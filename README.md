# Apex Merchant App

Production-grade Merchant Application with **Dynamic UPI QR Code Generation**, **Biometric Passkey Authentication (WebAuthn)**, and **TRAI DLT-Compliant Mobile OTP Verification & PIN Security**.

Built with an Express + TypeScript + SQLite backend and a React + Vite + Tailwind CSS frontend.

---

## 1. Quick Start Guide

### Prerequisites
- Node.js `v18+` (Tested on `v20+` and `v26+`)
- npm `9+`

### Secret Generation
Before starting the application, generate 4 distinct 48-byte cryptographic hex secrets:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Backend Setup
```bash
cd backend
npm install
npm run build
npm test        # Runs 40 automated tests across 8 test suites on an isolated in-memory DB
npm start       # Starts backend API on http://localhost:5000
```

### Frontend Setup
```bash
cd frontend
npm install
npm run build
npm run dev     # Starts Vite development server on http://localhost:3000
```

The web application runs locally at `http://localhost:3000` and proxies API requests to `http://localhost:5000`.

---

## 2. Security & Architecture Model

### Secrets & Configuration
- **No Compromised or Fallback Secrets**: Production startup immediately halts if any secret (`JWT_SECRET`, `OTP_HMAC_SECRET`, `QR_SIGNING_SECRET`, `WEBHOOK_SECRET`) is missing, shorter than 32 characters, or set to a known placeholder.
- **Environment Isolation**: `backend/.env` is excluded from git via `.gitignore`. A template is provided in `backend/.env.example`.
- **Dev-Only Flags**: `SEED_DEMO`, `ALLOW_DEV_OTP`, and `ENABLE_PAYMENT_SIMULATOR` default to `true` in local development but are strictly **refused** (throw fatal error at startup) when `NODE_ENV=production`.
- **CORS & CSRF Defense**: CORS is restricted to origins configured in `CORS_ORIGINS` (default `http://localhost:3000`). All state-changing mutating requests (`POST`, `PUT`, `DELETE`, `PATCH`) verify the `Origin` header.

### Authentication & Merchant Isolation
- **HttpOnly Cookies**: Sessions are issued as signed JWT tokens stored in an `httpOnly`, `SameSite=Lax` cookie (`session_token`, marked `Secure` in production) with a 12-hour expiry. Tokens are never stored in `localStorage`.
- **Strict Isolation**: Client-supplied `merchantId` parameters in bodies, query parameters, or headers are prohibited. The merchant identity is derived exclusively from the verified session cookie via `requireAuth` middleware.
- **PIN Complexity & Lockout**: 6-digit PINs are hashed using bcrypt (cost factor 12). Trivial PINs (`000000`, `123456`, `111111`, sequences) are rejected. 5 consecutive incorrect PIN attempts trigger a mandatory 15-minute account lockout recorded in SQLite.
- **Sensitive Action Tokens**: High-risk operations (payouts, editing bank/UPI settlement details, CSV exports, disabling locks) require a dedicated single-use sensitive action token. These tokens are bound to both the merchant ID and the specific action type, expire after 2 minutes, and record a unique `jti` in `used_tokens` to prevent replay attacks.

### Biometrics & Passkeys (WebAuthn)
- **Real Platform Authenticator**: Powered by `@simplewebauthn/server` and `@simplewebauthn/browser`.
- **Zero Mock / Fake Biometrics**: Operates via native WebAuthn (Touch ID, Face ID, Windows Hello, Android BiometricPrompt). In development, runs on `localhost`; in production, strictly requires HTTPS.
- **Privacy & Non-Storage**: Biometric templates never leave client hardware; only server-verified cryptographic challenge-response public key credentials are used.

