import React, { useState, useEffect } from 'react';
import { useBiometrics } from '../context/BiometricContext';
import { BiometricService } from '../services/biometricService';
import { Fingerprint, KeyRound, AlertTriangle, ShieldCheck, X } from 'lucide-react';

export const SensitiveActionModal: React.FC = () => {
  const { sensitiveActionPrompt, closeSensitiveAction } = useBiometrics();
  const [showPin, setShowPin] = useState<boolean>(false);
  const [pin, setPin] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sensitiveActionPrompt) {
        closeSensitiveAction();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sensitiveActionPrompt, closeSensitiveAction]);

  if (!sensitiveActionPrompt) return null;

  const handleBiometricAuth = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await BiometricService.authenticateWithPasskey(sensitiveActionPrompt.action);

      if (res.success && res.token) {
        sensitiveActionPrompt.onSuccess(res.token);
        closeSensitiveAction();
      } else {
        if (res.code === 'NOT_SUPPORTED' || res.code === 'NOT_ENROLLED') {
          setShowPin(true);
          setError(res.error || 'Biometrics not enrolled. Please verify with your 6-digit PIN.');
        } else if (res.code === 'USER_CANCELLED') {
          setError('Biometric verification cancelled.');
        } else {
          setError(res.error || 'Biometric authorization failed.');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authorization failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePinAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) {
      setError('Please enter your 6-digit PIN.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await BiometricService.verifyDevicePasscode(pin, sensitiveActionPrompt.action);
      if (res.success && res.token) {
        sensitiveActionPrompt.onSuccess(res.token);
        closeSensitiveAction();
      } else {
        setError(res.error || 'Incorrect PIN.');
      }
    } catch (err: any) {
      setError(err.message || 'Verification error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sensitive-action-title"
      className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 relative">
        <button
          onClick={closeSensitiveAction}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center">
          <div className="w-12 h-12 bg-amber-50 border border-amber-200 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 id="sensitive-action-title" className="text-lg font-bold text-slate-800">
            {sensitiveActionPrompt.title}
          </h3>
          <p className="text-xs text-slate-400 mt-1">{sensitiveActionPrompt.description}</p>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {!showPin ? (
          <div className="mt-6 space-y-3">
            <button
              onClick={handleBiometricAuth}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 transition"
            >
              <Fingerprint className="w-5 h-5 animate-pulse" />
              <span>{loading ? 'Verifying with Hardware...' : 'Confirm with Biometrics'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowPin(true)}
              className="w-full text-xs text-indigo-600 hover:text-indigo-800 font-semibold py-2 flex items-center justify-center gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Use 6-Digit PIN Fallback</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handlePinAuth} className="mt-6 space-y-4">
            <div>
              <label htmlFor="sensitive-pin-input" className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 text-center">
                Enter 6-Digit Security PIN
              </label>
              <input
                id="sensitive-pin-input"
                type="password"
                maxLength={6}
                pattern="[0-9]*"
                inputMode="numeric"
                autoFocus
                placeholder="••••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className="w-full text-center tracking-[0.8em] text-xl font-bold py-2.5 px-3 border border-slate-200 rounded-xl focus:border-indigo-600 outline-none"
              />
              <span className="text-[10px] text-slate-400 mt-1 block text-center">Enter your 6-digit PIN</span>
            </div>

            <button
              type="submit"
              disabled={loading || pin.length !== 6}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50 transition"
            >
              {loading ? 'Verifying...' : 'Authorize Action'}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPin(false);
                setError(null);
              }}
              className="text-xs text-indigo-600 block mx-auto py-1"
            >
              Back to Biometric Prompt
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
