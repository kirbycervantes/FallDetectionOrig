import { useState, useEffect, useMemo } from 'react';
import { MapPin, AlertTriangle, CheckCircle, Hand, XCircle, CloudOff, RefreshCw, Download, Navigation } from 'lucide-react';
import { resolveEventTime, validDate } from '../../lib/time';
import { db, ref, onValue } from '../../lib/db';
import { SkeletonList } from './ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { eventKind, isCancelled, isStoppedQuietly, kindLabel, type EventKind } from '../../lib/events';
import { parseResponse, saveResponse, type EventResponse, type ResponseStatus } from '../../lib/responses';
import { downloadCsv, csvDate, csvTime } from '../../lib/exportCsv';
import { channelKind, normalizeStatus } from './admin/deliveryModel';

interface FallEvent {
  id: string;
  timestamp: Date;
  kind: EventKind;
  cancelled: boolean;
  quiet: boolean;
  cancelledAt: Date | null;
  offline: boolean;
  location: unknown;
  response: EventResponse | null;
  /** contacts the hub could not text / contacts it tried to text */
  smsFailed: number;
  smsTotal: number;
}

interface FallHistoryProps {
  deviceId: string;
  /** read-only view (administrator looking at a family): no buttons */
  readOnly?: boolean;
  /** the signed-in caregiver, used for "I'm on my way" / "Handled" */
  responder?: { uid: string; name: string };
  /** family id: its registered emergency contacts are the people you can pick as "on the way" */
  familyId?: string;
}

type TypeFilter = 'all' | 'fall' | 'sos' | 'cancelled';
type DateFilter = 'all' | 'today' | '7d' | '30d';
type ResponseFilter = 'any' | 'none' | 'on_my_way' | 'handled' | 'sms_failed';

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'fall', label: 'Falls' },
  { id: 'sos', label: 'Manual SOS' },
  { id: 'cancelled', label: 'Cancelled' },
];

const RESPONSE_FILTERS: { id: ResponseFilter; label: string }[] = [
  { id: 'none', label: 'No response yet' },
  { id: 'on_my_way', label: 'On the way' },
  { id: 'handled', label: 'Handled' },
  { id: 'sms_failed', label: 'SMS failed' },
];

