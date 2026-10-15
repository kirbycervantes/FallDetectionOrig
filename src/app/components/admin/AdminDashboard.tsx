import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import { Users, Wifi, Send, AlertTriangle, Hand, XCircle } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue } from "../../../lib/db";
import { resolveEventTime } from "../../../lib/time";
import { useNow } from "../../../lib/deviceStatus";
import { eventKind, isCancelled, type EventKind } from "../../../lib/events";
import { familyDeviceId, personName, batteryLevels, deviceState } from "./adminData";
import { buildRows } from "./deliveryModel";

interface Family {
  id: string;
  name: string;
  deviceId: string;
  status: "online" | "offline" | "low_battery";
  wearableBattery: string;
  hubBattery: string;
  createdAt: string;
}

type IncidentKind = EventKind | "cancelled";

interface Incident {
  id: string;
  kind: IncidentKind;
  person: string;
  time: string;
  timestamp: Date;
}

const KIND_UI: Record<IncidentKind, { label: string; Icon: typeof AlertTriangle; box: string }> = {
  fall: { label: "Fall detected", Icon: AlertTriangle, box: "bg-destructive/10 text-destructive" },
  sos: { label: "Manual SOS", Icon: Hand, box: "bg-warning/10 text-warning" },
  cancelled: { label: "Cancelled", Icon: XCircle, box: "bg-muted text-muted-foreground" },
};

const FILTERS: { id: "all" | IncidentKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fall", label: "Fall" },
  { id: "sos", label: "Manual SOS" },
  { id: "cancelled", label: "Cancelled" },
];

