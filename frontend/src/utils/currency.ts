/**
 * Converts a rupee input string (e.g. "120.50") to integer paise safely using integer arithmetic.
 */
export function rupeesToPaise(rupeesStr: string): number {
  if (!rupeesStr) return 0;
  const parts = rupeesStr.trim().split('.');
  const whole = parseInt(parts[0] || '0', 10);
  let fraction = 0;
  if (parts.length > 1) {
    const fracStr = (parts[1] + '00').slice(0, 2);
    fraction = parseInt(fracStr, 10);
  }
  return whole * 100 + fraction;
}

/**
 * Formats paise into Indian Rupee currency string using Intl.NumberFormat('en-IN')
 */
export function formatInrPaise(paise: number): string {
  const rupees = (paise || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(rupees);
}

