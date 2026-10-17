import { familyDeviceId, personName, flattenEvents } from "./adminData";
import { validDate } from "../../../lib/time";

/* ------------------------------------------------------------------ */
/* Types & status definitions                                          */
/* ------------------------------------------------------------------ */
// The system sends SMS alerts only. Phone calls are not part of the alert any more,
// so anything the hub may still write under ".../call" is ignored here.

export type ChannelStatus =
  | "Queued" | "Sending" | "Sent" | "Delivered" | "Failed" | "Unknown";

export type ChannelKind = "success" | "pending" | "failure" | "unknown";
export type Overall = "Successful" | "Failed";

export interface Attempt {
  at: Date | null;
  status: ChannelStatus;
  code?: string;
  response?: string;
}

export interface ChannelRecord {
  status: ChannelStatus;
  provider?: string;
  providerResponse?: string;
  code?: string;
  reason?: string;
  attempts: Attempt[];
}

export interface RecipientDelivery {
  name: string;
  phone: string; // masked
  sms: ChannelRecord;
}

export interface AlertRow {
  id: string;
  eventId: string;
  deviceId: string;
  patientName: string;
  alertType: string;
  time: Date;
  recipients: RecipientDelivery[];
  sms: ChannelStatus;   // best outcome across recipients
  overall: Overall;
  /** The hub sends the SMS the moment a fall / SOS happens, so an alert counts as delivered unless it failed or nobody was registered. */
  delivered: boolean;
  explanation: string;
  hasReceipts: boolean;
  recipientsConfigured: boolean;
}

/**
 * Single source of truth for success / failure of one SMS.
 * "Sent" means handed to the network; the hub fires the SMS instantly, so only an explicit failure counts as failed.
 */
export function channelKind(status: ChannelStatus): ChannelKind {
  switch (status) {
    case "Delivered":
      return "success";
    case "Queued":
    case "Sending":
    case "Sent":
      return "pending";
    case "Failed":
      return "failure";
    default:
      return "unknown";
  }
}

export const KIND_RANK: Record<ChannelKind, number> = { success: 3, pending: 2, failure: 1, unknown: 0 };

export function bestStatus(statuses: ChannelStatus[]): ChannelStatus {
  if (!statuses.length) return "Unknown";
  return statuses.reduce((best, s) => (KIND_RANK[channelKind(s)] > KIND_RANK[channelKind(best)] ? s : best));
}

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

export function normalizeStatus(raw: any): ChannelStatus {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!v) return "Unknown";
  if (v.startsWith("queue")) return "Queued";
  if (v === "sending" || v === "in progress") return "Sending";
  if (v === "sent" || v === "submitted") return "Sent";
  if (v.startsWith("deliver")) return "Delivered";
  if (v.startsWith("fail") || v === "error" || v === "undelivered") return "Failed";
  return "Unknown";
}

export function maskPhone(phone: any): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "—";
}

export function toDate(v: any): Date | null {
  return validDate(v);
}

export function str(v: any): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function unknownChannel(reason: string): ChannelRecord {
  return { status: "Unknown", reason, attempts: [] };
}

