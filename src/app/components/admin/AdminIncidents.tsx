import { useEffect, useMemo, useRef, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue } from "../../../lib/db";
import { SkeletonTable } from "../ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Search, Filter, CalendarDays } from "lucide-react";
import { familyDeviceId, personName, flattenEvents } from "./adminData";
import { buildRows, type AlertRow } from "./deliveryModel";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type EventKind = "fall" | "sos" | "cancelled";
type DeliveryState = "Delivered" | "Failed" | "—";

/** Events on the same device less than this far apart belong to one incident. */
const GROUP_WINDOW_MS = 30 * 60 * 1000;

interface LocInfo {
  kind: "coords" | "text" | "unavailable";
  text: string;
  mapUrl: string | null;
}

interface IncEvent {
  deviceId: string;
  eventId: string;
  date: Date;
  kind: EventKind;
  label: string;
  location: LocInfo | null;
  delivery: DeliveryState;
}

interface Incident {
  id: string;
  deviceId: string;
  patientName: string;
  events: IncEvent[]; // oldest -> newest
  typeLabel: string;
  kinds: EventKind[];
  startedAt: Date;
  latestActivity: Date;
  delivery: DeliveryState;
  location: { primary: string; detail: string; mapUrl: string | null; found: boolean };
  recipients: { name: string; phone: string }[];
}

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

function eventKind(raw: any): EventKind {
  if (raw?.status === "cancelled" || raw?.cancelled === true) return "cancelled";
  const t = String(raw?.type || "").toLowerCase();
  if (t === "sos" || raw?.status === "emergency") return "sos";
  return "fall";
}

function eventLabel(kind: EventKind): string {
  if (kind === "fall") return "Fall detected";
  if (kind === "sos") return "Manual SOS";
  return "Cancelled";
}

function validCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

function mapLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Turns whatever the hub stored into a location. Returns null when nothing was reported. */
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

/* ------------------------------------------------------------------ */
/* Building incidents                                                  */
/* ------------------------------------------------------------------ */

