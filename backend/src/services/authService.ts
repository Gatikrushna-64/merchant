import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db';
import { config } from '../config';
import { Merchant } from '../types';
import { OtpService, isValidIndianPhone } from './otpService';

export const PIN_LOCKOUT_MS = 15 * 60 * 1000;
export const MAX_PIN_ATTEMPTS = 5;

// Dummy hash for constant-time comparison on nonexistent accounts
const DUMMY_HASH = '$2a$12$e80yqV4sT79B4r0Qe1Gz2eW0z7i8o9p0a1s2d3f4g5h6j7k8l9z0a';

export function validatePinComplexity(pin: string): { valid: boolean; reason?: string } {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    return { valid: false, reason: 'PIN must be exactly 6 digits (0-9).' };
  }
  if (/^(\d)\1{5}$/.test(pin)) {
    return { valid: false, reason: 'Trivial PINs with repeated numbers are not allowed.' };
  }
  const sequences = [
    '012345', '123456', '234567', '345678', '456789',
    '987654', '876543', '765432', '654321', '543210',
    '121212', '123123'
  ];
  if (sequences.includes(pin)) {
    return { valid: false, reason: 'Sequential or easily guessable PINs are not allowed.' };
  }
  return { valid: true };
}

export class AuthService {
  public static generateSessionToken(merchantId: string, phone: string): string {
    return jwt.sign(
      { merchantId, phone, jti: crypto.randomUUID() },
      config.jwtSecret,
      { expiresIn: '12h' }
    );
  }

  public static async login(phone: string, pin: string): Promise<{
    token: string;
    merchant: Partial<Merchant>;
  }> {
    if (!isValidIndianPhone(phone)) {
      throw new Error('Invalid mobile number format');
    }
    if (typeof pin !== 'string' || pin.length !== 6) {
      throw new Error('PIN must be 6 digits');
    }

    const cleanPhone = OtpService.normalizePhone(phone);
    const now = Date.now();

    const merchant = await db.get<Merchant>(
      'SELECT * FROM merchants WHERE phone = ?',
      [cleanPhone]
    );

    if (!merchant) {
      // Timing attack protection
      await bcrypt.compare(pin, DUMMY_HASH).catch(() => {});
      throw new Error('Invalid mobile number or PIN');
    }

    // Check PIN lockout
    if (merchant.pin_locked_until && merchant.pin_locked_until > now) {
      const remainingMinutes = Math.ceil((merchant.pin_locked_until - now) / 60000);
      throw new Error(`Account temporarily locked due to failed PIN attempts. Try again in ${remainingMinutes} minute(s).`);
    }

    const isMatch = await bcrypt.compare(pin, merchant.passcode_hash);

    if (!isMatch) {
      const currentAttempts = (merchant.failed_pin_attempts || 0) + 1;

      if (currentAttempts >= MAX_PIN_ATTEMPTS) {
        const lockedUntil = now + PIN_LOCKOUT_MS;
        await db.run(
          'UPDATE merchants SET failed_pin_attempts = 0, pin_locked_until = ? WHERE id = ?',
          [lockedUntil, merchant.id]
        );
        throw new Error('Maximum 5 failed PIN attempts exceeded. Account is locked for 15 minutes.');
      } else {
        await db.run(
          'UPDATE merchants SET failed_pin_attempts = ? WHERE id = ?',
          [currentAttempts, merchant.id]
        );
        const remaining = MAX_PIN_ATTEMPTS - currentAttempts;
        throw new Error(`Invalid mobile number or PIN. ${remaining} attempt(s) remaining.`);
      }
    }

    // Success: reset failed attempts
    await db.run(
      'UPDATE merchants SET failed_pin_attempts = 0, pin_locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [merchant.id]
    );

    const token = this.generateSessionToken(merchant.id, merchant.phone);

    return {
      token,
      merchant: {
        id: merchant.id,
        name: merchant.name,
        business_name: merchant.business_name,
        phone: merchant.phone,
        upi_vpa: merchant.upi_vpa,
        biometrics_enabled: merchant.biometrics_enabled,
        balance: merchant.balance
      }
    };
  }

