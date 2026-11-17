import request from 'supertest';
import crypto from 'crypto';
import { app } from '../api/app';
import { initDatabase, db } from '../api/db';
import { OrderService } from '../api/services/orderService';
import { AuthService } from '../api/services/authService';
import { SecurityService } from '../api/services/securityService';
import { appConfig as config } from '../api/config';
import { SESSION_COOKIE_NAME } from '../api/middleware/authMiddleware';
import bcrypt from 'bcryptjs';

describe('Section C & G: Payment Webhook Hardening, Concurrency & Idempotency', () => {
  let merchantId: string;
  let sessionCookie: string;

  beforeAll(async () => {
    await initDatabase();

    merchantId = 'mch-pay-test-' + Date.now();
    const hash = await bcrypt.hash('938174', 12);
    await db.run(
      `INSERT INTO merchants (id, name, business_name, phone, phone_verified, upi_vpa, passcode_hash, balance)
       VALUES (?, 'Payment Tester', 'Payment Store', '+919877777777', 1, 'tester@upi', ?, 100000)`,
      [merchantId, hash]
    );

    const token = AuthService.generateSessionToken(merchantId, '+919877777777');
    sessionCookie = `${SESSION_COOKIE_NAME}=${token}`;
  });

  function generateSignature(rawBody: string): string {
    return crypto
      .createHmac('sha256', config.webhookSecret)
      .update(rawBody)
      .digest('hex');
  }

  it('should reject webhooks with missing or invalid signature (401)', async () => {
    const payload = JSON.stringify({
      eventId: 'EVT_TEST_1',
      referenceId: 'REF_1',
      amount: 1000,
      status: 'SUCCESS'
    });

    // 1. Missing signature
    const missingRes = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(missingRes.status).toBe(401);
    expect(missingRes.body.error).toContain('Invalid or missing webhook signature');

    // 2. Bad/tampered signature
    const badRes = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', '0000000000000000000000000000000000000000000000000000000000000000')
      .send(payload);

    expect(badRes.status).toBe(401);
  });

  it('should process webhook with valid HMAC signature and credit balance', async () => {
    const order = await OrderService.createOrder(merchantId, 30000, 'Test Order 1');
    const merchantBefore = await db.get('SELECT balance FROM merchants WHERE id = ?', [merchantId]);

    const payload = JSON.stringify({
      eventId: `EVT_VALID_${Date.now()}`,
      referenceId: order.reference_id,
      amount: 30000,
      status: 'SUCCESS',
      gateway: 'PHONEPE_UPI'
    });

    const signature = generateSignature(payload);

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('PROCESSED');

    const merchantAfter = await db.get('SELECT balance FROM merchants WHERE id = ?', [merchantId]);
    expect(merchantAfter.balance).toBe(merchantBefore.balance + 30000);
  });

  it('should credit exactly once across 50 concurrent identical webhooks (strict idempotency)', async () => {
    const order = await OrderService.createOrder(merchantId, 15000, 'Concurrency Order');
    const merchantBefore = await db.get('SELECT balance FROM merchants WHERE id = ?', [merchantId]);

    const eventId = `EVT_PARALLEL_${Date.now()}`;
    const payload = JSON.stringify({
      eventId,
      referenceId: order.reference_id,
      amount: 15000,
      status: 'SUCCESS',
      gateway: 'RAZORPAY_UPI'
    });

    const signature = generateSignature(payload);

    // Dispatch 50 parallel identical webhooks
    const requests = Array.from({ length: 50 }, () =>
      request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', signature)
        .send(payload)
    );

    const responses = await Promise.all(requests);

    // All must return 200 OK
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const processedCount = responses.filter(r => r.body.status === 'PROCESSED').length;
    const alreadyProcessedCount = responses.filter(r => r.body.status === 'ALREADY_PROCESSED').length;

    expect(processedCount).toBe(1);
    expect(alreadyProcessedCount).toBe(49);

    // Balance must increase by EXACTLY 15000 paise (not 50 * 15000)
    const merchantAfter = await db.get('SELECT balance FROM merchants WHERE id = ?', [merchantId]);
    expect(merchantAfter.balance).toBe(merchantBefore.balance + 15000);
  });

  it('should accept late payment on expired QR, credit merchant, and mark paid_late = 1', async () => {
    const order = await OrderService.createOrder(merchantId, 20000, 'Late Order');

    // Artificially expire the order
    await db.run('UPDATE orders SET status = "EXPIRED", expires_at = ? WHERE id = ?', [
      Date.now() - 10000,
      order.id
    ]);

    const merchantBefore = await db.get('SELECT balance FROM merchants WHERE id = ?', [merchantId]);

    const payload = JSON.stringify({
      eventId: `EVT_LATE_${Date.now()}`,
      referenceId: order.reference_id,
      amount: 20000,
      status: 'SUCCESS',
      gateway: 'PAYTM_UPI'
    });
    const signature = generateSignature(payload);

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('LATE_PAYMENT_CREDITED');
    expect(res.body.classification).toBe('LATE');

    const updatedOrder = await db.get('SELECT status, paid_late FROM orders WHERE id = ?', [order.id]);
    expect(updatedOrder.status).toBe('PAID');
    expect(updatedOrder.paid_late).toBe(1);

    const merchantAfter = await db.get('SELECT balance FROM merchants WHERE id = ?', [merchantId]);
    expect(merchantAfter.balance).toBe(merchantBefore.balance + 20000);
  });

  it('should prevent balance overdraw across parallel payouts', async () => {
    // Set exact balance to 5000 paise (Rs 50)
    await db.run('UPDATE merchants SET balance = 5000 WHERE id = ?', [merchantId]);

    // Issue two distinct sensitive tokens for two withdrawal attempts of 5000 paise
    const token1 = SecurityService.generateSensitiveToken(merchantId, 'PAYOUT', 'PIN');
    const token2 = SecurityService.generateSensitiveToken(merchantId, 'PAYOUT', 'PIN');

    // Dispatch 2 concurrent payouts for 5000 paise each (total 10000 paise requested, but only 5000 available)
    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/v1/security/payouts')
        .set('Cookie', sessionCookie)
        .set('x-sensitive-token', token1)
        .send({ amount: 5000 }),
      request(app)
        .post('/api/v1/security/payouts')
        .set('Cookie', sessionCookie)
        .set('x-sensitive-token', token2)
        .send({ amount: 5000 })
    ]);

    const statuses = [res1.status, res2.status].sort();
    // One must succeed (200) and one must be rejected (400)
    expect(statuses).toEqual([200, 400]);

    const merchantAfter = await db.get('SELECT balance FROM merchants WHERE id = ?', [merchantId]);
    expect(merchantAfter.balance).toBe(0); // Cannot be negative!
  });
});

