import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { appConfig as config } from '../config';
import { getSmsProvider } from './sms/smsProvider';
import { OtpRecord } from '../types';

export const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
export const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_REQUESTS_PER_PHONE = 3;
export const MAX_REQUESTS_PER_IP = 10;

export interface VerifyOtpResult {
  success: boolean;
  message: string;
  verificationToken?: string;
  attemptsRemaining?: number;
  lockedUntil?: number;
}

export function isValidIndianPhone(phone: string): boolean {
  if (typeof phone !== 'string') return false;
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(?:\+91)?[6-9]\d{9}$/.test(cleaned);
}

export function isValidOtp(otp: string): boolean {
  return typeof otp === 'string' && /^\d{6}$/.test(otp);
}

export class OtpService {
  /**
   * Hashes the 6-digit OTP using HMAC-SHA256 with OTP_HMAC_SECRET.
   */
  public static hashOtp(otp: string): string {
    return crypto
      .createHmac('sha256', config.otpHmacSecret)
      .update(otp)
      .digest('hex');
  }

  /**
   * Dispatches a fresh 6-digit OTP with strict rate limiting, cooldown, and hashing.
   */
  public static async requestOtp(
    phone: string,
    ipAddress?: string
  ): Promise<{
    success: boolean;
    message: string;
    cooldownSeconds: number;
    devOtp?: string;
  }> {
    if (!isValidIndianPhone(phone)) {
      throw new Error('Invalid mobile number. Must be a valid 10-digit Indian phone starting with 6-9.');
    }

    const cleanPhone = this.normalizePhone(phone);
    const now = Date.now();

    // 1. Check if phone is locked out from previous failed attempts
    const latestRecord = await db.get<OtpRecord>(
      'SELECT * FROM otp_verifications WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
      [cleanPhone]
    );

    if (latestRecord && latestRecord.locked_until && latestRecord.locked_until > now) {
      const remainingMinutes = Math.ceil((latestRecord.locked_until - now) / 60000);
      throw new Error(`Mobile number is temporarily locked due to failed attempts. Try again in ${remainingMinutes} minute(s).`);
    }

    // 2. Enforce 30-second resend cooldown
    if (latestRecord && latestRecord.cooldown_until && latestRecord.cooldown_until > now) {
      const remainingSeconds = Math.ceil((latestRecord.cooldown_until - now) / 1000);
      throw new Error(`Please wait ${remainingSeconds} second(s) before requesting another verification code.`);
    }

    // 3. Rate limiting per phone (max 3 in 15 minutes) using millisecond timestamps
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const phoneCount = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM otp_verifications WHERE phone = ? AND created_at >= ?',
      [cleanPhone, windowStart]
    );

    if (phoneCount && phoneCount.count >= MAX_REQUESTS_PER_PHONE) {
      throw new Error('Too many OTP requests for this mobile number. Please try again after 15 minutes.');
    }

    // 4. Rate limiting per IP (max 10 in 15 minutes)
    if (ipAddress) {
      const ipCount = await db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM otp_verifications WHERE ip_address = ? AND created_at >= ?',
        [ipAddress, windowStart]
      );

