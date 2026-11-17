import { Router } from 'express';
import { PaymentController } from '../controllers/paymentController';
import { requireAuth } from '../middleware/authMiddleware';
import { webhookLimiter } from '../middleware/rateLimiters';
import { config } from '../config';

const router = Router();

// Webhook receiver (public, authenticated via x-webhook-signature)
router.post('/webhook', webhookLimiter, PaymentController.handleWebhook);

// Dev Simulator endpoint: mounted only when enabled in non-production
if (!config.isProduction && config.enablePaymentSimulator) {
  router.post('/simulate-success', requireAuth, PaymentController.simulatePayment);
}

export default router;
