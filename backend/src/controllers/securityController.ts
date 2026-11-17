import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { SecurityService } from '../services/securityService';
import { WebAuthnService } from '../services/webauthnService';
import { db } from '../db';
import { SensitiveAction } from '../types';

export class SecurityController {
  public static async getSecurityStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const merchant = await db.get(
        'SELECT id, name, business_name, phone, upi_vpa, bank_account_number, bank_ifsc, biometrics_enabled, balance FROM merchants WHERE id = ?',
        [req.merchant.id]
      );

      if (!merchant) {
        res.status(404).json({ success: false, error: 'Merchant not found' });
        return;
      }

      // Mask bank account number
      const raw = merchant.bank_account_number;
      merchant.bank_account_number = raw && raw.length > 4 ? `••••••••${raw.slice(-4)}` : raw;

      res.json({ success: true, data: merchant });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  public static async verifyPasscode(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { passcode, action = 'PAYOUT' } = req.body;
      if (!passcode) {
        res.status(400).json({ success: false, error: 'Passcode is required' });
        return;
      }

      const result = await SecurityService.verifyPasscode(
        req.merchant.id,
        passcode,
        action as SensitiveAction
      );

      res.json({ success: true, token: result.token });
    } catch (err: any) {
      res.status(401).json({ success: false, error: err.message });
    }
  }

  // --- WebAuthn Endpoints ---

  public static async getRegistrationOptions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const options = await WebAuthnService.getRegistrationOptions(req.merchant);
      res.json(options);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async verifyRegistration(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { response, deviceName } = req.body;
      const result = await WebAuthnService.verifyRegistration(req.merchant, response, deviceName);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async getAuthenticationOptions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const options = await WebAuthnService.getAuthenticationOptions(req.merchant);
      res.json(options);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async verifyAuthentication(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { response, action = 'PAYOUT' } = req.body;
      const result = await WebAuthnService.verifyAuthentication(
        req.merchant,
        response,
        action as SensitiveAction
      );

      res.json(result);
    } catch (err: any) {
      res.status(401).json({ success: false, error: err.message });
    }
  }

  public static async listWebAuthnDevices(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const devices = await WebAuthnService.listDevices(req.merchant.id);
      res.json({ success: true, data: devices });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  public static async deleteWebAuthnDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const result = await WebAuthnService.deleteDevice(req.merchant.id, id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  // --- Protected Sensitive Actions ---

  public static async toggleBiometrics(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { enabled } = req.body;
      const newSetting = enabled ? 1 : 0;

      await db.run('UPDATE merchants SET biometrics_enabled = ? WHERE id = ?', [
        newSetting,
        req.merchant.id
      ]);

      res.json({ success: true, data: { biometrics_enabled: newSetting } });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async executePayout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { amount } = req.body;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      const payout = await SecurityService.executePayout(
        req.merchant.id,
        Number(amount),
        idempotencyKey
      );

      res.json({ success: true, data: payout });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async updateBankDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { upiVpa, bankAccountNumber, bankIfsc } = req.body;
      const updated = await SecurityService.updateSettlementDetails(req.merchant.id, {
        upiVpa,
        bankAccountNumber,
        bankIfsc
      });

      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async exportReport(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const csv = await SecurityService.exportTransactionsReport(req.merchant.id);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="transactions_report.csv"');
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  public static async listPayouts(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const payouts = await SecurityService.listPayouts(req.merchant.id);
      res.json({ success: true, data: payouts });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  public static async listNeedsAttention(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const attentionData = await SecurityService.listNeedsAttention(req.merchant.id);
      res.json({ success: true, data: attentionData });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}
