import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue } from "../../../lib/db";
import { SkeletonTable } from "../ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  Search, Filter, Info, CheckCircle2, XCircle, Clock, HelpCircle, Loader2,
  MessageSquare, PhoneCall, ChevronDown, ChevronUp, Bell, FlaskConical, CalendarDays,
} from "lucide-react";
import { familyDeviceId, personName, flattenEvents } from "./adminData";
import { validDate } from "../../../lib/time";

/* ------------------------------------------------------------------ */
/* Types & status definitions                                          */
/* ------------------------------------------------------------------ */

type ChannelStatus =
  | "Queued" | "Sending" | "Sent" | "Delivered" | "Failed" | "Answered" | "No answer" | "Unknown";

type ChannelKind = "success" | "pending" | "failure" | "unknown";
type Overall = "Successful" | "Failed" | "In progress" | "Unconfirmed";
type Channel = "sms" | "call";

interface Attempt {
  at: Date | null;
  status: ChannelStatus;
  code?: string;
  response?: string;
}

interface ChannelRecord {
  status: ChannelStatus;
  provider?: string;
  providerResponse?: string;
  code?: string;
  reason?: string;
  attempts: Attempt[];
}

interface RecipientDelivery {
  name: string;
  phone: string; // masked
  sms: ChannelRecord;
  call: ChannelRecord;
}

interface AlertRow {
  id: string;
  eventId: string;
  deviceId: string;
  patientName: string;
  alertType: string;
  time: Date;
  recipients: RecipientDelivery[];
  sms: ChannelStatus;   // best outcome across recipients
  call: ChannelStatus;  // best outcome across recipients
  overall: Overall;
  explanation: string;
  hasReceipts: boolean;
}

/**
 * Single source of truth for success / failure.
 * SMS succeeds only when the provider confirms delivery; a call succeeds only when it is answered.
 * "Sent" means handed to the network — it is NOT treated as delivered.
 */
function channelKind(status: ChannelStatus): ChannelKind {
  switch (status) {
    case "Delivered":
    case "Answered":
      return "success";
    case "Queued":
    case "Sending":
    case "Sent":
      return "pending";
    case "Failed":
    case "No answer":
      return "failure";
    default:
      return "unknown";
  }
}

const KIND_RANK: Record<ChannelKind, number> = { success: 3, pending: 2, failure: 1, unknown: 0 };

function bestStatus(statuses: ChannelStatus[]): ChannelStatus {
  if (!statuses.length) return "Unknown";
  return statuses.reduce((best, s) => (KIND_RANK[channelKind(s)] > KIND_RANK[channelKind(best)] ? s : best));
}

/** An alert is successful if at least one channel was confirmed (delivered / answered). */
function overallResult(sms: ChannelStatus, call: ChannelStatus): Overall {
  const kinds = [channelKind(sms), channelKind(call)];
  if (kinds.includes("success")) return "Successful";
  if (kinds.includes("pending")) return "In progress";
  if (kinds.includes("failure")) return "Failed";
  return "Unconfirmed";
}

function channelPhrase(channel: Channel, status: ChannelStatus): string {
  const name = channel === "sms" ? "SMS" : "Call";
  switch (status) {
    case "Delivered": return "SMS delivery was confirmed by the provider";
    case "Answered": return "the call was answered";
    case "Sent": return "SMS was sent but no delivery confirmation has arrived yet";
    case "Queued": return `${name} is queued`;
    case "Sending": return channel === "sms" ? "SMS is being sent" : "the call is ringing";
    case "Failed": return `${name} failed`;
    case "No answer": return "the call was not answered";
    default: return `${name} outcome was not reported`;
  }
}

function explain(sms: ChannelStatus, call: ChannelStatus, overall: Overall): string {
  const s = channelPhrase("sms", sms);
  const c = channelPhrase("call", call);
  const sentence = `${s.charAt(0).toUpperCase()}${s.slice(1)}; ${c}.`;
  const smsK = channelKind(sms);
  const callK = channelKind(call);
  if (overall === "Successful" && (smsK !== "success" || callK !== "success")) {
    return `${sentence} Counted as successful because at least one channel reached the recipient.`;
  }
  if (overall === "Successful") return `${sentence} Both channels reached the recipient.`;
  if (overall === "Failed") return `${sentence} No channel reached the recipient, so this alert counts as failed.`;
  if (overall === "In progress") return `${sentence} Waiting for a final outcome — not yet counted as successful or failed.`;
  return `${sentence} The hub did not report a delivery receipt, so the outcome cannot be confirmed.`;
}

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

