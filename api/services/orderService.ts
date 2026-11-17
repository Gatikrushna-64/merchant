import crypto from 'crypto';
import { db, withTransaction } from '../db';
import { Order } from '../types';
import { QrService } from './qrService';
import { appConfig as config } from '../config';

export const QR_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes strictly

export interface OrderResponseWithTiming extends Order {
  serverTime: number;
  expiresInSeconds: number;
}

export class OrderService {
  /**
   * Creates an order for the authenticated merchant with validation and reference recording.
   */
  public static async createOrder(
    merchantId: string,
    amountInPaise: number,
    note?: string
  ): Promise<OrderResponseWithTiming> {
    if (typeof amountInPaise !== 'number' || !Number.isInteger(amountInPaise)) {
      throw new Error('Order amount must be an integer number of paise');
    }

    if (amountInPaise < config.orderMinAmountPaise) {
      throw new Error(`Minimum order amount is ₹${(config.orderMinAmountPaise / 100).toFixed(2)}`);
    }

    if (amountInPaise > config.orderMaxAmountPaise) {
      throw new Error(`Maximum order amount is ₹${(config.orderMaxAmountPaise / 100).toFixed(2)}`);
    }

    const cleanNote = (note || 'Payment to merchant').trim().slice(0, 50);

    // Retrieve merchant profile
    const merchant = await db.get(
      'SELECT upi_vpa, business_name FROM merchants WHERE id = ?',
      [merchantId]
    );

    if (!merchant) {
      throw new Error('Merchant account not found');
    }

    const orderId = crypto.randomUUID();
    const referenceId = QrService.generateTransactionRef();
    const now = Date.now();
    const expiresAt = now + QR_EXPIRY_MS;

    const qrResult = QrService.generateUpiPayload({
      vpa: merchant.upi_vpa,
      merchantName: merchant.business_name,
      amountInPaise,
      referenceId,
      note: cleanNote,
      expiresAt
    });

    const nowIso = new Date(now).toISOString();

    await withTransaction(async () => {
      await db.run(
        `INSERT INTO orders (
          id, merchant_id, reference_id, amount, currency, note,
          upi_payload, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          merchantId,
          referenceId,
          amountInPaise,
          'INR',
          cleanNote,
          qrResult.upiPayload,
          'PENDING',
          expiresAt,
          nowIso
        ]
      );

      // Record in order_references table
      await db.run(
        `INSERT INTO order_references (reference_id, order_id, created_at)
         VALUES (?, ?, ?)`,
        [referenceId, orderId, now]
      );
    });

    const order = await this.getOrder(orderId, merchantId);
    if (!order) {
      throw new Error('Failed to retrieve created order');
    }

    return order;
  }

  /**
   * Retrieves an order and verifies merchant ownership. Returns null (or 404) on mismatch.
   */
  public static async getOrder(orderId: string, merchantId: string): Promise<OrderResponseWithTiming | null> {
    const order = await db.get<Order>('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return null;

    // Strict merchant isolation check
    if (order.merchant_id !== merchantId) {
      return null;
    }

    const now = Date.now();
    // Auto-expire order if past 5-minute threshold and still PENDING
    if (order.status === 'PENDING' && now >= order.expires_at) {
      await db.run('UPDATE orders SET status = ? WHERE id = ?', ['EXPIRED', order.id]);
      order.status = 'EXPIRED';
    }

    const diffSeconds = Math.max(0, Math.floor((order.expires_at - now) / 1000));

    return {
      ...order,
      serverTime: now,
      expiresInSeconds: order.status === 'PENDING' ? diffSeconds : 0
    };
  }

  /**
   * Refreshes an order with a fresh reference and resets the 5-minute timer.
   * STRICT: Allow /refresh only when the order is EXPIRED!
   */
  public static async refreshOrder(orderId: string, merchantId: string): Promise<OrderResponseWithTiming> {
    const existing = await db.get<Order>('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!existing || existing.merchant_id !== merchantId) {
      throw new Error('Order not found');
    }

    const now = Date.now();
    const isActuallyExpired = existing.status === 'EXPIRED' || (existing.status === 'PENDING' && now >= existing.expires_at);

    if (existing.status === 'PAID') {
      throw new Error('Cannot refresh an already PAID order');
    }

    if (!isActuallyExpired) {
      throw new Error('Order has not expired yet. Refresh is allowed only after the 5-minute window expires.');
    }

    const merchant = await db.get(
      'SELECT upi_vpa, business_name FROM merchants WHERE id = ?',
      [merchantId]
    );

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    const newReferenceId = QrService.generateTransactionRef();
    const newExpiresAt = now + QR_EXPIRY_MS;

    const qrResult = QrService.generateUpiPayload({
      vpa: merchant.upi_vpa,
      merchantName: merchant.business_name,
      amountInPaise: existing.amount,
      referenceId: newReferenceId,
      note: existing.note,
      expiresAt: newExpiresAt
    });

    await withTransaction(async () => {
      // Mark old reference as superseded
      await db.run(
        'UPDATE order_references SET superseded_at = ? WHERE reference_id = ?',
        [now, existing.reference_id]
      );

      // Add new reference record
      await db.run(
        'INSERT INTO order_references (reference_id, order_id, created_at) VALUES (?, ?, ?)',
        [newReferenceId, orderId, now]
      );

      // Update active reference on order
      await db.run(
        `UPDATE orders SET
          reference_id = ?,
          upi_payload = ?,
          status = 'PENDING',
          expires_at = ?
        WHERE id = ?`,
        [newReferenceId, qrResult.upiPayload, newExpiresAt, orderId]
      );
    });

    const updated = await this.getOrder(orderId, merchantId);
    return updated!;
  }

  /**
   * Lists orders for the authenticated merchant with pagination and filtering.
   */
  public static async listMerchantOrders(
    merchantId: string,
    options: {
      status?: string;
      searchRef?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ orders: Order[]; total: number; summary: { todayOrdersCount: number; todayPaidPaise: number } }> {
    const limit = Math.min(options.limit || 50, 100);
    const offset = options.offset || 0;

    let query = 'SELECT * FROM orders WHERE merchant_id = ?';
    const params: any[] = [merchantId];

    if (options.status) {
      query += ' AND status = ?';
      params.push(options.status.toUpperCase());
    }

    if (options.searchRef) {
      query += ' AND reference_id LIKE ?';
      params.push(`%${options.searchRef.trim()}%`);
    }

    if (options.startDate) {
      query += ' AND created_at >= ?';
      params.push(options.startDate);
    }

    if (options.endDate) {
      query += ' AND created_at <= ?';
      params.push(options.endDate);
    }

    // Auto-expire any pending orders that have timed out
    const now = Date.now();
    await db.run(
      'UPDATE orders SET status = "EXPIRED" WHERE merchant_id = ? AND status = "PENDING" AND expires_at <= ?',
      [merchantId, now]
    );

    const countRow = await db.get<{ count: number }>(
      query.replace('SELECT *', 'SELECT COUNT(*) as count'),
      params
    );

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const orders = await db.all<Order>(query, params);

    // Calculate today's summary (midnight to now)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const summaryRow = await db.get<{ count: number; totalPaid: number }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) as totalPaid
       FROM orders WHERE merchant_id = ? AND created_at >= ?`,
      [merchantId, todayIso]
    );

    return {
      orders,
      total: countRow?.count || 0,
      summary: {
        todayOrdersCount: summaryRow?.count || 0,
        todayPaidPaise: summaryRow?.totalPaid || 0
      }
    };
  }
}
