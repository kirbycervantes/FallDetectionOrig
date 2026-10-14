/** "+63 917 123 4567", "639171234567", "09171234567" -> "09171234567" ('' if invalid) */
export function normalizePhone(phone: unknown): string {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) digits = '0' + digits.slice(2);
  if (digits.startsWith('9') && digits.length === 10) digits = '0' + digits;
  return /^09\d{9}$/.test(digits) ? digits : '';
}
