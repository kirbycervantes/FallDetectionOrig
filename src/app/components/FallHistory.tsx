import { useState, useEffect, useMemo } from 'react';
import { MapPin, AlertTriangle, CheckCircle, Hand, XCircle, CloudOff } from 'lucide-react';
import { resolveEventTime, validDate } from '../../lib/time';
import { db, ref, onValue } from '../../lib/db';
import { SkeletonList } from './ui/skeleton';
import { eventKind, isCancelled, isStoppedQuietly, kindLabel, type EventKind } from '../../lib/events';

interface FallEvent {
  id: string;
  timestamp: Date;
  kind: EventKind;
  cancelled: boolean;
  quiet: boolean;
  cancelledAt: Date | null;
  offline: boolean;
  location: unknown;
}

interface FallHistoryProps {
  deviceId: string;
}

type TypeFilter = 'all' | 'fall' | 'sos' | 'cancelled';
type DateFilter = 'all' | 'today' | '7d' | '30d';

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'fall', label: 'Falls' },
  { id: 'sos', label: 'Manual SOS' },
  { id: 'cancelled', label: 'Cancelled' },
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

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function FallHistory({ deviceId }: FallHistoryProps) {
  const [events, setEvents] = useState<FallEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
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
            return {
              id: key,
              timestamp: resolveEventTime(key, raw.timestamp),
              kind: eventKind(raw),
              cancelled: isCancelled(raw),
              quiet: isStoppedQuietly(raw),
              cancelledAt: validDate(raw.cancelledAt),
              offline: raw.offline === true,
              location: raw.location ?? null,
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

  const filtered = useMemo(() => {
    const today = startOfToday();
    const minTime =
      dateFilter === 'today' ? today :
      dateFilter === '7d' ? today - 6 * 86400000 :
      dateFilter === '30d' ? today - 29 * 86400000 :
      0;
    return events.filter((e) => {
      if (e.timestamp.getTime() < minTime) return false;
      if (typeFilter === 'cancelled') return e.cancelled;
      if (typeFilter === 'fall') return e.kind === 'fall' && !e.cancelled;
      if (typeFilter === 'sos') return e.kind === 'sos' && !e.cancelled;
      return true;
    });
  }, [events, typeFilter, dateFilter]);

  // reset to page 1 when a filter changes
  useEffect(() => setPage(1), [typeFilter, dateFilter]);

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
          </div>
        </div>

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
                          {event.cancelled && <span className="text-muted-foreground font-normal">- cancelled</span>}
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
                    </div>
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
    </div>
  );
}
