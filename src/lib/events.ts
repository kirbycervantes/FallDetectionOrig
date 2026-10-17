// What kind of alert an event is, from what the hub writes:
//   new hub : type "fall" | "sos", cancelled: true, stoppedQuietly: true
//   old hub : status "confirmed" (fall) | "emergency" (SOS)

export type EventKind = 'fall' | 'sos';

export function eventKind(raw: any): EventKind {
  const type = String(raw?.type ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  if (type === 'sos' || type === 'manualsos') return 'sos';
  if (type === 'fall') return 'fall';
  const status = String(raw?.status ?? '').toLowerCase();
  if (status === 'emergency' || status === 'sos' || status === 'sos_manual') return 'sos';
  return 'fall';
}

export function isCancelled(raw: any): boolean {
  return raw?.cancelled === true || String(raw?.status ?? '').toLowerCase() === 'cancelled';
}

/** Cancelled by holding CANCEL 2 s on the wearable (no SMS). */
export function isStoppedQuietly(raw: any): boolean {
  return raw?.stoppedQuietly === true;
}

export function kindLabel(kind: EventKind): string {
  return kind === 'sos' ? 'Manual SOS' : 'Fall Detected';
}

/** Real falls only (not SOS, not cancelled) - used for "Total Falls". */
export function isCountedFall(raw: any): boolean {
  return eventKind(raw) === 'fall' && !isCancelled(raw);
}
