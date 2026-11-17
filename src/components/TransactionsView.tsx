import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Order, Payout } from '../types';
import { formatInrPaise } from '../utils/currency';
import { 
  Search, Clock, CheckCircle2, RefreshCw
} from 'lucide-react';

export const TransactionsView: React.FC = () => {
  const [tab, setTab] = useState<'orders' | 'payouts' | 'attention'>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [attentionData, setAttentionData] = useState<{ lateOrders: Order[]; flaggedEvents: any[] }>({
    lateOrders: [],
    flaggedEvents: []
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchRef, setSearchRef] = useState<string>('');
  const [todaySummary, setTodaySummary] = useState<{ todayOrdersCount: number; todayPaidPaise: number }>({
    todayOrdersCount: 0,
    todayPaidPaise: 0
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (tab === 'orders') {
        const res = await api.listOrders({
          status: statusFilter || undefined,
          searchRef: searchRef || undefined
        });
        setOrders(res.orders);
        setTodaySummary(res.summary);
      } else if (tab === 'payouts') {
        const data = await api.listPayouts();
        setPayouts(data);
      } else if (tab === 'attention') {
        const data = await api.listNeedsAttention();
        setAttentionData(data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load transaction data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [tab, statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  return (
    <div className="max-w-md w-full mx-auto bg-white min-h-screen sm:min-h-0 sm:rounded-3xl sm:shadow-xl sm:border border-slate-100 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Ledger & History</h2>
          <button
            onClick={loadData}
            aria-label="Refresh data"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Today's KPI Banner */}
        <div className="mt-4 grid grid-cols-2 gap-2 bg-slate-800/80 rounded-2xl p-3 border border-slate-700/60">
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Today's Revenue</span>
            <div className="text-lg font-bold text-emerald-400 mt-0.5">
              {formatInrPaise(todaySummary.todayPaidPaise)}
            </div>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Today's Orders</span>
            <div className="text-lg font-bold text-white mt-0.5">
              {todaySummary.todayOrdersCount}
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex mt-4 bg-slate-800 p-1 rounded-xl gap-1 text-xs font-semibold">
          <button
            onClick={() => setTab('orders')}
            className={`flex-1 py-1.5 rounded-lg transition ${
              tab === 'orders' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Orders
          </button>
          <button
            onClick={() => setTab('payouts')}
            className={`flex-1 py-1.5 rounded-lg transition ${
              tab === 'payouts' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Payouts
          </button>
          <button
            onClick={() => setTab('attention')}
            className={`flex-1 py-1.5 rounded-lg transition relative ${
              tab === 'attention' ? 'bg-amber-600 text-white shadow' : 'text-amber-400 hover:text-amber-300'
            }`}
          >
            Needs Attention
            {(attentionData.lateOrders.length > 0 || attentionData.flaggedEvents.length > 0) && (
              <span className="w-2 h-2 rounded-full bg-rose-500 absolute top-1 right-2 animate-ping" />
            )}
          </button>
        </div>
      </div>

      {/* Main List Area */}
      <div className="p-4 flex-1 flex flex-col space-y-3">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs flex justify-between items-center">
            <span>{error}</span>
            <button onClick={loadData} className="font-bold underline text-xs">Retry</button>
          </div>
        )}

        {/* Orders View */}
        {tab === 'orders' && (
          <>
            {/* Search and Filter */}
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search ref (e.g. TR_...)"
                  value={searchRef}
                  onChange={(e) => setSearchRef(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl outline-none focus:border-indigo-600 font-mono"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs px-2.5 py-2 border border-slate-200 rounded-xl bg-slate-50 outline-none font-semibold text-slate-700"
              >
                <option value="">All Statuses</option>
                <option value="PAID">Paid</option>
                <option value="PENDING">Pending</option>
                <option value="EXPIRED">Expired</option>
                <option value="FAILED">Failed</option>
              </select>
            </form>

            {loading ? (
              <div className="flex-1 flex items-center justify-center py-12 text-slate-400 text-xs gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                <span>Loading orders...</span>
              </div>
            ) : orders.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-slate-400 text-xs text-center">
                <Clock className="w-8 h-8 text-slate-300 mb-2" />
                <p>No transactions match your criteria.</p>
              </div>
            ) : (
              <div className="space-y-2 flex-1 overflow-y-auto max-h-[420px] pr-1">
                {orders.map((o) => (
                  <div
                    key={o.id}
                    className="p-3 bg-slate-50/80 hover:bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-between transition"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-slate-800">{o.reference_id}</span>
                        {o.paid_late === 1 && (
                          <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">
                            Late Paid
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {new Date(o.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900">
                        {formatInrPaise(o.amount)}
                      </div>
                      <OrderStatusPill status={o.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Payouts View */}
        {tab === 'payouts' && (
          <div className="space-y-2 flex-1 overflow-y-auto max-h-[480px]">
            {loading ? (
              <div className="py-12 text-center text-slate-400 text-xs">Loading payouts...</div>
            ) : payouts.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">No payout records found.</div>
            ) : (
              payouts.map((p) => (
                <div key={p.id} className="p-3 bg-slate-50 border border-slate-100 rounded-2xl flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">
                      Transfer to {p.destination_type}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {p.destination_details}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      {new Date(p.created_timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-slate-900 block">{formatInrPaise(p.amount)}</span>
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      {p.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Needs Attention View */}
        {tab === 'attention' && (
          <div className="space-y-3 flex-1 overflow-y-auto max-h-[480px]">
            <p className="text-xs text-slate-500">
              Payments accepted late or flagged for manual merchant review.
            </p>

            {attentionData.lateOrders.length === 0 && attentionData.flaggedEvents.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-2" />
                <span>All payments are clean and matched! No action required.</span>
              </div>
            ) : (
              <>
                {attentionData.lateOrders.map(o => (
                  <div key={o.id} className="p-3 bg-amber-50 border border-amber-200 rounded-2xl">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-amber-900">Late Payment Credited</span>
                      <span className="text-xs font-black text-amber-900">{formatInrPaise(o.amount)}</span>
                    </div>
                    <p className="text-[11px] text-amber-800 mt-1">
                      Customer scanned QR after the 5-minute expiry window. Exact amount was accepted and your wallet was credited.
                    </p>
                    <span className="font-mono text-[10px] text-amber-700 block mt-1">Ref: {o.reference_id}</span>
                  </div>
                ))}

                {attentionData.flaggedEvents.map((ev, i) => (
                  <div key={i} className="p-3 bg-rose-50 border border-rose-200 rounded-2xl">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-rose-900">{ev.classification}</span>
                      <span className="text-xs font-black text-rose-900">{formatInrPaise(ev.amount)}</span>
                    </div>
                    <p className="text-[11px] text-rose-800 mt-1">
                      Webhook received but flagged for review ({ev.review_status}).
                    </p>
                    <span className="font-mono text-[10px] text-rose-700 block mt-1">Event: {ev.event_id}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const OrderStatusPill: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'PAID':
      return <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Paid</span>;
    case 'EXPIRED':
      return <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">Expired</span>;
    case 'FAILED':
      return <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">Failed</span>;
    default:
      return <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Pending</span>;
  }
};
