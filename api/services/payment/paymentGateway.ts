import crypto from 'crypto';
import { appConfig as config } from '../../config';

export interface ParsedWebhookEvent {
  eventId: string;
  referenceId: string;
  amount: number; // in paise
  status: 'SUCCESS' | 'FAILURE';
  gateway: string;
  rawPayload: any;
}

export interface IPaymentGateway {
  verifyWebhook(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean;
  parseEvent(rawBody: Buffer | undefined, headers: Record<string, any>): ParsedWebhookEvent;
  getGatewayName(): string;
}

/**
 * Generic HMAC-SHA256 Payment Gateway Adapter.
 * Verifies signature over raw request body using WEBHOOK_SECRET.
 */
export class GenericHmacGateway implements IPaymentGateway {
  public verifyWebhook(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
    if (!rawBody || !signatureHeader) {
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', config.webhookSecret)
        .update(rawBody)
        .digest('hex');

      // Constant time comparison to prevent timing attacks
      if (expectedSignature.length !== signatureHeader.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(signatureHeader, 'hex')
      );
    } catch {
      return false;
    }
  }

  public parseEvent(rawBody: Buffer | undefined, _headers: Record<string, any>): ParsedWebhookEvent {
    if (!rawBody) {
      throw new Error('Raw body is required to parse webhook event');
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    const { eventId, referenceId, amount, status = 'SUCCESS', gateway = 'GENERIC_UPI' } = payload;

    if (!eventId || !referenceId || amount === undefined) {
      throw new Error('Missing required webhook fields: eventId, referenceId, amount');
    }

    return {
      eventId: String(eventId),
      referenceId: String(referenceId),
      amount: Math.round(Number(amount)),
      status: status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
      gateway: String(gateway),
      rawPayload: payload
    };
  }

  public getGatewayName(): string {
    return 'GENERIC_HMAC_GATEWAY';
  }
}

export const defaultGateway: IPaymentGateway = new GenericHmacGateway();

