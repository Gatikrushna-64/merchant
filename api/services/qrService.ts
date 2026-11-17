import crypto from 'crypto';

export interface GenerateQrInput {
  vpa: string;
  merchantName: string;
  amountInPaise: number;
  referenceId: string;
  note?: string;
  expiresAt: number;
}

export interface GeneratedQrResult {
  upiPayload: string;
  expiresAt: number;
  formattedAmount: string;
}

export class QrService {
  /**
   * Generates a standard NPCI UPI payment URL.
   * Format: upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tr=<ref>&tn=<note>
   */
  public static generateUpiPayload(input: GenerateQrInput): GeneratedQrResult {
    const { vpa, merchantName, amountInPaise, referenceId, note = 'Payment', expiresAt } = input;

    // Convert paise to INR decimal string (e.g. 10050 paise -> 100.50)
    const amountInInr = (amountInPaise / 100).toFixed(2);

    const params = new URLSearchParams();
    params.set('pa', vpa);
    params.set('pn', merchantName);
    params.set('am', amountInInr);
    params.set('cu', 'INR');
    params.set('tr', referenceId);
    params.set('tn', note.slice(0, 50)); // Max 50 characters

    const upiPayload = `upi://pay?${params.toString()}`;

    return {
      upiPayload,
      expiresAt,
      formattedAmount: amountInInr
    };
  }

  /**
   * Generates a collision-resistant unique transaction reference.
   */
  public static generateTransactionRef(): string {
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `TR_${Date.now()}_${randomHex}`;
  }
}
