import { initDatabase, db } from '../api/db';
import { OtpService } from '../api/services/otpService';

describe('Section E & G: OTP Hardening, Race Condition Prevention & Limits', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  const getPhone = () => `+9198${Math.floor(10000000 + Math.random() * 90000000)}`;

  it('should cap parallel wrong OTP guesses at exactly 5 (race condition test)', async () => {
    const phone = getPhone();
    await OtpService.requestOtp(phone);

    // Launch 20 concurrent wrong guesses simultaneously
    const parallelGuesses = Array.from({ length: 20 }, () =>
      OtpService.verifyOtp(phone, '000000')
    );

    const results = await Promise.all(parallelGuesses);

    // Exactly 5 attempts should have been processed before locking
    const record = await db.get(
      'SELECT attempts, locked_until FROM otp_verifications WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
      [phone]
    );

    expect(record.attempts).toBe(5);
    expect(record.locked_until).toBeDefined();
    expect(record.locked_until).toBeGreaterThan(Date.now());

    // Verify all 20 returned failure
    results.forEach(r => expect(r.success).toBe(false));
  });

  it('should reject invalid phone and OTP formats with descriptive errors', async () => {
    // Non-Indian or non-6-9 starting phones
    await expect(OtpService.requestOtp('12345')).rejects.toThrow('Invalid mobile number');
    await expect(OtpService.requestOtp('+911234567890')).rejects.toThrow('Invalid mobile number');
    await expect(OtpService.requestOtp('+14155552671')).rejects.toThrow('Invalid mobile number');

    // Invalid OTP format
    const validPhone = getPhone();
    await OtpService.requestOtp(validPhone);
    const nonDigitVerify = await OtpService.verifyOtp(validPhone, 'abcdef');
    expect(nonDigitVerify.success).toBe(false);
    expect(nonDigitVerify.message).toContain('6 digits');
  });
});

