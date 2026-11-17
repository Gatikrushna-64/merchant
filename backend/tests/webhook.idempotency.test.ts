import { PaymentService } from '../src/services/paymentService';
import { OrderService } from '../src/services/orderService';
import { initDatabase, db } from '../src/db';

describe('Feature 1: Payment Webhook Server Confirmation & Idempotency', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  const demoId = 'demo-merchant-id';

  it('should confirm payment, flip order to PAID, and credit merchant balance', async () => {
    const merchantBefore = await db.get('SELECT balance FROM merchants WHERE id = ?', [demoId]);
    const initialBalance = merchantBefore.balance;

    const amount = 50000; // 500.00 INR
    const order = await OrderService.createOrder(demoId, amount, 'Webhook Test');

    const eventId = `EVT_TEST_SUCCESS_${Date.now()}`;
    const result = await PaymentService.processWebhook({
      eventId,
      referenceId: order.reference_id,
      amount,
      gateway: 'RAZORPAY_UPI',
      status: 'SUCCESS',
      rawPayload: { eventId, amount }
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('PROCESSED');

    const updatedOrder = await OrderService.getOrder(order.id, demoId);
    expect(updatedOrder?.status).toBe('PAID');
    expect(updatedOrder?.paid_at).toBeDefined();

    const merchantAfter = await db.get('SELECT balance FROM merchants WHERE id = ?', [demoId]);
    expect(merchantAfter.balance).toBe(initialBalance + amount);
  });

  it('should be strictly idempotent: duplicate webhook delivery must NOT double credit', async () => {
    const amount = 30000;
    const order = await OrderService.createOrder(demoId, amount, 'Idempotency Test');

    const eventId = `EVT_DUP_TEST_${Date.now()}`;
    const webhookPayload = {
      eventId,
      referenceId: order.reference_id,
      amount,
      gateway: 'PAYTM_UPI',
      status: 'SUCCESS' as const,
      rawPayload: { eventId, amount }
    };

    // First call
    const firstResult = await PaymentService.processWebhook(webhookPayload);
    expect(firstResult.status).toBe('PROCESSED');

    const merchantAfterFirst = await db.get('SELECT balance FROM merchants WHERE id = ?', [demoId]);
    const balanceAfterFirst = merchantAfterFirst.balance;

    // Second call with identical eventId (duplicate callback replay)
    const secondResult = await PaymentService.processWebhook(webhookPayload);
    expect(secondResult.success).toBe(true);
    expect(secondResult.status).toBe('ALREADY_PROCESSED');

    // Third call
    const thirdResult = await PaymentService.processWebhook(webhookPayload);
    expect(thirdResult.status).toBe('ALREADY_PROCESSED');

    // Balance must be exactly the same as after the first call
    const merchantAfterDuplicates = await db.get('SELECT balance FROM merchants WHERE id = ?', [demoId]);
    expect(merchantAfterDuplicates.balance).toBe(balanceAfterFirst);
  });

  it('should credit exact-amount payment on an EXPIRED order and flag paid_late = 1', async () => {
    const order = await OrderService.createOrder(demoId, 20000, 'Expired Payment Test');

    // Artificially expire the order
    await db.run('UPDATE orders SET expires_at = ?, status = ? WHERE id = ?', [
      Date.now() - 5000,
      'EXPIRED',
      order.id
    ]);

    const merchantBefore = await db.get('SELECT balance FROM merchants WHERE id = ?', [demoId]);

    const result = await PaymentService.processWebhook({
      eventId: `EVT_EXP_${Date.now()}`,
      referenceId: order.reference_id,
      amount: 20000,
      gateway: 'PHONEPE_UPI',
      status: 'SUCCESS',
      rawPayload: { amount: 20000 }
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('LATE_PAYMENT_CREDITED');
    expect(result.classification).toBe('LATE');

    const updatedOrder = await OrderService.getOrder(order.id, demoId);
    expect(updatedOrder?.status).toBe('PAID');
    expect(updatedOrder?.paid_late).toBe(1);

    const merchantAfter = await db.get('SELECT balance FROM merchants WHERE id = ?', [demoId]);
    expect(merchantAfter.balance).toBe(merchantBefore.balance + 20000);
  });

  it('should reject webhook if amount is mismatched (underpayment prevention)', async () => {
    const order = await OrderService.createOrder(demoId, 10000, 'Amount Mismatch Test');

    const result = await PaymentService.processWebhook({
      eventId: `EVT_MISMATCH_${Date.now()}`,
      referenceId: order.reference_id,
      amount: 5000, // Attempted 50 INR payment for 100 INR order
      gateway: 'GPAY_UPI',
      status: 'SUCCESS',
      rawPayload: { amount: 5000 }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('AMOUNT_MISMATCH');
    expect(result.classification).toBe('AMOUNT_MISMATCH');
  });
});
