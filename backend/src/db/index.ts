import sqlite3 from 'sqlite3';
import { config } from '../config';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Ensure database directory exists if not in-memory
if (config.dbPath !== ':memory:') {
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

export const sqlite = new sqlite3.Database(config.dbPath);

// Enable WAL mode and foreign keys for durability and concurrency
sqlite.serialize(() => {
  sqlite.run('PRAGMA foreign_keys = ON;');
  if (config.dbPath !== ':memory:') {
    sqlite.run('PRAGMA journal_mode = WAL;');
  }
});

export const db = {
  run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      sqlite.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },

  get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      sqlite.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row as T | undefined);
      });
    });
  },

  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      sqlite.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows as T[]);
      });
    });
  },

  exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sqlite.exec(sql, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
};

/**
 * Mutex queue to serialize SQLite transactions in Node.js event loop
 */
class AsyncMutex {
  private queue = Promise.resolve();

  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const waitPromise = new Promise<void>(res => { release = res; });
    const currentQueue = this.queue;
    this.queue = currentQueue.then(() => waitPromise);
    await currentQueue;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}

export const transactionMutex = new AsyncMutex();

/**
 * Runs a callback inside a serialized SQLite transaction
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return transactionMutex.runExclusive(async () => {
    await db.run('BEGIN IMMEDIATE;');
    try {
      const result = await fn();
      await db.run('COMMIT;');
      return result;
    } catch (err) {
      await db.run('ROLLBACK;').catch(() => {});
      throw err;
    }
  });
}

export async function initDatabase(): Promise<void> {
  const schema = `
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      phone_verified INTEGER DEFAULT 0,
      upi_vpa TEXT NOT NULL,
      bank_account_number TEXT,
      bank_ifsc TEXT,
      passcode_hash TEXT NOT NULL,
      biometrics_enabled INTEGER DEFAULT 0,
      balance INTEGER DEFAULT 0,
      failed_pin_attempts INTEGER DEFAULT 0,
      pin_locked_until INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS otp_verifications (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      expires_at INTEGER NOT NULL,
      cooldown_until INTEGER NOT NULL,
      locked_until INTEGER,
      verified_at INTEGER,
      ip_address TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verifications(phone);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      reference_id TEXT UNIQUE NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR',
      note TEXT,
      upi_payload TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      paid_late INTEGER DEFAULT 0,
      expires_at INTEGER NOT NULL,
      paid_at INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(merchant_id) REFERENCES merchants(id)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_reference ON orders(reference_id);
    CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id);

    CREATE TABLE IF NOT EXISTS order_references (
      reference_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      superseded_at INTEGER,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_order_ref_order ON order_references(order_id);

    CREATE TABLE IF NOT EXISTS payment_events (
      id TEXT PRIMARY KEY,
      event_id TEXT UNIQUE NOT NULL,
      order_id TEXT,
      gateway TEXT NOT NULL,
      amount INTEGER NOT NULL,
      classification TEXT NOT NULL,
      review_status TEXT,
      payload_json TEXT NOT NULL,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_payment_event_id ON payment_events(event_id);

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      destination_type TEXT NOT NULL,
      destination_details TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      idempotency_key TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_timestamp INTEGER NOT NULL,
      FOREIGN KEY(merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      device_name TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      FOREIGN KEY(merchant_id) REFERENCES merchants(id)
    );

    CREATE INDEX IF NOT EXISTS idx_webauthn_merchant ON webauthn_credentials(merchant_id);

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS used_tokens (
      jti TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      used_at INTEGER NOT NULL
    );
  `;

  await db.exec(schema);

  // Safe migration: add missing columns to older databases
  await runMigrations();

  // Seed or update demo merchant ONLY when SEED_DEMO=true
  if (config.seedDemo) {
    const demoPhone = '+919876543210';
    const demoId = 'demo-merchant-id';

    // Check if demo merchant already exists by phone OR by id
    const existing = await db.get<any>(
      'SELECT * FROM merchants WHERE phone = ? OR id = ?',
      [demoPhone, demoId]
    );

    const demoPin = config.seedDemoPin || '123456';

    if (!existing) {
      const passcodeHash = await bcrypt.hash(demoPin, 12);

      await db.run(
        `INSERT INTO merchants (
          id, name, business_name, phone, phone_verified, upi_vpa, bank_account_number, bank_ifsc, passcode_hash, biometrics_enabled, balance, failed_pin_attempts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          demoId,
          'Demo Merchant',
          config.defaultMerchantName,
          demoPhone,
          1,
          config.defaultMerchantVpa,
          '98765432101234',
          'HDFC0001234',
          passcodeHash,
          0,
          500000 // 5000.00 INR (in paise)
        ]
      );

      if (config.nodeEnv !== 'test') {
        console.log(`[SEED] Demo merchant seeded: Phone = ${demoPhone}, PIN = ${demoPin}`);
      }
    } else {
      // Migrate older id (e.g. 'default-merchant-id') to 'demo-merchant-id' safely
      if (existing.id !== demoId) {
        await db.run('PRAGMA foreign_keys = OFF');
        await db.run('UPDATE orders SET merchant_id = ? WHERE merchant_id = ?', [demoId, existing.id]);
        await db.run('UPDATE payouts SET merchant_id = ? WHERE merchant_id = ?', [demoId, existing.id]);
        await db.run('UPDATE webauthn_credentials SET merchant_id = ? WHERE merchant_id = ?', [demoId, existing.id]);
        await db.run('UPDATE merchants SET id = ? WHERE id = ?', [demoId, existing.id]);
        await db.run('PRAGMA foreign_keys = ON');
      }

      // If SEED_DEMO_PIN was specified, ensure passcode matches
      if (config.seedDemoPin) {
        const passcodeHash = await bcrypt.hash(config.seedDemoPin, 12);
        await db.run(
          'UPDATE merchants SET passcode_hash = ?, failed_pin_attempts = 0, pin_locked_until = NULL WHERE id = ?',
          [passcodeHash, demoId]
        );
      }

      if (config.nodeEnv !== 'test') {
        console.log(`[SEED] Demo merchant account (${demoPhone}) ready with ID: ${demoId}`);
      }
    }
  }
}

async function ensureColumnExists(table: string, column: string, definition: string): Promise<void> {
  try {
    const columns = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
    const exists = columns.some(c => c.name.toLowerCase() === column.toLowerCase());
    if (!exists) {
      await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch (err: any) {
    // If table doesn't exist yet, it will be created by CREATE TABLE IF NOT EXISTS
  }
}

async function runMigrations(): Promise<void> {
  // merchants table
  await ensureColumnExists('merchants', 'failed_pin_attempts', 'INTEGER DEFAULT 0');
  await ensureColumnExists('merchants', 'pin_locked_until', 'INTEGER');

  // orders table
  await ensureColumnExists('orders', 'paid_late', 'INTEGER DEFAULT 0');

  // payment_events table
  await ensureColumnExists('payment_events', 'classification', "TEXT DEFAULT 'NORMAL'");
  await ensureColumnExists('payment_events', 'review_status', 'TEXT');

  // payouts table
  await ensureColumnExists('payouts', 'idempotency_key', 'TEXT');
  await ensureColumnExists('payouts', 'created_timestamp', 'INTEGER DEFAULT 0');

  // otp_verifications table
  await ensureColumnExists('otp_verifications', 'locked_until', 'INTEGER');
  await ensureColumnExists('otp_verifications', 'verified_at', 'INTEGER');
  await ensureColumnExists('otp_verifications', 'ip_address', 'TEXT');
}
