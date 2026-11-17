import request from 'supertest';
import { app } from '../src/app';
import { initDatabase, db } from '../src/db';
import { AuthService } from '../src/services/authService';
import { SecurityService } from '../src/services/securityService';
import { SESSION_COOKIE_NAME } from '../src/middleware/authMiddleware';
import bcrypt from 'bcryptjs';

describe('Section D & G: WebAuthn Passkeys & Biometric Access', () => {
  let merchantId: string;
  let sessionCookie: string;

  beforeAll(async () => {
    await initDatabase();

    merchantId = 'mch-webauthn-' + Date.now();
    const hash = await bcrypt.hash('849102', 12);
    await db.run(
      `INSERT INTO merchants (id, name, business_name, phone, phone_verified, upi_vpa, passcode_hash, biometrics_enabled, balance)
       VALUES (?, 'Passkey Merchant', 'Passkey Store', '+919866666666', 1, 'passkey@upi', ?, 0, 50000)`,
      [merchantId, hash]
    );

    const token = AuthService.generateSessionToken(merchantId, '+919866666666');
    sessionCookie = `${SESSION_COOKIE_NAME}=${token}`;
  });

  it('should generate WebAuthn registration options for logged-in merchant', async () => {
    const res = await request(app)
      .post('/api/v1/security/webauthn/register/options')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeDefined();
    expect(res.body.rp.name).toBe('Apex Merchant App');
    expect(res.body.user.name).toBe('+919866666666');

    // Confirm challenge was saved server-side in webauthn_challenges
    const challengeRow = await db.get(
      'SELECT * FROM webauthn_challenges WHERE merchant_id = ?',
      [merchantId]
    );
    expect(challengeRow).toBeDefined();
    expect(challengeRow.challenge).toBe(res.body.challenge);
  });

  it('should reject getAuthenticationOptions when no passkeys are enrolled', async () => {
    const res = await request(app)
      .post('/api/v1/security/webauthn/authenticate/options')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No passkey registered');
  });

  it('should require sensitive action token (DISABLE_LOCK) to delete a registered passkey', async () => {
    // Manually register a test passkey in DB
    const testCredId = 'test-cred-' + Date.now();
    await db.run(
      `INSERT INTO webauthn_credentials (id, merchant_id, credential_id, public_key, counter, device_name, created_at)
       VALUES (?, ?, ?, 'test_pub_key', 0, 'Test Pixel Phone', ?)`,
      ['dev-1', merchantId, testCredId, Date.now()]
    );

    // Attempt deletion without step-up token
    const rejectRes = await request(app)
      .delete('/api/v1/security/webauthn/devices/dev-1')
      .set('Cookie', sessionCookie);

    expect(rejectRes.status).toBe(403);
    expect(rejectRes.body.code).toBe('SENSITIVE_AUTH_REQUIRED');

    // Attempt with valid DISABLE_LOCK step-up token
    const stepUpToken = SecurityService.generateSensitiveToken(merchantId, 'DISABLE_LOCK', 'PIN');

    const successRes = await request(app)
      .delete('/api/v1/security/webauthn/devices/dev-1')
      .set('Cookie', sessionCookie)
      .set('x-sensitive-token', stepUpToken);

    expect(successRes.status).toBe(200);
    expect(successRes.body.success).toBe(true);

    const deleted = await db.get('SELECT * FROM webauthn_credentials WHERE id = ?', ['dev-1']);
    expect(deleted).toBeUndefined();
  });
});

