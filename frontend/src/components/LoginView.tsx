import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Store, Lock, ArrowRight, AlertCircle, RefreshCw, UserPlus } from 'lucide-react';
import { isValidIndianPhone } from '../utils/validation';

interface LoginViewProps {
  onGoToRegister: () => void;
  onForgotPin: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onGoToRegister, onForgotPin }) => {
  const { login } = useAuth();
  const [phone, setPhone] = useState<string>('');
  const [pin, setPin] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidIndianPhone(phone)) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return;
    }
    if (pin.length !== 6) {
      setError('PIN must be exactly 6 digits');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await login(phone, pin);
      if (!res.success) {
        setError(res.error || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md w-full mx-auto bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-100">
      <div className="text-center mb-6">
        <div className="w-14 h-14 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 mx-auto mb-3 shadow-inner">
          <Store className="w-7 h-7" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">Apex Merchant</h2>
        <p className="text-xs text-slate-400 mt-1">Sign in to your merchant terminal</p>
      </div>

      {error && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-100 rounded-2xl text-rose-700 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Mobile Number
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
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              6-Digit Security PIN
            </label>
            <button
              type="button"
              onClick={onForgotPin}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
            >
              Forgot PIN?
            </button>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              placeholder="••••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="w-full pl-10 pr-3 py-3 text-lg tracking-[0.6em] font-bold border border-slate-200 rounded-2xl focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || pin.length !== 6 || phone.replace(/\D/g, '').length < 10}
          className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 disabled:opacity-50"
        >
          {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : (
            <>
              <span>Sign In to Terminal</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        <div className="pt-4 border-t border-slate-100 flex justify-between items-center text-xs">
          <span className="text-slate-400">New merchant?</span>
          <button
            type="button"
            onClick={onGoToRegister}
            className="text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Register with Mobile OTP</span>
          </button>
        </div>
      </form>
    </div>
  );
};
