import crypto from 'crypto';
import { db, withTransaction } from '../db';
import { Order, PaymentClassification, OrderReference } from '../types';
import { appConfig as config } from '../config';

export interface ProcessWebhookResult {
  success: boolean;
  status:
    | 'PROCESSED'
    | 'LATE_PAYMENT_CREDITED'
    | 'ALREADY_PROCESSED'
    | 'AMOUNT_MISMATCH'
    | 'DUPLICATE_PAYMENT'
    | 'UNMATCHED'
    | 'FAILED';
  message: string;
  orderId?: string;
  amountCredited?: number;
  classification?: PaymentClassification;
}

export class PaymentService {
  /**
   * Processes incoming payment with atomic idempotency (insert event first),
   * reference resolution across superseded references, and late payment acceptance.
   */
  public static async processWebhook(event: {
    eventId: string;
    referenceId: string;
    amount: number;
    gateway: string;
    status: 'SUCCESS' | 'FAILURE';
    rawPayload: any;
  }): Promise<ProcessWebhookResult> {
    const { eventId, referenceId, amount, gateway, status, rawPayload } = event;

    if (!eventId || !referenceId) {
      return {
        success: false,
        status: 'FAILED',
        message: 'Missing eventId or referenceId'
      };
    }

    return await withTransaction(async () => {
      // 1. Insert into payment_events first to catch duplicate eventId without race condition
      const eventRecordId = crypto.randomUUID();

      try {
        await db.run(
          `INSERT INTO payment_events (
            id, event_id, gateway, amount, classification, review_status, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            eventRecordId,
            eventId,
            gateway,
            amount,
            'MATCHED', // temporary; updated below
            'NONE',
            JSON.stringify(rawPayload)
          ]
        );
      } catch (err: any) {
        if (err.message && err.message.includes('UNIQUE constraint failed: payment_events.event_id')) {
          return {
            success: true,
            status: 'ALREADY_PROCESSED',
            message: `Event ${eventId} has already been processed idempotently. No action taken.`
          };
        }
        throw err;
      }

      // 2. Find order via order_references or direct reference_id
      const refRecord = await db.get<OrderReference>(
        'SELECT * FROM order_references WHERE reference_id = ?',
        [referenceId]
      );

      let order: Order | undefined;
      if (refRecord) {
        order = await db.get<Order>('SELECT * FROM orders WHERE id = ?', [refRecord.order_id]);
      } else {
        order = await db.get<Order>('SELECT * FROM orders WHERE reference_id = ?', [referenceId]);
      }

      // 3. UNMATCHED: No order found matching reference
      if (!order) {
        await db.run(
          'UPDATE payment_events SET classification = ?, review_status = ? WHERE id = ?',
          ['UNMATCHED', 'NEEDS_REVIEW', eventRecordId]
        );
        return {
          success: true,
          status: 'UNMATCHED',
          classification: 'UNMATCHED',
          message: `No order found for reference ${referenceId}. Event saved as UNMATCHED for review.`
        };
      }

      // Update event with order_id
      await db.run('UPDATE payment_events SET order_id = ? WHERE id = ?', [order.id, eventRecordId]);

      // 4. Gateway reported failure
      if (status !== 'SUCCESS') {
        await db.run(
          'UPDATE payment_events SET classification = ?, review_status = ? WHERE id = ?',
          ['UNMATCHED', 'NEEDS_REVIEW', eventRecordId]
        );
        return {
          success: false,
          status: 'FAILED',
          orderId: order.id,
          message: 'Payment gateway reported payment failure.'
        };
      }

      // 5. DUPLICATE_PAYMENT: Order was already PAID
      if (order.status === 'PAID') {
        await db.run(
          'UPDATE payment_events SET classification = ?, review_status = ? WHERE id = ?',
          ['DUPLICATE_PAYMENT', 'NEEDS_REVIEW', eventRecordId]
        );
        return {
          success: true,
          status: 'DUPLICATE_PAYMENT',
          classification: 'DUPLICATE_PAYMENT',
          orderId: order.id,
          message: `Order ${order.id} was already marked as PAID. Duplicate payment logged for review.`
        };
      }

      // 6. AMOUNT_MISMATCH: Underpayment or overpayment
      if (amount !== order.amount) {
        await db.run(
          'UPDATE payment_events SET classification = ?, review_status = ? WHERE id = ?',
          ['AMOUNT_MISMATCH', 'NEEDS_REVIEW', eventRecordId]
        );
        return {
          success: false,
          status: 'AMOUNT_MISMATCH',
          classification: 'AMOUNT_MISMATCH',
          orderId: order.id,
          message: `Amount mismatch: expected ${order.amount} paise, received ${amount} paise. Flagged for review.`
        };
      }

      const now = Date.now();
      const isExpired = order.status === 'EXPIRED' || now >= order.expires_at;

      // 7. LATE PAYMENT: Exact-amount payment for unpaid order is credited even if QR expired!
      if (isExpired) {
        await db.run(
          'UPDATE orders SET status = "PAID", paid_late = 1, paid_at = ? WHERE id = ?',
          [now, order.id]
        );

        await db.run(
          'UPDATE merchants SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [amount, order.merchant_id]
        );

        await db.run(
          'UPDATE payment_events SET classification = ?, review_status = "NONE" WHERE id = ?',
          ['LATE', eventRecordId]
        );

        return {
          success: true,
          status: 'LATE_PAYMENT_CREDITED',
          classification: 'LATE',
          orderId: order.id,
          amountCredited: amount,
          message: 'Order QR had expired, but exact-amount payment was accepted and credited (paid_late = 1).'
        };
      }

      // 8. MATCHED: Standard on-time exact payment
      await db.run(
        'UPDATE orders SET status = "PAID", paid_late = 0, paid_at = ? WHERE id = ?',
        [now, order.id]
      );

      await db.run(
        'UPDATE merchants SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [amount, order.merchant_id]
      );

      await db.run(
        'UPDATE payment_events SET classification = ?, review_status = "NONE" WHERE id = ?',
        ['MATCHED', eventRecordId]
      );

      return {
        success: true,
        status: 'PROCESSED',
        classification: 'MATCHED',
        orderId: order.id,
        amountCredited: amount,
        message: 'Payment confirmed and merchant balance credited successfully.'
      };
    });
  }

  /**
   * Dev/Demo simulator helper (mounted only when enabled and not in production)
   */
  public static async simulatePayment(orderId: string, merchantId: string): Promise<ProcessWebhookResult> {
    if (config.isProduction || !config.enablePaymentSimulator) {
      throw new Error('Payment simulator is disabled in this environment.');
    }

    const order = await db.get<Order>('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) {
      throw new Error('Order not found');
    }

    if (order.merchant_id !== merchantId) {
      throw new Error('Order does not belong to authenticated merchant');
    }

    const mockEventId = `SIM_${crypto.randomUUID()}`;
    return this.processWebhook({
      eventId: mockEventId,
      referenceId: order.reference_id,
      amount: order.amount,
      gateway: 'UPI_SIMULATOR',
      status: 'SUCCESS',
      rawPayload: { simulated: true, orderId, timestamp: new Date().toISOString() }
    });
  }
}
