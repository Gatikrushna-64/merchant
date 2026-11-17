import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Helper to validate or generate secret
const KNOWN_DEFAULTS = [
  'replace_with_random_secret_at_least_32_chars_long_in_production',
  'super_secret_merchant_jwt_key_2026',
  'upi_qr_hmac_secret_key_antigravity_2026',
  'default_jwt_secret_antigravity_2026',
  'default_qr_secret_antigravity_2026'
];

function resolveSecret(envVarName: string): string {
  const value = process.env[envVarName]?.trim();

  if (isProduction) {
    if (!value) {
      throw new Error(`CRITICAL: Production startup failed. Missing required environment secret: ${envVarName}`);
    }
    if (value.length < 32) {
      throw new Error(`CRITICAL: Secret ${envVarName} is too short (< 32 characters). Must be strong cryptographically.`);
    }
    if (KNOWN_DEFAULTS.some(d => value.toLowerCase().includes(d.toLowerCase()))) {
      throw new Error(`CRITICAL: Secret ${envVarName} is using a known insecure default value.`);
    }
    return value;
  }

  // Development/Test fallback
  if (value && value.length >= 32 && !KNOWN_DEFAULTS.includes(value)) {
    return value;
  }

  const generated = crypto.randomBytes(48).toString('hex');
  if (nodeEnv !== 'test') {
    console.warn(`[WARN] ${envVarName} not securely configured. Generated ephemeral 96-char random secret for ${nodeEnv} session.`);
  }
  return generated;
}

// Dev-only switches validation
function resolveDevSwitch(envVarName: string, defaultValue = true): boolean {
  const raw = process.env[envVarName];
  const isEnabled = raw !== undefined ? raw === 'true' || raw === '1' : defaultValue;

  if (isProduction && isEnabled) {
    throw new Error(
      `CRITICAL: Dev backdoor switch ${envVarName} is enabled in PRODUCTION. This switch is strictly forbidden in production.`
    );
  }

  return isProduction ? false : isEnabled;
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv,
  isProduction,
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000'],
  trustProxy: process.env.TRUST_PROXY === 'true' ? true : (process.env.TRUST_PROXY || false),

  // Distinct Secrets
  jwtSecret: resolveSecret('JWT_SECRET'),
  otpHmacSecret: resolveSecret('OTP_HMAC_SECRET'),
  qrSigningSecret: resolveSecret('QR_SIGNING_SECRET'),
  webhookSecret: resolveSecret('WEBHOOK_SECRET'),

  // Dev-only switches
  seedDemo: resolveDevSwitch('SEED_DEMO', true),
  seedDemoPin: process.env.SEED_DEMO_PIN || '',
  allowDevOtp: resolveDevSwitch('ALLOW_DEV_OTP', true),
  enablePaymentSimulator: resolveDevSwitch('ENABLE_PAYMENT_SIMULATOR', true),

  // SQLite DB Path
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../merchant.db'),

  // WebAuthn
  webauthn: {
    rpId: process.env.WEBAUTHN_RP_ID || 'localhost',
    rpName: process.env.WEBAUTHN_RP_NAME || 'Apex Merchant App',
    origin: process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000'
  },

  // Limits
  orderMinAmountPaise: 100, // Rs 1
  orderMaxAmountPaise: parseInt(process.env.ORDER_MAX_AMOUNT_PAISE || '10000000', 10), // Rs 1,00,000
  payoutMaxPerTxnPaise: parseInt(process.env.PAYOUT_MAX_PER_TXN_PAISE || '5000000', 10), // Rs 50,000
  payoutMaxPerDayPaise: parseInt(process.env.PAYOUT_MAX_PER_DAY_PAISE || '20000000', 10), // Rs 2,00,000

  // Defaults for merchants
  defaultMerchantVpa: 'merchant@okhdfcbank',
  defaultMerchantName: 'Apex Mart',

  // SMS
  smsProvider: process.env.SMS_PROVIDER || 'mock',
  msg91: {
    authKey: process.env.MSG91_AUTH_KEY || '',
    senderId: process.env.MSG91_SENDER_ID || '',
    dltTeId: process.env.MSG91_DLT_TE_ID || ''
  }
};