      if (ipCount && ipCount.count >= MAX_REQUESTS_PER_IP) {
        throw new Error('Too many requests from your network. Please try again later.');
      }
    }

    // 5. Generate secure 6-digit random code
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = this.hashOtp(otp);

    const recordId = crypto.randomUUID();
    const expiresAt = now + OTP_EXPIRY_MS;
    const cooldownUntil = now + RESEND_COOLDOWN_MS;

    // 6. Store hash in database
    await db.run(
      `INSERT INTO otp_verifications (
        id, phone, otp_hash, attempts, expires_at, cooldown_until, ip_address, created_at
      ) VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
      [recordId, cleanPhone, otpHash, expiresAt, cooldownUntil, ipAddress || null, now]
    );

    // 7. Dispatch via SMS provider
    const sms = getSmsProvider();
    const sent = await sms.sendOtp(cleanPhone, otp);

    if (!sent) {
      // Do not leave a live un-dispatched OTP behind
      await db.run('DELETE FROM otp_verifications WHERE id = ?', [recordId]);
      throw new Error('Failed to dispatch SMS verification code. Please try again.');
    }

    return {
      success: true,
      message: 'If the mobile number is valid, a 6-digit verification code has been dispatched.',
      cooldownSeconds: 30,
      devOtp: config.allowDevOtp ? otp : undefined
    };
  }

  /**
   * Verifies the 6-digit OTP with ATOMIC ATTEMPT INCREMENTING before comparison.
   */
  public static async verifyOtp(phone: string, inputOtp: string): Promise<VerifyOtpResult> {
    if (!isValidIndianPhone(phone)) {
      return { success: false, message: 'Invalid mobile number format' };
    }
    if (!isValidOtp(inputOtp)) {
      return { success: false, message: 'Verification code must be exactly 6 digits' };
    }

    const cleanPhone = this.normalizePhone(phone);
    const now = Date.now();

    const record = await db.get<OtpRecord>(
      'SELECT * FROM otp_verifications WHERE phone = ? AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [cleanPhone]
    );

    if (!record) {
      return {
        success: false,
        message: 'No active OTP verification session found for this mobile number.'
      };
    }

    // Check existing lockout
    if (record.locked_until && record.locked_until > now) {
      const remainingMinutes = Math.ceil((record.locked_until - now) / 60000);
      return {
        success: false,
        lockedUntil: record.locked_until,
        message: `Account is locked. Try again in ${remainingMinutes} minute(s).`
      };
    }

    // Check expiry
    if (now > record.expires_at) {
      return {
        success: false,
        message: 'The verification code has expired. Please request a new OTP.'
      };
    }

    // ATOMIC INCREMENT BEFORE COMPARING (prevents parallel guess race condition)
    const updateResult = await db.run(
      `UPDATE otp_verifications 
       SET attempts = attempts + 1 
       WHERE id = ? AND attempts < 5 AND verified_at IS NULL AND expires_at > ?`,
      [record.id, now]
    );

    if (updateResult.changes === 0) {
      // Maximum attempts already exceeded or concurrent lock
      const latest = await db.get<OtpRecord>('SELECT attempts, locked_until FROM otp_verifications WHERE id = ?', [record.id]);
      if (latest && latest.attempts >= 5) {
        const lockedUntil = latest.locked_until || (now + LOCKOUT_DURATION_MS);
        if (!latest.locked_until) {
          await db.run('UPDATE otp_verifications SET locked_until = ? WHERE id = ?', [lockedUntil, record.id]);
        }
        return {
          success: false,
          attemptsRemaining: 0,
          lockedUntil,
          message: 'Maximum 5 wrong attempts exceeded. This mobile number is locked for 15 minutes.'
        };
      }

      return {
        success: false,
        message: 'Verification session expired or already completed.'
      };
    }

    const currentAttempts = record.attempts + 1;

    // Compare hash in constant time
    const inputHash = this.hashOtp(inputOtp);
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(inputHash, 'hex'),
      Buffer.from(record.otp_hash, 'hex')
    );

    if (!isMatch) {
      if (currentAttempts >= MAX_ATTEMPTS) {
        const lockedUntil = now + LOCKOUT_DURATION_MS;
        await db.run(
          'UPDATE otp_verifications SET locked_until = ? WHERE id = ?',
          [lockedUntil, record.id]
        );
        return {
          success: false,
          attemptsRemaining: 0,
          lockedUntil,
          message: 'Maximum 5 wrong attempts exceeded. This mobile number is locked for 15 minutes.'
        };
      }

      return {
        success: false,
        attemptsRemaining: MAX_ATTEMPTS - currentAttempts,
        message: `Incorrect code. ${MAX_ATTEMPTS - currentAttempts} attempt(s) remaining.`
      };
    }

    // Success: Invalidate single-use OTP
    await db.run('UPDATE otp_verifications SET verified_at = ? WHERE id = ?', [now, record.id]);

    // Issue verified registration token (valid for 15 mins)
    const verificationToken = jwt.sign(
      { phone: cleanPhone, scope: 'PHONE_VERIFIED', jti: crypto.randomUUID() },
      config.jwtSecret,
      { expiresIn: '15m' }
    );

    return {
      success: true,
      message: 'Mobile number verified successfully!',
      verificationToken
    };
  }

  public static normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `+91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+${digits}`;
    }
    return phone.trim();
  }
}
