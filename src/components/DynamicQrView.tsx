import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Order, OrderStatus } from '../types';
import { api } from '../services/api';
import { rupeesToPaise, formatInrPaise } from '../utils/currency';
import { 
  RefreshCw, CheckCircle2, Clock, AlertTriangle, 
  IndianRupee, ArrowRight, Sparkles 
} from 'lucide-react';

export const DynamicQrView: React.FC = () => {
  const [amountInput, setAmountInput] = useState<string>('250');
  const [noteInput, setNoteInput] = useState<string>('Table Order #12');
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [simulating, setSimulating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [simulatorEnabled, setSimulatorEnabled] = useState<boolean>(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load app config (to conditionally show Simulate Payment button)
  useEffect(() => {
    api.getConfig().then(cfg => {
      if (cfg) setSimulatorEnabled(cfg.enablePaymentSimulator);
    }).catch(() => {});
  }, []);

  // Generate new order QR using integer paise math
  const handleGenerateQr = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const amountInPaise = rupeesToPaise(amountInput);
    if (amountInPaise < 100) {
      setError('Minimum order amount is ₹1.00');
      return;
    }
    if (amountInPaise > 10000000) {
      setError('Maximum order amount is ₹1,00,000.00');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const order = await api.createOrder(amountInPaise, noteInput);
      setCurrentOrder(order);
      setSecondsRemaining(order.expiresInSeconds || 300);
    } catch (err: any) {
      setError(err.message || 'Failed to create dynamic QR code.');
    } finally {
      setLoading(false);
    }
  };

  // Refresh existing expired order
  const handleRefreshQr = async () => {
    if (!currentOrder) return;
    try {
      setRefreshing(true);
      setError(null);
      const refreshed = await api.refreshOrder(currentOrder.id);
      setCurrentOrder(refreshed);
      setSecondsRemaining(refreshed.expiresInSeconds || 300);
    } catch (err: any) {
      setError(err.message || 'Failed to refresh QR code.');
    } finally {
      setRefreshing(false);
    }
  };

  // Simulate payment callback from gateway
  const handleSimulatePayment = async () => {
    if (!currentOrder) return;
    try {
      setSimulating(true);
      await api.simulateCustomerPayment(currentOrder.id);
      const updated = await api.getOrder(currentOrder.id);
      setCurrentOrder(updated);
    } catch (err: any) {
      setError(err.message || 'Simulation failed.');
    } finally {
      setSimulating(false);
    }
  };

  // Countdown timer derived from server expiration
  useEffect(() => {
    if (!currentOrder || currentOrder.status !== 'PENDING') {
      return;
    }

    const interval = setInterval(() => {
      setSecondsRemaining(prev => {
        if (prev <= 1) {
          setCurrentOrder(o => o ? { ...o, status: 'EXPIRED' } : null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [currentOrder?.status]);

  // Polling with tab visibility check (stops polling when tab is hidden)
  useEffect(() => {
    if (!currentOrder || currentOrder.status !== 'PENDING') {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    const poll = async () => {
      if (document.visibilityState === 'hidden') return; // Stop polling while tab is hidden
      try {
        const latest = await api.getOrder(currentOrder.id);
        if (latest.status !== currentOrder.status) {
          setCurrentOrder(latest);
        }
      } catch (err) {
        console.error('Status poll error:', err);
      }
    };

    pollTimerRef.current = setInterval(poll, 2000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [currentOrder?.id, currentOrder?.status]);

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-md w-full mx-auto bg-white min-h-screen sm:min-h-0 sm:rounded-3xl sm:shadow-xl sm:border border-slate-100 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 text-white p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <IndianRupee className="w-6 h-6 text-indigo-200" />
            <h1 className="text-xl font-bold tracking-tight">Dynamic UPI QR</h1>
          </div>
          <span className="text-xs bg-indigo-500/30 border border-indigo-300/30 rounded-full px-2.5 py-1">
            Single-Use
          </span>
        </div>
        <p className="text-xs text-indigo-100 mt-1">
          NPCI UPI compliant • Server-verified payments only
        </p>
      </div>

      <div className="p-5 flex-1 flex flex-col">
        {!currentOrder ? (
          <form onSubmit={handleGenerateQr} className="space-y-4 my-auto">
            <div>
              <label htmlFor="amount-input" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Transaction Amount (INR)
              </label>
              <div className="relative rounded-2xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold">
                  ₹
                </div>
                <input
                  id="amount-input"
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="block w-full pl-8 pr-4 py-3.5 text-2xl font-bold rounded-2xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 text-slate-800 outline-none transition"
                />
              </div>
            </div>

            <div>
              <label htmlFor="note-input" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Order Note (Max 50 chars)
              </label>
              <input
                id="note-input"
                type="text"
                maxLength={50}
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="e.g. Table 4 / Invoice #928"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
            </div>

            {error && (
              <div
                role="alert"
                aria-live="polite"
                className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl flex items-center gap-2 border border-rose-100"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] transition text-white font-semibold py-3.5 rounded-2xl shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <span>Generate Dynamic QR</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-between space-y-4">
            <div className="w-full flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase">Payment Status</span>
              <div aria-live="polite">
                <StatusBadge status={currentOrder.status} />
              </div>
            </div>

            <div className="text-center py-1">
              <span className="text-3xl font-extrabold text-slate-900">
                {formatInrPaise(currentOrder.amount)}
              </span>
              <div className="text-xs text-slate-400 mt-0.5 font-medium">
                Ref: <span className="font-mono text-slate-600">{currentOrder.reference_id}</span>
              </div>
            </div>

            <div className="relative p-5 bg-white rounded-3xl shadow-md border border-slate-100 flex flex-col items-center">
              {currentOrder.status === 'EXPIRED' ? (
                <div className="w-[200px] h-[200px] flex flex-col items-center justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-4 text-center">
                  <Clock className="w-10 h-10 text-slate-400 mb-2" />
                  <p className="text-sm font-semibold text-slate-700">QR Expired</p>
                  <p className="text-xs text-slate-400 mt-1">
                    5-minute validity ended. Tap below to regenerate.
                  </p>
                </div>
              ) : currentOrder.status === 'PAID' ? (
                <div className="w-[200px] h-[200px] flex flex-col items-center justify-center bg-emerald-50 rounded-2xl border border-emerald-200 p-4 text-center">
                  <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-3 animate-bounce">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <p className="text-base font-bold text-emerald-800">Payment Confirmed!</p>
                  <p className="text-xs text-emerald-600 mt-1">Server-verified via Webhook</p>
                </div>
              ) : (
                <div className="relative">
                  <QRCodeSVG
                    value={currentOrder.upi_payload}
                    size={200}
                    level="M"
                    includeMargin={true}
                  />
                  {currentOrder.status === 'PENDING' && (
                    <div className="absolute inset-x-0 -bottom-3 flex justify-center">
                      <span className="bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow">
                        Scan with any UPI App
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {currentOrder.status === 'PENDING' && (
              <div
                aria-live="polite"
                className="w-full bg-indigo-50/60 border border-indigo-100/80 rounded-2xl p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-2 text-indigo-700">
                  <Clock className="w-4 h-4 animate-pulse text-indigo-600" />
                  <span className="text-xs font-medium">Valid for:</span>
                </div>
                <div className="font-mono text-base font-bold text-indigo-900 tracking-wider">
                  {formatCountdown(secondsRemaining)}
                </div>
              </div>
            )}

            <div className="w-full space-y-2 pt-2">
              {currentOrder.status === 'EXPIRED' && (
                <button
                  onClick={handleRefreshQr}
                  disabled={refreshing}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 transition"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>Regenerate Fresh QR</span>
                </button>
              )}

              {simulatorEnabled && currentOrder.status === 'PENDING' && (
                <button
                  onClick={handleSimulatePayment}
                  disabled={simulating}
                  className="w-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-semibold py-2.5 rounded-2xl flex items-center justify-center gap-2 transition"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{simulating ? 'Processing Webhook...' : 'Simulate Customer Scan & Payment'}</span>
                </button>
              )}

              <button
                onClick={() => setCurrentOrder(null)}
                className="w-full text-slate-400 hover:text-slate-600 text-xs font-medium py-2 transition text-center"
              >
                + New Transaction
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: OrderStatus }> = ({ status }) => {
  switch (status) {
    case 'PAID':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
          <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
          Paid
        </span>
      );
    case 'EXPIRED':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
          <span className="w-2 h-2 rounded-full bg-slate-400"></span>
          Expired
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
          <span className="w-2 h-2 rounded-full bg-rose-600"></span>
          Failed
        </span>
      );
    case 'PENDING':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          Pending
        </span>
      );
  }
};
