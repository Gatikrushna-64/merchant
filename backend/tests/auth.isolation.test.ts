import request from 'supertest';
import { app } from '../src/app';
import { initDatabase, db } from '../src/db';
import { AuthService } from '../src/services/authService';
import { OrderService } from '../src/services/orderService';
import { SecurityService } from '../src/services/securityService';
import { SESSION_COOKIE_NAME } from '../src/middleware/authMiddleware';
import bcrypt from 'bcryptjs';

describe('Section B & G: Authentication, Authorization & Merchant Isolation', () => {
  let merchantAId: string;
  let merchantBId: string;
  let sessionCookieA: string;
  let sessionCookieB: string;
  let orderAId: string;

  beforeAll(async () => {
    await initDatabase();

    // Create Merchant A
    merchantAId = 'merchant-a-' + Date.now();
    const pinA = '284915';
    const hashA = await bcrypt.hash(pinA, 12);
    await db.run(
      `INSERT INTO merchants (id, name, business_name, phone, phone_verified, upi_vpa, passcode_hash, balance)
       VALUES (?, ?, ?, ?, 1, ?, ?, 100000)`,
      [merchantAId, 'Merchant A', 'Store A', '+919811111111', 'storea@upi', hashA]
    );
    const tokenA = AuthService.generateSessionToken(merchantAId, '+919811111111');
    sessionCookieA = `${SESSION_COOKIE_NAME}=${tokenA}`;

    // Create Merchant B
    merchantBId = 'merchant-b-' + Date.now();
    const pinB = '739152';
    const hashB = await bcrypt.hash(pinB, 12);
    await db.run(
      `INSERT INTO merchants (id, name, business_name, phone, phone_verified, upi_vpa, passcode_hash, balance)
       VALUES (?, ?, ?, ?, 1, ?, ?, 50000)`,
      [merchantBId, 'Merchant B', 'Store B', '+919822222222', 'storeb@upi', hashB]
    );
    const tokenB = AuthService.generateSessionToken(merchantBId, '+919822222222');
    sessionCookieB = `${SESSION_COOKIE_NAME}=${tokenB}`;

    // Create an order owned by Merchant A
    const orderA = await OrderService.createOrder(merchantAId, 25000, 'Table 1');
    orderAId = orderA.id;
  });

  it('should reject unauthenticated access with 401 across protected routes', async () => {
    const endpoints = [
      { method: 'get', url: '/api/v1/orders' },
      { method: 'get', url: `/api/v1/orders/${orderAId}` },
      { method: 'post', url: '/api/v1/orders' },
      { method: 'post', url: `/api/v1/orders/${orderAId}/refresh` },
      { method: 'get', url: '/api/v1/security/status' },
      { method: 'post', url: '/api/v1/security/payouts' },
      { method: 'put', url: '/api/v1/security/bank-details' },
      { method: 'get', url: '/api/v1/security/reports/export' }
    ];

    for (const ep of endpoints) {
      const res = await (request(app) as any)[ep.method](ep.url);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }
  });

  it('should enforce merchant isolation: Merchant B cannot access Merchant A orders (returns 404)', async () => {
    // Merchant B attempts to fetch Merchant A's order
    const resGet = await request(app)
      .get(`/api/v1/orders/${orderAId}`)
      .set('Cookie', sessionCookieB);

    expect(resGet.status).toBe(404);

    // Merchant B attempts to refresh Merchant A's order
    const resRefresh = await request(app)
      .post(`/api/v1/orders/${orderAId}/refresh`)
      .set('Cookie', sessionCookieB);

    expect(resRefresh.status).toBe(404);
  });

  it('should lock merchant login after 5 consecutive incorrect PIN attempts', async () => {
    const testPhone = '+919833333333';
    const hash = await bcrypt.hash('849201', 12);
    await db.run(
      `INSERT INTO merchants (id, name, business_name, phone, phone_verified, upi_vpa, passcode_hash, balance)
       VALUES (?, 'Lockout Test', 'Lock Store', ?, 1, 'lock@upi', ?, 0)`,
      ['merchant-lockout-' + Date.now(), testPhone, hash]
    );

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ phone: testPhone, pin: '000000' });
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('attempt(s) remaining');
    }

    // 5th failed attempt -> triggers 15-minute lockout
    const fifthRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: testPhone, pin: '000000' });

    expect(fifthRes.status).toBe(401);
    expect(fifthRes.body.error).toContain('locked for 15 minutes');

    // 6th attempt even with CORRECT pin must be locked
    const lockedRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: testPhone, pin: '849201' });

    expect(lockedRes.status).toBe(401);
    expect(lockedRes.body.error).toContain('Account temporarily locked');
  }, 15000);

  it('should reject replayed, expired, or wrong-merchant sensitive tokens', async () => {
    // Token issued for Merchant A
    const tokenA = SecurityService.generateSensitiveToken(merchantAId, 'PAYOUT', 'PIN');

    // Merchant B cannot use Merchant A's token
    const resWrongMerchant = await request(app)
      .post('/api/v1/security/payouts')
      .set('Cookie', sessionCookieB)
      .set('x-sensitive-token', tokenA)
      .send({ amount: 1000 });

    expect(resWrongMerchant.status).toBe(403);
    expect(resWrongMerchant.body.error).toContain('Token not authorized for this merchant');

    // Merchant A uses token for PAYOUT
    const resValidUse = await request(app)
      .post('/api/v1/security/payouts')
      .set('Cookie', sessionCookieA)
      .set('x-sensitive-token', tokenA)
      .send({ amount: 1000 });

    expect(resValidUse.status).toBe(200);

    // Replay attack: using the exact same token again must be rejected!
    const resReplay = await request(app)
      .post('/api/v1/security/payouts')
      .set('Cookie', sessionCookieA)
      .set('x-sensitive-token', tokenA)
      .send({ amount: 1000 });

    expect(resReplay.status).toBe(403);
    expect(resReplay.body.code).toBe('TOKEN_ALREADY_USED');
  });

  it('should reject trivial PINs on registration or reset', async () => {
    const trivialPins = ['000000', '123456', '111111', '654321', '012345'];
    for (const pin of trivialPins) {
      await expect(
        AuthService.resetPin('fake-token', pin)
      ).rejects.toThrow();
    }
  });
});

