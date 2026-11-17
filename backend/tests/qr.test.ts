import { QrService } from '../src/services/qrService';
import { OrderService } from '../src/services/orderService';
import { initDatabase, db } from '../src/db';

describe('Feature 1: Dynamic UPI QR Code Generation & Verification', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('should generate valid UPI payload with correct NPCI format', () => {
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const result = QrService.generateUpiPayload({
      vpa: 'testmerchant@upi',
      merchantName: 'Test Store',
      amountInPaise: 49900, // 499.00 INR
      referenceId: 'TR_123456789',
      note: 'Grocery bill',
      expiresAt
    });

    expect(result.upiPayload).toContain('upi://pay?');
    expect(result.upiPayload).toContain('pa=testmerchant%40upi');
    expect(result.upiPayload).toContain('pn=Test+Store');
    expect(result.upiPayload).toContain('am=499.00');
    expect(result.upiPayload).toContain('cu=INR');
    expect(result.upiPayload).toContain('tr=TR_123456789');
    expect(result.upiPayload).toContain('tn=Grocery+bill');
    expect(result.formattedAmount).toBe('499.00');
  });

  it('should create order with PENDING status and 5-minute expiry', async () => {
    const amount = 25000; // 250.00 INR
    const order = await OrderService.createOrder('demo-merchant-id', amount, 'Table 4');

    expect(order.id).toBeDefined();
    expect(order.amount).toBe(25000);
    expect(order.status).toBe('PENDING');
    expect(order.expires_at).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(order.expires_at).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 1000);
    expect(order.serverTime).toBeDefined();
    expect(order.expiresInSeconds).toBeGreaterThan(0);
  });

  it('should automatically mark order as EXPIRED if 5 minutes have elapsed', async () => {
    const order = await OrderService.createOrder('demo-merchant-id', 10000, 'Test Expire');

    // Artificially age the order's expiry timestamp into the past
    const pastTime = Date.now() - 1000;
    await db.run('UPDATE orders SET expires_at = ? WHERE id = ?', [pastTime, order.id]);

    const retrieved = await OrderService.getOrder(order.id, 'demo-merchant-id');
    expect(retrieved?.status).toBe('EXPIRED');
    expect(retrieved?.expiresInSeconds).toBe(0);
  });

  it('should refresh an expired order with a new reference and reset 5-minute timer', async () => {
    const order = await OrderService.createOrder('demo-merchant-id', 35000, 'Refresh Test');
    const oldRef = order.reference_id;

    // Artificially expire it
    await db.run('UPDATE orders SET expires_at = ?, status = ? WHERE id = ?', [
      Date.now() - 5000,
      'EXPIRED',
      order.id
    ]);

    const refreshed = await OrderService.refreshOrder(order.id, 'demo-merchant-id');
    expect(refreshed.id).toBe(order.id);
    expect(refreshed.status).toBe('PENDING');
    expect(refreshed.reference_id).not.toBe(oldRef);
    expect(refreshed.expires_at).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
  });
});
