import React, { useState, useEffect } from 'react';
import { useBiometrics } from '../context/BiometricContext';
import { BiometricService } from '../services/biometricService';
import { Fingerprint, KeyRound, ShieldAlert, AlertCircle, ArrowRight, Lock } from 'lucide-react';

export const BiometricLockOverlay: React.FC = () => {
  const { isLocked, unlockApp } = useBiometrics();
  const [showPinFallback, setShowPinFallback] = useState<boolean>(false);
  const [pin, setPin] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<number>(0);

  // Auto-prompt biometrics when lock becomes active
  useEffect(() => {
    if (isLocked) {
      handleBiometricUnlock();
    }
  }, [isLocked]);

  if (!isLocked) return null;

  const handleBiometricUnlock = async () => {
    setLoading(true);
    setErrorMessage(null);

    const result = await BiometricService.authenticateWithPasskey('PAYOUT');

    setLoading(false);
    if (result.success) {
      unlockApp();
      setAttempts(0);
    } else {
      setAttempts((prev) => prev + 1);
      if (result.code === 'NOT_SUPPORTED' || result.code === 'NOT_ENROLLED') {
        setShowPinFallback(true);
        setErrorMessage(result.error || 'Biometric passkey not available. Please enter your 6-digit PIN.');
      } else if (result.code === 'TOO_MANY_ATTEMPTS' || attempts >= 3) {
        setShowPinFallback(true);
        setErrorMessage('Too many biometric attempts. Passcode verification required.');
      } else if (result.code === 'USER_CANCELLED') {
        setErrorMessage('Biometric prompt was cancelled. Tap to retry or use PIN.');
      } else {
        setErrorMessage(result.error || 'Biometric authentication failed. Tap to retry or use PIN.');
      }
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) {
      setErrorMessage('Passcode must be exactly 6 digits.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const result = await BiometricService.verifyDevicePasscode(pin, 'PAYOUT');
    setLoading(false);

    if (result.success) {
      unlockApp();
      setPin('');
      setAttempts(0);
    } else {
      setAttempts((prev) => prev + 1);
      setErrorMessage(result.error || 'Incorrect passcode. Please try again.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Merchant Terminal Locked"
      className="fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 flex flex-col items-center text-center">
        {/* App Lock Icon */}
        <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 mb-4 shadow-inner">
          <Lock className="w-8 h-8" />
        </div>

        <h2 className="text-xl font-bold text-slate-800">Apex Terminal Locked</h2>
        <p className="text-xs text-slate-400 mt-1 max-w-[240px]">
          Biometric security active. Verify your identity to access terminal.
        </p>

        {errorMessage && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs flex items-center gap-2 text-left w-full">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{errorMessage}</span>
          </div>
        )}

        {!showPinFallback ? (
          <div className="w-full mt-8 space-y-4">
            <button
              onClick={handleBiometricUnlock}
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 active:scale-[0.98] transition py-4 rounded-2xl text-white font-semibold flex items-center justify-center gap-3 shadow-lg shadow-indigo-200"
            >
              <Fingerprint className="w-6 h-6 animate-pulse" />
              <span>{loading ? 'Verifying with OS...' : 'Tap for Biometric Unlock'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowPinFallback(true)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center justify-center gap-1.5 mx-auto py-1"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Use 6-Digit PIN Instead</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handlePinSubmit} className="w-full mt-6 space-y-4">
            <div>
              <label htmlFor="terminal-pin-input" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Enter 6-Digit PIN
              </label>
              <input
                id="terminal-pin-input"
                type="password"
                maxLength={6}
                pattern="[0-9]*"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                className="w-full text-center tracking-[1em] text-2xl font-bold py-3 px-4 border border-slate-200 rounded-2xl focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Enter your 6-digit account PIN</span>
            </div>

            <button
              type="submit"
              disabled={loading || pin.length !== 6}
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span>{loading ? 'Verifying...' : 'Unlock Terminal'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPinFallback(false);
                setErrorMessage(null);
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold block mx-auto py-1"
            >
              Back to Biometric Unlock
            </button>
          </form>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldAlert className="w-3.5 h-3.5 text-emerald-500" />
          <span>Biometric credentials never leave your hardware</span>
        </div>
      </div>
    </div>
  );
};
