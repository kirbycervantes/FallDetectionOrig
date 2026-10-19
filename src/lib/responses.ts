import { db, ref, update } from './db';
import { validDate } from './time';

// A caregiver tells the family (and the admin) what they are doing about an alert:
//   "I'm on my way"  ->  later  "Handled"
// Saved at events/<deviceId>/<eventId>/response so every caregiver and the admin see the same thing.

export type ResponseStatus = 'on_my_way' | 'handled';

export interface EventResponse {
  status: ResponseStatus;
  /** Who set the current status */
  by: string;
  /** When the current status was set */
  at: Date | null;
  onMyWayBy: string | null;
  onMyWayAt: Date | null;
  handledBy: string | null;
  handledAt: Date | null;
}

export function parseResponse(raw: any): EventResponse | null {
  const r = raw?.response;
  if (!r || typeof r !== 'object') return null;
  const status: ResponseStatus | null = r.status === 'handled' ? 'handled' : r.status === 'on_my_way' ? 'on_my_way' : null;
  if (!status) return null;
  const onMyWayBy = r.onMyWayBy ? String(r.onMyWayBy) : null;
  const handledBy = r.handledBy ? String(r.handledBy) : null;
  const onMyWayAt = validDate(r.onMyWayAt);
  const handledAt = validDate(r.handledAt);
  return {
    status,
    by: (status === 'handled' ? handledBy ?? onMyWayBy : onMyWayBy) ?? 'A caregiver',
    at: status === 'handled' ? handledAt : onMyWayAt,
    onMyWayBy,
    onMyWayAt,
    handledBy,
    handledAt,
  };
}

export function responseLabel(status: ResponseStatus): string {
  return status === 'handled' ? 'Handled' : "On my way";
}

/**
 * `person` = the registered contact who is on the way / who handled it (chosen from the family's contacts).
 * `account` = the signed-in website account that pressed the button (kept for the record).
 */
export function saveResponse(
  deviceId: string,
  eventId: string,
  status: ResponseStatus,
  who: { uid: string; account: string; person: string }
) {
  const now = new Date().toISOString();
  const patch =
    status === 'on_my_way'
      ? { status, onMyWayBy: who.person, onMyWayAccount: who.account, onMyWayUid: who.uid, onMyWayAt: now }
      : { status, handledBy: who.person, handledAccount: who.account, handledUid: who.uid, handledAt: now };
  return update(ref(db, `events/${deviceId}/${eventId}/response`), patch);
}
