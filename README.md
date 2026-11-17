# Apex Merchant App

Production-grade Merchant Application with **Dynamic UPI QR Code Generation**, **Biometric Passkey Authentication (WebAuthn)**, and **TRAI DLT-Compliant Mobile OTP Verification & PIN Security**.

Built as a **unified full-stack application** with an Express + TypeScript backend (Serverless `/api`) and a React + Vite + Tailwind CSS frontend (`/src`), ready for **one-click deployment on Vercel**.

---

## 1. Quick Start Guide

### Prerequisites
- Node.js `v18+` (Tested on `v20+` and `v26+`)
- npm `9+`

### Local Setup & Development
```bash
# 1. Install all dependencies
npm install

# 2. Run automated tests (40 tests across 8 suites)
npm test

# 3. Build frontend bundle
npm run build

# 4. Start local development (runs Vite UI on :3000 & Express API on :5000)
npm run dev
```

---

## 2. Deploying to Vercel (All-in-One)

This repository is pre-configured with `vercel.json` for seamless, single-repository deployment on **Vercel**:
- **Frontend**: Automatically built via `vite build` into `dist/` and served globally via Vercel Edge CDN.
- **Backend API**: Automatically deployed as serverless functions via `/api/index.ts` handling all `/api/v1/*` routes.
- **Database**: In Vercel serverless environments, SQLite automatically runs in `/tmp/merchant.db` to prevent read-only filesystem restrictions.

### Vercel Deployment Steps:
1. Push your repository to GitHub: `https://github.com/Gatikrushna-64/merchant`.
2. Go to [https://vercel.com/new](https://vercel.com/new).
3. Import your **`Gatikrushna-64/merchant`** repository.
4. Framework Preset: **Vite** (auto-detected).
5. Build Command: `npm run build` (or `vite build`).
6. Output Directory: `dist`.
7. **Environment Variables** (Optional for production customization):
   - `JWT_SECRET`: 48-byte hex secret
   - `OTP_HMAC_SECRET`: 48-byte hex secret
   - `QR_SIGNING_SECRET`: 48-byte hex secret
   - `WEBHOOK_SECRET`: 48-byte hex secret
8. Click **Deploy**. Your entire full-stack app will be live on your `*.vercel.app` domain!

---

## 3. Project Structure

```text
merchant_app/
├── api/                   # Express backend (Serverless Functions on Vercel)
│   ├── config/            # Secrets & environment configuration
│   ├── controllers/       # Auth, orders, payments, security controllers
│   ├── db/                # SQLite initialization & auto-migrations
│   ├── middleware/        # JWT auth, rate limiters, CORS & CSRF guard
│   ├── routes/            # Express route handlers
│   ├── services/          # Business logic, OTP, QR, WebAuthn, SMS
│   ├── types/             # Backend TypeScript interfaces
│   ├── app.ts             # Express application setup
│   ├── index.ts           # Vercel serverless entrypoint
│   └── server.ts          # Local dev standalone server (:5000)
├── src/                   # React frontend
│   ├── components/        # QR terminal, transactions, security, auth
│   ├── context/           # AuthContext, BiometricContext
│   ├── services/          # API client, WebAuthn passkey client
│   ├── utils/             # Currency paise math, formatters, validation
│   ├── types.ts           # Frontend TypeScript types
│   ├── App.tsx            # Root application view
│   ├── main.tsx           # React entry point
│   └── index.css          # Tailwind CSS styles
├── tests/                 # Automated test suite (Jest + Supertest)
│   ├── auth.isolation.test.ts
│   ├── biometrics.sensitive.test.ts
│   ├── otp.hardening.test.ts
│   ├── otp.registration.test.ts
│   ├── payments.hardening.test.ts
│   ├── qr.test.ts
│   ├── setup.ts
│   ├── webauthn.test.ts
│   └── webhook.idempotency.test.ts
├── index.html             # Vite HTML entry point
├── package.json           # Unified dependencies & scripts
├── vite.config.ts         # Vite bundler configuration
├── vercel.json            # Vercel routing & serverless rewrites
├── tailwind.config.js     # Tailwind CSS configuration
├── postcss.config.js      # PostCSS configuration
├── tsconfig.json          # Unified TypeScript configuration
└── jest.config.cjs        # Jest test configuration
```

---

## 4. Security & Architecture Model

- **No Shared or Compromised Secrets**: Production startup immediately halts if secrets are missing or weak.
- **Merchant Isolation**: All state-changing endpoints enforce `requireAuth` reading a signed JWT from an `httpOnly`, `SameSite=Lax` cookie. Client-supplied merchant IDs are strictly rejected.
- **Hardware Passkeys (WebAuthn)**: Native biometric authentication (Touch ID, Face ID, Windows Hello, Android BiometricPrompt) via `@simplewebauthn`. Biometrics never leave the device.
- **Idempotent Webhooks**: Strict HMAC-SHA256 signature verification over raw body with `payment_events` unique constraints and transaction mutex serialization.
- **Integer Paise Currency Math**: Zero floating-point rounding errors. All amounts calculated and stored in paise (₹1.00 = 100 paise).
- **Automated Database Migrations**: `initDatabase()` automatically detects missing columns or older schemas using SQLite `PRAGMA table_info` and applies safe migrations.

---

## 5. Demo Login Credentials (Local Development)

- **Phone Number**: `+919876543210`
- **PIN**: `123456`
- **Default Business**: Apex Retail Mart
- **Default Settlement VPA**: `merchant@okhdfcbank`