const DATE_FILTERS: { id: DateFilter; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

// Convert Firebase location data into text React can safely display.
function formatEventLocation(location: unknown): string {
  if (location == null) return 'Location unavailable';
  if (typeof location === 'string') return location;
  if (typeof location === 'object') {
    const c = location as { lat?: unknown; lng?: unknown };
    if (typeof c.lat === 'number' && typeof c.lng === 'number' && !(c.lat === 0 && c.lng === 0)) {
      return `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
    }
  }
  return 'Location unavailable';
}

// How many contacts the hub reported a failed SMS for (events/<device>/<event>/delivery/contactN/sms)
function smsCounts(raw: any, cancelled: boolean): { failed: number; total: number } {
  if (cancelled || !raw?.delivery || typeof raw.delivery !== 'object') return { failed: 0, total: 0 };
  const list = Object.values(raw.delivery).filter((d: any) => d && typeof d === 'object') as any[];
  const failed = list.filter((d) => channelKind(normalizeStatus(d.sms?.status)) === 'failure').length;
  return { failed, total: list.length };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function FallHistory({ deviceId, readOnly = false, responder, familyId }: FallHistoryProps) {
  const [events, setEvents] = useState<FallEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [respFilter, setRespFilter] = useState<ResponseFilter>('any');
  const [refreshing, setRefreshing] = useState(false);
  // who is on the way / who handled it: picked from the registered emergency contacts
  const [picker, setPicker] = useState<{ eventId: string; mode: ResponseStatus; person: string; step: 'choose' | 'confirm' } | null>(null);
  const [contactNames, setContactNames] = useState<string[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  // Clears the filters and goes back to the first page (events themselves are already live)
  const handleRefresh = () => {
    setTypeFilter('all');
    setDateFilter('all');
    setRespFilter('any');
    setPage(1);
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  };
  const PAGE_SIZE = 10;

  useEffect(() => {
    const unsubscribe = onValue(
      ref(db, `events/${deviceId}`),
      (snapshot) => {
        const data = snapshot.val() || {};
        const parsed: FallEvent[] = Object.keys(data)
          .filter((key) => data[key] && typeof data[key] === 'object')
          .map((key) => {
            const raw = data[key];
            const cancelled = isCancelled(raw);
            const sms = smsCounts(raw, cancelled);
            return {
              id: key,
              timestamp: resolveEventTime(key, raw.timestamp),
              kind: eventKind(raw),
              cancelled,
              quiet: isStoppedQuietly(raw),
              cancelledAt: validDate(raw.cancelledAt),
              offline: raw.offline === true,
              location: raw.location ?? null,
              response: parseResponse(raw),
              smsFailed: sms.failed,
              smsTotal: sms.total,
            };
          })
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        setEvents((prev) => {
          if (parsed.length > prev.length) setPage(1);
          return parsed;
        });
        setLoading(false);
      },
      (error) => {
        console.error('Error loading fall history:', error);
        setEvents([]);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [deviceId]);

  useEffect(() => {
    if (!familyId) { setContactNames([]); return; }
    const unsub = onValue(ref(db, `families/${familyId}/contacts`), (snap) => {
      const v = snap.val() || {};
      const names = Object.values(v)
        .map((c: any) => (c && typeof c === 'object' ? String(c.name ?? '').trim() : ''))
        .filter(Boolean);
      setContactNames([...new Set(names)]);
    }, () => setContactNames([]));
    return () => unsub();
  }, [familyId]);

  // the people you can choose from: the registered contacts, plus the signed-in account if it is not one of them
  const personOptions = useMemo(() => {
    const list = [...contactNames];
    if (responder?.name && !list.some((n) => n.toLowerCase() === responder.name.toLowerCase())) list.push(responder.name);
    return list;
  }, [contactNames, responder?.name]);

  const filtered = useMemo(() => {
    const today = startOfToday();
    const minTime =
      dateFilter === 'today' ? today :
      dateFilter === '7d' ? today - 6 * 86400000 :
      dateFilter === '30d' ? today - 29 * 86400000 :
      0;
    return events.filter((e) => {
      if (e.timestamp.getTime() < minTime) return false;
      if (typeFilter === 'cancelled' && !e.cancelled) return false;
      if (typeFilter === 'fall' && !(e.kind === 'fall' && !e.cancelled)) return false;
      if (typeFilter === 'sos' && !(e.kind === 'sos' && !e.cancelled)) return false;
      // response / SMS filter: only for alerts that were sent (a cancelled alert has no response)
      if (respFilter !== 'any') {
        if (e.cancelled) return false;
        if (respFilter === 'none' && e.response) return false;
        if (respFilter === 'on_my_way' && e.response?.status !== 'on_my_way') return false;
        if (respFilter === 'handled' && e.response?.status !== 'handled') return false;
        if (respFilter === 'sms_failed' && e.smsFailed === 0) return false;
      }
      return true;
    });
  }, [events, typeFilter, dateFilter, respFilter]);

  // reset to page 1 when a filter changes
  useEffect(() => setPage(1), [typeFilter, dateFilter, respFilter]);

  const openPicker = (eventId: string, mode: ResponseStatus, current?: string) => {
    const keep = current && personOptions.includes(current) ? current : '';
    setActionError('');
    setPicker({ eventId, mode, person: keep || (personOptions.length === 1 ? personOptions[0] : ''), step: 'choose' });
  };

  const respond = async (eventId: string, status: ResponseStatus, person: string) => {
    if (!responder || readOnly || !person) return;
    setActionError('');
    setSavingId(eventId);
    try {
      await saveResponse(deviceId, eventId, status, { uid: responder.uid, account: responder.name, person });
      setPicker(null);
    } catch (err) {
      console.error('Could not save the response:', err);
      setActionError('Could not save your response. Check your connection and try again.');
    } finally {
      setSavingId(null);
    }
  };

  const handleExport = () => {
    const rows = filtered.map((e) => {
      const smsResult = e.cancelled ? 'n/a (cancelled)'
        : e.smsTotal === 0 ? 'No SMS record'
        : e.smsFailed === 0 ? 'Sent'
        : e.smsFailed === e.smsTotal ? 'Failed'
        : `Failed for ${e.smsFailed} of ${e.smsTotal} contacts`;
      const r = e.response;
      return [
        csvDate(e.timestamp),
        csvTime(e.timestamp),
        kindLabel(e.kind),
        e.cancelled ? (e.quiet ? 'Cancelled (no SMS)' : 'Cancelled') : 'Alert sent',
        smsResult,
        r ? (r.status === 'handled' ? 'Handled' : 'On my way') : e.cancelled ? '' : 'No response',
        r ? r.by : '',
        r?.at ? `${csvDate(r.at)} ${csvTime(r.at)}` : '',
      ];
    });
    downloadCsv(
      `carebeacon-incidents-${deviceId}-${csvDate(new Date())}.csv`,
      ['Date', 'Time', 'Type', 'Result', 'SMS', 'Response', 'Responded by', 'Responded at'],
      rows
    );
  };

  const pickerEvent = picker ? events.find((e) => e.id === picker.eventId) : undefined;

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-foreground">Incident History</h2>
          <p className="text-sm text-muted-foreground">Historical log of all recorded events</p>
        </div>
        <SkeletonList items={5} />
      </div>
    );
  }

  const now = new Date();
  const totalFalls = events.filter((e) => e.kind === 'fall' && !e.cancelled).length;
  const totalSos = events.filter((e) => e.kind === 'sos' && !e.cancelled).length;
  const thisMonth = events.filter(
    (e) =>
      !e.cancelled &&
      e.timestamp.getMonth() === now.getMonth() &&
      e.timestamp.getFullYear() === now.getFullYear()
  ).length;
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEvents = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const latestId = events[0]?.id;

  const respCount = (id: ResponseFilter) => {
    const sent = events.filter((e) => !e.cancelled);
    return id === 'none' ? sent.filter((e) => !e.response).length
      : id === 'on_my_way' ? sent.filter((e) => e.response?.status === 'on_my_way').length
      : id === 'handled' ? sent.filter((e) => e.response?.status === 'handled').length
      : id === 'sms_failed' ? sent.filter((e) => e.smsFailed > 0).length
      : sent.length;
  };

  const typeCount = (id: TypeFilter) =>
    id === 'all' ? events.length :
    id === 'cancelled' ? events.filter((e) => e.cancelled).length :
    events.filter((e) => e.kind === id && !e.cancelled).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-1 text-foreground">Incident History</h2>
        <p className="text-sm text-muted-foreground">Every fall, Manual SOS and cancelled alert from the wearable</p>
      </div>

      {/* Summary (no icons) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Falls', value: totalFalls, note: 'All time' },
          { label: 'Manual SOS', value: totalSos, note: 'All time' },
          { label: 'This Month', value: thisMonth, note: monthLabel },
        ].map((card) => (
          <div key={card.label} className="bg-card border border-border rounded-2xl px-5 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <span className="text-[11px] px-2 py-0.5 bg-muted text-muted-foreground rounded-md">{card.note}</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="bg-card border border-border rounded-2xl p-4 md:p-6 shadow-sm">
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-foreground">Event Timeline</h3>
            <span className="text-sm text-muted-foreground">
              {filtered.length} of {events.length}
            </span>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setTypeFilter(f.id)}
                  aria-pressed={typeFilter === f.id}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    typeFilter === f.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-foreground hover:bg-muted'
                  }`}
                >
                  {f.label} <span className="opacity-70">({typeCount(f.id)})</span>
                </button>
              ))}
            </div>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              aria-label="Filter by date"
              className="sm:ml-auto px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground"
            >
              {DATE_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <select
              value={respFilter}
              onChange={(e) => setRespFilter(e.target.value as ResponseFilter)}
              aria-label="Filter by response or SMS result"
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground"
            >
              <option value="any">Any response</option>
              {RESPONSE_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>{f.label} ({respCount(f.id)})</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="Refresh and reset filters"
              title="Refresh and reset filters"
              className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground hover:bg-muted transition-colors"
            >
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={filtered.length === 0}
              aria-label="Export the listed events as a CSV file"
              title="Export the listed events (follows the filters above) as a CSV file for Excel"
              className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="size-4" />
              Export CSV
            </button>
          </div>
        </div>

        {actionError && (
          <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionError}
          </p>
        )}

        <div className="space-y-3">
          {pageEvents.map((event) => {
            const tone = event.cancelled
              ? { box: 'bg-muted', icon: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' }
              : event.kind === 'sos'
              ? { box: 'bg-warning/10', icon: 'text-warning', badge: 'bg-warning/10 text-warning' }
              : { box: 'bg-destructive/10', icon: 'text-destructive', badge: 'bg-destructive/10 text-destructive' };
            const Icon = event.cancelled ? XCircle : event.kind === 'sos' ? Hand : AlertTriangle;
            const badge = event.cancelled
              ? (event.quiet ? 'Cancelled (no SMS)' : 'Cancelled')
              : event.kind === 'sos' ? 'Manual SOS' : 'Fall';

            return (
              <div
                key={event.id}
                className={`bg-background border rounded-xl p-4 md:p-5 transition-colors hover:border-primary/30 ${
                  event.id === latestId ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border'
                }`}
              >
                <div className="flex items-start gap-3 md:gap-4">
                  <div className={`shrink-0 p-2.5 rounded-lg ${tone.box}`}>
                    <Icon className={`size-5 ${tone.icon}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <p className="font-semibold mb-0.5 text-foreground flex flex-wrap items-center gap-2">
                          {kindLabel(event.kind)}
                          {event.cancelled && (
                            <span className="px-2 py-0.5 rounded-md bg-foreground text-background text-[11px] font-bold uppercase tracking-wide">
                              Cancelled
                            </span>
                          )}
                          {event.id === latestId && (
                            <span className="px-2 py-0.5 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold uppercase tracking-wide">
                              Latest
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground">{event.timestamp.toLocaleString()}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${tone.badge}`}>
                        {badge}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg min-w-0">
                        <MapPin className="size-4 text-muted-foreground shrink-0" />
                        <span className="text-xs text-foreground truncate">{formatEventLocation(event.location)}</span>
                      </div>
                      {event.cancelled && event.cancelledAt && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
                          <XCircle className="size-4 text-muted-foreground shrink-0" />
                          <span className="text-xs text-foreground">
                            Cancelled at {event.cancelledAt.toLocaleTimeString()}
                          </span>
                        </div>
                      )}
                      {event.offline && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
                          <CloudOff className="size-4 text-muted-foreground shrink-0" />
                          <span className="text-xs text-foreground">Happened offline, uploaded later</span>
                        </div>
                      )}
                      {!event.cancelled && event.smsFailed > 0 && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 rounded-lg">
                          <AlertTriangle className="size-4 text-destructive shrink-0" />
                          <span className="text-xs font-medium text-destructive">
                            {event.smsFailed === event.smsTotal
                              ? 'SMS failed - nobody was texted'
                              : `SMS failed for ${event.smsFailed} of ${event.smsTotal} contacts`}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Response: "I'm on my way" / "Handled" */}
                    {!event.cancelled && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                        {event.response ? (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                              event.response.status === 'handled' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
                            }`}
                          >
                            {event.response.status === 'handled'
                              ? <CheckCircle className="size-4 shrink-0" />
                              : <Navigation className="size-4 shrink-0" />}
                            {event.response.status === 'handled' ? 'Handled' : 'On the way'} - {event.response.by}
                            {event.response.at ? ` · ${event.response.at.toLocaleString()}` : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No one has responded yet</span>
                        )}

                        {!readOnly && responder && event.response?.status !== 'handled' && (
                          <span className="flex flex-wrap items-center gap-2">
                            {!event.response && (
                              <button
                                type="button"
                                onClick={() => openPicker(event.id, 'on_my_way')}
                                className="rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                              >
                                I'm on my way
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openPicker(event.id, 'handled', event.response?.by)}
                              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                            >
                              Handled
                            </button>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-6 pt-4 border-t border-border">
            <span className="text-sm text-muted-foreground">
              Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex flex-wrap items-center justify-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-sm text-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex p-6 bg-muted rounded-2xl mb-4">
              <CheckCircle className="size-12 text-muted-foreground" />
            </div>
            <p className="text-foreground font-medium">
              {events.length === 0 ? 'No incidents recorded' : 'No events match this filter'}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {events.length === 0 ? 'All systems operational' : 'Try another type or date range'}
            </p>
          </div>
        )}
      </div>
      {/* Pop-up: who is on the way / who handled it, then a confirmation */}
      <Dialog open={!!picker} onOpenChange={(o) => { if (!o && savingId === null) setPicker(null); }}>
        <DialogContent className="sm:max-w-md">
          {picker && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {picker.step === 'choose'
                    ? (picker.mode === 'on_my_way' ? 'Who is on the way?' : 'Who handled it?')
                    : (picker.mode === 'on_my_way' ? 'Confirm: on the way' : 'Confirm: handled')}
                </DialogTitle>
                <DialogDescription>
                  {pickerEvent ? `${kindLabel(pickerEvent.kind)} - ${pickerEvent.timestamp.toLocaleString()}` : 'Choose from the registered contacts'}
                </DialogDescription>
              </DialogHeader>

              {picker.step === 'choose' ? (
                <div className="space-y-4">
                  {personOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No registered contacts yet. Add one under Emergency Contacts first.
                    </p>
                  ) : (
                    <div role="radiogroup" aria-label="Registered contacts" className="space-y-2">
                      {personOptions.map((n) => (
                        <label
                          key={n}
                          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
                            picker.person === n ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                          }`}
                        >
                          <input
                            type="radio"
                            name="responder"
                            value={n}
                            checked={picker.person === n}
                            onChange={() => setPicker({ ...picker, person: n })}
                            className="size-4 accent-primary"
                          />
                          <span className="text-foreground">{n}{n === responder?.name ? ' (me)' : ''}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPicker(null)}
                      className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setPicker({ ...picker, step: 'confirm' })}
                      disabled={!picker.person}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-foreground">
                    {picker.mode === 'on_my_way'
                      ? <>Confirm that <strong>{picker.person}</strong> is on the way. Everyone with access to this account will see it.</>
                      : <>Mark this alert as handled by <strong>{picker.person}</strong>? Everyone with access to this account will see it.</>}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPicker({ ...picker, step: 'choose' })}
                      disabled={savingId === picker.eventId}
                      className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(picker.eventId, picker.mode, picker.person)}
                      disabled={savingId === picker.eventId}
                      className={`rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${
                        picker.mode === 'handled' ? 'bg-success' : 'bg-primary'
                      }`}
                    >
                      {savingId === picker.eventId ? 'Saving...' : 'Yes, confirm'}
                    </button>
                  </div>
                  {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
