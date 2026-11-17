import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import crypto from 'crypto';
import { db } from '../db';
import { config } from '../config';
import { Merchant, SensitiveAction, WebAuthnCredentialRecord } from '../types';
import { SecurityService } from './securityService';

export class WebAuthnService {
  /**
   * Generates passkey registration options for authenticated merchant
   */
  public static async getRegistrationOptions(merchant: Merchant) {
    const existingCreds = await db.all<WebAuthnCredentialRecord>(
      'SELECT credential_id FROM webauthn_credentials WHERE merchant_id = ?',
      [merchant.id]
    );

    const options = await generateRegistrationOptions({
      rpName: config.webauthn.rpName,
      rpID: config.webauthn.rpId,
      userID: Buffer.from(merchant.id, 'utf-8'),
      userName: merchant.phone,
      userDisplayName: merchant.business_name || merchant.name,
      attestationType: 'none',
      excludeCredentials: existingCreds.map(c => ({
        id: c.credential_id,
        transports: ['internal']
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required'
      }
    });

    const challengeId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000;

    await db.run(
      'INSERT INTO webauthn_challenges (id, merchant_id, challenge, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [challengeId, merchant.id, options.challenge, expiresAt, now]
    );

    return options;
  }

  /**
   * Verifies passkey registration response and stores public key
   */
  public static async verifyRegistration(
    merchant: Merchant,
    body: any,
    deviceName?: string
  ): Promise<{ success: boolean; credentialId: string }> {
    const now = Date.now();
    const challengeRecord = await db.get(
      'SELECT id, challenge FROM webauthn_challenges WHERE merchant_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
      [merchant.id, now]
    );

    if (!challengeRecord) {
      throw new Error('Registration challenge expired or missing. Please try again.');
    }

    // Invalidate challenge (single-use)
    await db.run('DELETE FROM webauthn_challenges WHERE id = ?', [challengeRecord.id]);

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpId,
      requireUserVerification: true
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('Passkey verification failed');
    }

    const { credential } = verification.registrationInfo;
    const credId = crypto.randomUUID();
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64url');

    await db.run(
      `INSERT INTO webauthn_credentials (
        id, merchant_id, credential_id, public_key, counter, transports, device_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        credId,
        merchant.id,
        credential.id,
        publicKeyBase64,
        credential.counter,
        JSON.stringify(body.response?.transports || ['internal']),
        deviceName || 'Biometric Device',
        now
      ]
    );

    // Enable biometrics flag on merchant
    await db.run('UPDATE merchants SET biometrics_enabled = 1 WHERE id = ?', [merchant.id]);

    return { success: true, credentialId: credential.id };
  }

  /**
   * Generates authentication options for biometric verification
   */
  public static async getAuthenticationOptions(merchant: Merchant) {
    const credentials = await db.all<WebAuthnCredentialRecord>(
      'SELECT * FROM webauthn_credentials WHERE merchant_id = ?',
      [merchant.id]
    );

    if (credentials.length === 0) {
      throw new Error('No passkey registered for this merchant. Please register a passkey first.');
    }

    const options = await generateAuthenticationOptions({
      rpID: config.webauthn.rpId,
      userVerification: 'required',
      allowCredentials: credentials.map(c => ({
        id: c.credential_id,
        transports: c.transports ? JSON.parse(c.transports) : undefined
      }))
    });

    const challengeId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000;

    await db.run(
      'INSERT INTO webauthn_challenges (id, merchant_id, challenge, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [challengeId, merchant.id, options.challenge, expiresAt, now]
    );

    return options;
  }

  /**
   * Verifies passkey assertion and issues a sensitive action token bound to merchant and action
   */
  public static async verifyAuthentication(
    merchant: Merchant,
    body: any,
    action: SensitiveAction
  ): Promise<{ success: boolean; token: string }> {
    const now = Date.now();
    const challengeRecord = await db.get(
      'SELECT id, challenge FROM webauthn_challenges WHERE merchant_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
      [merchant.id, now]
    );

    if (!challengeRecord) {
      throw new Error('Authentication challenge expired or missing. Please try again.');
    }

    await db.run('DELETE FROM webauthn_challenges WHERE id = ?', [challengeRecord.id]);

    const credentialRecord = await db.get<WebAuthnCredentialRecord>(
      'SELECT * FROM webauthn_credentials WHERE merchant_id = ? AND credential_id = ?',
      [merchant.id, body.id]
    );

    if (!credentialRecord) {
      throw new Error('Unknown or unregistered passkey credential');
    }

    const publicKeyBuffer = Buffer.from(credentialRecord.public_key, 'base64url');

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpId,
      credential: {
        id: credentialRecord.credential_id,
        publicKey: new Uint8Array(publicKeyBuffer),
        counter: credentialRecord.counter,
        transports: credentialRecord.transports ? JSON.parse(credentialRecord.transports) : undefined
      },
      requireUserVerification: true
    });

    if (!verification.verified) {
      throw new Error('Biometric authentication could not be verified by operating system');
    }

    // Update counter and last_used_at
    await db.run(
      'UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?',
      [verification.authenticationInfo.newCounter, now, credentialRecord.id]
    );

    // Issue sensitive action token
    const token = SecurityService.generateSensitiveToken(merchant.id, action, 'BIOMETRIC');

    return { success: true, token };
  }

  /**
   * Lists registered WebAuthn passkey devices
   */
  public static async listDevices(merchantId: string) {
    return await db.all<WebAuthnCredentialRecord>(
      'SELECT id, credential_id, device_name, created_at, last_used_at FROM webauthn_credentials WHERE merchant_id = ?',
      [merchantId]
    );
  }

  /**
   * Deletes a passkey device (requires step-up sensitive action auth)
   */
  public static async deleteDevice(merchantId: string, deviceId: string) {
    const result = await db.run(
      'DELETE FROM webauthn_credentials WHERE id = ? AND merchant_id = ?',
      [deviceId, merchantId]
    );

    // If no credentials remaining, set biometrics_enabled = 0
    const countRow = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM webauthn_credentials WHERE merchant_id = ?',
      [merchantId]
    );

    if (!countRow || countRow.count === 0) {
      await db.run('UPDATE merchants SET biometrics_enabled = 0 WHERE id = ?', [merchantId]);
    }

    return { success: result.changes > 0 };
  }
}

