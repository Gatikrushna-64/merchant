import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BiometricProvider } from './context/BiometricContext';
import { BiometricLockOverlay } from './components/BiometricLockOverlay';
import { SensitiveActionModal } from './components/SensitiveActionModal';
import { DynamicQrView } from './components/DynamicQrView';
import { TransactionsView } from './components/TransactionsView';
import { SettingsAndActionsView } from './components/SettingsAndActionsView';
import { RegistrationFlow } from './components/RegistrationFlow';
import { LoginView } from './components/LoginView';
import { ForgotPinModal } from './components/ForgotPinModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { formatInrPaise } from './utils/currency';
import { QrCode, ShieldCheck, History, LogOut, Store, RefreshCw } from 'lucide-react';

function AppContent() {
  const { merchant, isLoading, isAuthenticated, logout, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<'qr' | 'transactions' | 'settings'>('qr');
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [showForgotPin, setShowForgotPin] = useState<boolean>(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 bg-white rounded-2xl shadow-md border border-slate-200 flex items-center justify-center text-indigo-600 mb-3">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
        <p className="text-xs text-slate-500 font-medium">Loading Apex Merchant...</p>
      </div>
    );
  }

  // Unauthenticated screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
        {authView === 'login' ? (
          <LoginView
            onGoToRegister={() => setAuthView('register')}
            onForgotPin={() => setShowForgotPin(true)}
          />
        ) : (
          <RegistrationFlow
            onSuccess={() => {
              refreshProfile();
            }}
            onGoToLogin={() => setAuthView('login')}
            onCancel={() => setAuthView('login')}
          />
        )}

        <ForgotPinModal
          isOpen={showForgotPin}
          onClose={() => setShowForgotPin(false)}
          onSuccess={() => {
            setShowForgotPin(false);
            setAuthView('login');
          }}
        />
      </div>
    );
  }

  // Authenticated Dashboard
  return (
    <BiometricProvider>
      <div className="min-h-screen bg-slate-100 flex flex-col justify-between sm:py-6 sm:px-4">
        {/* Biometric Locks & Overlays */}
        <BiometricLockOverlay />
        <SensitiveActionModal />

        <div className="max-w-md w-full mx-auto space-y-3">
          {/* Top Merchant Header */}
          <header className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center font-bold">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-800 leading-tight">
                  {merchant?.business_name || 'Apex Merchant'}
                </h1>
                <p className="text-[11px] text-slate-400 font-mono">
                  {merchant?.upi_vpa || 'VPA'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="text-[10px] text-slate-400 font-medium block">Balance</span>
                <span className="text-xs font-bold text-emerald-600 font-mono">
                  {formatInrPaise(merchant?.balance || 0)}
                </span>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Main Content Area */}
          <main className="flex-1">
            <ErrorBoundary fallbackTitle="View Error">
              {activeTab === 'qr' && <DynamicQrView />}
              {activeTab === 'transactions' && <TransactionsView />}
              {activeTab === 'settings' && <SettingsAndActionsView />}
            </ErrorBoundary>
          </main>
        </div>

        {/* Bottom Tab Bar */}
        <nav className="max-w-md w-full mx-auto bg-white/95 backdrop-blur-md border-t sm:border sm:rounded-2xl border-slate-200 mt-4 px-4 py-2 flex justify-around shadow-sm">
          <button
            onClick={() => setActiveTab('qr')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
              activeTab === 'qr' ? 'text-indigo-600 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <QrCode className="w-5 h-5" />
            <span className="text-[11px]">UPI Terminal</span>
          </button>

          <button
            onClick={() => setActiveTab('transactions')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
              activeTab === 'transactions' ? 'text-indigo-600 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <History className="w-5 h-5" />
            <span className="text-[11px]">Transactions</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
              activeTab === 'settings' ? 'text-indigo-600 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <ShieldCheck className="w-5 h-5" />
            <span className="text-[11px]">Security & Wallet</span>
          </button>
        </nav>
      </div>
    </BiometricProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
