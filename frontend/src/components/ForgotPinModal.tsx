import React, { useState, useEffect } from 'react';
import { X, KeyRound, AlertCircle, RefreshCw } from 'lucide-react';
import { isValidIndianPhone, validatePinComplexity } from '../utils/validation';

interface ForgotPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ForgotPinModal: React.FC<ForgotPinModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [step, setStep] = useState<'PHONE' | 'OTP' | 'NEW_PIN'>('PHONE');
  const [phone, setPhone] = useState<string>('');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [newPin, setNewPin] = useState<string>('');
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<number>(0);

  // Esc key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Cooldown interval
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  if (!isOpen) return null;

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidIndianPhone(phone)) {
      setError('Please enter a valid 10-digit Indian phone number.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Cannot connect to backend API server (http://localhost:5000).');
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch OTP');

      setCooldown(data.cooldownSeconds || 30);
      if (data.devOtp) {
        setDevOtp(data.devOtp);
      }
      setStep('OTP');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (code: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: code })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Cannot connect to backend API server (http://localhost:5000).');
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Verification failed');

      setVerificationToken(data.verificationToken);
      setStep('NEW_PIN');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    const pinCheck = validatePinComplexity(newPin);
    if (!pinCheck.valid) {
      setError(pinCheck.reason || 'Invalid PIN format');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/auth/reset-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verificationToken,
          newPin
        })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Cannot connect to backend API server (http://localhost:5000).');
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset PIN');

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forgot-pin-title"
      className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 relative">
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg focus:ring-2 focus:ring-indigo-500"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-5">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
            <KeyRound className="w-6 h-6" />
          </div>
          <h3 id="forgot-pin-title" className="text-lg font-bold text-slate-800">
            Reset Security PIN
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {step === 'PHONE' && 'Verify your registered phone number'}
            {step === 'OTP' && 'Enter the 6-digit verification code'}
            {step === 'NEW_PIN' && 'Create your new 6-digit PIN'}
          </p>
        </div>

        {error && (
          <div
            aria-live="polite"
            className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {step === 'PHONE' && (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label htmlFor="reset-phone" className="block text-xs font-semibold text-slate-500 mb-1">
                Registered Mobile Number
              </label>
              <input
                id="reset-phone"
                type="tel"
                required
                autoFocus
                placeholder="+91 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:border-indigo-600"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 text-xs"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Send Reset OTP</span>}
            </button>
          </form>
        )}

        {step === 'OTP' && (
          <div className="space-y-4">
            {devOtp && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-center justify-between">
                <div>
                  <span className="font-bold block text-[11px]">Mock SMS Mode</span>
                  <span className="text-[11px] text-amber-700">
                    OTP: <strong className="font-mono text-sm tracking-wider">{devOtp}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const digits = devOtp.split('');
                    setOtpDigits(digits);
                    handleVerifyOtp(devOtp);
                  }}
                  className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-semibold transition"
                >
                  Auto-Fill
                </button>
              </div>
            )}

            <div className="flex justify-between gap-1.5">
              {otpDigits.map((d, i) => (
                <input
                  key={i}
                  type="text"
                  maxLength={1}
                  inputMode="numeric"
                  value={d}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    const copy = [...otpDigits];
                    copy[i] = val;
                    setOtpDigits(copy);
                    if (val && i < 5) {
                      (e.target.nextElementSibling as HTMLInputElement)?.focus();
                    }
                    if (copy.join('').length === 6) {
                      handleVerifyOtp(copy.join(''));
                    }
                  }}
                  className="w-10 h-12 text-center text-xl font-bold border border-slate-200 rounded-xl outline-none focus:border-indigo-600"
                />
              ))}
            </div>

            <div className="text-center">
              {cooldown > 0 ? (
                <span className="text-xs text-slate-400">Resend in {cooldown}s</span>
              ) : (
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  className="text-xs text-indigo-600 font-semibold"
                >
                  Resend OTP
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'NEW_PIN' && (
          <form onSubmit={handleResetPin} className="space-y-4">
            <div>
              <label htmlFor="new-pin-input" className="block text-xs font-semibold text-slate-500 mb-1">
                Enter New 6-Digit PIN
              </label>
              <input
                id="new-pin-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                autoFocus
                placeholder="••••••"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                className="w-full text-center tracking-[0.6em] py-2.5 border border-slate-200 rounded-xl text-lg font-bold outline-none focus:border-indigo-600"
              />
              <span className="text-[10px] text-slate-400 block mt-1">
                Must not be repeated or sequential (e.g. 123456)
              </span>
            </div>

            <button
              type="submit"
              disabled={loading || newPin.length !== 6}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 text-xs"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Update PIN & Finish</span>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