  public static async resetPin(verificationToken: string, newPin: string): Promise<{ success: boolean; message: string }> {
    if (!verificationToken) {
      throw new Error('Verification token required');
    }

    const pinCheck = validatePinComplexity(newPin);
    if (!pinCheck.valid) {
      throw new Error(pinCheck.reason || 'Invalid PIN');
    }

    let phone: string;
    try {
      const decoded = jwt.verify(verificationToken, config.jwtSecret) as any;
      if (decoded.scope !== 'PHONE_VERIFIED' || !decoded.phone) {
        throw new Error('Invalid token scope');
      }
      phone = decoded.phone;
    } catch {
      throw new Error('Verification session expired or invalid. Please verify phone again.');
    }

    const merchant = await db.get<Merchant>('SELECT id FROM merchants WHERE phone = ?', [phone]);
    if (!merchant) {
      throw new Error('No merchant account found for this mobile number.');
    }

    const passcodeHash = await bcrypt.hash(newPin, 12);

    await db.run(
      `UPDATE merchants SET 
        passcode_hash = ?, 
        failed_pin_attempts = 0, 
        pin_locked_until = NULL, 
        updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [passcodeHash, merchant.id]
    );

    return { success: true, message: 'PIN reset successfully. Please log in with your new PIN.' };
  }

  public static async register(input: {
    verificationToken: string;
    name: string;
    businessName: string;
    upiVpa: string;
    passcode: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
  }): Promise<{
    merchant: Partial<Merchant>;
    token?: string;
    alreadyRegistered?: boolean;
    message?: string;
  }> {
    const { verificationToken, name, businessName, upiVpa, passcode, bankAccountNumber, bankIfsc } = input;

    if (!verificationToken) {
      throw new Error('Mobile verification token is required.');
    }

    let phone: string;
    try {
      const decoded = jwt.verify(verificationToken, config.jwtSecret) as any;
      if (decoded.scope !== 'PHONE_VERIFIED' || !decoded.phone) {
        throw new Error('Invalid token scope');
      }
      phone = decoded.phone;
    } catch {
      throw new Error('Verification session expired or invalid. Please verify phone again.');
    }

    // Never issue a session for an already-registered phone. Return generic message.
    const existing = await db.get<Merchant>('SELECT id FROM merchants WHERE phone = ?', [phone]);
    if (existing) {
      return {
        merchant: {},
        alreadyRegistered: true,
        message: 'This mobile number is already registered. Please proceed to sign in with your PIN.'
      };
    }

    const pinCheck = validatePinComplexity(passcode);
    if (!pinCheck.valid) {
      throw new Error(pinCheck.reason || 'Invalid PIN');
    }

    const passcodeHash = await bcrypt.hash(passcode, 12);
    const merchantId = crypto.randomUUID();
    const finalVpa = upiVpa?.trim() || `${phone.replace(/\D/g, '')}@okhdfcbank`;

    await db.run(
      `INSERT INTO merchants (
        id, name, business_name, phone, phone_verified, upi_vpa,
        bank_account_number, bank_ifsc, passcode_hash, biometrics_enabled, balance
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 0, 0)`,
      [
        merchantId,
        name.trim(),
        businessName.trim(),
        phone,
        finalVpa,
        bankAccountNumber?.trim() || null,
        bankIfsc?.trim()?.toUpperCase() || null,
        passcodeHash
      ]
    );

    const token = this.generateSessionToken(merchantId, phone);

    return {
      merchant: {
        id: merchantId,
        name: name.trim(),
        business_name: businessName.trim(),
        phone,
        phone_verified: 1,
        upi_vpa: finalVpa,
        biometrics_enabled: 0,
        balance: 0
      },
      token
    };
  }
}

