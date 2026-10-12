import { useState, useEffect } from "react";
import { Link } from "react-router";
import { StatusBadge } from "./StatusBadge";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue } from "../../../lib/db";
import { resolveEventTime } from "../../../lib/time";
import { DEFAULT_LEVELS } from "../BatteryPanel";

function familyDeviceId(f: any): string | undefined {
  return f?.deviceId || f?.deviceSerialNumber || undefined;
}

function personName(f: any, device?: any): string {
  return f?.monitoredPerson?.name || f?.monitoredPersonName || f?.patientName || device?.user?.name || "Unknown";
}

// Same source as the caregiver dashboard: devices/{id}/batteries, static defaults until real values arrive
function batteryLevels(device: any) {
  const b = device?.batteries || {};
  return {
    wearable: typeof b.wearable === 'number' ? b.wearable : DEFAULT_LEVELS.wearable,
    hub: typeof b.hub === 'number' ? b.hub : DEFAULT_LEVELS.hub,
  };
}

interface Family {
  id: string;
  name: string;
  deviceId: string;
  status: "online" | "offline" | "low_battery";
  wearableBattery: string;
  hubBattery: string;
  createdAt: string;
}

interface Incident {
  id: string;
  type: string;
  person: string;
  time: string;
  statusText: string;
  typeColor: string;
  timestamp: Date;
}

export function AdminDashboard() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [stats, setStats] = useState({
    totalFamilies: 0,
    devicesOnline: 0,
    totalDevices: 0,
    openIncidents: 0,
  });

  useEffect(() => {
    let currentFamilies: any = {};
    let currentDevices: any = {};
    let currentEvents: any = {};

    const recompute = () => {
      // ---- Registered families ----
      const parsedFamilies: Family[] = [];
      let onlineCount = 0;
      let totalDevs = 0;

      Object.keys(currentFamilies).forEach(key => {
        const f = currentFamilies[key] || {};
        const deviceId = familyDeviceId(f);
        const device = deviceId ? currentDevices[deviceId] : undefined;

        let status: Family["status"] = "offline";
        let wearable = "—";
        let hub = "—";

        if (deviceId) {
          totalDevs++;
          const levels = batteryLevels(device);
          wearable = `${Math.round(levels.wearable)}%`;
          hub = `${Math.round(levels.hub)}%`;

          if (device?.status === 'offline') {
            status = 'offline';
          } else if (Math.min(levels.wearable, levels.hub) < 20) {
            status = 'low_battery';
            onlineCount++;
          } else {
            status = 'online';
            onlineCount++;
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
      let openCount = 0;

      Object.keys(currentEvents).forEach(deviceId => {
        const deviceEvents = currentEvents[deviceId] || {};
        const familyEntry = Object.values(currentFamilies).find((f: any) => familyDeviceId(f) === deviceId);
        const person = familyEntry ? personName(familyEntry, currentDevices[deviceId]) : (currentDevices[deviceId]?.user?.name || deviceId);

        Object.keys(deviceEvents).forEach(eventId => {
          const ev = deviceEvents[eventId];
          if (!ev || typeof ev !== 'object') return;

          if (ev.status === 'pending' || ev.status === 'emergency' || ev.status === 'unconfirmed') {
            openCount++;
          }

          let typeColor = "bg-primary/15";
          let typeText = "Event";

          if (ev.status === 'pending' || ev.status === 'unconfirmed') {
            typeColor = "bg-destructive/15";
            typeText = "Fall detected (Unconfirmed)";
          } else if (ev.status === 'emergency') {
            typeColor = "bg-warning/15";
            typeText = "SOS Button Pressed";
          } else if (ev.status === 'confirmed') {
            typeColor = "bg-destructive/15";
            typeText = "Fall Confirmed";
          } else if (ev.status === 'resolved') {
            typeColor = "bg-success/15";
            typeText = "Resolved";
          } else if (ev.status === 'cancelled') {
            typeColor = "bg-muted";
            typeText = "Cancelled";
          }

          // Device writes millis() uptime as timestamp -> use the real time from the Firebase key
          const when = resolveEventTime(eventId, ev.timestamp);

          parsedIncidents.push({
            id: `${deviceId}-${eventId}`,
            type: typeText,
            person,
            time: when.toLocaleString(),
            timestamp: when,
            statusText: ev.contactNotified ? `Notified: ${ev.contactNotified}` : '',
            typeColor
          });
        });
      });

      // Newest first, top 5
      parsedIncidents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      setFamilies(parsedFamilies);
      setIncidents(parsedIncidents.slice(0, 5));
      setStats({
        totalFamilies: Object.keys(currentFamilies).length,
        devicesOnline: onlineCount,
        totalDevices: totalDevs,
        openIncidents: openCount,
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
  }, []);

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="mb-4 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">System overview</p>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-card p-4 sm:p-6 rounded-xl border border-border flex flex-col gap-1 sm:gap-2 shadow-sm">
            <span className="text-xs sm:text-sm text-muted-foreground">Families</span>
            <span className="text-xl sm:text-2xl font-semibold">{stats.totalFamilies}</span>
          </div>
          <div className="bg-card p-4 sm:p-6 rounded-xl border border-border flex flex-col gap-1 sm:gap-2 shadow-sm">
            <span className="text-xs sm:text-sm text-muted-foreground">Devices online</span>
            <span className="text-xl sm:text-2xl font-semibold">{stats.devicesOnline}/{stats.totalDevices}</span>
          </div>
          <div className="bg-card p-4 sm:p-6 rounded-xl border border-border flex flex-col gap-1 sm:gap-2 shadow-sm">
            <span className="text-xs sm:text-sm text-muted-foreground">Open incidents</span>
            <span className="text-xl sm:text-2xl font-semibold">{stats.openIncidents}</span>
          </div>
          <div className="bg-card p-4 sm:p-6 rounded-xl border border-border flex flex-col gap-1 sm:gap-2 shadow-sm">
            <span className="text-xs sm:text-sm text-muted-foreground">Alerts delivered</span>
            <span className="text-xl sm:text-2xl font-semibold">100%</span>
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
                  <th className="font-medium px-3 sm:px-6 py-3 sm:py-4">Device Serial</th>
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
          <div className="p-4 sm:p-6 border-b border-border">
            <h2 className="text-base sm:text-lg font-medium text-foreground">Recent incidents</h2>
          </div>
          <div className="flex flex-col">
            {incidents.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No recent incidents
              </div>
            ) : (
              incidents.map((incident) => (
                <div key={incident.id} className="flex items-start gap-3 sm:gap-4 p-4 sm:p-6 hover:bg-muted/50 transition-colors border-b border-border last:border-0">
                  <div className={`mt-1 size-3 rounded ${incident.typeColor} flex-shrink-0`} />
                  <div className="flex flex-col">
                    <div className="text-sm font-medium text-foreground">
                      {incident.type} — <span className="font-normal text-muted-foreground">{incident.person}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <span>{incident.time}</span>
                      {incident.statusText && (
                        <>
                          <span>&middot;</span>
                          <span>{incident.statusText}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
