import { db } from './db';
import { ref, query, orderByChild, equalTo, get } from 'firebase/database';

/** Letters (and the Filipino n with tilde) separated by spaces. No digits, no special characters. */
export const NAME_REGEX = /^[A-Za-z\u00D1\u00F1]+(?:\s+[A-Za-z\u00D1\u00F1]+)*$/;

/** While typing: throws away anything that is not a letter or a space. */
export function cleanName(value: string): string {
  return value.replace(/[^A-Za-z\u00D1\u00F1 ]/g, '').replace(/ {2,}/g, ' ').slice(0, 60);
}

/** A device MAC address: CB-1234-5678 (the ID the hub registers for itself). Numbers only. */
export const MAC_PATTERN = /^CB-\d{4}-\d{4}$/;

export const MAC_ERROR = 'The MAC address must look like CB-1234-5678 (numbers only).';

/**
 * While typing / pasting: keeps the field in the CB-XXXX-XXXX shape. Letters and symbols are thrown away,
 * only digits are kept, and "CB-" and the dash are added by themselves.
 */
export function formatMac(raw: string): string {
  const digits = raw.toUpperCase().replace(/^CB/, '').replace(/\D/g, '').slice(0, 8);
  if (!digits) return '';
  return digits.length > 4 ? `CB-${digits.slice(0, 4)}-${digits.slice(4)}` : `CB-${digits}`;
}

/** While typing / pasting: digits only, at most 11 (09XXXXXXXXX). "+63 917 123 4567" becomes 09171234567. */
export function limitPhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length > 10) digits = '0' + digits.slice(2);
  return digits.slice(0, 11);
}

/** Is this phone number (09XXXXXXXXX) already saved on another account? */
export async function isPhoneTaken(phone: string, exceptUid?: string): Promise<boolean> {
  const snap = await get(query(ref(db, 'users'), orderByChild('phone'), equalTo(phone)));
  if (!snap.exists()) return false;
  return Object.keys(snap.val() || {}).some((uid) => uid !== exceptUid);
}
