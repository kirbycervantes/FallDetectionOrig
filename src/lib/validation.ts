import { db } from './db';
import { ref, query, orderByChild, equalTo, get } from 'firebase/database';

/** Letters (and the Filipino n with tilde) separated by spaces. No digits, no special characters. */
export const NAME_REGEX = /^[A-Za-z\u00D1\u00F1]+(?:\s+[A-Za-z\u00D1\u00F1]+)*$/;

/** While typing: throws away anything that is not a letter or a space. */
export function cleanName(value: string): string {
  return value.replace(/[^A-Za-z\u00D1\u00F1 ]/g, '').replace(/ {2,}/g, ' ').slice(0, 60);
}

/** A device MAC address: CB-1234-5678 (what the admin provisions) or CB-MOCK-0009 (demo devices). */
export const MAC_PATTERN = /^CB-(?:\d{4}-\d{4}|MOCK-\d{4})$/;

export const MAC_ERROR = 'The MAC address must look like CB-1234-5678 (numbers only) or CB-MOCK-0009.';

/**
 * While typing / pasting: keeps the field in the right shape. Letters and symbols are thrown away,
 * the dashes are added by themselves, and only "CB" and "MOCK" can be letters.
 */
export function formatMac(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const rest = cleaned.replace(/^CB/, '');

  // demo devices: CB-MOCK-0009
  if (rest.startsWith('M')) {
    const word = 'MOCK';
    let i = 0;
    while (i < word.length && rest[i] === word[i]) i++;
    const digits = rest.slice(i).replace(/\D/g, '').slice(0, 4);
    if (i < word.length) return `CB-${word.slice(0, i)}`;
    return digits ? `CB-MOCK-${digits}` : 'CB-MOCK';
  }

  // CB-1234-5678: only digits
  const digits = rest.replace(/\D/g, '').slice(0, 8);
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