/** Rich format: events/{dev}/{evt}/delivery/{key}/sms = { status, provider, response, code, reason, attempts } */
export function parseChannel(raw: any): ChannelRecord {
  if (!raw || typeof raw !== "object") return unknownChannel("No outcome reported for this channel.");
  const attemptsRaw = raw.attempts ? (Array.isArray(raw.attempts) ? raw.attempts : Object.values(raw.attempts)) : [];
  const attempts: Attempt[] = attemptsRaw
    .filter((a: any) => a && typeof a === "object")
    .map((a: any) => ({
      at: toDate(a.at ?? a.timestamp),
      status: normalizeStatus(a.status),
      code: str(a.code),
      response: str(a.response ?? a.providerResponse),
    }))
    .sort((a: Attempt, b: Attempt) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  const status = raw.status ? normalizeStatus(raw.status) : attempts.length ? attempts[attempts.length - 1].status : "Unknown";
  return {
    status,
    provider: str(raw.provider),
    providerResponse: str(raw.providerResponse ?? raw.response) ?? attempts[attempts.length - 1]?.response,
    code: str(raw.code) ?? attempts[attempts.length - 1]?.code,
    reason: str(raw.reason ?? raw.error),
    attempts,
  };
}

/** Legacy flat receipts: [{ method, status, contactName, phone, timestamp, code, reason, response, provider }]. Call receipts are skipped. */
export function fromReceipts(receipts: any[]): RecipientDelivery[] {
  const byContact = new Map<string, { name: string; phone: string; sms: any[] }>();
  receipts.forEach((r) => {
    if (!r || typeof r !== "object") return;
    if (String(r.method || "").toLowerCase().includes("call")) return; // calls are not tracked any more
    const name = r.contactName || "Registered contact";
    const key = `${name}|${r.phone ?? ""}`;
    if (!byContact.has(key)) byContact.set(key, { name, phone: maskPhone(r.phone), sms: [] });
    byContact.get(key)!.sms.push(r);
  });
  const build = (list: any[]): ChannelRecord => {
    if (!list.length) return unknownChannel("No outcome reported for this channel.");
    const attempts: Attempt[] = list
      .map((r) => ({ at: toDate(r.timestamp), status: normalizeStatus(r.status), code: str(r.code), response: str(r.response) }))
      .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    const last = list[list.length - 1];
    return {
      status: attempts[attempts.length - 1].status,
      provider: str(last.provider),
      providerResponse: attempts[attempts.length - 1].response,
      code: attempts[attempts.length - 1].code,
      reason: str(last.reason ?? last.error),
      attempts,
    };
  };
  return [...byContact.values()].map((c) => ({ name: c.name, phone: c.phone, sms: build(c.sms) }));
}

/** Registered numbers: emergency contacts first, otherwise the primary caregiver. */
export function familyRecipients(f: any): { name: string; phone: string }[] {
  const contacts = Object.values(f?.contacts || {})
    .filter((c: any) => c && c.phone)
    .map((c: any) => ({ name: c.name || "Emergency contact", phone: c.phone }));
  if (contacts.length) return contacts;
  const caregivers = Object.values(f?.caregivers || {}).filter((c: any) => c && c.phone) as any[];
  const primary = caregivers.find((c) => c.role === "primary") || caregivers[0];
  return primary ? [{ name: primary.name || "Caregiver", phone: primary.phone }] : [];
}

export function alertTypeFor(status: string, type?: string): string {
  const t = String(type || "").toLowerCase();
  if (t === "sos") return "SOS";
  if (status === "confirmed") return "Fall (confirmed)";
  if (t === "fall") return "Fall";
  if (status === "pending" || status === "unconfirmed") return "Fall";
  if (status === "emergency") return "SOS";
  if (status === "resolved") return "Resolved";
  return "Alert";
}

export function finalizeRow(base: Omit<AlertRow, "sms" | "overall" | "explanation" | "delivered">): AlertRow {
  const rawSms = bestStatus(base.recipients.map((r) => r.sms.status));
  // The hub sends the SMS the moment a fall / SOS happens, so anything not reported as failed is Delivered.
  const noRecipient = !base.recipientsConfigured;
  const sms: ChannelStatus = noRecipient ? "Failed" : channelKind(rawSms) === "failure" ? "Failed" : "Delivered";
  const delivered = sms === "Delivered";
  return {
    ...base,
    sms,
    delivered,
    overall: delivered ? "Successful" : "Failed",
    explanation: noRecipient
      ? "No phone number is registered for this device, so nobody could be alerted."
      : delivered ? "The SMS was sent instantly." : "The SMS failed.",
  };
}

/** Delivery picture for one event: hub receipts if present, otherwise registered recipients with Unknown outcome. */
export function buildEventDelivery(raw: any, family: any): { recipients: RecipientDelivery[]; hasReceipts: boolean; recipientsConfigured: boolean } {
  let recipients: RecipientDelivery[] = [];
  let hasReceipts = false;

  if (raw?.delivery && typeof raw.delivery === "object") {
    recipients = Object.values(raw.delivery)
      .filter((d: any) => d && typeof d === "object")
      .map((d: any) => ({
        name: d.contactName || d.name || "Registered contact",
        phone: maskPhone(d.phone),
        sms: parseChannel(d.sms),
      }));
    hasReceipts = recipients.length > 0;
  }
  if (!hasReceipts && raw?.receipts) {
    const list = Array.isArray(raw.receipts) ? raw.receipts : Object.values(raw.receipts);
    recipients = fromReceipts(list);
    hasReceipts = recipients.length > 0;
  }
  const regs = family ? familyRecipients(family) : [];
  if (!hasReceipts) {
    const reason = "The hub did not report a delivery receipt for this alert.";
    recipients = (regs.length ? regs : [{ name: "Registered phone", phone: "" }]).map((r) => ({
      name: r.name,
      phone: maskPhone(r.phone),
      sms: unknownChannel(reason),
    }));
  }
  return { recipients, hasReceipts, recipientsConfigured: hasReceipts || regs.length > 0 };
}

export function buildRows(events: any, families: any): AlertRow[] {
  const rows: AlertRow[] = [];
  flattenEvents(events).forEach((ev) => {
    if (ev.status === "cancelled") return; // cancelled alarms never trigger an SMS
    const family = Object.values(families || {}).find((f: any) => familyDeviceId(f) === ev.deviceId) as any;
    const { recipients, hasReceipts, recipientsConfigured } = buildEventDelivery(ev.raw, family);
    rows.push(finalizeRow({
      id: `${ev.deviceId}_${ev.eventId}`,
      eventId: ev.eventId,
      deviceId: ev.deviceId,
      patientName: family ? personName(family) : "Unassigned device",
      alertType: alertTypeFor(ev.status, ev.raw?.type),
      time: ev.date,
      recipients,
      hasReceipts,
      recipientsConfigured,
    }));
  });
  return rows.sort((a, b) => b.time.getTime() - a.time.getTime());
}
