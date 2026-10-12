import { useState, useEffect } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue } from "../../../lib/db";
import { familyDeviceId, deviceState, flattenEvents } from "./adminData";
import { SkeletonChart, SkeletonCard } from "../ui/skeleton";
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { Activity, Users, AlertTriangle, ShieldCheck } from "lucide-react";

export function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [incidentData, setIncidentData] = useState<any[]>([]);
  const [deviceData, setDeviceData] = useState<any[]>([]);
  
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
        const state = deviceState(currentDevices[id]);
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

      // Last 7 days, oldest -> today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const chartData = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - (6 - i));
        return {
          key: d.toDateString(),
          name: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
          incidents: 0,
          falseAlarms: 0,
        };
      });

      let total = 0;
      let resolved = 0;
      events.forEach(ev => {
        if (ev.status !== 'cancelled') total++;
        if (ev.status === 'confirmed' || ev.status === 'resolved') resolved++;
        const day = chartData.find(d => d.key === ev.date.toDateString());
        if (day) {
          if (ev.status === 'cancelled') day.falseAlarms++;
          else day.incidents++;
        }
      });

      setIncidentData(chartData);
      setStats({
        activeFamilies: Object.keys(currentFamilies).length,
        onlineDevices: online,
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
  }, []);

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
          
          {/* Incident Trends (Line Chart) */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-medium text-foreground mb-6">Incident Trends (7 Days)</h3>
            <div className="h-72 w-full">
              {loading ? (
                <SkeletonChart />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={incidentData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} interval={0} />
                    <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' }} 
                    />
                    <Line type="monotone" dataKey="incidents" name="Incidents" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="falseAlarms" name="False Alarms" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Device Status (Bar Chart) */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-medium text-foreground mb-6">Device Fleet Status</h3>
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