### Payment Correctness & Accounting
- **NPCI Standard UPI QR**: Compliant UPI pay URIs (`upi://pay?pa=...&pn=...&am=...&cu=INR&tr=...&tn=...`) generated server-side. No proprietary checksum parameters.
- **Webhook HMAC-SHA256**: Raw request bodies are captured during ingestion and verified against `WEBHOOK_SECRET` with constant-time equality comparisons (`crypto.timingSafeEqual`) on header `x-webhook-signature`.
- **Strict Idempotency**: Payment events record unique `event_id` in `payment_events` inside a serialized transaction (`BEGIN IMMEDIATE` with `transactionMutex`) to prevent double-crediting.
- **Late Payment Handling**: Exact-amount payments on expired QR codes are credited with `paid_late = 1` and status `LATE`. Superseded references are resolved to parent orders.
- **Integer Currency Math**: All monetary amounts are stored and calculated as 64-bit integer paise (₹1.00 = 100 paise) to eliminate floating-point rounding errors.

---

## 3. Environment Variables Reference

| Variable | Description | Allowed Environments | Default (Dev) |
| :--- | :--- | :--- | :--- |
| `PORT` | Backend HTTP port | All | `5000` |
| `NODE_ENV` | Environment mode (`development`, `test`, `production`) | All | `development` |
| `CORS_ORIGINS` | Comma-separated list of allowed frontend origins | All | `http://localhost:3000` |
| `TRUST_PROXY` | Express trust proxy setting | All | `loopback` |
| `DB_PATH` | Path to SQLite database file (`:memory:` for tests) | All | `./merchant.db` |
| `JWT_SECRET` | 32+ character HMAC secret for session and sensitive tokens | All (Distinct) | Generated in dev |
| `OTP_HMAC_SECRET` | 32+ character HMAC secret for phone OTP verification | All (Distinct) | Generated in dev |
| `QR_SIGNING_SECRET` | 32+ character HMAC secret for internal QR verification | All (Distinct) | Generated in dev |
| `WEBHOOK_SECRET` | 32+ character secret for verifying payment gateway HMAC | All (Distinct) | Generated in dev |
| `SEED_DEMO` | Seeds demo merchant on startup | Dev / Test ONLY | `true` |
| `SEED_DEMO_PIN` | Demo merchant PIN (or randomly generated on startup) | Dev / Test ONLY | `123456` |
| `ALLOW_DEV_OTP` | Returns OTP in response or server logs | Dev / Test ONLY | `true` |
| `ENABLE_PAYMENT_SIMULATOR` | Enables `/api/v1/payments/simulate-success` endpoint | Dev / Test ONLY | `true` |
| `SMS_PROVIDER` | SMS adapter (`mock` for dev/test, `msg91` for prod) | All | `mock` |
| `MSG91_AUTH_KEY` | MSG91 API authentication key | Production | *None* |
| `MSG91_SENDER_ID` | Approved 6-character TRAI DLT Sender ID | Production | *None* |
| `MSG91_DLT_TE_ID` | Approved TRAI DLT Template ID for OTP SMS | Production | *None* |

---

## 4. API Specification & Authentication Requirements

### Public Endpoints (No Session Required)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/config` | Returns client flags (`enablePaymentSimulator`) |
| `POST` | `/api/v1/auth/otp/send` | Dispatches 6-digit SMS OTP (30s cooldown, rate-limited) |
| `POST` | `/api/v1/auth/otp/verify` | Validates OTP; returns verification token (max 5 attempts) |
| `POST` | `/api/v1/auth/register` | Registers merchant; sets httpOnly session cookie |
| `POST` | `/api/v1/auth/login` | Authenticates merchant via phone + 6-digit PIN; sets cookie |
| `POST` | `/api/v1/auth/reset-pin` | Resets PIN with valid OTP verification token |
| `POST` | `/api/v1/payments/webhook` | Payment gateway webhook (verified via HMAC signature) |

