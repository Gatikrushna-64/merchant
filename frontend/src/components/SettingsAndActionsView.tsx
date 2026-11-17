import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBiometrics } from '../context/BiometricContext';
import { formatInrPaise, rupeesToPaise } from '../utils/currency';
import { isValidUpiVpa, isValidIfsc, isValidBankAccount } from '../utils/validation';
import { 
  Building2, ArrowDownCircle, Shield, FileSpreadsheet, 
  Check, AlertTriangle, Fingerprint, LogOut, X
} from 'lucide-react';

export const SettingsAndActionsView: React.FC = () => {
  const { merchant, logout, refreshProfile } = useAuth();
  const { biometricsEnabled, toggleBiometricsSetting, triggerSensitiveAction, enrollPasskey } = useBiometrics();

  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Payout Form Modal state
  const [showPayoutModal, setShowPayoutModal] = useState<boolean>(false);
  const [payoutAmount, setPayoutAmount] = useState<string>('500');

  // Bank Form Modal state
  const [showBankModal, setShowBankModal] = useState<boolean>(false);
  const [bankAccount, setBankAccount] = useState<string>('');
  const [bankIfsc, setBankIfsc] = useState<string>('');
  const [upiVpa, setUpiVpa] = useState<string>('');

  // Passkey enrollment state
  const [enrollingPasskey, setEnrollingPasskey] = useState<boolean>(false);

  useEffect(() => {
    if (merchant) {
      setBankAccount(merchant.bank_account_number || '');
      setBankIfsc(merchant.bank_ifsc || '');
      setUpiVpa(merchant.upi_vpa || '');
    }
  }, [merchant]);

  // Esc key handlers for modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPayoutModal(false);
        setShowBankModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 1. Sensitive Action: Payout Request
  const handleInitiatePayout = () => {
    const amountInPaise = rupeesToPaise(payoutAmount);
    if (amountInPaise <= 0) {
      setMessage({ text: 'Please enter a valid payout amount', type: 'error' });
      return;
    }

    triggerSensitiveAction({
      title: 'Authorize Payout',
      description: `Confirm transfer of ${formatInrPaise(amountInPaise)} to your settlement account.`,
      action: 'PAYOUT',
      onSuccess: async (sensitiveToken: string) => {
        try {
          const idempotencyKey = `payout_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const res = await fetch('/api/v1/security/payouts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-sensitive-token': sensitiveToken,
              'idempotency-key': idempotencyKey
            },
            credentials: 'include',
            body: JSON.stringify({ amount: amountInPaise })
          });

          const data = await res.json();
          if (res.ok) {
            setMessage({ text: `Payout of ${formatInrPaise(amountInPaise)} processed successfully!`, type: 'success' });
            setShowPayoutModal(false);
            await refreshProfile();
          } else {
            setMessage({ text: data.error || 'Payout failed', type: 'error' });
          }
        } catch (err: any) {
          setMessage({ text: err.message || 'Payout network error', type: 'error' });
        }
      }
    });
  };

  // 2. Sensitive Action: Update Bank / UPI
  const handleUpdateBankDetails = () => {
    if (upiVpa && !isValidUpiVpa(upiVpa)) {
      setMessage({ text: 'Invalid UPI VPA format. Expected: username@bank', type: 'error' });
      return;
    }
    if (bankIfsc && !isValidIfsc(bankIfsc)) {
      setMessage({ text: 'Invalid IFSC code. Expected 4 letters, 0, then 6 alphanumeric characters.', type: 'error' });
      return;
    }
    if (bankAccount && !isValidBankAccount(bankAccount.replace(/•/g, ''))) {
      setMessage({ text: 'Invalid bank account number. Expected 9 to 18 digits.', type: 'error' });
      return;
    }

    triggerSensitiveAction({
      title: 'Update Settlement Details',
      description: 'Confirm updating your official business settlement account.',
      action: 'BANK_DETAILS',
      onSuccess: async (sensitiveToken: string) => {
        try {
          const res = await fetch('/api/v1/security/bank-details', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'x-sensitive-token': sensitiveToken
            },
            credentials: 'include',
            body: JSON.stringify({
              bankAccountNumber: bankAccount.includes('•') ? undefined : bankAccount,
              bankIfsc,
              upiVpa
            })
          });

          const data = await res.json();
          if (res.ok) {
            setMessage({ text: 'Bank and UPI details updated successfully!', type: 'success' });
            setShowBankModal(false);
            await refreshProfile();
          } else {
            setMessage({ text: data.error || 'Failed to update details', type: 'error' });
          }
        } catch (err: any) {
          setMessage({ text: err.message, type: 'error' });
        }
      }
    });
  };

  // 3. Sensitive Action: Export CSV Report
  const handleExportReport = () => {
    triggerSensitiveAction({
      title: 'Export Financial Report',
      description: 'Authorization required to download full transaction records.',
      action: 'EXPORT',
      onSuccess: async (sensitiveToken: string) => {
        try {
          const res = await fetch('/api/v1/security/reports/export', {
            headers: { 'x-sensitive-token': sensitiveToken },
            credentials: 'include'
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Export denied');
          }

          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `transactions_${Date.now()}.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setMessage({ text: 'Report exported successfully!', type: 'success' });
        } catch (err: any) {
          setMessage({ text: err.message, type: 'error' });
        }
      }
    });
  };

  // 4. Enroll WebAuthn Passkey
  const handleEnrollPasskey = async () => {
    try {
      setEnrollingPasskey(true);
      setMessage(null);
      const res = await enrollPasskey('Merchant Device Passkey');
      if (res.success) {
        setMessage({ text: 'Biometric passkey enrolled successfully! Biometric unlock is now active.', type: 'success' });
      } else {
        setMessage({ text: res.error || 'Passkey enrollment failed', type: 'error' });
      }
    } finally {
      setEnrollingPasskey(false);
    }
  };

  // 5. Toggle Biometrics (requires verification to turn OFF)
  const handleToggleBiometrics = async (newVal: boolean) => {
    setMessage(null);
    const result = await toggleBiometricsSetting(newVal);
    if (!result.success) {
      setMessage({ text: result.error || 'Could not change setting', type: 'error' });
    } else {
      setMessage({
        text: newVal ? 'Biometric App Lock enabled!' : 'Biometric App Lock turned off.',
        type: 'success'
      });
      await refreshProfile();
    }
  };

  return (
    <div className="max-w-md w-full mx-auto bg-white min-h-screen sm:min-h-0 sm:rounded-3xl sm:shadow-xl sm:border border-slate-100 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">{merchant?.business_name || 'My Store'}</h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{merchant?.phone}</p>
          </div>
          <button
            onClick={logout}
            aria-label="Log out"
            className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1.5 p-1.5 rounded-lg border border-slate-700/60 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>

        {/* Balance Card */}
        <div className="mt-4 bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Settlement Wallet</span>
            <div className="text-2xl font-black text-white mt-0.5">
              {formatInrPaise(merchant?.balance || 0)}
            </div>
          </div>
          <button
            onClick={() => setShowPayoutModal(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition shadow"
          >
            <ArrowDownCircle className="w-4 h-4" />
            <span>Withdraw</span>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4 flex-1">
        {message && (
          <div
            role="alert"
            aria-live="polite"
            className={`p-3 rounded-2xl text-xs flex items-center gap-2 border ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {message.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {/* Biometrics & WebAuthn Section */}
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm">
              <Shield className="w-4 h-4 text-indigo-600" />
              <span>Biometric Passkeys & Lock</span>
            </div>
            {biometricsEnabled && (
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                Active
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            FIDO2 / WebAuthn passkey protection. Locks terminal on app start, 60s background, or 60s inactivity.
          </p>

          <div className="pt-2 flex flex-col gap-2">
            {!biometricsEnabled ? (
              <button
                onClick={handleEnrollPasskey}
                disabled={enrollingPasskey}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 transition"
              >
                <Fingerprint className="w-4 h-4" />
                <span>{enrollingPasskey ? 'Enrolling with OS...' : 'Enable Biometric Passkey'}</span>
              </button>
            ) : (
              <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                <div>
                  <span className="text-xs font-medium text-slate-800 block">Require Biometric Lock</span>
                  <span className="text-[10px] text-slate-400 block">Verification required to disable</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={biometricsEnabled}
                    onChange={(e) => handleToggleBiometrics(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Settlement Account Section */}
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm">
              <Building2 className="w-4 h-4 text-indigo-600" />
              <span>Settlement Account</span>
            </div>
            <button
              onClick={() => setShowBankModal(true)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
            >
              Edit Details
            </button>
          </div>

          <div className="text-xs text-slate-600 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">Primary UPI VPA:</span>
              <span className="font-mono font-medium text-slate-800">{merchant?.upi_vpa}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bank Account:</span>
              <span className="font-mono text-slate-800">{merchant?.bank_account_number || 'Not added'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IFSC Code:</span>
              <span className="font-mono text-slate-800">{merchant?.bank_ifsc || 'Not added'}</span>
            </div>
          </div>
        </div>

        {/* Reports Export Section */}
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-800 block">Export Financial Reports</span>
            <span className="text-[11px] text-slate-400 block">Download all transactions in CSV format</span>
          </div>
          <button
            onClick={handleExportReport}
            className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Payout Modal */}
      {showPayoutModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payout-modal-title"
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 space-y-4 relative">
            <button
              onClick={() => setShowPayoutModal(false)}
              aria-label="Close"
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 id="payout-modal-title" className="text-base font-bold text-slate-800">
              Withdraw to Settlement Account
            </h3>
            <p className="text-xs text-slate-400">
              Available Balance: {formatInrPaise(merchant?.balance || 0)}
            </p>

            <div>
              <label htmlFor="payout-amount-input" className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                Amount (INR)
              </label>
              <input
                id="payout-amount-input"
                type="number"
                step="0.01"
                autoFocus
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
                placeholder="500"
                className="w-full py-2.5 px-3 border border-slate-200 rounded-xl text-lg font-bold outline-none focus:border-indigo-600"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowPayoutModal(false)}
                className="flex-1 py-2.5 text-xs text-slate-500 hover:text-slate-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInitiatePayout}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Bank Modal */}
      {showBankModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bank-modal-title"
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 space-y-4 relative">
            <button
              onClick={() => setShowBankModal(false)}
              aria-label="Close"
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 id="bank-modal-title" className="text-base font-bold text-slate-800">
              Update Settlement Details
            </h3>

            <div className="space-y-3">
              <div>
                <label htmlFor="upi-vpa-input" className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                  UPI VPA
                </label>
                <input
                  id="upi-vpa-input"
                  type="text"
                  value={upiVpa}
                  onChange={(e) => setUpiVpa(e.target.value)}
                  className="w-full py-2 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-600 font-mono"
                />
              </div>

              <div>
                <label htmlFor="bank-acc-input" className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                  Bank Account Number (9-18 digits)
                </label>
                <input
                  id="bank-acc-input"
                  type="text"
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                  placeholder="Enter full account number"
                  className="w-full py-2 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-600 font-mono"
                />
              </div>

              <div>
                <label htmlFor="bank-ifsc-input" className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                  Bank IFSC Code (e.g. HDFC0001234)
                </label>
                <input
                  id="bank-ifsc-input"
                  type="text"
                  maxLength={11}
                  value={bankIfsc}
                  onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                  className="w-full py-2 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-600 font-mono uppercase"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBankModal(false)}
                className="flex-1 py-2.5 text-xs text-slate-500 hover:text-slate-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdateBankDetails}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
