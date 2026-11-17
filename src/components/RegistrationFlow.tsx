import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, ArrowRight, RefreshCw, 
  CheckCircle2, AlertTriangle, Store, Lock, User, LogIn
} from 'lucide-react';
import { validatePinComplexity, isValidUpiVpa } from '../utils/validation';

interface RegistrationFlowProps {
  onSuccess: (merchant: any) => void;
  onGoToLogin?: () => void;
  onCancel?: () => void;
}

export const RegistrationFlow: React.FC<RegistrationFlowProps> = ({ onSuccess, onGoToLogin, onCancel }) => {
  const [step, setStep] = useState<'PHONE' | 'OTP' | 'PROFILE'>('PHONE');
  const [phone, setPhone] = useState<string>('');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  
  // Registration form fields
  const [name, setName] = useState<string>('');
  const [businessName, setBusinessName] = useState<string>('');
  const [upiVpa, setUpiVpa] = useState<string>('');
  const [passcode, setPasscode] = useState<string>('');

  // Status & Timers
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyRegisteredMessage, setAlreadyRegisteredMessage] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState<number>(0);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState<number>(0);

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 30s resend cooldown interval
  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendCooldownSeconds(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);

  // 15-minute lockout countdown interval
  useEffect(() => {
    if (!lockedUntil) return;
    const updateLockout = () => {
      const remaining = Math.max(0, Math.floor((lockedUntil - Date.now()) / 1000));
      setLockoutRemainingSeconds(remaining);
      if (remaining <= 0) {
        setLockedUntil(null);
        setError(null);
      }
    };
    updateLockout();
    const timer = setInterval(updateLockout, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  // Request OTP
  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanDigits = phone.replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setAlreadyRegisteredMessage(null);
      const res = await fetch('/api/v1/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Cannot connect to backend API server (http://localhost:5000). Please ensure the backend is running.');
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch verification code');
      }

      setResendCooldownSeconds(data.cooldownSeconds || 30);
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

  // OTP digit input handler with auto-advance and paste
  const handleDigitChange = (index: number, value: string) => {
    if (value.length > 1) {
      const pasted = value.replace(/\D/g, '').slice(0, 6);
      if (pasted.length > 0) {
        const newDigits = [...otpDigits];
        for (let i = 0; i < 6; i++) {
          newDigits[i] = pasted[i] || '';
        }
        setOtpDigits(newDigits);
        if (pasted.length === 6) {
          triggerVerify(pasted);
        } else {
          otpInputRefs.current[Math.min(pasted.length, 5)]?.focus();
        }
      }
      return;
    }

    const digit = value.replace(/\D/g, '');
    const newDigits = [...otpDigits];
    newDigits[index] = digit;
    setOtpDigits(newDigits);

    if (digit && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }

    const fullCode = newDigits.join('');
    if (fullCode.length === 6) {
      triggerVerify(fullCode);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  // Verify OTP
  const triggerVerify = async (code: string) => {
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
      if (!res.ok) {
        if (data.attemptsRemaining !== undefined) {
          setAttemptsRemaining(data.attemptsRemaining);
        }
        if (data.lockedUntil) {
          setLockedUntil(data.lockedUntil);
        }
        throw new Error(data.message || 'Verification failed');
      }

      setVerificationToken(data.verificationToken);
      setStep('PROFILE');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Complete Registration
  const handleCompleteRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationToken) {
      setError('Mobile verification session missing. Please verify phone again.');
      return;
    }

    if (!isValidUpiVpa(upiVpa)) {
      setError('Invalid UPI VPA format. Expected name@bank (e.g., store@okhdfcbank)');
      return;
    }

    const pinCheck = validatePinComplexity(passcode);
    if (!pinCheck.valid) {
      setError(pinCheck.reason || 'PIN does not meet security rules.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          verificationToken,
          name: name.trim(),
          businessName: businessName.trim(),
          upiVpa: upiVpa.trim(),
          passcode
        })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Cannot connect to backend API server (http://localhost:5000).');
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete registration');
      }

      if (data.alreadyRegistered) {
        setAlreadyRegisteredMessage(data.message || 'An account with this phone number already exists. Please log in.');
        return;
      }

      if (data.merchant) {
        onSuccess(data.merchant);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatLockoutTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-md w-full mx-auto bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-100">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="w-14 h-14 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 mx-auto mb-3 shadow-inner">
          <Store className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Merchant Registration</h2>
        <p className="text-xs text-slate-400 mt-1">
          {step === 'PHONE' && 'Step 1 of 3: Enter your 10-digit mobile number'}
          {step === 'OTP' && 'Step 2 of 3: Verify with 6-digit OTP'}
          {step === 'PROFILE' && 'Step 3 of 3: Business details & device PIN'}
        </p>
      </div>

      {alreadyRegisteredMessage && (
        <div className="mb-5 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-indigo-900 text-xs space-y-2">
          <div className="font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-indigo-600" />
            <span>Account Already Exists</span>
          </div>
          <p>{alreadyRegisteredMessage}</p>
          {onGoToLogin && (
            <button
              type="button"
              onClick={onGoToLogin}
              className="mt-2 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-xl flex items-center justify-center gap-1.5 transition"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Go to Login</span>
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-100 rounded-2xl text-rose-700 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Lockout Banner */}
      {lockedUntil && (
        <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs space-y-1">
          <div className="font-bold flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-amber-600" />
            <span>Mobile Number Temporarily Locked</span>
          </div>
          <p>Too many failed attempts. Try again in {formatLockoutTimer(lockoutRemainingSeconds)}.</p>
        </div>
      )}

      {/* STEP 1: Phone Entry */}
      {step === 'PHONE' && (
        <form onSubmit={handleRequestOtp} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Indian Mobile Number
            </label>
            <div className="flex rounded-2xl border border-slate-200 focus-within:border-indigo-600 focus-within:ring-2 focus-within:ring-indigo-100 overflow-hidden transition">
              <span className="bg-slate-50 px-3.5 py-3 text-slate-600 font-semibold text-sm border-r border-slate-200 flex items-center">
                +91
              </span>
              <input
                type="tel"
                pattern="[0-9]{10}"
                maxLength={10}
                required
                autoFocus
                placeholder="9876543210"
                value={phone.replace(/^\+91/, '')}
                onChange={(e) => setPhone(`+91${e.target.value.replace(/\D/g, '')}`)}
                className="w-full px-3.5 py-3 text-base font-semibold text-slate-800 outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Requires 6-digit SMS OTP verification (TRAI DLT compliant)
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || phone.replace(/\D/g, '').length < 10}
            className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : (
              <>
                <span>Send Verification OTP</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div className="pt-2 flex flex-col gap-2">
            {onGoToLogin && (
              <button
                type="button"
                onClick={onGoToLogin}
                className="w-full text-xs text-indigo-600 hover:text-indigo-800 font-medium py-1 text-center"
              >
                Already have an account? Sign in
              </button>
            )}

            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="w-full text-xs text-slate-400 hover:text-slate-600 font-medium py-1 text-center"
              >
                Cancel and Return
              </button>
            )}
          </div>
        </form>
      )}

      {/* STEP 2: 6-Digit OTP Entry */}
      {step === 'OTP' && (
        <div className="space-y-5">
          {devOtp && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs flex items-center justify-between">
              <div>
                <span className="font-bold block">Development (Mock SMS) Mode</span>
                <span className="text-[11px] text-amber-700">
                  Your verification code is: <strong className="font-mono text-sm tracking-wider">{devOtp}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const digits = devOtp.split('');
                  setOtpDigits(digits);
                  triggerVerify(devOtp);
                }}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition"
              >
                Auto-Fill
              </button>
            </div>
          )}

          <div className="text-center">
            <span className="text-xs text-slate-500">Code dispatched to </span>
            <span className="text-xs font-bold text-slate-800 font-mono">{phone}</span>
            <button
              onClick={() => setStep('PHONE')}
              className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold ml-2"
            >
              Change
            </button>
          </div>

          {/* 6 Digit Input Boxes */}
          <div className="flex justify-between gap-2">
            {otpDigits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => (otpInputRefs.current[idx] = el)}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={digit}
                disabled={!!lockedUntil || loading}
                onChange={(e) => handleDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                className="w-12 h-14 text-center text-2xl font-bold rounded-2xl border border-slate-200 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 outline-none transition disabled:bg-slate-50"
              />
            ))}
          </div>

          {attemptsRemaining !== null && attemptsRemaining > 0 && (
            <p className="text-center text-xs text-amber-600 font-medium">
              {attemptsRemaining} attempt(s) remaining before 15-minute lock.
            </p>
          )}

          {/* Resend Cooldown Timer */}
          <div className="text-center pt-2">
            {resendCooldownSeconds > 0 ? (
              <p className="text-xs text-slate-400 font-medium">
                Resend OTP in <span className="font-mono font-bold text-slate-600">{resendCooldownSeconds}s</span>
              </p>
            ) : (
              <button
                type="button"
                disabled={!!lockedUntil || loading}
                onClick={() => handleRequestOtp()}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center justify-center gap-1.5 mx-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Resend 6-Digit OTP</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* STEP 3: Merchant Profile & Passcode */}
      {step === 'PROFILE' && (
        <form onSubmit={handleCompleteRegistration} className="space-y-4">
          <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-2xl text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>Mobile {phone} verified successfully!</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Your Full Name</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="text"
                required
                placeholder="Ramesh Kumar"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Store / Business Name</label>
            <div className="relative">
              <Store className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="text"
                required
                placeholder="Apex Retail Store"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Merchant UPI VPA</label>
            <input
              type="text"
              required
              placeholder="store@okhdfcbank"
              value={upiVpa}
              onChange={(e) => setUpiVpa(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono outline-none focus:border-indigo-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
              Create 6-Digit PIN (Non-Trivial)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="password"
                maxLength={6}
                pattern="[0-9]*"
                required
                placeholder="••••••"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value.replace(/\D/g, ''))}
                className="w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm tracking-widest font-bold outline-none focus:border-indigo-600"
              />
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              6 digits. Sequences (123456) and repeats (000000) are rejected.
            </span>
          </div>

          <button
            type="submit"
            disabled={loading || passcode.length < 6}
            className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 disabled:opacity-50 transition"
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : (
              <>
                <ShieldCheck className="w-5 h-5" />
                <span>Complete Registration & Launch Terminal</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
};