### Authenticated Endpoints (`requireAuth` Enforced)
| Method | Endpoint | Required Headers / Guard | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/auth/me` | Session Cookie | Returns current authenticated merchant profile |
| `POST` | `/api/v1/auth/logout` | Session Cookie | Clears session cookie |
| `POST` | `/api/v1/orders` | Session Cookie | Creates new dynamic QR order (paise, 5-min expiry) |
| `GET` | `/api/v1/orders` | Session Cookie | Lists orders with filters (`status`, `searchRef`, dates) |
| `GET` | `/api/v1/orders/:id` | Session Cookie | Gets order details (404 if not owned by merchant) |
| `POST` | `/api/v1/orders/:id/refresh` | Session Cookie | Generates fresh QR (allowed only if `EXPIRED`) |
| `GET` | `/api/v1/security/status` | Session Cookie | Returns lock status and passkey counts |
| `POST` | `/api/v1/security/verify-passcode`| Session Cookie | Verifies PIN; returns 2-min action-bound token |
| `POST` | `/api/v1/security/webauthn/register/options` | Session Cookie | Generates WebAuthn passkey registration options |
| `POST` | `/api/v1/security/webauthn/register/verify` | Session Cookie | Verifies WebAuthn passkey attestation |
| `POST` | `/api/v1/security/webauthn/authenticate/options` | Session Cookie | Generates WebAuthn passkey challenge options |
| `POST` | `/api/v1/security/webauthn/authenticate/verify` | Session Cookie | Verifies passkey assertion; returns action token |
| `POST` | `/api/v1/security/biometrics/toggle` | Session Cookie + Action Token (`DISABLE_LOCK` if turning off) | Toggles biometric app lock requirement |
| `POST` | `/api/v1/security/payouts` | Session Cookie + `x-sensitive-token` (`PAYOUT`) | Deducts balance; supports `Idempotency-Key` |
| `GET` | `/api/v1/security/payouts` | Session Cookie | Lists merchant payout history |
| `PUT` | `/api/v1/security/bank-details` | Session Cookie + `x-sensitive-token` (`BANK_DETAILS`) | Updates bank account and IFSC settlement details |
| `GET` | `/api/v1/security/reports/export` | Session Cookie + `x-sensitive-token` (`EXPORT`) | Exports transactions as CSV |
| `GET` | `/api/v1/security/needs-attention` | Session Cookie | Lists late orders and flagged review events |
| `POST` | `/api/v1/payments/simulate-success` | Session Cookie (Dev Only) | Simulates payment gateway webhook callback |

---

## 5. Webhook Signature Specification

To integrate external payment gateways (e.g. Razorpay, Cashfree, PhonePe) or mock tools:
- The webhook listener expects an `HMAC-SHA256` signature of the raw request payload in the `x-webhook-signature` HTTP header.
- Computed as: `crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')`.

Example Webhook Payload:
```json
{
  "event_id": "evt_9f8d7c6b5a4e3d2c",
  "order_ref": "TXN-902834-4821",
  "amount": 25000,
  "status": "SUCCESS",
  "gateway_payment_id": "pay_live_8392019382",
  "timestamp": 1731558291000
}
```

---

## 6. How to Test & Verify

### Automated Test Suite
Run the full test suite in `backend`:
```bash
cd backend
npm run check
```
- Executes 40 unit and integration tests across 8 suites.
- Runs with `DB_PATH=:memory:` — `merchant.db` is never modified or overwritten by tests.

### Manual Verification Flow
1. **Sign In**:
   - Navigate to `http://localhost:3000`.
   - Log in using demo credentials:
     - **Phone**: `+919876543210`
     - **PIN**: `123456`
2. **Dynamic QR Generation**:
   - In the **UPI Terminal** tab, enter `250.00` and tap **Generate Dynamic QR**.
   - Notice the live `05:00` countdown timer and UPI QR encoding.
   - Tap **Simulate Customer Scan & Payment** (available in dev mode).
   - The status updates immediately to `Paid` and terminal balance increments.
3. **Biometric Security & Passkeys**:
   - In the **Security & Wallet** tab, tap **Register Passkey on This Device** to enroll Windows Hello / Touch ID / Face ID.
   - Switch to another application or minimize the browser for 60 seconds; observe the **Apex Terminal Locked** overlay.
   - Unlock with hardware biometric passkey or the 6-digit PIN fallback.
4. **Guarded Sensitive Actions**:
   - Under **Settlement Payout**, tap **Request Payout**.
   - A biometric/PIN challenge modal appears. Authorize the action.
   - The balance is deducted atomically and the payout appears in the **Transactions** ledger.
