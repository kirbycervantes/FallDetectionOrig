// phoneIndex/{09XXXXXXXXX} = { uid, email }
// Lets "Forgot password -> try another way" find the account by its
// registered phone number, so the reset link can be sent to that account's email.
// (Database rule: anyone can read ONE number they type in, nobody can list them all.)
import { db, ref, set } from './db';
import { get } from 'firebase/database';

/** "+63 917 123 4567", "639171234567", "09171234567" -> "09171234567" ('' if invalid) */
export function normalizePhone(phone: unknown): string {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) digits = '0' + digits.slice(2);
  if (digits.startsWith('9') && digits.length === 10) digits = '0' + digits;
  return /^09\d{9}$/.test(digits) ? digits : '';
}

/** "juan.delacruz@gmail.com" -> "ju***@gmail.com" */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}***@${domain}`;
}

export async function savePhoneIndex(phone: unknown, uid: string, email: string | null | undefined) {
  const key = normalizePhone(phone);
  if (!key || !email) return;
  try {
    await set(ref(db, `phoneIndex/${key}`), { uid, email });
  } catch (e) {
    // Rules not published yet - the website still works, only the phone lookup won't.
    console.warn('[phoneIndex] could not save', e);
  }
}

export async function removePhoneIndex(phone: unknown) {
  const key = normalizePhone(phone);
  if (!key) return;
  try {
    await set(ref(db, `phoneIndex/${key}`), null);
  } catch (e) {
    console.warn('[phoneIndex] could not remove', e);
  }
}

/** Returns the account email registered to this phone number, or null. */
export async function emailForPhone(phone: unknown): Promise<string | null> {
  const key = normalizePhone(phone);
  if (!key) return null;
  const snap = await get(ref(db, `phoneIndex/${key}`));
  const email = snap.exists() ? snap.val()?.email : null;
  return typeof email === 'string' && email.includes('@') ? email : null;
}
