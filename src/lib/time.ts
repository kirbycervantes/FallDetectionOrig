// Firebase push keys (e.g. "-P3Zpuiv-U4QVVJbwdzJ") encode the creation time in their first 8 characters.
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

export function timeFromPushKey(key: string): number | null {
  if (!key || key.length < 8) return null;
  let t = 0;
  for (let i = 0; i < 8; i++) {
    const idx = PUSH_CHARS.indexOf(key.charAt(i));
    if (idx < 0) return null;
    t = t * 64 + idx;
  }
  return isRealTime(t) ? t : null;
}

// Anything before 2020 is not a real date (e.g. ESP32 millis() uptime like 105080).
export function isRealTime(ms: number): boolean {
  return Number.isFinite(ms) && ms > 1577836800000;
}

function toMs(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    if (isRealTime(value)) return value;
    if (isRealTime(value * 1000)) return value * 1000; // seconds-based epoch
    return null;
  }
  const ms = new Date(value as string).getTime();
  return isRealTime(ms) ? ms : null;
}

/** Real event time: the stored timestamp if valid, otherwise the time encoded in the Firebase push key. */
export function resolveEventTime(key: string, timestamp: unknown): Date {
  const ms = toMs(timestamp) ?? timeFromPushKey(key) ?? Date.now();
  return new Date(ms);
}

/** Valid date or null (used for "last seen" style fields). */
export function validDate(value: unknown): Date | null {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms);
}
