export type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';

export type PaymentClassification =
  | 'MATCHED'
  | 'LATE'
  | 'DUPLICATE_PAYMENT'
  | 'AMOUNT_MISMATCH'
  | 'UNMATCHED';

export type SensitiveAction = 'PAYOUT' | 'BANK_DETAILS' | 'EXPORT' | 'DISABLE_LOCK';

export interface Order {
  id: string;
  merchant_id: string;
  reference_id: string; // active UPI tr reference
  amount: number; // in paise
  currency: string; // INR
  note: string;
  upi_payload: string;
  status: OrderStatus;
  paid_late: number; // 0 or 1
  expires_at: number; // Unix timestamp in ms
  paid_at?: number | null;
  created_at: string;
}

export interface OrderReference {
  reference_id: string;
  order_id: string;
  created_at: number;
  superseded_at?: number | null;
}

export interface Merchant {
  id: string;
  name: string;
  business_name: string;
  phone: string;
  phone_verified: number; // 0 or 1
  upi_vpa: string;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  passcode_hash: string;
  biometrics_enabled: number; // 0 or 1
  balance: number; // in paise
  failed_pin_attempts: number;
  pin_locked_until?: number | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentWebhookPayload {
  eventId: string;
  referenceId: string;
  amount: number; // in paise
  gateway: string;
  status: 'SUCCESS' | 'FAILURE';
  gatewayTransactionId?: string;
  timestamp?: string;
}

export interface PaymentEvent {
  id: string;
  event_id: string;
  order_id?: string | null;
  gateway: string;
  amount: number;
  classification: PaymentClassification;
  review_status?: string | null;
  payload_json: string;
  processed_at: string;
}

export interface OtpRecord {
  id: string;
  phone: string;
  otp_hash: string;
  attempts: number;
  expires_at: number;
  cooldown_until: number;
  locked_until?: number | null;
  verified_at?: number | null;
  ip_address?: string | null;
  created_at: number;
}

export interface Payout {
  id: string;
  merchant_id: string;
  amount: number;
  destination_type: string;
  destination_details: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  idempotency_key?: string | null;
  created_at: string;
  created_timestamp: number;
}

export interface WebAuthnCredentialRecord {
  id: string;
  merchant_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports?: string | null;
  device_name?: string | null;
  created_at: number;
  last_used_at?: number | null;
}
