import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue } from "../../../lib/db";
import { SkeletonTable } from "../ui/skeleton";
import { Search, Filter, CheckCircle2, XCircle, Clock, Send, MessageSquare, PhoneCall, Radio } from "lucide-react";
import { familyDeviceId, personName, flattenEvents } from "./adminData";
import { resolveEventTime } from "../../../lib/time";

type Method = 'SMS' | 'Call';
type DeliveryStatus = 'Sent' | 'Delivered' | 'Failed' | 'Pending';

interface AlertDelivery {
  id: string;
  timestamp: Date;
  patientName: string;
  deviceId: string;
  eventType: string;
  contactName: string;
  contactPhone: string;
  sms: DeliveryStatus | null;
  call: DeliveryStatus | null;
}

interface Recipient { name: string; phone: string; }

// Show only the last 4 digits of a phone number
function maskPhone(phone: any): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '—';
  return `•••• ${digits.slice(-4)}`;
}

// The hub texts and calls the family's registered numbers:
// emergency contacts first, otherwise the primary caregiver.
function familyRecipients(f: any): Recipient[] {
  const contacts = Object.values(f?.contacts || {})
    .filter((c: any) => c && c.phone)
    .map((c: any) => ({ name: c.name || 'Emergency contact', phone: c.phone }));
  if (contacts.length) return contacts;

  const caregivers = Object.values(f?.caregivers || {}).filter((c: any) => c && c.phone) as any[];
  const primary = caregivers.find(c => c.role === 'primary') || caregivers[0];
  return primary ? [{ name: primary.name || 'Caregiver', phone: primary.phone }] : [];
}

function eventLabel(status: string): string {
  if (status === 'pending' || status === 'unconfirmed' || status === 'confirmed') return 'Fall';
  if (status === 'emergency') return 'SOS';
  if (status === 'resolved') return 'Resolved';
  return 'Event';
}

function normalizeMethod(m: any): Method {
  return String(m || '').toLowerCase().includes('call') ? 'Call' : 'SMS';
}

function normalizeStatus(s: any): DeliveryStatus {
  const v = String(s || '').toLowerCase();
  if (v.startsWith('deliver')) return 'Delivered';
  if (v.startsWith('fail') || v === 'error') return 'Failed';
  if (v.startsWith('pend')) return 'Pending';
  return 'Sent';
}

