import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { appConfig as config } from './config';
import { initDatabase } from './db';
import { verifyStateChangingOrigin } from './middleware/authMiddleware';
import { globalLimiter } from './middleware/rateLimiters';
import authRoutes from './routes/authRoutes';
import orderRoutes from './routes/orderRoutes';
import paymentRoutes from './routes/paymentRoutes';
import securityRoutes from './routes/securityRoutes';

export const app = express();

// Trust proxy configuration
if (config.trustProxy) {
  app.set('trust proxy', config.trustProxy);
}

// Request ID attachment
app.use((req, res, next) => {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  (req as any).id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
});

// Security Headers & CORS
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, webhooks)
      if (!origin) return callback(null, true);
      if (
        config.corsOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin.includes('localhost')
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true
  })
);

// Lazy cold-start DB initialization for Serverless environments (e.g. Vercel)
let dbInitPromise: Promise<void> | null = null;
app.use(async (_req, _res, next) => {
  if (config.nodeEnv !== 'test') {
    if (!dbInitPromise) {
      dbInitPromise = initDatabase().catch((err) => {
        dbInitPromise = null;
        throw err;
      });
    }
    try {
      await dbInitPromise;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// Global rate limiting
app.use('/api', globalLimiter);

// Cookie Parser
app.use(cookieParser());

// 10kb JSON body limit + rawBody capture for webhook signature verification
app.use(
  express.json({
    limit: '10kb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    }
  })
);

// Origin verification on state-changing requests (CSRF mitigation)
app.use(verifyStateChangingOrigin);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Mount routes helper to support both direct /api/v1 and Vercel-stripped /v1 paths
const mountApiRoutes = (prefix: string) => {
  app.get(`${prefix}/config`, (_req, res) => {
    res.json({
      success: true,
      data: {
        enablePaymentSimulator: config.enablePaymentSimulator && !config.isProduction
      }
    });
  });

  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/orders`, orderRoutes);
  app.use(`${prefix}/payments`, paymentRoutes);
  app.use(`${prefix}/security`, securityRoutes);
};

mountApiRoutes('/api/v1');
mountApiRoutes('/v1');

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Sanitized 500 error handler with request ID logging
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const reqId = (req as any).id || 'unknown';
  console.error(`[Error] Request ID ${reqId}:`, err);

  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    requestId: reqId
  });
});

export default app;
