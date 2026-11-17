import { initDatabase, db } from '../src/db';
import { OtpService } from '../src/services/otpService';
import { AuthService } from '../src/services/authService';

describe('Feature 3: OTP Verification During Registration (Indian Standards)', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  const getUniquePhone = () => `+919${Math.floor(100000000 + Math.random() * 900000000)}`;

  it('should generate a 6-digit OTP and store ONLY the cryptographic hash in DB', async () => {
    const testPhone = getUniquePhone();
    const res = await OtpService.requestOtp(testPhone);
    expect(res.success).toBe(true);
    expect(res.devOtp).toBeDefined();
    expect(res.devOtp?.length).toBe(6);
    expect(/^\d{6}$/.test(res.devOtp!)).toBe(true);

    // Verify database record contains only hash
    const record = await db.get(
      'SELECT * FROM otp_verifications WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
      [testPhone]
    );

    expect(record).toBeDefined();
    expect(record.otp_hash).toBeDefined();
    expect(record.otp_hash.length).toBe(64); // SHA-256 hex
    // Plaintext OTP must NOT be anywhere in the database record
    expect(JSON.stringify(record)).not.toContain(res.devOtp!);
  });

  it('should enforce a 30-second resend cooldown timer', async () => {
    const freshPhone = getUniquePhone();
    await OtpService.requestOtp(freshPhone);

    // Immediate second request must be rejected with cooldown error
    await expect(OtpService.requestOtp(freshPhone)).rejects.toThrow('Please wait');
  });

  it('should reject incorrect OTP and decrement remaining attempts', async () => {
    const phone = getUniquePhone();
    await OtpService.requestOtp(phone);

    const verifyRes = await OtpService.verifyOtp(phone, '000000');
    expect(verifyRes.success).toBe(false);
    expect(verifyRes.attemptsRemaining).toBe(4);
    expect(verifyRes.message).toContain('4 attempt(s) remaining');
  });

  it('should trigger a 15-minute lockout after 5 consecutive failed attempts', async () => {
    const phone = getUniquePhone();
    await OtpService.requestOtp(phone);

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      const res = await OtpService.verifyOtp(phone, '000000');
      expect(res.success).toBe(false);
    }

    // 5th failed attempt -> locks account for 15 minutes
    const fifthAttempt = await OtpService.verifyOtp(phone, '000000');
    expect(fifthAttempt.success).toBe(false);
    expect(fifthAttempt.attemptsRemaining).toBe(0);
    expect(fifthAttempt.lockedUntil).toBeDefined();
    expect(fifthAttempt.message).toContain('locked for 15 minutes');

    // Subsequent OTP request or verification must be locked
    await expect(OtpService.requestOtp(phone)).rejects.toThrow('temporarily locked');
  });

  it('should reject expired OTP after 5 minutes', async () => {
    const phone = getUniquePhone();
    const otpRes = await OtpService.requestOtp(phone);
    const validOtp = otpRes.devOtp!;

    // Artificially age the record's expiry timestamp into the past
    await db.run(
      'UPDATE otp_verifications SET expires_at = ? WHERE phone = ?',
      [Date.now() - 1000, phone]
    );

    const res = await OtpService.verifyOtp(phone, validOtp);
    expect(res.success).toBe(false);
    expect(res.message).toContain('expired');
  });

  it('should invalidate OTP immediately after single successful use', async () => {
    const phone = getUniquePhone();
    const otpRes = await OtpService.requestOtp(phone);
    const validOtp = otpRes.devOtp!;

    // First verification succeeds
    const firstVerify = await OtpService.verifyOtp(phone, validOtp);
    expect(firstVerify.success).toBe(true);
    expect(firstVerify.verificationToken).toBeDefined();

    // Second verification with identical OTP must fail (single-use enforced)
    const secondVerify = await OtpService.verifyOtp(phone, validOtp);
    expect(secondVerify.success).toBe(false);
    expect(secondVerify.message).toContain('No active OTP verification session found');
  });

  it('should reject registration if phone is unverified or token is missing', async () => {
    await expect(
      AuthService.register({
        verificationToken: '',
        name: 'John Doe',
        businessName: 'John Store',
        upiVpa: 'john@upi',
        passcode: '749201'
      })
    ).rejects.toThrow('Mobile verification token is required');
  });

  it('should complete registration successfully with a verified token', async () => {
    const phone = getUniquePhone();
    const otpRes = await OtpService.requestOtp(phone);
    const verifyRes = await OtpService.verifyOtp(phone, otpRes.devOtp!);

    const regResult = await AuthService.register({
      verificationToken: verifyRes.verificationToken!,
      name: 'Priya Sharma',
      businessName: 'Sharma Sweets',
      upiVpa: 'sharma@okhdfcbank',
      passcode: '749201',
      bankAccountNumber: '1234567890',
      bankIfsc: 'SBIN0001234'
    });

    expect(regResult.token).toBeDefined();
    expect(regResult.merchant.phone).toBe(phone);
    expect(regResult.merchant.business_name).toBe('Sharma Sweets');

    // Confirm in DB
    const merchant = await db.get('SELECT * FROM merchants WHERE phone = ?', [phone]);
    expect(merchant.phone_verified).toBe(1);
  });
});
