import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue, update, push, set, remove } from "../../../lib/db";
import { auth } from "../../../lib/firebase";
import { SkeletonTable } from "../ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  Search, Filter, CalendarDays, ArrowUpDown, ChevronDown, ChevronUp, MapPin, MapPinOff, ExternalLink,
  AlertOctagon, AlertTriangle, MinusCircle, CircleAlert, Eye, Siren, CheckCircle2, Ban,
  Send, XCircle, HelpCircle, UserX, Clock, History, StickyNote, Trash2, User, Watch, Router, Battery,
} from "lucide-react";
import { familyDeviceId, personName, batteryLevels, deviceState, flattenEvents } from "./adminData";
import { validDate } from "../../../lib/time";
import { buildEventDelivery, bestStatus, overallResult, explain, maskPhone, type RecipientDelivery, type ChannelStatus } from "./deliveryModel";
import { ChannelBadge, ChannelDetail } from "./deliveryUi";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type IncidentStatus = "Open" | "Acknowledged" | "Responding" | "Resolved" | "False alarm";
type Severity = "Critical" | "High" | "Low";
type DeliveryState = "Delivered" | "Sending" | "Failed" | "Not reported" | "No recipients configured" | "Not sent";
type EventKind = "fall" | "sos" | "other";

const STATUSES: IncidentStatus[] = ["Open", "Acknowledged", "Responding", "Resolved", "False alarm"];
const DELIVERY_STATES: DeliveryState[] = ["Delivered", "Sending", "Failed", "Not reported", "No recipients configured", "Not sent"];

/** Events on the same device less than this far apart belong to one incident. */
const GROUP_WINDOW_MS = 30 * 60 * 1000;

interface LocInfo {
  kind: "coords" | "text" | "unavailable";
  text: string;
  mapUrl: string | null;
}

interface EventDelivery {
  state: DeliveryState;
  recipients: RecipientDelivery[];
  sms: ChannelStatus;
  call: ChannelStatus;
  explanation: string;
}

interface IncEvent {
  deviceId: string;
  eventId: string;
  date: Date;
  kind: EventKind;
  rawStatus: string;
  label: string;
  stateLabel: string;
  location: LocInfo | null;
  delivery: EventDelivery;
}

interface LocationView {
  kind: "reported" | "last-known" | "unavailable" | "none";
  primary: string;
  detail: string;
  mapUrl: string | null;
}

interface AuditEntry { at: Date | null; by: string; text: string; note?: string; system?: boolean }
interface Note { id: string; at: Date | null; by: string; text: string }

