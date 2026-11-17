import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db, withTransaction } from '../db';
import { appConfig as config } from '../config';
import { Merchant, Payout, Order, SensitiveAction } from '../types';

export function isValidUpiVpa(vpa: string): boolean {
  return typeof vpa === 'string' && /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(vpa.trim());
}

export function isValidIfsc(ifsc: string): boolean {
  return typeof ifsc === 'string' && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

export function isValidBankAccount(acc: string): boolean {
  return typeof acc === 'string' && /^\d{9,18}$/.test(acc.trim());
}

export class SecurityService {
  /**
   * Generates a 2-minute, single-use sensitive action token bound to merchant and action
   */
  public static generateSensitiveToken(
    merchantId: string,
    action: SensitiveAction,
    authMethod: 'BIOMETRIC' | 'PIN'
  ): string {
    const jti = crypto.randomUUID();
    return jwt.sign(
      {
        merchantId,
        action,
        authMethod,
        scope: 'SENSITIVE_ACTION',
        jti
      },
      config.jwtSecret,
      { expiresIn: '2m' }
    );
  }

  /**
   * Fallback verification: Merchant device PIN / passcode with 5-attempt/15-min lockout
   */
  public static async verifyPasscode(
    merchantId: string,
    passcode: string,
    action: SensitiveAction
  ): Promise<{ token: string }> {
    const merchant = await db.get<Merchant>(
      'SELECT id, passcode_hash, failed_pin_attempts, pin_locked_until FROM merchants WHERE id = ?',
      [merchantId]
    );

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    const now = Date.now();
    if (merchant.pin_locked_until && merchant.pin_locked_until > now) {
      const remainingMinutes = Math.ceil((merchant.pin_locked_until - now) / 60000);
      throw new Error(`Passcode verification locked. Try again in ${remainingMinutes} minute(s).`);
    }

    const isValid = await bcrypt.compare(passcode, merchant.passcode_hash);

    if (!isValid) {
      const currentAttempts = (merchant.failed_pin_attempts || 0) + 1;
      if (currentAttempts >= 5) {
        const lockedUntil = now + 15 * 60 * 1000;
        await db.run(
          'UPDATE merchants SET failed_pin_attempts = 0, pin_locked_until = ? WHERE id = ?',
          [lockedUntil, merchantId]
        );
        throw new Error('Maximum 5 incorrect attempts exceeded. Passcode locked for 15 minutes.');
      } else {
        await db.run(
          'UPDATE merchants SET failed_pin_attempts = ? WHERE id = ?',
          [currentAttempts, merchantId]
        );
        const remaining = 5 - currentAttempts;
        throw new Error(`Invalid passcode. ${remaining} attempt(s) remaining.`);
      }
    }

    // Reset failed attempts on success
    await db.run(
      'UPDATE merchants SET failed_pin_attempts = 0, pin_locked_until = NULL WHERE id = ?',
      [merchantId]
    );

    const token = this.generateSensitiveToken(merchantId, action, 'PIN');
    return { token };
  }

  /**
   * Sensitive Action: Process Merchant Payout / Withdrawal
   * Enforces: atomic balance update, idempotency key, daily & per-txn maximums, server-side destination
   */
  public static async executePayout(
    merchantId: string,
    amountInPaise: number,
    idempotencyKey?: string
  ): Promise<Payout> {
    if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
      throw new Error('Payout amount must be a positive integer in paise.');
    }

    if (amountInPaise > config.payoutMaxPerTxnPaise) {
      throw new Error(`Amount exceeds maximum per-transaction limit of ₹${(config.payoutMaxPerTxnPaise / 100).toFixed(2)}`);
    }

    const now = Date.now();

    // Check daily payout total (last 24h)
    const dayStart = now - 24 * 60 * 60 * 1000;
    const dailyTotalRow = await db.get<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) as total FROM payouts WHERE merchant_id = ? AND created_timestamp >= ?',
      [merchantId, dayStart]
    );

    const dailyTotal = dailyTotalRow?.total || 0;
    if (dailyTotal + amountInPaise > config.payoutMaxPerDayPaise) {
      throw new Error(`Payout exceeds 24-hour daily limit of ₹${(config.payoutMaxPerDayPaise / 100).toFixed(2)}`);
    }

    return await withTransaction(async () => {
      // Idempotency check if header provided
      if (idempotencyKey) {
        const existing = await db.get<Payout>(
          'SELECT * FROM payouts WHERE idempotency_key = ?',
          [idempotencyKey]
        );
        if (existing) {
          if (existing.merchant_id !== merchantId) {
            throw new Error('Idempotency key conflict');
          }
          return existing;
        }
      }

      // Read destination strictly from merchant record on server
      const merchant = await db.get<Merchant>(
        'SELECT upi_vpa, bank_account_number, bank_ifsc FROM merchants WHERE id = ?',
        [merchantId]
      );

      if (!merchant) {
        throw new Error('Merchant record not found');
      }

      let destinationType = 'UPI';
      let destinationDetails = merchant.upi_vpa;

      if (merchant.bank_account_number && merchant.bank_ifsc) {
        destinationType = 'BANK';
        destinationDetails = `${merchant.bank_account_number} (${merchant.bank_ifsc})`;
      }

      if (!destinationDetails) {
        throw new Error('No settlement account (UPI VPA or Bank Details) configured for merchant');
      }

      // Atomic balance deduction: checks balance >= amountInPaise in the single query!
      const updateResult = await db.run(
        'UPDATE merchants SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND balance >= ?',
        [amountInPaise, merchantId, amountInPaise]
      );

      if (updateResult.changes !== 1) {
        throw new Error('Insufficient wallet balance to execute payout');
      }

      const payoutId = crypto.randomUUID();
      const nowIso = new Date(now).toISOString();

      await db.run(
        `INSERT INTO payouts (
          id, merchant_id, amount, destination_type, destination_details, status, idempotency_key, created_at, created_timestamp
        ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
        [payoutId, merchantId, amountInPaise, destinationType, destinationDetails, idempotencyKey || null, nowIso, now]
      );

      const payout = await db.get<Payout>('SELECT * FROM payouts WHERE id = ?', [payoutId]);
      return payout!;
    });
  }

  /**
   * Sensitive Action: Update Settlement Details
   */
  public static async updateSettlementDetails(
    merchantId: string,
    details: { upiVpa?: string; bankAccountNumber?: string; bankIfsc?: string }
  ): Promise<Partial<Merchant>> {
    const { upiVpa, bankAccountNumber, bankIfsc } = details;

    if (upiVpa !== undefined && !isValidUpiVpa(upiVpa)) {
      throw new Error('Invalid UPI ID format. Expected format: username@bank');
    }

    if (bankIfsc !== undefined && !isValidIfsc(bankIfsc)) {
      throw new Error('Invalid IFSC code. Expected 4 letters, 0, then 6 alphanumeric characters (e.g. HDFC0001234)');
    }

    if (bankAccountNumber !== undefined && !isValidBankAccount(bankAccountNumber)) {
      throw new Error('Invalid bank account number. Expected 9 to 18 digits.');
    }

    await db.run(
      `UPDATE merchants SET
        upi_vpa = COALESCE(?, upi_vpa),
        bank_account_number = COALESCE(?, bank_account_number),
        bank_ifsc = COALESCE(?, bank_ifsc),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        upiVpa?.trim() || null,
        bankAccountNumber?.trim() || null,
        bankIfsc?.trim()?.toUpperCase() || null,
        merchantId
      ]
    );

    const updated = await db.get<Merchant>(
      'SELECT id, upi_vpa, bank_account_number, bank_ifsc FROM merchants WHERE id = ?',
      [merchantId]
    );

    return {
      ...updated,
      bank_account_number: updated?.bank_account_number ? `••••••••${updated.bank_account_number.slice(-4)}` : null
    };
  }

  /**
   * Sensitive Action: Export Transactions Report to CSV
   */
  public static async exportTransactionsReport(merchantId: string): Promise<string> {
    const orders = await db.all<Order>(
      'SELECT id, reference_id, amount, status, paid_late, expires_at, paid_at, created_at FROM orders WHERE merchant_id = ? ORDER BY created_at DESC',
      [merchantId]
    );

    const headers = ['Order ID', 'UPI Reference', 'Amount (INR)', 'Status', 'Paid Late', 'Paid At', 'Created At'];
    const rows = orders.map(o => [
      o.id,
      o.reference_id,
      (o.amount / 100).toFixed(2),
      o.status,
      o.paid_late ? 'YES' : 'NO',
      o.paid_at ? new Date(o.paid_at).toISOString() : 'N/A',
      o.created_at
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  /**
   * Lists payout history for the merchant
   */
  public static async listPayouts(merchantId: string): Promise<Payout[]> {
    return await db.all<Payout>(
      'SELECT * FROM payouts WHERE merchant_id = ? ORDER BY created_timestamp DESC LIMIT 20',
      [merchantId]
    );
  }

  /**
   * Lists payments requiring merchant attention (NEEDS_REVIEW or LATE)
   */
  public static async listNeedsAttention(merchantId: string): Promise<any[]> {
    const lateOrders = await db.all<Order>(
      'SELECT * FROM orders WHERE merchant_id = ? AND paid_late = 1 ORDER BY created_at DESC LIMIT 20',
      [merchantId]
    );

    const events = await db.all(
      `SELECT pe.* FROM payment_events pe
       LEFT JOIN orders o ON pe.order_id = o.id
       WHERE (o.merchant_id = ? OR pe.order_id IS NULL) AND pe.review_status = 'NEEDS_REVIEW'
       ORDER BY pe.processed_at DESC LIMIT 20`,
      [merchantId]
    );

    return { lateOrders, flaggedEvents: events } as any;
  }
}
