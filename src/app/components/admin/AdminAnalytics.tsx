import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue } from "../../../lib/db";
import { familyDeviceId, personName, deviceState, flattenEvents } from "./adminData";
import { useNow } from "../../../lib/deviceStatus";
import { SkeletonChart, SkeletonCard } from "../ui/skeleton";
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { Activity, Users, AlertTriangle, ShieldCheck } from "lucide-react";

const LINE_COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1"];

export function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [incidentData, setIncidentData] = useState<any[]>([]);
  const [deviceData, setDeviceData] = useState<any[]>([]);
  const [days, setDays] = useState(7);
  const [perDevice, setPerDevice] = useState(false);
  const [deviceLines, setDeviceLines] = useState<{ key: string; name: string }[]>([]);
  const now = useNow(5000);
  const nowRef = useRef(now);
  nowRef.current = now;
  
  const [stats, setStats] = useState({
    activeFamilies: 0,
    totalIncidents: 0,
    onlineDevices: 0,
    resolvedIncidents: 0
  });

  useEffect(() => {
    let currentFamilies: any = {};
    let currentDevices: any = {};
    let currentEvents: any = {};
    const loaded = { families: false, devices: false, events: false };

    const recompute = () => {
      // ---- Device fleet: every device linked to a family (counted once) ----
      const deviceIds = new Set<string>();
      Object.values(currentFamilies).forEach((f: any) => {
        const id = familyDeviceId(f);
        if (id) deviceIds.add(id);
      });
      let online = 0, offline = 0, lowBattery = 0;
      deviceIds.forEach(id => {
        const state = deviceState(currentDevices[id], nowRef.current);
        if (state === 'online') online++;
        else if (state === 'offline') offline++;
        else lowBattery++;
      });
      setDeviceData([
        { name: 'Online', count: online, fill: '#10b981' },
        { name: 'Offline', count: offline, fill: '#ef4444' },
        { name: 'Low Battery', count: lowBattery, fill: '#f59e0b' },
      ]);

      // ---- Incidents (events are stored per device: events/{deviceId}/{eventId}) ----
      const events = flattenEvents(currentEvents);

      // Last N days, oldest -> today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Device names for the per-device view
      const nameOf: Record<string, string> = {};
      Object.values(currentFamilies).forEach((f: any) => {
        const id = familyDeviceId(f);
        if (id) nameOf[id] = personName(f, currentDevices[id]);
      });
      const lineIds = Array.from(new Set(events.map(e => e.deviceId))).sort();
      setDeviceLines(lineIds.map(id => ({ key: id, name: nameOf[id] && nameOf[id] !== 'Unknown' ? nameOf[id] : id })));

      const chartData = Array.from({ length: days }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - (days - 1 - i));
        const row: any = {
          key: d.toDateString(),
          name: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          incidents: 0,
          cancelled: 0,
        };
        lineIds.forEach(id => { row[id] = 0; });
        return row;
      });

      let total = 0;
      let resolved = 0;
      events.forEach(ev => {
        if (ev.status !== 'cancelled') total++;
        if (ev.status === 'confirmed' || ev.status === 'resolved') resolved++;
        const day = chartData.find(d => d.key === ev.date.toDateString());
        if (day) {
          if (ev.status === 'cancelled') day.cancelled++;
          else { day.incidents++; day[ev.deviceId]++; }
        }
      });

      setIncidentData(chartData);
      setStats({
        activeFamilies: Object.keys(currentFamilies).length,
        onlineDevices: online + lowBattery, // a low-battery device is still online
        totalIncidents: total,
        resolvedIncidents: resolved,
      });
      if (loaded.families && loaded.devices && loaded.events) setLoading(false);
    };

    const unsubFamilies = onValue(ref(db, 'families'), (snap) => {
      currentFamilies = snap.val() || {}; loaded.families = true; recompute();
    });
    const unsubDevices = onValue(ref(db, 'devices'), (snap) => {
      currentDevices = snap.val() || {}; loaded.devices = true; recompute();
    });
    const unsubEvents = onValue(ref(db, 'events'), (snap) => {
      currentEvents = snap.val() || {}; loaded.events = true; recompute();
    });

    return () => {
      unsubFamilies();
      unsubDevices();
      unsubEvents();
    };
  }, [days, now]);

  return (
    <AdminLayout>
      <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Analytics Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">System-wide trends and engagement metrics</p>
        </div>

        {/* Top Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-primary/10 text-primary rounded-xl">
              <Users className="size-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">Active Families</p>
              <p className="text-2xl font-bold text-foreground">{stats.activeFamilies}</p>
            </div>
          </div>
          
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-success/10 text-success rounded-xl">
              <Activity className="size-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">Online Devices</p>
              <p className="text-2xl font-bold text-foreground">{stats.onlineDevices}</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-destructive/10 text-destructive rounded-xl">
              <AlertTriangle className="size-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">Total Incidents</p>
              <p className="text-2xl font-bold text-foreground">{stats.totalIncidents}</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-amber-500/10 text-amber-500 rounded-xl">
              <ShieldCheck className="size-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">Resolved/Confirmed</p>
              <p className="text-2xl font-bold text-foreground">{stats.resolvedIncidents}</p>
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Incidents (Line Chart) */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <h3 className="text-lg font-medium text-foreground">Incidents</h3>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Chart view">
                  {[{ v: false, l: 'All devices' }, { v: true, l: 'Per device' }].map(o => (
                    <button
                      key={o.l}
                      type="button"
                      onClick={() => setPerDevice(o.v)}
                      aria-pressed={perDevice === o.v}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        perDevice === o.v ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted'
                      }`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  aria-label="Days shown"
                  className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-foreground cursor-pointer focus:outline-none focus:border-primary"
                >
                  <option value={7}>Last 7 days</option>
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
              </div>
            </div>
            <div className="h-72 w-full">
              {loading ? (
                <SkeletonChart />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={incidentData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} interval={days > 7 ? 'preserveStartEnd' : 0} />
                    <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' }}
                    />
                    {perDevice ? (
                      <>
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {deviceLines.map((d, i) => (
                          <Line key={d.key} type="monotone" dataKey={d.key} name={d.name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                        ))}
                      </>
                    ) : (
                      <>
                        <Line type="monotone" dataKey="incidents" name="Incidents" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="cancelled" name="Cancelled" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Device Status (Bar Chart) */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-medium text-foreground mb-6">Devices Online Status</h3>
            <div className="h-72 w-full">
              {loading ? (
                <SkeletonChart />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deviceData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' }} 
                      cursor={{ fill: 'transparent' }}
                    />
                    <Bar dataKey="count" name="Devices" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

        </div>
      </div>
    </AdminLayout>
  );
}
