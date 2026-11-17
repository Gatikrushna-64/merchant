import React, { createContext, useContext, useState, useEffect } from 'react';
import { Merchant } from '../types';

interface AuthContextType {
  merchant: Merchant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (phone: string, pin: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setSessionMerchant: (merchant: Merchant) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshProfile = async () => {
    try {
      const res = await fetch('/api/v1/auth/me', {
        credentials: 'include'
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.success && data.data) {
          setMerchant(data.data);
          return;
        }
      }
      setMerchant(null);
    } catch {
      setMerchant(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshProfile();
  }, []);

  const login = async (phone: string, pin: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone, pin })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return {
          success: false,
          error: 'Cannot connect to backend API server (http://localhost:5000). Please ensure the backend server is running.'
        };
      }

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Invalid credentials' };
      }

      setMerchant(data.merchant);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Login network failure' };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } finally {
      setMerchant(null);
    }
  };

  const setSessionMerchant = (m: Merchant) => {
    setMerchant(m);
  };

  return (
    <AuthContext.Provider
      value={{
        merchant,
        isAuthenticated: !!merchant,
        isLoading,
        login,
        logout,
        refreshProfile,
        setSessionMerchant
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

