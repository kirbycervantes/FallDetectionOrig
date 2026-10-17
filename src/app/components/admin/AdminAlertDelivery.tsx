import { useEffect, useMemo, useRef, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue } from "../../../lib/db";
import { SkeletonTable } from "../ui/skeleton";
import { buildRows, type AlertRow } from "./deliveryModel";
import { fmtTime } from "./deliveryUi";

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-medium ${
        ok ? "border-success/25 bg-success/10 text-success" : "border-destructive/25 bg-destructive/10 text-destructive"
      }`}
    >
      {ok ? "Delivered" : "Failed"}
    </span>
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

export function AdminAlertDelivery() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("today");
  const [search, setSearch] = useState("");
  const [filterResult, setFilterResult] = useState<"all" | "delivered" | "failed">("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const tableTopRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let events: any = {};
    let families: any = {};
    const loaded = { events: false, families: false };
    const recompute = () => {
      setRows(buildRows(events, families));
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

  const periodRows = useMemo(() => {
    const start = periodStart(period);
    return rows.filter((r) => r.time.getTime() >= start);
  }, [rows, period]);

  const total = periodRows.length;
  const delivered = periodRows.filter((r) => r.delivered).length;
  const failed = total - delivered;
  const rate = total ? Math.round((delivered / total) * 100) : null;

  const filtered = periodRows.filter((r) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q
      || r.patientName.toLowerCase().includes(q)
      || r.deviceId.toLowerCase().includes(q)
      || r.recipients.some((x) => x.name.toLowerCase().includes(q));
    const matchesResult = filterResult === "all" || (filterResult === "delivered" ? r.delivered : !r.delivered);
    return matchesSearch && matchesResult;
  });

  useEffect(() => { setPage(1); }, [search, filterResult, period]);

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

  const periodLabel = PERIOD_LABEL[period];
  const emptyText = search || filterResult !== "all" ? "No alerts match these filters" : `No alerts sent — ${periodLabel.toLowerCase()}`;

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Alert Delivery</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every SMS the central hub sends for fall and SOS alerts
            </p>
          </div>
          <div>
            <label htmlFor="ad-period" className="sr-only">Reporting period</label>
            <select
              id="ad-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="h-[38px] cursor-pointer rounded-xl border border-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
          </div>
        </div>

        {/* Summary cards */}
        <section aria-label={`Delivery summary, ${periodLabel}`} className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">Total alerts</span>
            <span className="text-2xl font-semibold text-foreground">{total}</span>
            <span className="text-xs text-muted-foreground">{periodLabel}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">Successful</span>
            <span className="text-2xl font-semibold text-foreground">{delivered}</span>
            <span className="text-xs text-muted-foreground">{periodLabel}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">Failed</span>
            <span className={`text-2xl font-semibold ${failed > 0 ? "text-destructive" : "text-foreground"}`}>{failed}</span>
            <span className="text-xs text-muted-foreground">{periodLabel}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">Success rate</span>
            <span className="text-2xl font-semibold text-foreground">{rate === null ? "—" : `${rate}%`}</span>
            <span className="text-xs text-muted-foreground">
              {total ? `${periodLabel} · ${delivered} / ${total} alerts` : `${periodLabel} · no alerts`}
            </span>
          </div>
        </section>

        {/* Filters */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1">
            <label htmlFor="ad-search" className="sr-only">Search patient, device or recipient</label>
            <input
              id="ad-search"
              type="search"
              placeholder="Search patient, device or recipient…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm focus:border-primary focus:outline-none sm:max-w-sm"
            />
          </div>
          <div>
            <label htmlFor="ad-result" className="sr-only">Result</label>
            <select
              id="ad-result"
              value={filterResult}
              onChange={(e) => setFilterResult(e.target.value as any)}
              className="h-[38px] w-full cursor-pointer rounded-xl border border-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none sm:w-auto"
            >
              <option value="all">All results</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        {/* Table / list */}
        {loading ? (
          <SkeletonTable rows={5} />
        ) : (
          <div ref={tableTopRef} className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Desktop table */}
            <div className="hidden w-full overflow-x-auto md:block">
              <table className="w-full min-w-[680px] text-left text-sm">
                <caption className="sr-only">Alert delivery log, {periodLabel}, newest first</caption>
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Time</th>
                    <th scope="col" className="px-4 py-3 font-medium">Patient / Device</th>
                    <th scope="col" className="px-4 py-3 font-medium">Alert type</th>
                    <th scope="col" className="px-4 py-3 font-medium">Recipient</th>
                    <th scope="col" className="px-4 py-3 font-medium">SMS status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">{emptyText}</td>
                    </tr>
                  ) : (
                    pageRows.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-muted/40">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtTime(row.time)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{row.patientName}</span>
                            <span className="font-mono text-xs text-muted-foreground">{row.deviceId}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3"><AlertTypeBadge type={row.alertType} /></td>
                        <td className="px-4 py-3"><RecipientCell row={row} /></td>
                        <td className="px-4 py-3"><StatusPill ok={row.sms === "Delivered"} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="divide-y divide-border md:hidden" aria-label={`Alert delivery log, ${periodLabel}`}>
              {pageRows.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyText}</li>
              ) : (
                pageRows.map((row) => (
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
                      <StatusPill ok={row.sms === "Delivered"} />
                    </div>
                  </li>
                ))
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
      </div>
    </AdminLayout>
  );
}