function buildIncidents(events: any, families: any, devices: any): Incident[] {
  const familyEntries = Object.entries(families || {}) as [string, any][];
  const deliveryRows = new Map<string, AlertRow>();
  buildRows(events, families).forEach((r) => deliveryRows.set(r.id, r));

  const byDevice = new Map<string, IncEvent[]>();
  flattenEvents(events).forEach((ev) => {
    const kind = eventKind(ev.raw);
    const row = deliveryRows.get(`${ev.deviceId}_${ev.eventId}`);
    const item: IncEvent = {
      deviceId: ev.deviceId,
      eventId: ev.eventId,
      date: ev.date,
      kind,
      label: eventLabel(kind),
      location: parseLocation(ev.raw.location),
      delivery: kind === "cancelled" || !row ? "—" : row.delivered ? "Delivered" : "Failed",
    };
    if (!byDevice.has(ev.deviceId)) byDevice.set(ev.deviceId, []);
    byDevice.get(ev.deviceId)!.push(item);
  });

  const incidents: Incident[] = [];

  byDevice.forEach((list, deviceId) => {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    const family = familyEntries.find(([, f]) => familyDeviceId(f) === deviceId)?.[1] ?? null;
    const device = devices?.[deviceId] ?? null;

    const groups: IncEvent[][] = [];
    list.forEach((ev) => {
      const cur = groups[groups.length - 1];
      if (cur && ev.date.getTime() - cur[cur.length - 1].date.getTime() <= GROUP_WINDOW_MS) cur.push(ev);
      else groups.push([ev]);
    });

    groups.forEach((evs) => {
      const live = evs.filter((e) => e.kind !== "cancelled");
      const kinds = [...new Set(evs.map((e) => e.kind))];
      const typeLabel = live.length === 0 ? "Cancelled"
        : kinds.includes("fall") && kinds.includes("sos") ? "Fall + Manual SOS"
        : kinds.includes("fall") ? "Fall" : "Manual SOS";

      let delivery: DeliveryState = "—";
      if (live.some((e) => e.delivery === "Delivered")) delivery = "Delivered";
      else if (live.some((e) => e.delivery === "Failed")) delivery = "Failed";

      // Location: latest event that reported one, otherwise the device's last known position
      const reported = [...evs].reverse().find((e) => e.location && e.location.kind !== "unavailable");
      const unavailable = [...evs].reverse().find((e) => e.location?.kind === "unavailable");
      const devLoc = parseLocation(device?.location);
      let location: Incident["location"];
      if (reported) {
        location = { primary: reported.location!.text, detail: "Reported with the alert", mapUrl: reported.location!.mapUrl, found: true };
      } else if (devLoc && devLoc.kind === "coords") {
        location = { primary: devLoc.text, detail: "Last known location of the device", mapUrl: devLoc.mapUrl, found: true };
      } else if (unavailable) {
        location = { primary: unavailable.location!.text, detail: "No GPS fix when the alert was raised", mapUrl: null, found: false };
      } else {
        location = { primary: "Not reported", detail: "The hub sent no location", mapUrl: null, found: false };
      }

      const row = live.length ? deliveryRows.get(`${deviceId}_${live[live.length - 1].eventId}`) : undefined;
      const recipients = (row?.recipients ?? []).map((r) => ({ name: r.name, phone: r.phone }));

      incidents.push({
        id: `${deviceId}_${evs[0].eventId}`,
        deviceId,
        patientName: family ? personName(family, device) : (device?.user?.name || "Unassigned device"),
        events: evs,
        typeLabel,
        kinds,
        startedAt: evs[0].date,
        latestActivity: evs[evs.length - 1].date,
        delivery,
        location,
        recipients,
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

function TypeBadge({ label }: { label: string }) {
  const cls = label === "Cancelled" ? "bg-muted text-muted-foreground"
    : label === "Manual SOS" ? "bg-warning/10 text-warning"
    : "bg-destructive/10 text-destructive";
  return <span className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function DeliveryBadge({ state }: { state: DeliveryState }) {
  if (state === "—") return <span className="text-xs text-muted-foreground">—</span>;
  const cls = state === "Delivered" ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30";
  return <span className={`inline-flex whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-medium ${cls}`}>{state}</span>;
}

function LocationCell({ loc }: { loc: Incident["location"] }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <div className="min-w-0">
        {loc.mapUrl ? (
          <a href={loc.mapUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">
            {loc.primary}<span className="sr-only"> (opens Google Maps in a new tab)</span>
          </a>
        ) : (
          <span className="text-xs font-medium text-foreground">{loc.primary}</span>
        )}
        <p className="text-[11px] text-muted-foreground">{loc.detail}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Incident details (popup)                                            */
/* ------------------------------------------------------------------ */

function IncidentView({ inc }: { inc: Incident }) {
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Person monitored</dt>
          <dd className="font-medium text-foreground">{inc.patientName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Device MAC address</dt>
          <dd className="font-mono font-bold text-foreground">{inc.deviceId}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Started</dt>
          <dd className="text-foreground">{fmtFull(inc.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Alert delivery</dt>
          <dd className="mt-0.5"><DeliveryBadge state={inc.delivery} /></dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="mb-1 text-xs text-muted-foreground">Location</dt>
          <dd><LocationCell loc={inc.location} /></dd>
        </div>
        {inc.recipients.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Alerted</dt>
            <dd className="text-foreground">
              {inc.recipients.map((r, i) => (
                <span key={i} className="mr-3 inline-block">{r.name} <span className="text-muted-foreground">{r.phone}</span></span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Events</h3>
        <ol className="relative space-y-3 border-l border-border pl-4" aria-label="Event timeline, oldest first">
          {inc.events.map((e) => (
            <li key={e.eventId} className="relative">
              <span
                className={`absolute -left-[21px] top-1.5 flex size-2.5 rounded-full ring-4 ring-card ${
                  e.kind === "cancelled" ? "bg-muted-foreground/50" : e.kind === "fall" ? "bg-destructive" : "bg-warning"
                }`}
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <time className="text-xs text-muted-foreground" dateTime={e.date.toISOString()}>{fmtFull(e.date)}</time>
                <span className="font-medium text-foreground">{e.label}</span>
                <DeliveryBadge state={e.delivery} />
              </div>
            </li>
          ))}
        </ol>
      </div>
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
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

export function AdminIncidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<Range>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | EventKind>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<"all" | "Delivered" | "Failed">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const tableTopRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let events: any = {}, families: any = {}, devices: any = {};
    const loaded = { events: false, families: false };
    const recompute = () => {
      setIncidents(buildIncidents(events, families, devices));
      if (loaded.events && loaded.families) setLoading(false);
    };
    const fail = (what: string) => (err: any) => { console.error(`Failed to load ${what}`, err); setLoading(false); };
    const unsubs = [
      onValue(ref(db, "events"), (s) => { events = s.val() || {}; loaded.events = true; recompute(); }, fail("events")),
      onValue(ref(db, "families"), (s) => { families = s.val() || {}; loaded.families = true; recompute(); }, fail("families")),
      onValue(ref(db, "devices"), (s) => { devices = s.val() || {}; recompute(); }, fail("devices")),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const filtered = useMemo(() => {
    const [a, b] = rangeBounds(range, from, to);
    const q = norm(search);
    return incidents
      .filter((i) => {
        if (i.latestActivity.getTime() < a || i.startedAt.getTime() > b) return false;
        if (typeFilter !== "all" && !i.kinds.includes(typeFilter)) return false;
        if (deliveryFilter !== "all" && i.delivery !== deliveryFilter) return false;
        if (q && !(norm(i.patientName).includes(q) || norm(i.deviceId).includes(q) || norm(i.typeLabel).includes(q))) return false;
        return true;
      })
      .sort((x, y) => y.latestActivity.getTime() - x.latestActivity.getTime());
  }, [incidents, range, from, to, search, typeFilter, deliveryFilter]);

  const filtersOn = search || range !== "all" || typeFilter !== "all" || deliveryFilter !== "all";

  useEffect(() => { setPage(1); }, [search, range, from, to, typeFilter, deliveryFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const firstNum = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const pageNumbers = Array.from({ length: Math.min(5, totalPages) }, (_, i) => firstNum + i);
  const goToPage = (n: number) => {
    setPage(Math.max(1, Math.min(totalPages, n)));
    tableTopRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const selected = incidents.find((i) => i.id === selectedId) ?? null;
  const clearFilters = () => { setSearch(""); setRange("all"); setFrom(""); setTo(""); setTypeFilter("all"); setDeliveryFilter("all"); };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 md:p-8">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">Incidents</h1>
          <p className="text-sm text-muted-foreground">
            Every fall, Manual SOS and cancelled alert. Events from the same device within {GROUP_WINDOW_MS / 60000} minutes are grouped into one incident.
          </p>
        </div>

        {/* Filters */}
        <div className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-search" className="sr-only">Search incidents</label>
              <input id="inc-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search person or MAC address"
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
              <Filter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-type" className="sr-only">Event type</label>
              <select id="inc-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className={selectCls}>
                <option value="all">All event types</option>
                <option value="fall">Includes a fall</option>
                <option value="sos">Includes a Manual SOS</option>
                <option value="cancelled">Includes a cancelled alert</option>
              </select>
            </div>
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="inc-delivery" className="sr-only">Alert delivery</label>
              <select id="inc-delivery" value={deliveryFilter} onChange={(e) => setDeliveryFilter(e.target.value as any)} className={selectCls}>
                <option value="all">Any alert delivery</option>
                <option value="Delivered">Delivered</option>
                <option value="Failed">Failed</option>
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

          <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
            <span>{filtered.length} incident{filtered.length === 1 ? "" : "s"}</span>
            {filtersOn && (
              <button type="button" onClick={clearFilters} className="font-medium text-primary hover:underline">Clear filters</button>
            )}
          </div>
        </div>

        {/* Table / list */}
        {loading ? (
          <SkeletonTable rows={5} />
        ) : (
          <div ref={tableTopRef} className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Desktop table */}
            <div className="hidden w-full overflow-x-auto md:block">
              <table className="w-full min-w-[820px] text-left text-sm">
                <caption className="sr-only">Incidents, newest first</caption>
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Time</th>
                    <th scope="col" className="px-4 py-3 font-medium">Person / Device</th>
                    <th scope="col" className="px-4 py-3 font-medium">Type</th>
                    <th scope="col" className="px-4 py-3 font-medium">Location</th>
                    <th scope="col" className="px-4 py-3 font-medium">Alert delivery</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                        {filtersOn ? "No incidents match these filters" : "No incidents recorded"}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((inc) => (
                      <tr key={inc.id} className="align-top transition-colors hover:bg-muted/40">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmt(inc.latestActivity)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{inc.patientName}</span>
                            <span className="font-mono text-xs font-bold text-foreground">{inc.deviceId}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3"><TypeBadge label={inc.typeLabel} /></td>
                        <td className="max-w-[260px] px-4 py-3"><LocationCell loc={inc.location} /></td>
                        <td className="px-4 py-3"><DeliveryBadge state={inc.delivery} /></td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => setSelectedId(inc.id)}
                            className="whitespace-nowrap rounded-lg px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            Details<span className="sr-only"> for {inc.typeLabel} incident, {inc.patientName}</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="divide-y divide-border md:hidden" aria-label="Incidents">
              {pageRows.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {filtersOn ? "No incidents match these filters" : "No incidents recorded"}
                </li>
              ) : (
                pageRows.map((inc) => (
                  <li key={inc.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{inc.patientName}</p>
                        <p className="font-mono text-xs font-bold text-foreground">{inc.deviceId}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{fmt(inc.latestActivity)}</p>
                      </div>
                      <TypeBadge label={inc.typeLabel} />
                    </div>
                    <LocationCell loc={inc.location} />
                    <div className="flex items-center justify-between gap-2">
                      <DeliveryBadge state={inc.delivery} />
                      <button type="button" onClick={() => setSelectedId(inc.id)}
                        className="whitespace-nowrap rounded-lg px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10">
                        Details
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>

            {/* Pagination */}
            {filtered.length > 0 && (
              <nav aria-label="Incident pages" className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-4 sm:flex-row sm:px-6">
                <span className="text-sm text-muted-foreground">
                  Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length} • Newest first
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">
                      Previous
                    </button>
                    {pageNumbers.map((n) => (
                      <button key={n} onClick={() => goToPage(n)} aria-current={n === currentPage ? "page" : undefined}
                        className={`min-w-9 rounded-lg border px-3 py-1.5 text-sm ${
                          n === currentPage ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-muted"
                        }`}>
                        {n}
                      </button>
                    ))}
                    <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">
                      Next
                    </button>
                  </div>
                )}
              </nav>
            )}
          </div>
        )}
      </div>

      {/* Incident details */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&>button:last-child]:hidden">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.typeLabel} — {selected.patientName}</DialogTitle>
                <DialogDescription>
                  Device <span className="font-mono font-bold">{selected.deviceId}</span>
                </DialogDescription>
              </DialogHeader>
              <IncidentView key={selected.id} inc={selected} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
