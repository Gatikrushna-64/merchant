import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { BiometricService } from '../services/biometricService';
import { useAuth } from './AuthContext';

interface SensitiveActionConfig {
  title: string;
  description: string;
  action: 'PAYOUT' | 'BANK_DETAILS' | 'EXPORT' | 'DISABLE_LOCK';
  onSuccess: (token: string) => void;
  onCancel?: () => void;
}

interface BiometricContextType {
  isLocked: boolean;
  biometricsEnabled: boolean;
  sensitiveActionPrompt: SensitiveActionConfig | null;
  unlockApp: () => void;
  triggerSensitiveAction: (config: SensitiveActionConfig) => void;
  closeSensitiveAction: () => void;
  toggleBiometricsSetting: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  enrollPasskey: (deviceName?: string) => Promise<{ success: boolean; error?: string }>;
}

const BiometricContext = createContext<BiometricContextType | null>(null);

export const BiometricProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { merchant, refreshProfile } = useAuth();
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [sensitiveActionPrompt, setSensitiveActionPrompt] = useState<SensitiveActionConfig | null>(null);

  const lastHiddenTimeRef = useRef<number | null>(null);
  const lastActiveTimeRef = useRef<number>(Date.now());

  const biometricsEnabled = merchant?.biometrics_enabled === 1;

  // Track 60-second inactivity timer
  useEffect(() => {
    if (!merchant || !biometricsEnabled) return;

    const onUserActivity = () => {
      lastActiveTimeRef.current = Date.now();
    };

    window.addEventListener('mousemove', onUserActivity);
    window.addEventListener('keydown', onUserActivity);
    window.addEventListener('touchstart', onUserActivity);

    const inactivityInterval = setInterval(() => {
      const idleTime = Date.now() - lastActiveTimeRef.current;
      if (idleTime >= 60000 && !isLocked) {
        setIsLocked(true);
      }
    }, 5000);

    return () => {
      window.removeEventListener('mousemove', onUserActivity);
      window.removeEventListener('keydown', onUserActivity);
      window.removeEventListener('touchstart', onUserActivity);
      clearInterval(inactivityInterval);
    };
  }, [merchant, biometricsEnabled, isLocked]);

  // Track background & tab blur (>= 60 seconds threshold)
  useEffect(() => {
    if (!merchant || !biometricsEnabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenTimeRef.current = Date.now();
      } else if (document.visibilityState === 'visible') {
        if (lastHiddenTimeRef.current) {
          const elapsed = Date.now() - lastHiddenTimeRef.current;
          if (elapsed >= 60000) {
            setIsLocked(true);
          }
          lastHiddenTimeRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [merchant, biometricsEnabled]);

  const unlockApp = () => {
    setIsLocked(false);
    lastHiddenTimeRef.current = null;
    lastActiveTimeRef.current = Date.now();
  };

  const triggerSensitiveAction = (config: SensitiveActionConfig) => {
    setSensitiveActionPrompt(config);
  };

  const closeSensitiveAction = () => {
    if (sensitiveActionPrompt?.onCancel) {
      sensitiveActionPrompt.onCancel();
    }
    setSensitiveActionPrompt(null);
  };

  const enrollPasskey = async (deviceName = 'Merchant Passkey') => {
    const result = await BiometricService.registerPasskey(deviceName);
    if (result.success) {
      await refreshProfile();
    }
    return result;
  };

  const toggleBiometricsSetting = async (
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      let sensitiveToken: string | undefined;

      // Disabling requires sensitive authorization
      if (!enabled && biometricsEnabled) {
        const bioResult = await BiometricService.authenticateWithPasskey('DISABLE_LOCK');
        if (!bioResult.success) {
          return {
            success: false,
            error: bioResult.error || 'Biometric authorization required to disable app lock.'
          };
        }
        sensitiveToken = bioResult.token;
      }

      const res = await fetch('/api/v1/security/biometrics/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sensitiveToken ? { 'x-sensitive-token': sensitiveToken } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ enabled })
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error };
      }

      await refreshProfile();
      if (!enabled) {
        setIsLocked(false);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update biometric setting.' };
    }
  };

  return (
    <BiometricContext.Provider
      value={{
        isLocked,
        biometricsEnabled,
        sensitiveActionPrompt,
        unlockApp,
        triggerSensitiveAction,
        closeSensitiveAction,
        toggleBiometricsSetting,
        enrollPasskey
      }}
    >
      {children}
    </BiometricContext.Provider>
  );
};

export const useBiometrics = () => {
  const context = useContext(BiometricContext);
  if (!context) {
    throw new Error('useBiometrics must be used within a BiometricProvider');
  }
  return context;
};
