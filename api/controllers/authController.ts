import { Request, Response } from 'express';
import { OtpService } from '../services/otpService';
import { AuthService } from '../services/authService';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, AuthenticatedRequest } from '../middleware/authMiddleware';
import { config } from '../config';

export class AuthController {
  public static async sendOtp(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = req.body;
      if (!phone) {
        res.status(400).json({ success: false, error: 'Mobile number is required' });
        return;
      }

      const clientIp = req.ip || req.socket.remoteAddress;
      const result = await OtpService.requestOtp(phone, clientIp);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async verifyOtp(req: Request, res: Response): Promise<void> {
    try {
      const { phone, otp } = req.body;
      if (!phone || !otp) {
        res.status(400).json({ success: false, error: 'Phone number and 6-digit OTP are required' });
        return;
      }

      const result = await OtpService.verifyOtp(phone, otp);
      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      res.status(200).json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async login(req: Request, res: Response): Promise<void> {
    try {
      const { phone, pin } = req.body;
      if (!phone || !pin) {
        res.status(400).json({ success: false, error: 'Phone and 6-digit PIN are required' });
        return;
      }

      const result = await AuthService.login(phone, pin);

      res.cookie(SESSION_COOKIE_NAME, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        maxAge: SESSION_MAX_AGE_MS
      });

      res.json({
        success: true,
        merchant: result.merchant
      });
    } catch (err: any) {
      res.status(401).json({ success: false, error: err.message });
    }
  }

  public static async logout(_req: Request, res: Response): Promise<void> {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction
    });
    res.json({ success: true, message: 'Logged out successfully' });
  }

  public static async resetPin(req: Request, res: Response): Promise<void> {
    try {
      const { verificationToken, newPin } = req.body;
      const result = await AuthService.resetPin(verificationToken, newPin);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async register(req: Request, res: Response): Promise<void> {
    try {
      const result = await AuthService.register(req.body);

      if (result.alreadyRegistered) {
        res.status(200).json({
          success: false,
          alreadyRegistered: true,
          message: result.message
        });
        return;
      }

      if (result.token) {
        res.cookie(SESSION_COOKIE_NAME, result.token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.isProduction,
          maxAge: SESSION_MAX_AGE_MS
        });
      }

      res.status(201).json({
        success: true,
        merchant: result.merchant
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async me(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.merchant) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Mask bank account number (only last 4 digits visible)
    const rawAccount = req.merchant.bank_account_number;
    const maskedAccount = rawAccount && rawAccount.length > 4
      ? `••••••••${rawAccount.slice(-4)}`
      : rawAccount;

    res.json({
      success: true,
      data: {
        id: req.merchant.id,
        name: req.merchant.name,
        business_name: req.merchant.business_name,
        phone: req.merchant.phone,
        upi_vpa: req.merchant.upi_vpa,
        bank_account_number: maskedAccount,
        bank_ifsc: req.merchant.bank_ifsc,
        biometrics_enabled: req.merchant.biometrics_enabled,
        balance: req.merchant.balance
      }
    });
  }
}