export function AdminDashboard() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentFilter, setIncidentFilter] = useState<"all" | IncidentKind>("all");
  const [stats, setStats] = useState({
    totalFamilies: 0,
    devicesOnline: 0,
    totalDevices: 0,
    alertsTotal: 0,
    alertsDelivered: 0,
  });

  const now = useNow(5000);
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    let currentFamilies: any = {};
    let currentDevices: any = {};
    let currentEvents: any = {};

    const recompute = () => {
      // ---- Registered families ----
      const parsedFamilies: Family[] = [];
      const seenDevices = new Set<string>();
      let onlineCount = 0;

      Object.keys(currentFamilies).forEach(key => {
        const f = currentFamilies[key] || {};
        const deviceId = familyDeviceId(f);
        const device = deviceId ? currentDevices[deviceId] : undefined;

        let status: Family["status"] = "offline";
        let wearable = "—";
        let hub = "—";

        if (deviceId) {
          const levels = batteryLevels(device);
          wearable = `${Math.round(levels.wearable)}%`;
          hub = `${Math.round(levels.hub)}%`;
          status = deviceState(device, nowRef.current);
          // count each physical device once, even if linked to several families
          if (!seenDevices.has(deviceId)) {
            seenDevices.add(deviceId);
            if (status !== 'offline') onlineCount++;
          }
        }

        parsedFamilies.push({
          id: key,
          name: personName(f, device),
          deviceId: deviceId || "Unlinked",
          status,
          wearableBattery: wearable,
          hubBattery: hub,
          createdAt: f.createdAt
        });
      });

      // Newest registrations first
      parsedFamilies.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

      // ---- Recent incidents ----
      const parsedIncidents: Incident[] = [];

      Object.keys(currentEvents).forEach(deviceId => {
        const deviceEvents = currentEvents[deviceId] || {};
        const familyEntry = Object.values(currentFamilies).find((f: any) => familyDeviceId(f) === deviceId);
        const person = familyEntry ? personName(familyEntry, currentDevices[deviceId]) : (currentDevices[deviceId]?.user?.name || deviceId);

        Object.keys(deviceEvents).forEach(eventId => {
          const ev = deviceEvents[eventId];
          if (!ev || typeof ev !== 'object') return;

          // Device writes millis() uptime as timestamp -> use the real time from the Firebase key
          const when = resolveEventTime(eventId, ev.timestamp);

          parsedIncidents.push({
            id: `${deviceId}-${eventId}`,
            kind: isCancelled(ev) ? "cancelled" : eventKind(ev),
            person,
            time: when.toLocaleString(),
            timestamp: when,
          });
        });
      });

      // Newest first
      parsedIncidents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // ---- Alerts delivered: share of fall / SOS alerts whose SMS + call went out ----
      const alertRows = buildRows(currentEvents, currentFamilies);

      setFamilies(parsedFamilies);
      setIncidents(parsedIncidents);
      setStats({
        totalFamilies: Object.keys(currentFamilies).length,
        devicesOnline: onlineCount,
        totalDevices: seenDevices.size,
        alertsTotal: alertRows.length,
        alertsDelivered: alertRows.filter(r => r.delivered).length,
      });
    };

    const unsubscribeFamilies = onValue(ref(db, 'families'), (snapshot) => {
      currentFamilies = snapshot.val() || {};
      recompute();
    });
    const unsubscribeDevices = onValue(ref(db, 'devices'), (snapshot) => {
      currentDevices = snapshot.val() || {};
      recompute();
    });
    const unsubscribeEvents = onValue(ref(db, 'events'), (snapshot) => {
      currentEvents = snapshot.val() || {};
      recompute();
    });

    return () => {
      unsubscribeFamilies();
      unsubscribeDevices();
      unsubscribeEvents();
    };
  }, [now]);

  const shownIncidents = incidents.filter(i => incidentFilter === "all" || i.kind === incidentFilter).slice(0, 5);
  const deliveredPct = stats.alertsTotal ? Math.round((stats.alertsDelivered / stats.alertsTotal) * 100) : null;

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="mb-4 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">System overview</p>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-card p-4 sm:p-6 rounded-xl border border-border flex items-center gap-4 shadow-sm">
            <div className="p-3 bg-primary/10 text-primary rounded-xl">
              <Users className="size-5 sm:size-6" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs sm:text-sm text-muted-foreground">Families</span>
              <span className="text-xl sm:text-2xl font-semibold">{stats.totalFamilies}</span>
            </div>
          </div>
          <div className="bg-card p-4 sm:p-6 rounded-xl border border-border flex items-center gap-4 shadow-sm">
            <div className="p-3 bg-success/10 text-success rounded-xl">
              <Wifi className="size-5 sm:size-6" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs sm:text-sm text-muted-foreground">Devices online</span>
              <span className="text-xl sm:text-2xl font-semibold">{stats.devicesOnline}/{stats.totalDevices}</span>
            </div>
          </div>
          <div className="bg-card p-4 sm:p-6 rounded-xl border border-border flex items-center gap-4 shadow-sm">
            <div className="p-3 bg-primary/10 text-primary rounded-xl">
              <Send className="size-5 sm:size-6" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs sm:text-sm text-muted-foreground">Alerts delivered</span>
              <span className="text-xl sm:text-2xl font-semibold">{deliveredPct === null ? "—" : `${deliveredPct}%`}</span>
              <span className="text-xs text-muted-foreground">
                {stats.alertsTotal ? `${stats.alertsDelivered} of ${stats.alertsTotal} alerts` : "No alerts yet"}
              </span>
            </div>
          </div>
        </div>

        {/* Registered Families Panel */}
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 sm:p-6 flex items-center justify-between border-b border-border">
            <h2 className="text-base sm:text-lg font-medium text-foreground">Registered families</h2>
            <Link to="/admin/families" className="text-xs sm:text-sm font-medium text-primary hover:text-primary/80 transition-colors">
              View all
            </Link>
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm min-w-[560px]">
              <thead className="text-muted-foreground bg-muted/30">
                <tr>
                  <th className="font-medium px-3 sm:px-6 py-3 sm:py-4">Person monitored</th>
                  <th className="font-medium px-3 sm:px-6 py-3 sm:py-4">MAC Address</th>
                  <th className="font-medium px-3 sm:px-6 py-3 sm:py-4">Wearable Battery</th>
                  <th className="font-medium px-3 sm:px-6 py-3 sm:py-4">Hub Battery</th>
                  <th className="font-medium px-3 sm:px-6 py-3 sm:py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {families.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                      No families registered yet
                    </td>
                  </tr>
                ) : (
                  families.slice(0, 5).map((family) => (
                    <tr key={family.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-3 sm:px-6 py-3 sm:py-4 text-foreground font-medium">{family.name}</td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 text-muted-foreground font-mono text-xs">{family.deviceId}</td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 text-muted-foreground">{family.wearableBattery}</td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 text-muted-foreground">{family.hubBattery}</td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4">
                        <StatusBadge status={family.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Incidents Panel */}
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-base sm:text-lg font-medium text-foreground">Recent incidents</h2>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter recent incidents">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setIncidentFilter(f.id)}
                  aria-pressed={incidentFilter === f.id}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    incidentFilter === f.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col">
            {shownIncidents.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No recent incidents
              </div>
            ) : (
              shownIncidents.map((incident) => {
                const ui = KIND_UI[incident.kind];
                return (
                  <div key={incident.id} className="flex items-center gap-3 sm:gap-4 p-4 sm:p-6 hover:bg-muted/50 transition-colors border-b border-border last:border-0">
                    <div className={`flex items-center justify-center size-9 rounded-xl shrink-0 ${ui.box}`}>
                      <ui.Icon className="size-4" aria-hidden="true" />
                    </div>
                    <div className="flex flex-col">
                      <div className="text-sm font-medium text-foreground">
                        {ui.label} — <span className="font-normal text-muted-foreground">{incident.person}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{incident.time}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