function normalizeStatus(raw: any): ChannelStatus {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!v) return "Unknown";
  if (v.startsWith("queue")) return "Queued";
  if (v === "sending" || v === "dialing" || v === "dialling" || v === "ringing" || v === "in progress") return "Sending";
  if (v === "sent" || v === "submitted") return "Sent";
  if (v.startsWith("deliver")) return "Delivered";
  if (v === "answered" || v === "connected" || v === "completed") return "Answered";
  if (v === "no answer" || v === "noanswer" || v === "busy" || v === "rejected" || v === "missed") return "No answer";
  if (v.startsWith("fail") || v === "error" || v === "undelivered") return "Failed";
  return "Unknown";
}

function maskPhone(phone: any): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "—";
}

function toDate(v: any): Date | null {
  return validDate(v);
}

function str(v: any): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function unknownChannel(reason: string): ChannelRecord {
  return { status: "Unknown", reason, attempts: [] };
}

/** Rich format: events/{dev}/{evt}/delivery/{key}/{sms|call} = { status, provider, response, code, reason, attempts } */
function parseChannel(raw: any): ChannelRecord {
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

/** Legacy flat receipts: [{ method, status, contactName, phone, timestamp, code, reason, response, provider }] */
function fromReceipts(receipts: any[]): RecipientDelivery[] {
  const byContact = new Map<string, { name: string; phone: string; sms: any[]; call: any[] }>();
  receipts.forEach((r) => {
    if (!r || typeof r !== "object") return;
    const name = r.contactName || "Registered contact";
    const key = `${name}|${r.phone ?? ""}`;
    if (!byContact.has(key)) byContact.set(key, { name, phone: maskPhone(r.phone), sms: [], call: [] });
    const isCall = String(r.method || "").toLowerCase().includes("call");
    byContact.get(key)![isCall ? "call" : "sms"].push(r);
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
  return [...byContact.values()].map((c) => ({ name: c.name, phone: c.phone, sms: build(c.sms), call: build(c.call) }));
}

/** Registered numbers: emergency contacts first, otherwise the primary caregiver. */
function familyRecipients(f: any): { name: string; phone: string }[] {
  const contacts = Object.values(f?.contacts || {})
    .filter((c: any) => c && c.phone)
    .map((c: any) => ({ name: c.name || "Emergency contact", phone: c.phone }));
  if (contacts.length) return contacts;
  const caregivers = Object.values(f?.caregivers || {}).filter((c: any) => c && c.phone) as any[];
  const primary = caregivers.find((c) => c.role === "primary") || caregivers[0];
  return primary ? [{ name: primary.name || "Caregiver", phone: primary.phone }] : [];
}

function alertTypeFor(status: string): string {
  if (status === "confirmed") return "Fall (confirmed)";
  if (status === "pending" || status === "unconfirmed") return "Fall";
  if (status === "emergency") return "SOS";
  if (status === "resolved") return "Resolved";
  return "Alert";
}

function finalizeRow(base: Omit<AlertRow, "sms" | "call" | "overall" | "explanation">): AlertRow {
  const sms = bestStatus(base.recipients.map((r) => r.sms.status));
  const call = bestStatus(base.recipients.map((r) => r.call.status));
  const overall = overallResult(sms, call);
  return { ...base, sms, call, overall, explanation: explain(sms, call, overall) };
}

function buildRows(events: any, families: any): AlertRow[] {
  const rows: AlertRow[] = [];
  flattenEvents(events).forEach((ev) => {
    if (ev.status === "cancelled") return; // cancelled alarms never trigger SMS / calls
    const family = Object.values(families || {}).find((f: any) => familyDeviceId(f) === ev.deviceId) as any;
    const raw = ev.raw;

    let recipients: RecipientDelivery[] = [];
    let hasReceipts = false;

    if (raw.delivery && typeof raw.delivery === "object") {
      recipients = Object.values(raw.delivery)
        .filter((d: any) => d && typeof d === "object")
        .map((d: any) => ({
          name: d.contactName || d.name || "Registered contact",
          phone: maskPhone(d.phone),
          sms: parseChannel(d.sms),
          call: parseChannel(d.call),
        }));
      hasReceipts = recipients.length > 0;
    }
    if (!hasReceipts && raw.receipts) {
      const list = Array.isArray(raw.receipts) ? raw.receipts : Object.values(raw.receipts);
      recipients = fromReceipts(list);
      hasReceipts = recipients.length > 0;
    }
    if (!hasReceipts) {
      const regs = family ? familyRecipients(family) : [];
      const reason = "The hub did not report a delivery receipt for this alert.";
      recipients = (regs.length ? regs : [{ name: "Registered phone", phone: "" }]).map((r) => ({
        name: r.name,
        phone: maskPhone(r.phone),
        sms: unknownChannel(reason),
        call: unknownChannel(reason),
      }));
    }

    rows.push(finalizeRow({
      id: `${ev.deviceId}_${ev.eventId}`,
      eventId: ev.eventId,
      deviceId: ev.deviceId,
      patientName: family ? personName(family) : "Unassigned device",
      alertType: alertTypeFor(ev.status),
      time: ev.date,
      recipients,
      hasReceipts,
    }));
  });
  return rows.sort((a, b) => b.time.getTime() - a.time.getTime());
}

/* ------------------------------------------------------------------ */
/* Sample data (clearly labelled in the UI; never mixed with live data) */
/* ------------------------------------------------------------------ */

function buildSampleRows(): AlertRow[] {
  const now = Date.now();
  const at = (minAgo: number, plusSec = 0) => new Date(now - minAgo * 60_000 + plusSec * 1000);
  const ch = (status: ChannelStatus, provider: string, attempts: Attempt[], extra: Partial<ChannelRecord> = {}): ChannelRecord => ({
    status, provider, attempts,
    providerResponse: attempts[attempts.length - 1]?.response,
    code: attempts[attempts.length - 1]?.code,
    ...extra,
  });
  const GLOBE = "Globe Telecom via SIM800L";
  const SMART = "Smart Communications via SIM800L";

  const specs: { min: number; patient: string; device: string; type: string; who: string; phone: string; sms: (m: number) => ChannelRecord; call: (m: number) => ChannelRecord }[] = [
    {
      min: 1, patient: "Remedios Cruz", device: "CB-DEMO-0001", type: "SOS", who: "Ana Cruz", phone: "09171234821",
      sms: (m) => ch("Sending", GLOBE, [{ at: at(m, 2), status: "Sending", response: "AT+CMGS issued, awaiting +CMGS" }]),
      call: (m) => ch("Queued", GLOBE, [{ at: at(m, 3), status: "Queued", response: "Waiting for SMS to finish before dialing" }]),
    },
    {
      min: 14, patient: "Teodoro Santos", device: "CB-DEMO-0002", type: "Fall", who: "Mark Santos", phone: "09281234567",
      sms: (m) => ch("Delivered", SMART, [
        { at: at(m, 3), status: "Sent", response: "+CMGS: 112" },
        { at: at(m, 9), status: "Delivered", response: "+CDS: status 0 (delivered)" },
      ]),
      call: (m) => ch("Answered", SMART, [{ at: at(m, 12), status: "Answered", response: "+CLCC: 1,0,0,0,0 (call active)" }]),
    },
    {
      min: 52, patient: "Remedios Cruz", device: "CB-DEMO-0001", type: "Fall", who: "Ana Cruz", phone: "09171234821",
      sms: (m) => ch("Delivered", GLOBE, [
        { at: at(m, 2), status: "Sent", response: "+CMGS: 47" },
        { at: at(m, 11), status: "Delivered", response: "+CDS: status 0 (delivered)" },
      ]),
      call: (m) => ch("No answer", GLOBE, [
        { at: at(m, 15), status: "No answer", code: "NO ANSWER", response: "NO ANSWER after 30 s" },
        { at: at(m, 75), status: "No answer", code: "BUSY", response: "BUSY" },
        { at: at(m, 140), status: "No answer", code: "NO ANSWER", response: "NO ANSWER after 30 s" },
      ], { reason: "Recipient did not pick up after 3 attempts" }),
    },
    {
      min: 128, patient: "Lourdes Villanueva", device: "CB-DEMO-0003", type: "SOS", who: "Paolo Villanueva", phone: "09451239090",
      sms: (m) => ch("Failed", SMART, [
        { at: at(m, 2), status: "Failed", code: "CMS 38", response: "+CMS ERROR: 38" },
        { at: at(m, 32), status: "Failed", code: "CMS 38", response: "+CMS ERROR: 38" },
      ], { reason: "Network out of order (weak signal at hub)" }),
      call: (m) => ch("Answered", SMART, [
        { at: at(m, 8), status: "No answer", code: "NO ANSWER", response: "NO ANSWER after 30 s" },
        { at: at(m, 50), status: "Answered", response: "+CLCC: 1,0,0,0,0 (call active)" },
      ]),
    },
    {
      min: 205, patient: "Teodoro Santos", device: "CB-DEMO-0002", type: "Fall", who: "Mark Santos", phone: "09281234567",
      sms: (m) => ch("Failed", SMART, [
        { at: at(m, 2), status: "Failed", code: "CMS 42", response: "+CMS ERROR: 42" },
        { at: at(m, 33), status: "Failed", code: "CMS 42", response: "+CMS ERROR: 42" },
        { at: at(m, 64), status: "Failed", code: "CMS 42", response: "+CMS ERROR: 42" },
      ], { reason: "Network congestion" }),
      call: (m) => ch("No answer", SMART, [
        { at: at(m, 10), status: "No answer", code: "NO CARRIER", response: "NO CARRIER" },
        { at: at(m, 70), status: "No answer", code: "NO ANSWER", response: "NO ANSWER after 30 s" },
      ], { reason: "Call could not be connected" }),
    },
    {
      min: 9, patient: "Lourdes Villanueva", device: "CB-DEMO-0003", type: "Fall", who: "Paolo Villanueva", phone: "09451239090",
      sms: (m) => ch("Sent", SMART, [{ at: at(m, 2), status: "Sent", response: "+CMGS: 203" }], { reason: "Awaiting delivery report from carrier" }),
      call: (m) => ch("Sending", SMART, [{ at: at(m, 20), status: "Sending", response: "ATD dialing, ringing" }]),
    },
    {
      min: 60 * 26, patient: "Remedios Cruz", device: "CB-DEMO-0001", type: "SOS", who: "Ana Cruz", phone: "09171234821",
      sms: (m) => ch("Delivered", GLOBE, [
        { at: at(m, 2), status: "Sent", response: "+CMGS: 41" },
        { at: at(m, 7), status: "Delivered", response: "+CDS: status 0 (delivered)" },
      ]),
      call: (m) => ch("Answered", GLOBE, [{ at: at(m, 10), status: "Answered", response: "+CLCC: 1,0,0,0,0 (call active)" }]),
    },
    {
      min: 60 * 30, patient: "Teodoro Santos", device: "CB-DEMO-0002", type: "Fall (confirmed)", who: "Mark Santos", phone: "09281234567",
      sms: (m) => ch("Unknown", SMART, [], { reason: "Hub restarted before reporting a result" }),
      call: (m) => ch("Unknown", SMART, [], { reason: "Hub restarted before reporting a result" }),
    },
    {
      min: 60 * 52, patient: "Lourdes Villanueva", device: "CB-DEMO-0003", type: "Fall", who: "Paolo Villanueva", phone: "09451239090",
      sms: (m) => ch("Delivered", SMART, [
        { at: at(m, 2), status: "Sent", response: "+CMGS: 188" },
        { at: at(m, 14), status: "Delivered", response: "+CDS: status 0 (delivered)" },
      ]),
      call: (m) => ch("Failed", SMART, [{ at: at(m, 18), status: "Failed", code: "CME 30", response: "+CME ERROR: 30" }], { reason: "No network service during call attempt" }),
    },
    {
      min: 60 * 74, patient: "Remedios Cruz", device: "CB-DEMO-0001", type: "Fall", who: "Ana Cruz", phone: "09171234821",
      sms: (m) => ch("Delivered", GLOBE, [
        { at: at(m, 2), status: "Sent", response: "+CMGS: 36" },
        { at: at(m, 6), status: "Delivered", response: "+CDS: status 0 (delivered)" },
      ]),
      call: (m) => ch("Answered", GLOBE, [{ at: at(m, 9), status: "Answered", response: "+CLCC: 1,0,0,0,0 (call active)" }]),
    },
    {
      min: 60 * 24 * 6, patient: "Teodoro Santos", device: "CB-DEMO-0002", type: "SOS", who: "Mark Santos", phone: "09281234567",
      sms: (m) => ch("Delivered", SMART, [
        { at: at(m, 3), status: "Sent", response: "+CMGS: 97" },
        { at: at(m, 10), status: "Delivered", response: "+CDS: status 0 (delivered)" },
      ]),
      call: (m) => ch("Answered", SMART, [{ at: at(m, 13), status: "Answered", response: "+CLCC: 1,0,0,0,0 (call active)" }]),
    },
    {
      min: 60 * 24 * 12, patient: "Lourdes Villanueva", device: "CB-DEMO-0003", type: "Fall", who: "Paolo Villanueva", phone: "09451239090",
      sms: (m) => ch("Failed", SMART, [{ at: at(m, 2), status: "Failed", code: "CMS 500", response: "+CMS ERROR: 500" }], { reason: "Unknown modem error" }),
      call: (m) => ch("No answer", SMART, [
        { at: at(m, 9), status: "No answer", code: "NO ANSWER", response: "NO ANSWER after 30 s" },
        { at: at(m, 70), status: "No answer", code: "NO ANSWER", response: "NO ANSWER after 30 s" },
      ], { reason: "Recipient did not pick up after 2 attempts" }),
    },
  ];

  return specs
    .map((s, i) => finalizeRow({
      id: `sample_${i}`,
      eventId: `sample-${String(i + 1).padStart(3, "0")}`,
      deviceId: s.device,
      patientName: s.patient,
      alertType: s.type,
      time: at(s.min),
      recipients: [{ name: s.who, phone: maskPhone(s.phone), sms: s.sms(s.min), call: s.call(s.min) }],
      hasReceipts: true,
    }))
    .sort((a, b) => b.time.getTime() - a.time.getTime());
}

/* ------------------------------------------------------------------ */
/* Presentational pieces                                               */
/* ------------------------------------------------------------------ */

const KIND_STYLE: Record<ChannelKind, string> = {
  success: "bg-success/10 text-success border-success/25",
  pending: "bg-warning/10 text-warning border-warning/25",
  failure: "bg-destructive/10 text-destructive border-destructive/25",
  unknown: "bg-muted text-muted-foreground border-border",
};

function StatusIcon({ status, className = "size-3.5" }: { status: ChannelStatus; className?: string }) {
  const kind = channelKind(status);
  if (kind === "success") return <CheckCircle2 className={className} aria-hidden="true" />;
  if (kind === "failure") return <XCircle className={className} aria-hidden="true" />;
  if (status === "Sending") return <Loader2 className={`${className} animate-spin motion-reduce:animate-none`} aria-hidden="true" />;
  if (kind === "pending") return <Clock className={className} aria-hidden="true" />;
  return <HelpCircle className={className} aria-hidden="true" />;
}

function ChannelBadge({ status, label }: { status: ChannelStatus; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-medium ${KIND_STYLE[channelKind(status)]}`}>
      <StatusIcon status={status} />
      {label ? <span className="sr-only">{label}: </span> : null}
      {status}
    </span>
  );
}

const OVERALL_STYLE: Record<Overall, { cls: string; icon: JSX.Element }> = {
  Successful: { cls: "bg-success text-white border-success", icon: <CheckCircle2 className="size-3.5" aria-hidden="true" /> },
  Failed: { cls: "bg-destructive text-white border-destructive", icon: <XCircle className="size-3.5" aria-hidden="true" /> },
  "In progress": { cls: "bg-warning/15 text-warning border-warning/30", icon: <Clock className="size-3.5" aria-hidden="true" /> },
  Unconfirmed: { cls: "bg-muted text-muted-foreground border-border", icon: <HelpCircle className="size-3.5" aria-hidden="true" /> },
};

function OverallBadge({ row }: { row: AlertRow }) {
  const st = OVERALL_STYLE[row.overall];
  const partial = row.overall === "Successful" && (channelKind(row.sms) !== "success" || channelKind(row.call) !== "success");
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-semibold ${st.cls}`}>
        {st.icon}
        {row.overall}
      </span>
      {partial && (
        <span className="text-[11px] text-muted-foreground">
          {channelKind(row.sms) === "success" ? "Call did not connect" : "SMS not confirmed"}
        </span>
      )}
    </div>
  );
}

function fmtTime(d: Date | null): string {
  return d ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—";
}

function ChannelDetail({ channel, rec }: { channel: Channel; rec: ChannelRecord }) {
  const title = channel === "sms" ? "SMS" : "Call";
  const first = rec.attempts[0]?.at ?? null;
  const last = rec.attempts[rec.attempts.length - 1]?.at ?? null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h5 className="flex items-center gap-2 text-sm font-medium text-foreground">
          {channel === "sms" ? <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" /> : <PhoneCall className="size-4 text-muted-foreground" aria-hidden="true" />}
          {title}
        </h5>
        <ChannelBadge status={rec.status} label={title} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Provider</dt>
        <dd className="text-foreground">{rec.provider ?? "—"}</dd>
        <dt className="text-muted-foreground">Provider response</dt>
        <dd className="font-mono text-foreground break-all">{rec.providerResponse ?? "—"}</dd>
        <dt className="text-muted-foreground">Failure reason / code</dt>
        <dd className={channelKind(rec.status) === "failure" ? "text-destructive" : "text-foreground"}>
          {rec.reason || rec.code ? [rec.reason, rec.code ? `(${rec.code})` : null].filter(Boolean).join(" ") : "—"}
        </dd>
        <dt className="text-muted-foreground">Attempts</dt>
        <dd className="text-foreground">{rec.attempts.length}</dd>
        <dt className="text-muted-foreground">First attempt</dt>
        <dd className="text-foreground">{fmtTime(first)}</dd>
        <dt className="text-muted-foreground">Last update</dt>
        <dd className="text-foreground">{fmtTime(last)}</dd>
      </dl>
      {rec.attempts.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Retry history</p>
          <ol className="space-y-1.5 border-l border-border pl-3">
            {rec.attempts.map((a, i) => (
              <li key={i} className="text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">#{i + 1}</span>
                  <span className="text-foreground">{fmtTime(a.at)}</span>
                  <ChannelBadge status={a.status} />
                </div>
                {(a.response || a.code) && (
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground break-all">
                    {a.response}{a.code && a.response?.includes(a.code) === false ? ` · ${a.code}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function AlertDetails({ row }: { row: AlertRow }) {
  return (
    <div className="space-y-4">
      <div className={`rounded-xl border px-4 py-3 text-sm ${
        row.overall === "Successful" ? "border-success/25 bg-success/5"
        : row.overall === "Failed" ? "border-destructive/25 bg-destructive/5"
        : row.overall === "In progress" ? "border-warning/25 bg-warning/5"
        : "border-border bg-muted/30"
      }`}>
        <p className="font-medium text-foreground">Why “{row.overall}”?</p>
        <p className="mt-0.5 text-muted-foreground">{row.explanation}</p>
        <p className="mt-1 text-xs text-muted-foreground">Event ID <span className="font-mono">{row.eventId}</span></p>
      </div>
      {row.recipients.map((r, i) => (
        <div key={i} className="space-y-2">
          <p className="text-sm text-foreground">
            <span className="font-medium">{r.name}</span> <span className="text-muted-foreground">{r.phone}</span>
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChannelDetail channel="sms" rec={r.sms} />
            <ChannelDetail channel="call" rec={r.call} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecipientCell({ row }: { row: AlertRow }) {
  const first = row.recipients[0];
  return (
    <div className="flex flex-col">
      <span className="text-foreground">{first?.name ?? "—"}</span>
      <span className="text-xs text-muted-foreground">
        {first?.phone ?? "—"}{row.recipients.length > 1 ? ` · +${row.recipients.length - 1} more` : ""}
      </span>
    </div>
  );
}

function AlertTypeBadge({ type }: { type: string }) {
  const cls = type.startsWith("Fall") ? "bg-destructive/10 text-destructive"
    : type === "SOS" ? "bg-warning/10 text-warning"
    : "bg-muted text-muted-foreground";
  return <span className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium ${cls}`}>{type}</span>;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type Period = "today" | "7d" | "30d" | "all";
const PERIOD_LABEL: Record<Period, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };

function periodStart(p: Period): number {
  if (p === "all") return 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === "7d") d.setDate(d.getDate() - 6);
  if (p === "30d") d.setDate(d.getDate() - 29);
  return d.getTime();
}

const SUCCESS_RATE_HELP =
  "Success rate = alerts with at least one successfully delivered channel ÷ alerts attempted. SMS success requires provider delivery confirmation. Call success requires an answered call or another explicitly defined outcome.";

export function AdminAlertDelivery() {
  const [liveRows, setLiveRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [useSample, setUseSample] = useState(false);
  const [period, setPeriod] = useState<Period>("today");
  const [search, setSearch] = useState("");
  const [filterResult, setFilterResult] = useState<"all" | Overall>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const tableTopRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let events: any = {};
    let families: any = {};
    const loaded = { events: false, families: false };
    const recompute = () => {
      setLiveRows(buildRows(events, families));
      if (loaded.events && loaded.families) setLoading(false);
    };
    const unsubEvents = onValue(ref(db, "events"), (snap) => {
      events = snap.val() || {}; loaded.events = true; recompute();
    }, (err) => { console.error("Failed to load events", err); setLoading(false); });
    const unsubFamilies = onValue(ref(db, "families"), (snap) => {
      families = snap.val() || {}; loaded.families = true; recompute();
    }, (err) => { console.error("Failed to load families", err); setLoading(false); });
    return () => { unsubEvents(); unsubFamilies(); };
  }, []);

  const sampleRows = useMemo(() => (useSample ? buildSampleRows() : []), [useSample]);
  const allRows = useSample ? sampleRows : liveRows;

  // Rows in the reporting period — summary cards AND table use this same set and the same definitions.
  const periodRows = useMemo(() => {
    const start = periodStart(period);
    return allRows.filter((r) => r.time.getTime() >= start);
  }, [allRows, period]);

  const total = periodRows.length;
  const successful = periodRows.filter((r) => r.overall === "Successful").length;
  const failed = periodRows.filter((r) => r.overall === "Failed").length;
  const inProgress = periodRows.filter((r) => r.overall === "In progress").length;
  const unconfirmed = periodRows.filter((r) => r.overall === "Unconfirmed").length;
  const rate = total ? Math.round((successful / total) * 100) : null;

  const filtered = periodRows.filter((r) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q
      || r.patientName.toLowerCase().includes(q)
      || r.deviceId.toLowerCase().includes(q)
      || r.recipients.some((x) => x.name.toLowerCase().includes(q));
    const matchesResult = filterResult === "all" || r.overall === filterResult;
    return matchesSearch && matchesResult;
  });

  useEffect(() => { setPage(1); setExpanded(null); }, [search, filterResult, period, useSample]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const firstNum = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const pageNumbers = Array.from({ length: Math.min(5, totalPages) }, (_, i) => firstNum + i);
  const goToPage = (n: number) => {
    setPage(Math.max(1, Math.min(totalPages, n)));
    setExpanded(null);
    tableTopRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));

  const periodLabel = PERIOD_LABEL[period];

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Alert Delivery</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Delivery outcome of every SMS and call the central hub sends for fall and SOS alerts
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="ad-period" className="sr-only">Reporting period</label>
              <select
                id="ad-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
                className="h-[38px] cursor-pointer appearance-none rounded-xl border border-border bg-card pl-9 pr-8 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setUseSample((v) => !v)}
              aria-pressed={useSample}
              className={`inline-flex h-[38px] items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors ${
                useSample ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              <FlaskConical className="size-4" aria-hidden="true" />
              {useSample ? "Showing sample data" : "Show sample data"}
            </button>
          </div>
        </div>

        {useSample && (
          <div role="status" className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-foreground">
              <span className="font-medium">Sample data.</span>{" "}
              <span className="text-muted-foreground">These records are illustrative and do not come from your devices. Turn off “Showing sample data” to see live alerts.</span>
            </p>
          </div>
        )}

        {/* Summary cards */}
        <section aria-label={`Delivery summary, ${periodLabel}`} className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground sm:text-sm">Total alerts</span>
              <Bell className="size-4 text-primary" aria-hidden="true" />
            </div>
            <span className="text-2xl font-semibold text-foreground">{total}</span>
            <span className="text-xs text-muted-foreground">
              {periodLabel}{inProgress + unconfirmed > 0 ? ` · ${inProgress} in progress, ${unconfirmed} unconfirmed` : ""}
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground sm:text-sm">Successful</span>
              <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            </div>
            <span className="text-2xl font-semibold text-foreground">{successful}</span>
            <span className="text-xs text-muted-foreground">{periodLabel} · ≥1 channel confirmed</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground sm:text-sm">Failed</span>
              <XCircle className="size-4 text-destructive" aria-hidden="true" />
            </div>
            <span className={`text-2xl font-semibold ${failed > 0 ? "text-destructive" : "text-foreground"}`}>{failed}</span>
            <span className="text-xs text-muted-foreground">{periodLabel} · no channel reached recipient</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground sm:text-sm">
                Success rate
                <Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setHelpOpen((o) => !o)}
                      aria-label="How the success rate is calculated"
                      className="rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Info className="size-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="max-w-xs text-left leading-relaxed">
                    {SUCCESS_RATE_HELP}
                  </TooltipContent>
                </Tooltip>
              </span>
            </div>
            <span className="text-2xl font-semibold text-foreground">{rate === null ? "—" : `${rate}%`}</span>
            <span className="text-xs text-muted-foreground">
              {total ? `${periodLabel} · ${successful} / ${total} alerts` : `${periodLabel} · no alerts`}
            </span>
          </div>
        </section>

        {/* Filters */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="ad-search" className="sr-only">Search patient, device or recipient</label>
            <input
              id="ad-search"
              type="search"
              placeholder="Search patient, device or recipient…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-4 text-sm focus:border-primary focus:outline-none sm:max-w-sm"
            />
          </div>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="ad-result" className="sr-only">Overall result</label>
            <select
              id="ad-result"
              value={filterResult}
              onChange={(e) => setFilterResult(e.target.value as any)}
              className="h-[38px] w-full cursor-pointer appearance-none rounded-xl border border-border bg-card pl-9 pr-8 text-sm text-foreground focus:border-primary focus:outline-none sm:w-auto"
            >
              <option value="all">All results</option>
              <option value="Successful">Successful</option>
              <option value="Failed">Failed</option>
              <option value="In progress">In progress</option>
              <option value="Unconfirmed">Unconfirmed</option>
            </select>
          </div>
        </div>

        {/* Table / list */}
        {loading && !useSample ? (
          <SkeletonTable rows={5} />
        ) : (
          <div ref={tableTopRef} className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Desktop table */}
            <div className="hidden w-full overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <caption className="sr-only">Alert delivery log, {periodLabel}, newest first</caption>
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Time</th>
                    <th scope="col" className="px-4 py-3 font-medium">Patient / Device</th>
                    <th scope="col" className="px-4 py-3 font-medium">Alert type</th>
                    <th scope="col" className="px-4 py-3 font-medium">Recipient</th>
                    <th scope="col" className="px-4 py-3 font-medium">SMS status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Call status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Overall result</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                        {search || filterResult !== "all" ? "No alerts match these filters" : `No alerts sent — ${periodLabel.toLowerCase()}`}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row) => {
                      const open = expanded === row.id;
                      const detailsId = `ad-details-${row.id}`;
                      return (
                        <Fragment key={row.id}>
                          <tr className={`transition-colors hover:bg-muted/40 ${open ? "bg-muted/30" : ""}`}>
                            <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtTime(row.time)}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground">{row.patientName}</span>
                                <span className="font-mono text-xs text-muted-foreground">{row.deviceId}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3"><AlertTypeBadge type={row.alertType} /></td>
                            <td className="px-4 py-3"><RecipientCell row={row} /></td>
                            <td className="px-4 py-3"><ChannelBadge status={row.sms} label="SMS" /></td>
                            <td className="px-4 py-3"><ChannelBadge status={row.call} label="Call" /></td>
                            <td className="px-4 py-3"><OverallBadge row={row} /></td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => toggle(row.id)}
                                aria-expanded={open}
                                aria-controls={detailsId}
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              >
                                {open ? "Hide" : "View"} details
                                {open ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr id={detailsId} className="bg-muted/20">
                              <td colSpan={8} className="px-4 py-4">
                                <AlertDetails row={row} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="divide-y divide-border md:hidden" aria-label={`Alert delivery log, ${periodLabel}`}>
              {pageRows.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {search || filterResult !== "all" ? "No alerts match these filters" : `No alerts sent — ${periodLabel.toLowerCase()}`}
                </li>
              ) : (
                pageRows.map((row) => {
                  const open = expanded === row.id;
                  const detailsId = `ad-m-details-${row.id}`;
                  return (
                    <li key={row.id} className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{row.patientName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{row.deviceId}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{fmtTime(row.time)}</p>
                        </div>
                        <AlertTypeBadge type={row.alertType} />
                      </div>
                      <div className="text-sm"><RecipientCell row={row} /></div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">SMS</span>
                        <ChannelBadge status={row.sms} label="SMS" />
                        <span className="ml-1 text-xs text-muted-foreground">Call</span>
                        <ChannelBadge status={row.call} label="Call" />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <OverallBadge row={row} />
                        <button
                          type="button"
                          onClick={() => toggle(row.id)}
                          aria-expanded={open}
                          aria-controls={detailsId}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {open ? "Hide" : "View"} details
                          {open ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                        </button>
                      </div>
                      {open && <div id={detailsId}><AlertDetails row={row} /></div>}
                    </li>
                  );
                })
              )}
            </ul>

            {/* Pagination */}
            {filtered.length > 0 && (
              <nav aria-label="Alert delivery pages" className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-4 sm:flex-row sm:px-6">
                <span className="text-sm text-muted-foreground">
                  Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length} • Newest first
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    {pageNumbers.map((n) => (
                      <button
                        key={n}
                        onClick={() => goToPage(n)}
                        aria-current={n === currentPage ? "page" : undefined}
                        className={`min-w-9 rounded-lg border px-3 py-1.5 text-sm ${
                          n === currentPage ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-muted"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                )}
              </nav>
            )}
          </div>
        )}

        {/* Legend */}
        <section aria-label="Status definitions" className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">How statuses are counted</p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <li><span className="font-medium text-success">Successful</span> — at least one channel confirmed: SMS <em>Delivered</em> (carrier delivery report) or call <em>Answered</em>.</li>
            <li><span className="font-medium text-destructive">Failed</span> — every channel ended in <em>Failed</em> or <em>No answer</em>.</li>
            <li><span className="font-medium text-warning">In progress</span> — <em>Queued</em>, <em>Sending</em> or <em>Sent</em> without confirmation yet. “Sent” is not “Delivered”.</li>
            <li><span className="font-medium text-foreground">Unconfirmed</span> — the hub reported no outcome (<em>Unknown</em>). Counted in total alerts, never as successful.</li>
          </ul>
        </section>
      </div>
    </AdminLayout>
  );
}