interface Incident {
  id: string;
  deviceId: string;
  firstEventId: string;
  familyId: string | null;
  family: any;
  device: any;
  patientName: string;
  events: IncEvent[]; // oldest -> newest
  typeLabel: string;
  kinds: EventKind[];
  status: IncidentStatus;
  statusSource: "manual" | "auto";
  autoReason: string;
  assignedTo: string | null;
  updatedAt: Date;
  startedAt: Date;
  latestActivity: Date;
  severity: Severity;
  severityReason: string;
  priority: number;
  delivery: DeliveryState;
  deliveryNote: string;
  deliveryLinkEvent: IncEvent | null;
  location: LocationView;
  notes: Note[];
  audit: AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

function eventKind(raw: any): EventKind {
  const t = String(raw?.type || "").toLowerCase();
  if (t === "fall") return "fall";
  if (t === "sos") return "sos";
  if (raw?.status === "emergency") return "sos";
  if (["pending", "unconfirmed", "confirmed"].includes(raw?.status)) return "fall";
  return "other";
}

function eventLabel(kind: EventKind, status: string): string {
  if (kind === "fall") return status === "confirmed" ? "Fall confirmed" : "Fall detected";
  if (kind === "sos") return "SOS button pressed";
  return "Device alert";
}

function eventStateLabel(status: string): string {
  switch (status) {
    case "cancelled": return "Cancelled by wearer";
    case "confirmed": return "Confirmed";
    case "resolved": return "Marked resolved";
    case "pending":
    case "unconfirmed": return "Awaiting confirmation";
    case "emergency": return "Emergency raised";
    default: return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Reported";
  }
}

function validCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

function mapLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Turns whatever the hub stored into a precise location state. Returns null when nothing was reported. */
function parseLocation(loc: any): LocInfo | null {
  if (loc === undefined || loc === null || loc === "") return null;
  if (typeof loc === "string") {
    const v = loc.trim().toLowerCase();
    if (!v || v === "unknown") return null;
    if (v.includes("permission")) return { kind: "unavailable", text: "Permission denied", mapUrl: null };
    if (v.includes("unavailable") || v.includes("no fix")) return { kind: "unavailable", text: "Location unavailable (no GPS fix)", mapUrl: null };
    return { kind: "text", text: loc.trim(), mapUrl: null };
  }
  if (typeof loc === "object") {
    const err = String(loc.error ?? loc.status ?? loc.reason ?? "").toLowerCase();
    if (err.includes("permission")) return { kind: "unavailable", text: "Permission denied", mapUrl: null };
    if (err.includes("unavailable") || err.includes("no_fix") || err.includes("no fix") || err.includes("timeout")) {
      return { kind: "unavailable", text: "Location unavailable (no GPS fix)", mapUrl: null };
    }
    const lat = Number(loc.lat ?? loc.latitude);
    const lng = Number(loc.lng ?? loc.lon ?? loc.longitude);
    if (loc.address && validCoords(lat, lng)) return { kind: "coords", text: String(loc.address), mapUrl: mapLink(lat, lng) };
    if (validCoords(lat, lng)) return { kind: "coords", text: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, mapUrl: mapLink(lat, lng) };
    if (lat === 0 && lng === 0) return { kind: "unavailable", text: "Location unavailable (GPS had no fix)", mapUrl: null };
    if (loc.address) return { kind: "text", text: String(loc.address), mapUrl: null };
  }
  return null;
}

function eventDelivery(raw: any, family: any): EventDelivery {
  const { recipients, hasReceipts, recipientsConfigured } = buildEventDelivery(raw, family);
  const sms = bestStatus(recipients.map((r) => r.sms.status));
  const call = bestStatus(recipients.map((r) => r.call.status));
  const overall = overallResult(sms, call);
  let state: DeliveryState;
  if (raw?.status === "cancelled") state = "Not sent";
  else if (!hasReceipts) state = recipientsConfigured ? "Not reported" : "No recipients configured";
  else state = overall === "Successful" ? "Delivered" : overall === "In progress" ? "Sending" : overall === "Failed" ? "Failed" : "Not reported";
  const explanation = state === "Not sent"
    ? "No SMS or call is sent for an alert the wearer cancelled."
    : state === "No recipients configured"
      ? "This family has no emergency contact or caregiver phone number on file, so the hub had no one to alert."
      : explain(sms, call, overall);
  return { state, recipients, sms, call, explanation };
}

const DELIVERY_RANK: Record<DeliveryState, number> = {
  Delivered: 6, Sending: 5, Failed: 4, "Not reported": 3, "No recipients configured": 2, "Not sent": 1,
};

const STATUS_WEIGHT: Record<IncidentStatus, number> = { Open: 4, Acknowledged: 3, Responding: 2, Resolved: 0, "False alarm": 0 };
const SEVERITY_WEIGHT: Record<Severity, number> = { Critical: 3, High: 2, Low: 1 };

function toDate(v: any): Date | null {
  return validDate(v);
}

function statusFromStored(v: any): IncidentStatus | null {
  return STATUSES.find((s) => s.toLowerCase() === String(v || "").toLowerCase()) ?? null;
}

/* ------------------------------------------------------------------ */
/* Building incidents                                                  */
/* ------------------------------------------------------------------ */

function buildIncidents(events: any, families: any, devices: any, records: any): Incident[] {
  const familyEntries = Object.entries(families || {}) as [string, any][];
  const byDevice = new Map<string, IncEvent[]>();

  flattenEvents(events).forEach((ev) => {
    const fam = familyEntries.find(([, f]) => familyDeviceId(f) === ev.deviceId)?.[1];
    const kind = eventKind(ev.raw);
    const item: IncEvent = {
      deviceId: ev.deviceId,
      eventId: ev.eventId,
      date: ev.date,
      kind,
      rawStatus: ev.status,
      label: eventLabel(kind, ev.status),
      stateLabel: eventStateLabel(ev.status),
      location: parseLocation(ev.raw.location),
      delivery: eventDelivery(ev.raw, fam),
    };
    if (!byDevice.has(ev.deviceId)) byDevice.set(ev.deviceId, []);
    byDevice.get(ev.deviceId)!.push(item);
  });

  const incidents: Incident[] = [];

  byDevice.forEach((list, deviceId) => {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    const familyEntry = familyEntries.find(([, f]) => familyDeviceId(f) === deviceId);
    const family = familyEntry?.[1] ?? null;
    const device = devices?.[deviceId] ?? null;

    // Group: same device, each event within GROUP_WINDOW of the previous one,
    // and never past an incident that was already closed.
    const groups: IncEvent[][] = [];
    list.forEach((ev) => {
      const cur = groups[groups.length - 1];
      if (cur) {
        const last = cur[cur.length - 1];
        const rec = records?.[`${deviceId}_${cur[0].eventId}`];
        const closedAt = toDate(rec?.closedAt);
        const sameWindow = ev.date.getTime() - last.date.getTime() <= GROUP_WINDOW_MS;
        if (sameWindow && !(closedAt && ev.date > closedAt)) { cur.push(ev); return; }
      }
      groups.push([ev]);
    });

    groups.forEach((evs) => {
      const id = `${deviceId}_${evs[0].eventId}`;
      const rec = records?.[id] || {};
      const live = evs.filter((e) => e.rawStatus !== "cancelled");
      const kinds = [...new Set(evs.map((e) => e.kind))];

      // Type
      const hasConfirmedFall = evs.some((e) => e.kind === "fall" && e.rawStatus === "confirmed");
      const typeLabel = hasConfirmedFall ? "Fall (confirmed)"
        : kinds.includes("fall") && kinds.includes("sos") ? "Fall + SOS"
        : kinds.includes("fall") ? "Fall" : kinds.includes("sos") ? "SOS" : "Device alert";

      // Status: stored decision wins, otherwise derived from the device's own reports
      const stored = statusFromStored(rec.status);
      let status: IncidentStatus;
      let autoReason = "";
      if (stored) {
        status = stored;
      } else if (live.length === 0) {
        status = "False alarm";
        autoReason = "Every event was cancelled by the wearer.";
      } else if (evs.some((e) => e.rawStatus === "resolved")) {
        status = "Resolved";
        autoReason = "The device marked the event resolved.";
      } else {
        status = "Open";
        autoReason = "No one has acknowledged this incident yet.";
      }

      // Severity (shown with icon + text, never colour alone)
      let severity: Severity;
      let severityReason: string;
      if (live.length === 0) { severity = "Low"; severityReason = "All events were cancelled by the wearer."; }
      else if (hasConfirmedFall) { severity = "Critical"; severityReason = "A fall was confirmed."; }
      else if (kinds.includes("fall") && kinds.includes("sos")) { severity = "Critical"; severityReason = "A fall and an SOS were both raised."; }
      else if (live.length >= 3) { severity = "Critical"; severityReason = `${live.length} alerts within ${GROUP_WINDOW_MS / 60000} minutes of each other.`; }
      else { severity = "High"; severityReason = kinds.includes("fall") ? "A fall was detected." : "The SOS button was pressed."; }

      // Alert delivery across the incident's events
      const delivered = evs.reduce<DeliveryState>((best, e) => (DELIVERY_RANK[e.delivery.state] > DELIVERY_RANK[best] ? e.delivery.state : best), "Not sent");
      const failedCount = live.filter((e) => e.delivery.state === "Failed").length;
      let deliveryNote = "";
      if (delivered === "Delivered") {
        const d = live.find((e) => e.delivery.state === "Delivered")!.delivery;
        deliveryNote = d.sms === "Delivered" && d.call === "Answered" ? "SMS delivered · call answered"
          : d.sms === "Delivered" ? "SMS delivered" : "Call answered";
        if (failedCount) deliveryNote += ` · ${failedCount} other alert${failedCount > 1 ? "s" : ""} failed`;
      } else if (delivered === "Not reported") deliveryNote = "No delivery report from the hub";
      else if (delivered === "Not sent") deliveryNote = "Cancelled before sending";
      else if (delivered === "Sending") deliveryNote = "Awaiting confirmation";
      else if (delivered === "Failed") deliveryNote = "No channel reached a recipient";
      else deliveryNote = "Add an emergency contact";
      const deliveryLinkEvent = [...live].reverse()[0] ?? null;

      // Location: latest event that reported one, otherwise the device's last known location —
      // but only when that position is relevant (incident still active, or recorded around the incident time).
      const reported = [...evs].reverse().find((e) => e.location && e.location.kind !== "unavailable");
      const unavailable = [...evs].reverse().find((e) => e.location?.kind === "unavailable");
      const devLoc = parseLocation(device?.location);
      const devAt = toDate(device?.lastUpdate);
      const lastEventAt = evs[evs.length - 1].date.getTime();
      const isActive = status === "Open" || status === "Acknowledged" || status === "Responding";
      const devRelevant = !!devLoc && devLoc.kind === "coords" && (
        isActive || (devAt !== null && devAt.getTime() <= lastEventAt + GROUP_WINDOW_MS)
      );
      let location: LocationView;
      if (reported) {
        location = { kind: "reported", primary: reported.location!.text, detail: `Reported with alert · ${fmt(reported.date)}`, mapUrl: reported.location!.mapUrl };
      } else if (devRelevant) {
        location = {
          kind: "last-known",
          primary: devLoc!.text,
          detail: `${unavailable ? `${unavailable.location!.text} at alert · ` : "Not sent with alert · "}device position ${devAt ? fmt(devAt) : "(time not reported)"}`,
          mapUrl: devLoc!.mapUrl,
        };
      } else if (unavailable) {
        location = { kind: "unavailable", primary: unavailable.location!.text, detail: `At ${fmt(unavailable.date)} · no last known location from that time`, mapUrl: null };
      } else {
        location = { kind: "none", primary: "Not reported", detail: "The hub sent no location with these events", mapUrl: null };
      }

      // Notes & audit
      const notes: Note[] = Object.entries(rec.notes || {})
        .map(([nid, n]: [string, any]) => ({ id: nid, at: toDate(n?.at), by: String(n?.by || "Admin"), text: String(n?.text || "") }))
        .filter((n) => n.text)
        .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
      const audit: AuditEntry[] = [
        ...evs.map((e, i) => ({
          at: e.date, by: "System", system: true,
          text: i === 0 ? `Incident opened — ${e.label.toLowerCase()} received from ${deviceId}` : `Event added — ${e.label.toLowerCase()} (${e.stateLabel.toLowerCase()})`,
        })),
        ...Object.values(rec.audit || {}).filter((a: any) => a && typeof a === "object").map((a: any) => ({
          at: toDate(a.at), by: String(a.by || "Admin"),
          text: a.action === "status_changed"
            ? `Status changed ${a.from ? `from ${a.from} ` : ""}to ${a.to}${a.responder ? ` · responder: ${a.responder}` : ""}`
            : a.action === "note_added" ? "Note added" : String(a.action || "Updated"),
          note: a.note ? String(a.note) : undefined,
        })),
      ].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

      const latestActivity = new Date(Math.max(evs[evs.length - 1].date.getTime(), toDate(rec.updatedAt)?.getTime() ?? 0));
      const updatedAt = toDate(rec.updatedAt) ?? evs[evs.length - 1].date;
      const priority = STATUS_WEIGHT[status] * 100 + SEVERITY_WEIGHT[severity] * 10
        + (delivered === "Failed" || delivered === "No recipients configured" ? 5 : 0);

      incidents.push({
        id, deviceId, firstEventId: evs[0].eventId,
        familyId: familyEntry?.[0] ?? null, family, device,
        patientName: family ? personName(family, device) : (device?.user?.name || "Unassigned device"),
        events: evs, typeLabel, kinds, status,
        statusSource: stored ? "manual" : "auto", autoReason,
        assignedTo: rec.assignedTo?.name || (typeof rec.assignedTo === "string" ? rec.assignedTo : null),
        updatedAt, startedAt: evs[0].date, latestActivity,
        severity, severityReason, priority,
        delivery: delivered, deliveryNote, deliveryLinkEvent,
        location, notes, audit,
      });
    });
  });

  return incidents;
}

/* ------------------------------------------------------------------ */
/* Formatting & small UI pieces                                        */
/* ------------------------------------------------------------------ */

function fmt(d: Date | null): string {
  return d ? d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

function fmtFull(d: Date | null): string {
  return d ? d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—";
}

function relTime(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days} day${days > 1 ? "s" : ""} ago` : fmt(d);
}

const SEVERITY_UI: Record<Severity, { cls: string; Icon: typeof AlertOctagon }> = {
  Critical: { cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: AlertOctagon },
  High: { cls: "bg-warning/10 text-warning border-warning/30", Icon: AlertTriangle },
  Low: { cls: "bg-muted text-muted-foreground border-border", Icon: MinusCircle },
};

function SeverityBadge({ severity, reason }: { severity: Severity; reason?: string }) {
  const { cls, Icon } = SEVERITY_UI[severity];
  return (
    <span title={reason} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-semibold ${cls}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Severity: </span>{severity}
    </span>
  );
}

const STATUS_UI: Record<IncidentStatus, { cls: string; Icon: typeof CircleAlert }> = {
  Open: { cls: "bg-destructive text-white border-destructive", Icon: CircleAlert },
  Acknowledged: { cls: "bg-primary/10 text-primary border-primary/30", Icon: Eye },
  Responding: { cls: "bg-warning/15 text-warning border-warning/30", Icon: Siren },
  Resolved: { cls: "bg-success/10 text-success border-success/30", Icon: CheckCircle2 },
  "False alarm": { cls: "bg-muted text-muted-foreground border-border", Icon: Ban },
};

function StatusBadge({ status }: { status: IncidentStatus }) {
  const { cls, Icon } = STATUS_UI[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-semibold ${cls}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Status: </span>{status}
    </span>
  );
}

const DELIVERY_UI: Record<DeliveryState, { cls: string; Icon: typeof Send }> = {
  Delivered: { cls: "bg-success/10 text-success border-success/30", Icon: CheckCircle2 },
  Sending: { cls: "bg-warning/10 text-warning border-warning/30", Icon: Clock },
  Failed: { cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: XCircle },
  "Not reported": { cls: "bg-muted text-muted-foreground border-border", Icon: HelpCircle },
  "No recipients configured": { cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: UserX },
  "Not sent": { cls: "bg-muted text-muted-foreground border-border", Icon: MinusCircle },
};

function DeliveryBadge({ state }: { state: DeliveryState }) {
  const { cls, Icon } = DELIVERY_UI[state];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-medium ${cls}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Alert delivery: </span>{state}
    </span>
  );
}

function deliveryHref(ev: IncEvent | null): string | null {
  return ev ? `/admin/alert-delivery?event=${encodeURIComponent(`${ev.deviceId}_${ev.eventId}`)}` : null;
}

function LocationCell({ loc }: { loc: LocationView }) {
  const Icon = loc.kind === "reported" || loc.kind === "last-known" ? MapPin : MapPinOff;
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        {loc.mapUrl ? (
          <a href={loc.mapUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">
            {loc.primary}<span className="sr-only"> (opens Google Maps in a new tab)</span>
          </a>
        ) : (
          <span className="text-xs font-medium text-foreground">{loc.primary}</span>
        )}
        {loc.kind === "last-known" && <p className="text-[11px] font-medium text-muted-foreground">Last known location</p>}
        <p className="text-[11px] text-muted-foreground">{loc.detail}</p>
      </div>
    </div>
  );
}

function EventTimeline({ inc, compact = false }: { inc: Incident; compact?: boolean }) {
  return (
    <ol className="relative space-y-3 border-l border-border pl-4" aria-label="Event timeline, oldest first">
      {inc.events.map((e) => {
        const href = deliveryHref(e.rawStatus === "cancelled" ? null : e);
        const isFall = e.kind === "fall";
        return (
          <li key={e.eventId} className="relative">
            <span className={`absolute -left-[21px] top-1 flex size-2.5 rounded-full ring-4 ring-card ${
              e.rawStatus === "cancelled" ? "bg-muted-foreground/50" : isFall ? "bg-destructive" : "bg-warning"
            }`} aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <time className="text-xs text-muted-foreground" dateTime={e.date.toISOString()}>{fmtFull(e.date)}</time>
              <span className="font-medium text-foreground">{e.label}</span>
              <span className="text-xs text-muted-foreground">· {e.stateLabel}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <DeliveryBadge state={e.delivery.state} />
              {!compact && e.delivery.state !== "Not sent" && (
                <>
                  <span className="inline-flex items-center gap-1"><span className="text-muted-foreground" aria-hidden="true">SMS</span><ChannelBadge status={e.delivery.sms} label="SMS" /></span>
                  <span className="inline-flex items-center gap-1"><span className="text-muted-foreground" aria-hidden="true">Call</span><ChannelBadge status={e.delivery.call} label="Call" /></span>
                </>
              )}
              {e.location ? (
                e.location.mapUrl ? (
                  <a href={e.location.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    <MapPin className="size-3" aria-hidden="true" />{e.location.text}<span className="sr-only"> (opens Google Maps)</span>
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><MapPinOff className="size-3" aria-hidden="true" />{e.location.text}</span>
                )
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground"><MapPinOff className="size-3" aria-hidden="true" />Location not reported</span>
              )}
              {href && (
                <Link to={href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  Delivery details <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Full incident view                                                  */
/* ------------------------------------------------------------------ */

function Section({ title, icon, children, action }: { title: string; icon: JSX.Element; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">{icon}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function adminName(): string {
  const u = auth.currentUser;
  return u?.displayName || u?.email || "Admin";
}

function IncidentView({ inc, onClose }: { inc: Incident; onClose: () => void }) {
  const [changing, setChanging] = useState(false);
  const [newStatus, setNewStatus] = useState<IncidentStatus>(inc.status === "Open" ? "Acknowledged" : inc.status);
  const [responder, setResponder] = useState(inc.assignedTo || adminName());
  const [statusNote, setStatusNote] = useState("");
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openDelivery, setOpenDelivery] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const needsNote = newStatus === "Resolved" || newStatus === "False alarm";
  const base = `admin/incidents/${inc.id}`;

  const logGlobal = async (action: string) => {
    const u = auth.currentUser;
    if (!u) return;
    await set(push(ref(db, "admin/auditLog")), {
      action, adminId: u.uid, adminEmail: u.email, targetId: inc.id, targetDevice: inc.deviceId, timestamp: new Date().toISOString(),
    });
  };

  const submitStatus = async () => {
    if (newStatus === inc.status && (responder.trim() || null) === (inc.assignedTo || null)) {
      setError("Choose a different status or responder."); return;
    }
    if (needsNote && !statusNote.trim()) { setError(`Add a note explaining why this is ${newStatus.toLowerCase()}.`); return; }
    setBusy(true); setError("");
    try {
      const now = new Date().toISOString();
      const by = adminName();
      const closed = newStatus === "Resolved" || newStatus === "False alarm";
      await update(ref(db, base), {
        status: newStatus,
        deviceId: inc.deviceId,
        firstEventId: inc.firstEventId,
        assignedTo: responder.trim() ? { name: responder.trim(), assignedBy: by, at: now } : null,
        updatedAt: now,
        updatedBy: by,
        closedAt: closed ? now : null,
      });
      await set(push(ref(db, `${base}/audit`)), {
        action: "status_changed", from: inc.status, to: newStatus, responder: responder.trim() || null,
        note: statusNote.trim() || null, by, at: now,
      });
      if (statusNote.trim()) await set(push(ref(db, `${base}/notes`)), { text: statusNote.trim(), by, at: now });
      await logGlobal(`Incident ${newStatus}`);
      setChanging(false); setStatusNote("");
    } catch (e: any) {
      setError(e?.message || "Could not update the incident.");
    } finally { setBusy(false); }
  };

  const submitNote = async () => {
    if (!noteText.trim()) { setError("Write a note first."); return; }
    setBusy(true); setError("");
    try {
      const now = new Date().toISOString();
      const by = adminName();
      await update(ref(db, base), { deviceId: inc.deviceId, firstEventId: inc.firstEventId, updatedAt: now, updatedBy: by });
      await set(push(ref(db, `${base}/notes`)), { text: noteText.trim(), by, at: now });
      await set(push(ref(db, `${base}/audit`)), { action: "note_added", by, at: now, note: noteText.trim() });
      setNoteText(""); setAddingNote(false);
    } catch (e: any) {
      setError(e?.message || "Could not save the note.");
    } finally { setBusy(false); }
  };

  const deleteRecords = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true); setError("");
    try {
      await Promise.all(inc.events.map((e) => remove(ref(db, `events/${e.deviceId}/${e.eventId}`))));
      await remove(ref(db, base));
      await logGlobal("Deleted incident records");
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not delete these records.");
      setBusy(false);
    }
  };

  const caregivers = Object.values(inc.family?.caregivers || {}) as any[];
  const contacts = Object.values(inc.family?.contacts || {}) as any[];
  const levels = batteryLevels(inc.device);
  const devState = deviceState(inc.device);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={inc.severity} reason={inc.severityReason} />
        <StatusBadge status={inc.status} />
        <DeliveryBadge state={inc.delivery} />
        <span className="text-xs text-muted-foreground">
          {inc.events.length} event{inc.events.length > 1 ? "s" : ""} · started {fmt(inc.startedAt)} · last activity {relTime(inc.latestActivity)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">Severity: {inc.severityReason}</p>

      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      {/* Status & responder */}
      <Section
        title="Status & responder"
        icon={<Siren className="size-4 text-muted-foreground" aria-hidden="true" />}
        action={!changing && (
          <button type="button" onClick={() => { setChanging(true); setError(""); }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
            Change status…
          </button>
        )}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd><StatusBadge status={inc.status} /> <span className="ml-1 text-xs text-muted-foreground">{inc.statusSource === "auto" ? `Automatic — ${inc.autoReason}` : "Set by a responder"}</span></dd>
          <dt className="text-muted-foreground">Assigned responder</dt>
          <dd className="text-foreground">{inc.assignedTo ?? <span className="text-muted-foreground">Unassigned</span>}</dd>
          <dt className="text-muted-foreground">Last updated</dt>
          <dd className="text-foreground">{fmtFull(inc.updatedAt)}</dd>
        </dl>

        {changing && (
          <form
            className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
            onSubmit={(e) => { e.preventDefault(); submitStatus(); }}
          >
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-foreground">New status</legend>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <label key={s} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${newStatus === s ? "border-primary bg-card" : "border-border bg-card/60"}`}>
                    <input type="radio" name="inc-status" value={s} checked={newStatus === s} onChange={() => setNewStatus(s)} className="accent-[var(--primary)]" />
                    {s}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">Assigned responder</span>
                <input value={responder} onChange={(e) => setResponder(e.target.value)} placeholder="Name of the person handling this"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">Note {needsNote ? <span className="text-destructive">(required)</span> : <span className="text-muted-foreground">(optional)</span>}</span>
                <input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} required={needsNote}
                  placeholder={needsNote ? "e.g. Caregiver confirmed patient is safe" : "What was done"}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
              </label>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { setChanging(false); setError(""); }} className="rounded-lg px-3 py-1.5 text-sm text-foreground hover:bg-muted">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy ? "Saving…" : `Confirm: mark as ${newStatus}`}
              </button>
            </div>
          </form>
        )}
      </Section>

      {/* Person & device */}
      <Section title="Person & device" icon={<User className="size-4 text-muted-foreground" aria-hidden="true" />}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Person monitored</dt>
          <dd className="font-medium text-foreground">{inc.patientName}</dd>
          <dt className="text-muted-foreground">Device serial</dt>
          <dd className="font-mono text-foreground">{inc.deviceId}</dd>
          <dt className="text-muted-foreground">Device status</dt>
          <dd className="text-foreground">{devState === "offline" ? "Offline" : devState === "low_battery" ? "Online · low battery" : "Online"}</dd>
          <dt className="text-muted-foreground">Batteries</dt>
          <dd className="flex flex-wrap gap-3 text-foreground">
            <span className="inline-flex items-center gap-1"><Watch className="size-3.5 text-muted-foreground" aria-hidden="true" />Wearable {Math.round(levels.wearable)}%</span>
            <span className="inline-flex items-center gap-1"><Router className="size-3.5 text-muted-foreground" aria-hidden="true" />Hub {Math.round(levels.hub)}%</span>
          </dd>
          <dt className="text-muted-foreground">Caregivers</dt>
          <dd className="text-foreground">
            {caregivers.length ? caregivers.map((c, i) => (
              <span key={i} className="mr-3 inline-block">{c.name || "Caregiver"}{c.role ? ` (${c.role})` : ""} <span className="text-muted-foreground">{maskPhone(c.phone)}</span></span>
            )) : <span className="text-muted-foreground">None linked</span>}
          </dd>
          <dt className="text-muted-foreground">Emergency contacts</dt>
          <dd className="text-foreground">
            {contacts.length ? contacts.map((c, i) => (
              <span key={i} className="mr-3 inline-block">{c.name || "Contact"} <span className="text-muted-foreground">{maskPhone(c.phone)}</span></span>
            )) : <span className="text-muted-foreground">None configured</span>}
          </dd>
        </dl>
      </Section>

      {/* Timeline */}
      <Section title="Event timeline" icon={<History className="size-4 text-muted-foreground" aria-hidden="true" />}>
        <EventTimeline inc={inc} />
      </Section>

      {/* Location */}
      <Section title="Location" icon={<MapPin className="size-4 text-muted-foreground" aria-hidden="true" />}>
        <div className="text-sm">
          <p className="font-medium text-foreground">{inc.location.primary}</p>
          {inc.location.kind === "last-known" && <p className="text-xs font-medium text-muted-foreground">Last known location (not from the alert itself)</p>}
          <p className="text-xs text-muted-foreground">{inc.location.detail}</p>
          {inc.location.mapUrl ? (
            <a href={inc.location.mapUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Open in Google Maps <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No map link — no valid coordinates were reported.</p>
          )}
        </div>
      </Section>

      {/* Alert delivery */}
      <Section title="Alert delivery attempts" icon={<Send className="size-4 text-muted-foreground" aria-hidden="true" />}>
        <ul className="space-y-2">
          {inc.events.map((e) => {
            const open = openDelivery === e.eventId;
            const href = deliveryHref(e.rawStatus === "cancelled" ? null : e);
            return (
              <li key={e.eventId} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-muted-foreground">{fmtFull(e.date)}</span>
                    <span className="font-medium text-foreground">{e.label}</span>
                    <DeliveryBadge state={e.delivery.state} />
                  </div>
                  <div className="flex items-center gap-2">
                    {e.delivery.state !== "Not sent" && (
                      <button type="button" onClick={() => setOpenDelivery(open ? null : e.eventId)} aria-expanded={open}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10">
                        {open ? "Hide" : "Show"} channels {open ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
                      </button>
                    )}
                    {href && (
                      <Link to={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                        Alert Delivery page <ExternalLink className="size-3" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{e.delivery.explanation}</p>
                {open && (
                  <div className="mt-3 space-y-3">
                    {e.delivery.recipients.map((r, i) => (
                      <div key={i} className="space-y-2">
                        <p className="text-sm"><span className="font-medium text-foreground">{r.name}</span> <span className="text-muted-foreground">{r.phone}</span></p>
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                          <ChannelDetail channel="sms" rec={r.sms} />
                          <ChannelDetail channel="call" rec={r.call} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {/* Notes */}
      <Section
        title="Responder notes"
        icon={<StickyNote className="size-4 text-muted-foreground" aria-hidden="true" />}
        action={!addingNote && (
          <button type="button" onClick={() => { setAddingNote(true); setError(""); }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
            Add note
          </button>
        )}
      >
        {inc.notes.length === 0 && !addingNote && <p className="text-sm text-muted-foreground">No notes yet.</p>}
        <ul className="space-y-2">
          {inc.notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <p className="text-foreground">{n.text}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{n.by} · {fmtFull(n.at)}</p>
            </li>
          ))}
        </ul>
        {addingNote && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submitNote(); }}>
            <label htmlFor={`note-${inc.id}`} className="sr-only">New note</label>
            <textarea id={`note-${inc.id}`} value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3}
              placeholder="e.g. Called daughter, she is on her way"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setAddingNote(false); setNoteText(""); }} className="rounded-lg px-3 py-1.5 text-sm text-foreground hover:bg-muted">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy ? "Saving…" : "Save note"}
              </button>
            </div>
          </form>
        )}
      </Section>

      {/* Audit trail */}
      <Section title="Audit trail" icon={<History className="size-4 text-muted-foreground" aria-hidden="true" />}>
        <ol className="space-y-1.5 text-sm">
          {inc.audit.map((a, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <time className="text-xs text-muted-foreground">{fmtFull(a.at)}</time>
              <span className="text-foreground">{a.text}</span>
              <span className="text-xs text-muted-foreground">— {a.by}</span>
              {a.note && <span className="w-full pl-0 text-xs text-muted-foreground sm:pl-4">“{a.note}”</span>}
            </li>
          ))}
        </ol>
      </Section>

      {/* Danger zone */}
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/20 p-4">
        <div>
          <p className="text-sm font-medium text-foreground">Delete incident records</p>
          <p className="text-xs text-muted-foreground">Permanently removes these {inc.events.length} event record{inc.events.length > 1 ? "s" : ""}, notes and history. Cannot be undone.</p>
        </div>
        <button type="button" onClick={deleteRecords} disabled={busy}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
            confirmDelete ? "bg-destructive text-white hover:bg-destructive/90" : "text-destructive hover:bg-destructive/10"
          }`}>
          <Trash2 className="size-4" aria-hidden="true" />
          {confirmDelete ? "Click again to delete permanently" : "Delete records"}
        </button>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type Range = "today" | "7d" | "30d" | "all" | "custom";
const RANGE_LABEL: Record<Range, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time", custom: "Custom range" };

function rangeBounds(r: Range, from: string, to: string): [number, number] {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (r === "today") return [start.getTime(), Infinity];
  if (r === "7d") { start.setDate(start.getDate() - 6); return [start.getTime(), Infinity]; }
  if (r === "30d") { start.setDate(start.getDate() - 29); return [start.getTime(), Infinity]; }
  if (r === "custom") {
    const a = from ? new Date(`${from}T00:00:00`).getTime() : 0;
    const b = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
    return [a, b];
  }
  return [0, Infinity];
}

const selectCls = "h-[38px] w-full cursor-pointer appearance-none rounded-xl border border-border bg-card pl-9 pr-8 text-sm text-foreground focus:border-primary focus:outline-none";

export function AdminIncidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<Range>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "fall" | "sos">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | IncidentStatus>("all");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [deliveryFilter, setDeliveryFilter] = useState<"all" | DeliveryState>("all");
  const [sort, setSort] = useState<"newest" | "priority">("priority");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const tableTopRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let events: any = {}, families: any = {}, devices: any = {}, records: any = {};
    const loaded = { events: false, families: false };
    const recompute = () => {
      setIncidents(buildIncidents(events, families, devices, records));
      if (loaded.events && loaded.families) setLoading(false);
    };
    const fail = (what: string) => (err: any) => { console.error(`Failed to load ${what}`, err); setLoading(false); };
    const unsubs = [
      onValue(ref(db, "events"), (s) => { events = s.val() || {}; loaded.events = true; recompute(); }, fail("events")),
      onValue(ref(db, "families"), (s) => { families = s.val() || {}; loaded.families = true; recompute(); }, fail("families")),
      onValue(ref(db, "devices"), (s) => { devices = s.val() || {}; recompute(); }, fail("devices")),
      onValue(ref(db, "admin/incidents"), (s) => { records = s.val() || {}; recompute(); }, fail("incident records")),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const deviceOptions = useMemo(() => {
    const m = new Map<string, string>();
    incidents.forEach((i) => m.set(i.deviceId, i.patientName));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [incidents]);

  const filtered = useMemo(() => {
    const [a, b] = rangeBounds(range, from, to);
    const q = search.trim().toLowerCase();
    const list = incidents.filter((i) => {
      if (i.latestActivity.getTime() < a || i.startedAt.getTime() > b) return false;
      if (typeFilter !== "all" && !i.kinds.includes(typeFilter)) return false;
      if (statusFilter === "active" && !["Open", "Acknowledged", "Responding"].includes(i.status)) return false;
      if (statusFilter !== "all" && statusFilter !== "active" && i.status !== statusFilter) return false;
      if (deviceFilter !== "all" && i.deviceId !== deviceFilter) return false;
      if (deliveryFilter !== "all" && i.delivery !== deliveryFilter) return false;
      if (q && !(
        i.patientName.toLowerCase().includes(q) || i.deviceId.toLowerCase().includes(q) ||
        i.typeLabel.toLowerCase().includes(q) || (i.assignedTo || "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
    return list.sort((x, y) =>
      sort === "priority"
        ? y.priority - x.priority || y.latestActivity.getTime() - x.latestActivity.getTime()
        : y.latestActivity.getTime() - x.latestActivity.getTime());
  }, [incidents, range, from, to, search, typeFilter, statusFilter, deviceFilter, deliveryFilter, sort]);

  const activeCount = filtered.filter((i) => ["Open", "Acknowledged", "Responding"].includes(i.status)).length;
  const filtersOn = search || range !== "all" || typeFilter !== "all" || statusFilter !== "all" || deviceFilter !== "all" || deliveryFilter !== "all";

  useEffect(() => { setPage(1); setExpanded(null); }, [search, range, from, to, typeFilter, statusFilter, deviceFilter, deliveryFilter, sort]);
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

  const selected = incidents.find((i) => i.id === selectedId) ?? null;
  const clearFilters = () => {
    setSearch(""); setRange("all"); setFrom(""); setTo(""); setTypeFilter("all");
    setStatusFilter("all"); setDeviceFilter("all"); setDeliveryFilter("all");
  };

  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));

  const ActionButtons = ({ inc }: { inc: Incident }) => {
    const open = expanded === inc.id;
    return (
      <div className="flex items-center justify-end gap-1">
        <button type="button" onClick={() => toggle(inc.id)} aria-expanded={open} aria-controls={`inc-tl-${inc.id}`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Timeline {open ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => setSelectedId(inc.id)}
          className="whitespace-nowrap rounded-lg px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Details<span className="sr-only"> for {inc.typeLabel} incident, {inc.patientName}</span>
        </button>
      </div>
    );
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 md:p-8">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">Incidents</h1>
          <p className="text-sm text-muted-foreground">
            System-wide incident timeline. Events from the same device within {GROUP_WINDOW_MS / 60000} minutes are grouped into one incident.
          </p>
        </div>

        {/* Filters */}
        <div className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-search" className="sr-only">Search incidents</label>
              <input id="inc-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search person, device, type or responder…"
                className="h-[38px] w-full rounded-xl border border-border bg-card pl-9 pr-4 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-range" className="sr-only">Date range</label>
              <select id="inc-range" value={range} onChange={(e) => setRange(e.target.value as Range)} className={selectCls}>
                {(Object.keys(RANGE_LABEL) as Range[]).map((r) => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
              </select>
            </div>
            <div className="relative">
              <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-sort" className="sr-only">Sort incidents</label>
              <select id="inc-sort" value={sort} onChange={(e) => setSort(e.target.value as any)} className={selectCls}>
                <option value="priority">Highest priority first</option>
                <option value="newest">Newest activity first</option>
              </select>
            </div>
          </div>

          {range === "custom" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm" />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm" />
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-type" className="sr-only">Event type</label>
              <select id="inc-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className={selectCls}>
                <option value="all">All event types</option>
                <option value="fall">Includes a fall</option>
                <option value="sos">Includes an SOS</option>
              </select>
            </div>
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-status" className="sr-only">Incident status</label>
              <select id="inc-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className={selectCls}>
                <option value="all">All statuses</option>
                <option value="active">Active (open, acknowledged, responding)</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-device" className="sr-only">Person or device</label>
              <select id="inc-device" value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)} className={selectCls}>
                <option value="all">All people & devices</option>
                {deviceOptions.map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}
              </select>
            </div>
            <div className="relative">
              <Send className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-delivery" className="sr-only">Alert delivery outcome</label>
              <select id="inc-delivery" value={deliveryFilter} onChange={(e) => setDeliveryFilter(e.target.value as any)} className={selectCls}>
                <option value="all">Any delivery outcome</option>
                {DELIVERY_STATES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <span role="status">
              {filtered.length} incident{filtered.length === 1 ? "" : "s"} · {activeCount} active
            </span>
            {filtersOn && (
              <button type="button" onClick={clearFilters} className="font-medium text-primary hover:underline">Clear filters</button>
            )}
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={5} />
        ) : (
          <div ref={tableTopRef} className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Desktop table */}
            <div className="hidden w-full overflow-x-auto lg:block">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <caption className="sr-only">Incidents, {sort === "priority" ? "highest priority first" : "newest activity first"}</caption>
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Severity</th>
                    <th scope="col" className="px-4 py-3 font-medium">Incident</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Activity</th>
                    <th scope="col" className="px-4 py-3 font-medium">Location</th>
                    <th scope="col" className="px-4 py-3 font-medium">Alert delivery</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                      {filtersOn ? "No incidents match these filters" : "No incidents recorded"}
                    </td></tr>
                  ) : pageRows.map((inc) => {
                    const open = expanded === inc.id;
                    const href = deliveryHref(inc.deliveryLinkEvent);
                    return (
                      <Fragment key={inc.id}>
                        <tr className={`align-top transition-colors hover:bg-muted/40 ${open ? "bg-muted/30" : ""}`}>
                          <td className="px-4 py-3"><SeverityBadge severity={inc.severity} reason={inc.severityReason} /></td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{inc.typeLabel}</p>
                            <p className="text-foreground">{inc.patientName}</p>
                            <p className="font-mono text-xs text-muted-foreground">{inc.deviceId}</p>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={inc.status} />
                            <p className="mt-1 text-xs text-muted-foreground">{inc.assignedTo ? `Responder: ${inc.assignedTo}` : "Unassigned"}</p>
                            <p className="text-[11px] text-muted-foreground">Updated {relTime(inc.updatedAt)}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-foreground">{inc.events.length} event{inc.events.length > 1 ? "s" : ""}</p>
                            <p className="text-xs text-muted-foreground" title={fmtFull(inc.latestActivity)}>Latest {relTime(inc.latestActivity)}</p>
                            <p className="text-[11px] text-muted-foreground">{fmt(inc.latestActivity)}</p>
                          </td>
                          <td className="max-w-[220px] px-4 py-3"><LocationCell loc={inc.location} /></td>
                          <td className="px-4 py-3">
                            <DeliveryBadge state={inc.delivery} />
                            <p className="mt-1 text-[11px] text-muted-foreground">{inc.deliveryNote}</p>
                            {href && (
                              <Link to={href} className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                                Channel details <ExternalLink className="size-3" aria-hidden="true" />
                              </Link>
                            )}
                          </td>
                          <td className="px-4 py-3"><ActionButtons inc={inc} /></td>
                        </tr>
                        {open && (
                          <tr id={`inc-tl-${inc.id}`} className="bg-muted/20">
                            <td colSpan={7} className="px-6 py-4">
                              <p className="mb-3 text-xs font-medium text-muted-foreground">Event timeline · oldest first</p>
                              <EventTimeline inc={inc} compact />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards: small & medium screens */}
            <ul className="divide-y divide-border lg:hidden" aria-label="Incidents">
              {pageRows.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {filtersOn ? "No incidents match these filters" : "No incidents recorded"}
                </li>
              ) : pageRows.map((inc) => {
                const open = expanded === inc.id;
                const href = deliveryHref(inc.deliveryLinkEvent);
                return (
                  <li key={inc.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{inc.typeLabel} · {inc.patientName}</p>
                        <p className="font-mono text-xs text-muted-foreground">{inc.deviceId}</p>
                      </div>
                      <SeverityBadge severity={inc.severity} reason={inc.severityReason} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={inc.status} />
                      <span className="text-xs text-muted-foreground">{inc.assignedTo ? `Responder: ${inc.assignedTo}` : "Unassigned"} · updated {relTime(inc.updatedAt)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {inc.events.length} event{inc.events.length > 1 ? "s" : ""} · latest {relTime(inc.latestActivity)} ({fmt(inc.latestActivity)})
                    </p>
                    <LocationCell loc={inc.location} />
                    <div className="flex flex-wrap items-center gap-2">
                      <DeliveryBadge state={inc.delivery} />
                      <span className="text-[11px] text-muted-foreground">{inc.deliveryNote}</span>
                      {href && (
                        <Link to={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          Channel details <ExternalLink className="size-3" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                    <ActionButtons inc={inc} />
                    {open && (
                      <div id={`inc-tl-${inc.id}`} className="rounded-lg bg-muted/20 p-3">
                        <EventTimeline inc={inc} compact />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {filtered.length > 0 && (
              <nav aria-label="Incident pages" className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-4 sm:flex-row sm:px-6">
                <span className="text-sm text-muted-foreground">
                  Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length} • {sort === "priority" ? "Highest priority first" : "Newest first"}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                    {pageNumbers.map((n) => (
                      <button key={n} onClick={() => goToPage(n)} aria-current={n === currentPage ? "page" : undefined}
                        className={`min-w-9 rounded-lg border px-3 py-1.5 text-sm ${n === currentPage ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-muted"}`}>{n}</button>
                    ))}
                    <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">Next</button>
                  </div>
                )}
              </nav>
            )}
          </div>
        )}

        {/* Legend */}
        <section aria-label="How incidents are classified" className="grid gap-3 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground md:grid-cols-3">
          <div>
            <p className="mb-1 font-medium text-foreground">Severity</p>
            <p><span className="font-medium text-foreground">Critical</span> — confirmed fall, fall + SOS, or 3+ alerts. <span className="font-medium text-foreground">High</span> — a fall or SOS. <span className="font-medium text-foreground">Low</span> — every event cancelled by the wearer.</p>
          </div>
          <div>
            <p className="mb-1 font-medium text-foreground">Priority order</p>
            <p>Open → Acknowledged → Responding → closed, then severity, then failed or unconfigured alert delivery, then most recent.</p>
          </div>
          <div>
            <p className="mb-1 font-medium text-foreground">Alert delivery</p>
            <p><span className="font-medium text-foreground">Delivered</span> only when the carrier confirmed an SMS or a call was answered. <span className="font-medium text-foreground">Not reported</span> means the hub sent no receipt — it is never counted as delivered.</p>
          </div>
        </section>
      </div>

      {/* Complete incident view */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.typeLabel} — {selected.patientName}</DialogTitle>
                <DialogDescription>
                  Incident <span className="font-mono">{selected.id}</span> · device <span className="font-mono">{selected.deviceId}</span>
                </DialogDescription>
              </DialogHeader>
              <IncidentView key={selected.id} inc={selected} onClose={() => setSelectedId(null)} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
