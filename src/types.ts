export type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';

export interface Order {
  id: string;
  merchant_id: string;
  reference_id: string;
  amount: number; // in paise
  currency: string;
  note: string;
  upi_payload: string;
  status: OrderStatus;
  paid_late: number;
  expires_at: number; // ms timestamp
  paid_at?: number | null;
  serverTime?: number;
  expiresInSeconds?: number;
  created_at: string;
}

export interface Merchant {
  id: string;
  name: string;
  business_name: string;
  phone: string;
  phone_verified: number;
  upi_vpa: string;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  biometrics_enabled: number;
  balance: number; // in paise
}

export interface Payout {
  id: string;
  merchant_id: string;
  amount: number;
  destination_type: string;
  destination_details: string;
  status: string;
  idempotency_key?: string | null;
  created_at: string;
  created_timestamp: number;
}

export interface WebAuthnDevice {
  id: string;
  credential_id: string;
  device_name?: string;
  created_at: number;
  last_used_at?: number | null;
}

export interface AppConfig {
  enablePaymentSimulator: boolean;
}
