export function isValidIndianPhone(phone: string): boolean {
  if (typeof phone !== 'string') return false;
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(?:\+91)?[6-9]\d{9}$/.test(cleaned);
}

export function isValidUpiVpa(vpa: string): boolean {
  if (typeof vpa !== 'string') return false;
  return /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(vpa.trim());
}

export function isValidIfsc(ifsc: string): boolean {
  if (typeof ifsc !== 'string') return false;
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

export function isValidBankAccount(account: string): boolean {
  if (typeof account !== 'string') return false;
  return /^\d{9,18}$/.test(account.trim());
}

export function validatePinComplexity(pin: string): { valid: boolean; reason?: string } {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    return { valid: false, reason: 'PIN must be exactly 6 digits (0-9).' };
  }
  if (/^(\d)\1{5}$/.test(pin)) {
    return { valid: false, reason: 'Trivial PINs with repeated numbers are not allowed.' };
  }
  const sequences = [
    '012345', '123456', '234567', '345678', '456789',
    '987654', '876543', '765432', '654321', '543210',
    '121212', '123123'
  ];
  if (sequences.includes(pin)) {
    return { valid: false, reason: 'Sequential or easily guessable PINs are not allowed.' };
  }
  return { valid: true };
}

