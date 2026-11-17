import { appConfig as config } from '../../config';

export interface ISmsProvider {
  sendOtp(phone: string, otp: string): Promise<boolean>;
  getProviderName(): string;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    const start = digits.slice(0, 2);
    const end = digits.slice(-2);
    return `+91 ${start}******${end}`;
  }
  return '***';
}

/**
 * Mock SMS Provider for local development, CI and automated tests.
 */
export class MockSmsProvider implements ISmsProvider {
  private static lastSentOtp: { phone: string; otp: string; timestamp: number } | null = null;

  public async sendOtp(phone: string, otp: string): Promise<boolean> {
    MockSmsProvider.lastSentOtp = { phone, otp, timestamp: Date.now() };
    if (config.allowDevOtp && config.nodeEnv !== 'test') {
      console.log(`[DEV OTP] Dispatched OTP [${otp}] to ${maskPhone(phone)} (Mock Mode)`);
    }
    return true;
  }

  public getProviderName(): string {
    return 'MOCK_SMS_PROVIDER';
  }

  public static getLastSentOtp() {
    return this.lastSentOtp;
  }
}

/**
 * MSG91 SMS Provider compliant with Indian TRAI TCCCPR (DLT) regulations.
 */
export class Msg91SmsProvider implements ISmsProvider {
  public async sendOtp(phone: string, otp: string): Promise<boolean> {
    const { authKey, senderId, dltTeId } = config.msg91;

    if (!authKey) {
      if (config.isProduction) {
        throw new Error('CRITICAL: MSG91_AUTH_KEY missing in production environment');
      }
      console.warn('[MSG91] Auth Key missing in dev. Mocking dispatch.');
      return true;
    }

    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const params = new URLSearchParams({
        template_id: dltTeId,
        mobile: cleanPhone,
        otp: otp
      });

      if (senderId) {
        params.set('sender', senderId);
      }

      // Send authkey in header, not in query string
      const res = await fetch(`https://api.msg91.com/api/v5/otp?${params.toString()}`, {
        method: 'POST',
        headers: {
          authkey: authKey,
          'Content-Type': 'application/json'
        }
      });

      const data = (await res.json()) as any;
      const success = data?.type === 'success';

      if (config.nodeEnv !== 'test') {
        console.log(`[MSG91] Dispatched to ${maskPhone(phone)}: ${success ? 'SUCCESS' : 'FAILED'}`);
      }

      return success;
    } catch (err) {
      console.error(`[MSG91] Network dispatch error for ${maskPhone(phone)}:`, err);
      return false;
    }
  }

  public getProviderName(): string {
    return 'MSG91_DLT_PROVIDER';
  }
}

export function getSmsProvider(): ISmsProvider {
  if (config.smsProvider === 'msg91') {
    return new Msg91SmsProvider();
  }
  return new MockSmsProvider();
}
