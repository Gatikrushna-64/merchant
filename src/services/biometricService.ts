import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable
} from '@simplewebauthn/browser';

export interface BiometricAuthResult {
  success: boolean;
  token?: string;
  authMethod: 'BIOMETRIC' | 'PIN';
  error?: string;
  code?:
    | 'NOT_SUPPORTED'
    | 'NOT_ENROLLED'
    | 'TOO_MANY_ATTEMPTS'
    | 'USER_CANCELLED'
    | 'BIOMETRICS_CHANGED'
    | 'INVALID_PIN';
}

export class BiometricService {
  /**
   * Checks if current browser environment supports WebAuthn APIs
   */
  public static isWebAuthnSupported(): boolean {
    return browserSupportsWebAuthn();
  }

  /**
   * Checks if platform authenticator (fingerprint / Face ID / Windows Hello) is available
   */
  public static async isPlatformBiometricAvailable(): Promise<boolean> {
    if (!this.isWebAuthnSupported()) return false;
    try {
      return await platformAuthenticatorIsAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Registers a new WebAuthn passkey device for the merchant
   */
  public static async registerPasskey(deviceName = 'Merchant Terminal'): Promise<{ success: boolean; error?: string }> {
    if (!this.isWebAuthnSupported()) {
      return { success: false, error: 'WebAuthn passkeys are not supported on this browser.' };
    }

    try {
      const optionsRes = await fetch('/api/v1/security/webauthn/register/options', {
        method: 'POST',
        credentials: 'include'
      });

      if (!optionsRes.ok) {
        const errData = await optionsRes.json();
        throw new Error(errData.error || 'Failed to fetch passkey registration options');
      }

      const optionsJSON = await optionsRes.json();
      const attResp = await startRegistration({ optionsJSON });

      const verifyRes = await fetch('/api/v1/security/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ response: attResp, deviceName })
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Passkey registration failed');
      }

      return { success: true };
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        return { success: false, error: 'Passkey registration cancelled by user.' };
      }
      return { success: false, error: err.message || 'Passkey enrollment failure' };
    }
  }

  /**
   * Performs real cryptographic WebAuthn biometric authentication.
   * Zero fake paths: issues token only after server signature verification.
   */
  public static async authenticateWithPasskey(
    action: 'PAYOUT' | 'BANK_DETAILS' | 'EXPORT' | 'DISABLE_LOCK' = 'PAYOUT'
  ): Promise<BiometricAuthResult> {
    if (!this.isWebAuthnSupported()) {
      return {
        success: false,
        authMethod: 'BIOMETRIC',
        code: 'NOT_SUPPORTED',
        error: 'WebAuthn is not supported in this browser environment.'
      };
    }

    try {
      const optionsRes = await fetch('/api/v1/security/webauthn/authenticate/options', {
        method: 'POST',
        credentials: 'include'
      });

      if (!optionsRes.ok) {
        const errData = await optionsRes.json();
        if (errData.error && errData.error.includes('No passkey registered')) {
          return {
            success: false,
            authMethod: 'BIOMETRIC',
            code: 'NOT_ENROLLED',
            error: 'No biometric passkey registered on your account yet. Use PIN or enroll passkey in settings.'
          };
        }
        throw new Error(errData.error || 'Failed to retrieve authentication challenge');
      }

      const optionsJSON = await optionsRes.json();
      const asseResp = await startAuthentication({ optionsJSON });

      const verifyRes = await fetch('/api/v1/security/webauthn/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ response: asseResp, action })
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Biometric verification was rejected by server');
      }

      return {
        success: true,
        token: verifyData.token,
        authMethod: 'BIOMETRIC'
      };
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        return {
          success: false,
          authMethod: 'BIOMETRIC',
          code: 'USER_CANCELLED',
          error: 'Biometric prompt was dismissed or timed out.'
        };
      }
      return {
        success: false,
        authMethod: 'BIOMETRIC',
        code: 'NOT_ENROLLED',
        error: err.message || 'Biometric verification failed.'
      };
    }
  }

  /**
   * Device PIN / Passcode fallback verification
   */
  public static async verifyDevicePasscode(
    passcode: string,
    action: 'PAYOUT' | 'BANK_DETAILS' | 'EXPORT' | 'DISABLE_LOCK' = 'PAYOUT'
  ): Promise<BiometricAuthResult> {
    try {
      const res = await fetch('/api/v1/security/verify-passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ passcode, action })
      });

      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          authMethod: 'PIN',
          code: 'INVALID_PIN',
          error: data.error || 'Invalid passcode entered.'
        };
      }

      return {
        success: true,
        token: data.token,
        authMethod: 'PIN'
      };
    } catch (err: any) {
      return {
        success: false,
        authMethod: 'PIN',
        code: 'INVALID_PIN',
        error: err.message || 'Passcode verification failed.'
      };
    }
  }
}
