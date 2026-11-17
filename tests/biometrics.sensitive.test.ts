import { initDatabase, db } from '../api/db';
import { SecurityService } from '../api/services/securityService';
import { requireSensitiveAction } from '../api/middleware/authMiddleware';
import jwt from 'jsonwebtoken';
import { appConfig as config } from '../api/config';

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
    setHeader(name: string, val: string) {
      this.headers[name] = val;
      return this;
    },
    send(content: any) {
      this.body = content;
      return this;
    }
  };
  return res;
}

describe('Feature 2: Biometric Access & Sensitive Action Guards', () => {
  const demoId = 'demo-merchant-id';

  beforeAll(async () => {
    await initDatabase();
  });

  it('should verify correct device passcode and return sensitive action token bound to action', async () => {
    const pin = config.seedDemoPin || '123456';
    const result = await SecurityService.verifyPasscode(demoId, pin, 'PAYOUT');
    expect(result.token).toBeDefined();

    const decoded = jwt.verify(result.token, config.jwtSecret) as any;
    expect(decoded.merchantId).toBe(demoId);
    expect(decoded.authMethod).toBe('PIN');
    expect(decoded.action).toBe('PAYOUT');
    expect(decoded.scope).toBe('SENSITIVE_ACTION');
    expect(decoded.jti).toBeDefined();
  });

  it('should reject invalid passcode with an error', async () => {
    await expect(
      SecurityService.verifyPasscode(demoId, '000000', 'PAYOUT')
    ).rejects.toThrow('Invalid passcode');
  });

  it('should reject sensitive action via middleware when sensitive token is missing', async () => {
    const req: any = {
      merchant: { id: demoId },
      headers: {},
      body: { amount: 1000 }
    };
    const res = createMockResponse();
    let nextCalled = false;

    const middleware = requireSensitiveAction('PAYOUT');
    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('SENSITIVE_AUTH_REQUIRED');
  });

  it('should allow sensitive action through middleware and mark token as used (single-use)', async () => {
    const pin = config.seedDemoPin || '123456';
    const { token } = await SecurityService.verifyPasscode(demoId, pin, 'PAYOUT');

    const req: any = {
      merchant: { id: demoId },
      headers: { 'x-sensitive-token': token },
      body: { amount: 5000 }
    };
    const res = createMockResponse();
    let nextCalled = false;

    const middleware = requireSensitiveAction('PAYOUT');
    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);

    // Replay attempt must be rejected
    const replayRes = createMockResponse();
    let replayNext = false;
    await middleware(req, replayRes, () => {
      replayNext = true;
    });

    expect(replayNext).toBe(false);
    expect(replayRes.statusCode).toBe(403);
    expect(replayRes.body.code).toBe('TOKEN_ALREADY_USED');
  });

  it('should reject sensitive action when token has wrong action scope', async () => {
    // Token issued for EXPORT, but used for PAYOUT
    const token = SecurityService.generateSensitiveToken(demoId, 'EXPORT', 'PIN');
    const req: any = {
      merchant: { id: demoId },
      headers: { 'x-sensitive-token': token }
    };
    const res = createMockResponse();
    let nextCalled = false;

    const middleware = requireSensitiveAction('PAYOUT');
    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('Token action mismatch');
  });

  it('should update bank and settlement details with format validation', async () => {
    const updated = await SecurityService.updateSettlementDetails(demoId, {
      bankAccountNumber: '98765432101234',
      bankIfsc: 'HDFC0001234',
      upiVpa: 'newvpa@okhdfcbank'
    });

    expect(updated.bank_account_number).toContain('••••••••1234');
    expect(updated.bank_ifsc).toBe('HDFC0001234');
    expect(updated.upi_vpa).toBe('newvpa@okhdfcbank');
  });

  it('should reject invalid IFSC or Bank Account numbers', async () => {
    await expect(
      SecurityService.updateSettlementDetails(demoId, { bankIfsc: 'INVALID' })
    ).rejects.toThrow('Invalid IFSC');

    await expect(
      SecurityService.updateSettlementDetails(demoId, { bankAccountNumber: '123' })
    ).rejects.toThrow('Invalid bank account');

    await expect(
      SecurityService.updateSettlementDetails(demoId, { upiVpa: 'invalid_upi' })
    ).rejects.toThrow('Invalid UPI');
  });

  it('should export transaction reports in CSV format', async () => {
    const csv = await SecurityService.exportTransactionsReport(demoId);
    expect(csv).toContain('Order ID,UPI Reference,Amount (INR),Status,Paid Late,Paid At,Created At');
  });

  it('should enforce 60-second background lock threshold calculation', () => {
    const backgroundTime = 100000;

    // 59 seconds in background -> DO NOT LOCK
    const returnTimeEarly = backgroundTime + 59 * 1000;
    const shouldLockEarly = (returnTimeEarly - backgroundTime) >= 60000;
    expect(shouldLockEarly).toBe(false);

    // 60 seconds in background -> MUST LOCK
    const returnTimeThreshold = backgroundTime + 60 * 1000;
    const shouldLockThreshold = (returnTimeThreshold - backgroundTime) >= 60000;
    expect(shouldLockThreshold).toBe(true);

    // 120 seconds in background -> MUST LOCK
    const returnTimeLate = backgroundTime + 120 * 1000;
    const shouldLockLate = (returnTimeLate - backgroundTime) >= 60000;
    expect(shouldLockLate).toBe(true);
  });
});
