import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { appConfig as config } from '../config';
import { db } from '../db';
import { Merchant, SensitiveAction } from '../types';

export interface AuthenticatedRequest extends Request {
  merchant?: Merchant;
  id?: string;
  rawBody?: Buffer;
}

export const SESSION_COOKIE_NAME = 'session_token';
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Validates Origin header against CORS allowlist on state-changing requests
 */
export function verifyStateChangingOrigin(req: Request, res: Response, next: NextFunction): void {
  const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
  const isWebhook = req.path.includes('/payments/webhook');

  if (isStateChanging && !isWebhook) {
    const origin = req.headers.origin;
    if (origin && !config.corsOrigins.includes(origin)) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: Request origin is not permitted',
        requestId: (req as any).id
      });
      return;
    }
  }

  next();
}

/**
 * Requires an authenticated merchant session via signed JWT in httpOnly cookie
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME] || req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in.',
      code: 'UNAUTHORIZED',
      requestId: req.id
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (!decoded.merchantId) {
      res.status(401).json({ success: false, error: 'Invalid session payload', requestId: req.id });
      return;
    }

    const merchant = await db.get<Merchant>(
      'SELECT * FROM merchants WHERE id = ?',
      [decoded.merchantId]
    );

    if (!merchant) {
      res.status(401).json({ success: false, error: 'Merchant session no longer exists', requestId: req.id });
      return;
    }

    req.merchant = merchant;
    next();
  } catch (err: any) {
    res.status(401).json({
      success: false,
      error: 'Session expired or invalid. Please sign in again.',
      code: 'SESSION_EXPIRED',
      requestId: req.id
    });
  }
}

/**
 * Requires a single-use sensitive action token bound to the specific merchant AND action
 */
export function requireSensitiveAction(action: SensitiveAction) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.merchant) {
      res.status(401).json({ success: false, error: 'Merchant authentication required', requestId: req.id });
      return;
    }

    const sensitiveToken = req.headers['x-sensitive-token'] as string;
    if (!sensitiveToken) {
      res.status(403).json({
        success: false,
        error: `Step-up authentication required for action: ${action}`,
        code: 'SENSITIVE_AUTH_REQUIRED',
        requestId: req.id
      });
      return;
    }

    try {
      const decoded = jwt.verify(sensitiveToken, config.jwtSecret) as any;

      if (decoded.scope !== 'SENSITIVE_ACTION') {
        res.status(403).json({ success: false, error: 'Invalid token scope', requestId: req.id });
        return;
      }

      if (decoded.merchantId !== req.merchant.id) {
        res.status(403).json({ success: false, error: 'Token not authorized for this merchant', requestId: req.id });
        return;
      }

      if (decoded.action !== action) {
        res.status(403).json({
          success: false,
          error: `Token action mismatch: expected ${action}, got ${decoded.action}`,
          requestId: req.id
        });
        return;
      }

      if (!decoded.jti) {
        res.status(403).json({ success: false, error: 'Missing token identifier', requestId: req.id });
        return;
      }

      // Check if jti already consumed (single-use enforcement)
      const alreadyUsed = await db.get(
        'SELECT jti FROM used_tokens WHERE jti = ?',
        [decoded.jti]
      );

      if (alreadyUsed) {
        res.status(403).json({
          success: false,
          error: 'Sensitive action authorization token was already used. Re-authentication required.',
          code: 'TOKEN_ALREADY_USED',
          requestId: req.id
        });
        return;
      }

      // Atomically invalidate the token by marking jti as used
      await db.run(
        'INSERT INTO used_tokens (jti, merchant_id, action, used_at) VALUES (?, ?, ?, ?)',
        [decoded.jti, req.merchant.id, action, Date.now()]
      );

      next();
    } catch (err: any) {
      res.status(403).json({
        success: false,
        error: 'Sensitive action authorization token expired or invalid.',
        code: 'TOKEN_INVALID',
        requestId: req.id
      });
    }
  };
}
