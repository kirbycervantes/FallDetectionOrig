import { useState, useEffect } from "react";
import { db, ref, onValue } from "../../lib/db";
import { resolveEventTime } from "../../lib/time";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";
import { SkeletonChart } from './ui/skeleton';
import { Activity, Battery, AlertTriangle, TrendingDown } from "lucide-react";

interface CaregiverAnalyticsProps {
  deviceId: string | null;
}

export function CaregiverAnalytics({ deviceId }: CaregiverAnalyticsProps) {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!deviceId) return;
    const eventsRef = ref(db, `events/${deviceId}`);
    const unsub = onValue(eventsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setIncidents(Object.entries(data).map(([key, v]: [string, any]) => ({ ...v, timestamp: resolveEventTime(key, v?.timestamp).getTime() })));
      } else {
        setIncidents([]);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [deviceId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-foreground">Analytics Overview</h2>
          <p className="text-sm text-muted-foreground">Detailed insights and trends</p>
        </div>
        <SkeletonChart />
        <SkeletonChart />
      </div>
    );
  }

  // Process data for charts
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fallCountByDay = new Array(7).fill(0);
  const fallCountByHour = new Array(24).fill(0);
  
  let validFalls = 0;
  
  incidents.forEach(inc => {
    if (inc.status !== 'cancelled') {
      validFalls++;
      const date = new Date(inc.timestamp);
      fallCountByDay[date.getDay()]++;
      fallCountByHour[date.getHours()]++;
    }
  });

  const weeklyData = daysOfWeek.map((day, index) => ({
    name: day,
    falls: fallCountByDay[index]
  }));

  const hourlyData = fallCountByHour.map((count, hour) => ({
    time: `${hour}:00`,
    falls: count
  }));

  // Identify high-risk period
  const maxHourlyFalls = Math.max(...fallCountByHour);
  const highRiskHour = fallCountByHour.indexOf(maxHourlyFalls);
  const formattedRiskHour = maxHourlyFalls > 0 ? 
    `${highRiskHour === 0 ? 12 : highRiskHour > 12 ? highRiskHour - 12 : highRiskHour} ${highRiskHour >= 12 ? 'PM' : 'AM'}` 
    : 'None';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-2xl p-6 border border-border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-destructive/10 rounded-xl">
              <AlertTriangle className="size-5 text-destructive" />
            </div>
            <h3 className="font-semibold text-foreground">Total Valid Falls</h3>
          </div>
          <p className="text-3xl font-bold text-foreground mt-4">{validFalls}</p>
        </div>
        
        <div className="bg-card rounded-2xl p-6 border border-border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-amber-500/10 rounded-xl">
              <Activity className="size-5 text-amber-500" />
            </div>
            <h3 className="font-semibold text-foreground">High-Risk Time</h3>
          </div>
          <p className="text-3xl font-bold text-foreground mt-4">{formattedRiskHour}</p>
          <p className="text-sm text-muted-foreground mt-1">Most falls occur around this hour</p>
        </div>

        <div className="bg-card rounded-2xl p-6 border border-border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              <TrendingDown className="size-5 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground">Weekly Trend</h3>
          </div>
          <div className="h-[60px] mt-2">
             <ResponsiveContainer width="100%" height="100%">
               <LineChart data={weeklyData}>
               <Line type="monotone" dataKey="falls" stroke="var(--primary)" strokeWidth={3} dot={false} />
               </LineChart>
             </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Incidents by Day */}
        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          <h3 className="text-lg font-semibold text-foreground mb-6">Incidents by Day</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip 
                  cursor={{ fill: 'var(--muted)' }}
                  contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '12px', color: 'var(--foreground)' }}
                  labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
                  itemStyle={{ color: 'var(--muted-foreground)' }}
                />
                <Bar dataKey="falls" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Incidents by Hour */}
        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          <h3 className="text-lg font-semibold text-foreground mb-6">Incidents by Hour</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val, i) => i % 4 === 0 ? val : ''} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '12px', color: 'var(--foreground)' }}
                  labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
                  itemStyle={{ color: 'var(--muted-foreground)' }}
                />
                <Line type="monotone" dataKey="falls" stroke="var(--destructive)" strokeWidth={3} dot={{ fill: 'var(--destructive)', strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
    </div>
  );
}
