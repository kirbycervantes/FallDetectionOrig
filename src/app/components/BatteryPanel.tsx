import { useEffect, useState } from 'react';
import { Battery, Watch, Router } from 'lucide-react';
import { db, ref, onValue } from '../../lib/db';

// Shown until the devices report real values to devices/{deviceId}/batteries/{wearable|hub}
export const DEFAULT_LEVELS = { wearable: 85, hub: 92 };

interface BatteryPanelProps {
  deviceId: string;
}

function levelColor(level: number) {
  if (level > 50) return { text: 'text-success', bg: 'bg-success', soft: 'bg-success/10' };
  if (level > 20) return { text: 'text-warning', bg: 'bg-warning', soft: 'bg-warning/10' };
  return { text: 'text-destructive', bg: 'bg-destructive', soft: 'bg-destructive/10' };
}

/** Wearable + Central Hub battery levels (static defaults until the devices report real values). */
export function useBatteryLevels(deviceId: string | null) {
  const [levels, setLevels] = useState(DEFAULT_LEVELS);

  useEffect(() => {
    if (!deviceId) return;
    const unsub = onValue(ref(db, `devices/${deviceId}/batteries`), (snap) => {
      const v = snap.val() || {};
      setLevels({
        wearable: typeof v.wearable === 'number' ? v.wearable : DEFAULT_LEVELS.wearable,
        hub: typeof v.hub === 'number' ? v.hub : DEFAULT_LEVELS.hub,
      });
    });
    return () => unsub();
  }, [deviceId]);

  return levels;
}

export function BatteryPanel({ deviceId }: BatteryPanelProps) {
  const levels = useBatteryLevels(deviceId);

  const items = [
    { name: 'Wearable', icon: Watch, level: levels.wearable },
    { name: 'Central Hub', icon: Router, level: levels.hub },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-6">
        <p className="text-sm text-muted-foreground">Battery Status</p>
        <div className="p-3 bg-success/10 rounded-xl">
          <Battery className="size-8 text-success" />
        </div>
      </div>
      <div className="space-y-5">
        {items.map(({ name, icon: Icon, level }) => {
          const pct = Math.max(0, Math.min(100, Math.round(level)));
          const c = levelColor(pct);
          return (
            <div key={name}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${c.soft}`}>
                    <Icon className={`size-4 ${c.text}`} />
                  </div>
                  <span className="text-sm font-medium text-foreground">{name}</span>
                </div>
                <span className={`text-lg font-bold ${c.text}`}>{pct}%</span>
              </div>
              <div className="relative w-full h-3 bg-muted rounded-full overflow-hidden">
                <div className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${c.bg}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
