import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { PaymentService } from '../services/paymentService';
import { defaultGateway } from '../services/payment/paymentGateway';
import { appConfig as config } from '../config';

export class PaymentController {
  /**
   * Gateway Webhook Receiver with raw-body HMAC-SHA256 verification.
   * Returns 401 on bad/missing signature.
   */
  public static async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const rawBody = (req as any).rawBody as Buffer | undefined;
      const signatureHeader = req.headers['x-webhook-signature'] as string | undefined;

      const isValid = defaultGateway.verifyWebhook(rawBody, signatureHeader);
      if (!isValid) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized: Invalid or missing webhook signature (x-webhook-signature)'
        });
        return;
      }

      const event = defaultGateway.parseEvent(rawBody, req.headers);
      const result = await PaymentService.processWebhook(event);

      res.status(200).json(result);
    } catch (err: any) {
      console.error('Webhook error:', err);
      res.status(400).json({ success: false, error: err.message || 'Webhook processing failed' });
    }
  }

  /**
   * Dev/Demo simulator endpoint (requires auth and order ownership, disabled in production)
   */
  public static async simulatePayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (config.isProduction || !config.enablePaymentSimulator) {
        res.status(404).json({ success: false, error: 'Payment simulator is not available.' });
        return;
      }

      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const { orderId } = req.body;
      if (!orderId) {
        res.status(400).json({ success: false, error: 'orderId is required' });
        return;
      }

      const result = await PaymentService.simulatePayment(orderId, req.merchant.id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
}