// One compact badge per channel, coloured by its delivery status
function ChannelBadge({ label, icon, status }: { label: string; icon: React.ReactNode; status: DeliveryStatus }) {
  const style =
    status === 'Failed' ? 'bg-destructive/10 text-destructive border-destructive/20'
    : status === 'Pending' ? 'bg-warning/10 text-warning border-warning/20'
    : 'bg-success/10 text-success border-success/20';
  const StatusIcon = status === 'Failed' ? XCircle : status === 'Pending' ? Clock : status === 'Delivered' ? CheckCircle2 : Send;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${style}`} title={`${label}: ${status}`}>
      {icon}
      {label}
      <span className="opacity-60">·</span>
      <StatusIcon className="size-3.5" />
      {status}
    </span>
  );
}

export function AdminAlertDelivery() {
  const [deliveries, setDeliveries] = useState<AlertDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const tableTopRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let currentEvents: any = {};
    let currentFamilies: any = {};
    const loaded = { events: false, families: false };

    const updateDeliveries = () => {
      const parsed: AlertDelivery[] = [];

      flattenEvents(currentEvents).forEach(ev => {
        // Cancelled alarms never send SMS/calls
        if (ev.status === 'cancelled') return;

        const family = Object.values(currentFamilies).find((f: any) => familyDeviceId(f) === ev.deviceId) as any;
        const patientName = family ? personName(family) : 'Unassigned device';
        const eventType = eventLabel(ev.status);
        const raw = ev.raw;

        // 1) Real receipts written by the hub (events/{deviceId}/{eventId}/receipts) -> grouped per contact
        const receipts = raw.receipts ? (Array.isArray(raw.receipts) ? raw.receipts : Object.values(raw.receipts)) : [];
        if (receipts.length) {
          const byContact = new Map<string, AlertDelivery>();
          receipts.forEach((r: any) => {
            if (!r || typeof r !== 'object') return;
            const name = r.contactName || 'Registered contact';
            const key = `${name}|${r.phone ?? ''}`;
            let row = byContact.get(key);
            if (!row) {
              row = {
                id: `${ev.deviceId}_${ev.eventId}_${byContact.size}`,
                timestamp: r.timestamp ? resolveEventTime(ev.eventId, r.timestamp) : ev.date,
                patientName,
                deviceId: ev.deviceId,
                eventType,
                contactName: name,
                contactPhone: maskPhone(r.phone),
                sms: null,
                call: null,
              };
              byContact.set(key, row);
            }
            if (normalizeMethod(r.method) === 'Call') row.call = normalizeStatus(r.status);
            else row.sms = normalizeStatus(r.status);
          });
          parsed.push(...byContact.values());
          return;
        }

        // 2) Otherwise: the hub sends an SMS and places a call to each registered number for every alert
        let recipients = family ? familyRecipients(family) : [];
        if (!recipients.length) {
          const fallbackName = typeof raw.contactNotified === 'string' && !raw.contactNotified.startsWith('None')
            ? raw.contactNotified : 'Registered phone';
          recipients = [{ name: fallbackName, phone: '' }];
        }

        recipients.forEach((rcp, idx) => {
          parsed.push({
            id: `${ev.deviceId}_${ev.eventId}_${idx}`,
            timestamp: ev.date,
            patientName,
            deviceId: ev.deviceId,
            eventType,
            contactName: rcp.name,
            contactPhone: maskPhone(rcp.phone),
            sms: 'Sent',
            call: 'Sent',
          });
        });
      });

      parsed.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      setDeliveries(parsed);
      if (loaded.events && loaded.families) setLoading(false);
    };

    const unsubEvents = onValue(ref(db, 'events'), (snapshot) => {
      currentEvents = snapshot.val() || {}; loaded.events = true; updateDeliveries();
    }, (err) => { console.error('Failed to load events', err); setLoading(false); });

    const unsubFamilies = onValue(ref(db, 'families'), (snapshot) => {
      currentFamilies = snapshot.val() || {}; loaded.families = true; updateDeliveries();
    }, (err) => { console.error('Failed to load families', err); setLoading(false); });

    return () => {
      unsubEvents();
      unsubFamilies();
    };
  }, []);

  const filteredDeliveries = deliveries.filter(d => {
    const q = search.toLowerCase();
    const matchesSearch = d.patientName.toLowerCase().includes(q) ||
                          d.contactName.toLowerCase().includes(q) ||
                          d.deviceId.toLowerCase().includes(q);
    const matchesStatus = filterStatus === "all" || d.sms === filterStatus || d.call === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // Summary
  const smsCount = deliveries.filter(d => d.sms).length;
  const callCount = deliveries.filter(d => d.call).length;
  const failedCount = deliveries.reduce((n, d) => n + (d.sms === 'Failed' ? 1 : 0) + (d.call === 'Failed' ? 1 : 0), 0);
  const attempts = smsCount + callCount;
  const successRate = attempts ? Math.round(((attempts - failedCount) / attempts) * 100) : 100;

  // Pagination: 10 per page, newest first
  useEffect(() => { setPage(1); }, [search, filterStatus]);
  const totalPages = Math.max(1, Math.ceil(filteredDeliveries.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredDeliveries.slice(pageStart, pageStart + PAGE_SIZE);
  const firstNum = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const pageNumbers = Array.from({ length: Math.min(5, totalPages) }, (_, i) => firstNum + i);
  const goToPage = (n: number) => {
    setPage(Math.max(1, Math.min(totalPages, n)));
    tableTopRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Alert Delivery</h1>
            <p className="text-sm text-muted-foreground mt-1">SMS and call alerts sent by the central hub to registered phone numbers</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search patient or contact..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:border-primary w-full md:w-56"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="pl-9 pr-8 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:border-primary appearance-none cursor-pointer text-foreground h-[38px]"
              >
                <option value="all">All Statuses</option>
                <option value="Sent">Sent</option>
                <option value="Delivered">Delivered</option>
                <option value="Pending">Pending</option>
                <option value="Failed">Failed</option>
              </select>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-card p-4 sm:p-5 rounded-xl border border-border shadow-sm flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 text-primary rounded-lg"><MessageSquare className="size-5" /></div>
            <div><p className="text-xs text-muted-foreground">SMS sent</p><p className="text-xl font-semibold">{smsCount}</p></div>
          </div>
          <div className="bg-card p-4 sm:p-5 rounded-xl border border-border shadow-sm flex items-center gap-3">
            <div className="p-2.5 bg-success/10 text-success rounded-lg"><PhoneCall className="size-5" /></div>
            <div><p className="text-xs text-muted-foreground">Calls placed</p><p className="text-xl font-semibold">{callCount}</p></div>
          </div>
          <div className="bg-card p-4 sm:p-5 rounded-xl border border-border shadow-sm flex items-center gap-3">
            <div className="p-2.5 bg-destructive/10 text-destructive rounded-lg"><XCircle className="size-5" /></div>
            <div><p className="text-xs text-muted-foreground">Failed</p><p className="text-xl font-semibold">{failedCount}</p></div>
          </div>
          <div className="bg-card p-4 sm:p-5 rounded-xl border border-border shadow-sm flex items-center gap-3">
            <div className="p-2.5 bg-warning/10 text-warning rounded-lg"><Radio className="size-5" /></div>
            <div><p className="text-xs text-muted-foreground">Success rate</p><p className="text-xl font-semibold">{successRate}%</p></div>
          </div>
        </div>

        {/* Deliveries Table */}
        {loading ? (
          <SkeletonTable rows={5} />
        ) : (
        <div ref={tableTopRef} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden scroll-mt-4">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[680px]">
              <thead className="text-muted-foreground bg-muted/30">
                <tr>
                  <th className="font-medium px-6 py-4">Time</th>
                  <th className="font-medium px-6 py-4">Patient / Device</th>
                  <th className="font-medium px-6 py-4">Alert</th>
                  <th className="font-medium px-6 py-4">Sent to</th>
                  <th className="font-medium px-6 py-4">SMS &amp; Call</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                      {search ? "No logs matched your search" : "No alerts sent yet"}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((d) => (
                    <tr key={d.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 text-muted-foreground text-xs whitespace-nowrap">
                        {d.timestamp.toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-foreground font-medium">{d.patientName}</span>
                          <span className="text-muted-foreground font-mono text-xs">{d.deviceId}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                          d.eventType === 'Fall' ? 'bg-destructive/10 text-destructive'
                          : d.eventType === 'SOS' ? 'bg-warning/10 text-warning'
                          : 'bg-muted text-muted-foreground'
                        }`}>
                          {d.eventType}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-foreground">{d.contactName}</span>
                          <span className="text-muted-foreground text-xs">{d.contactPhone}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {d.sms && <ChannelBadge label="SMS" icon={<MessageSquare className="size-3.5" />} status={d.sms} />}
                          {d.call && <ChannelBadge label="Call" icon={<PhoneCall className="size-3.5" />} status={d.call} />}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filteredDeliveries.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-border">
              <span className="text-sm text-muted-foreground">
                Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredDeliveries.length)} of {filteredDeliveries.length} • Newest first
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  {pageNumbers.map((n) => (
                    <button
                      key={n}
                      onClick={() => goToPage(n)}
                      className={`min-w-9 px-3 py-1.5 rounded-lg text-sm border ${
                        n === currentPage
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border text-foreground hover:bg-muted'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </AdminLayout>
  );
}
