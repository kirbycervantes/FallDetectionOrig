import { useState, useEffect, type ReactNode } from 'react';
import { Clock, MapPin, Cpu } from 'lucide-react';
import { db, ref, onValue } from '../../lib/db';
import { SkeletonCard } from './ui/skeleton';
import { formatDuration, isDeviceOnline, lastSeen, timeAgo, useNow } from '../../lib/deviceStatus';

interface DeviceStatusProps {
  deviceId: string;
}

function Tile({ icon, label, children, sub }: { icon: ReactNode; label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start gap-4 p-4 bg-muted border border-border rounded-xl">
      <div className="p-2.5 bg-primary/10 rounded-lg text-primary shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <div className="text-sm font-semibold text-foreground">{children}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export function DeviceStatus({ deviceId }: DeviceStatusProps) {
  const [device, setDevice] = useState<any>(undefined);
  const now = useNow(1000); // uptime ticks every second

  useEffect(() => {
    const unsubscribe = onValue(ref(db, `devices/${deviceId}`), (snapshot) => {
      setDevice(snapshot.val() ?? null);
    });
    return () => unsubscribe();
  }, [deviceId]);

  if (device === undefined) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-foreground">System Diagnostics</h2>
          <p className="text-sm text-muted-foreground">Real-time hardware monitoring</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  const online = isDeviceOnline(device, now);
  const seen = lastSeen(device);

  // Uptime = what the hub reported + time since that report (only while online)
  const reportedUptime = Number(device?.uptime);
  const uptimeMs =
    online && Number.isFinite(reportedUptime) && seen
      ? reportedUptime + Math.max(0, now - seen.getTime())
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-1 text-foreground">System Diagnostics</h2>
        <p className="text-sm text-muted-foreground">
          Live data from the central hub • {online ? 'updated every 10 s' : `hub offline, last seen ${timeAgo(seen, now)}`}
        </p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 md:p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 text-foreground">Technical Details</h3>

        <div className="grid md:grid-cols-2 gap-4">
          <Tile icon={<Cpu className="size-5" />} label="Device ID (MAC address)">
            <span className="font-mono font-bold">{deviceId}</span>
          </Tile>

          <Tile
            icon={<Clock className="size-5" />}
            label="System Uptime"
            sub={uptimeMs === null ? `Last seen ${seen ? seen.toLocaleString() : 'never'}` : 'Since the hub was last switched on'}
          >
            {uptimeMs !== null ? formatDuration(uptimeMs) : online ? 'Not reported' : 'Hub offline'}
          </Tile>

          <Tile
            icon={<MapPin className="size-5" />}
            label="GPS Status"
            sub={
              !online
                ? 'Shown when the hub is online'
                : device?.gpsFix
                ? 'Position is up to date'
                : 'Searching for satellites (works best outdoors)'
            }
          >
            {!online ? (
              <span className="text-muted-foreground">Unknown</span>
            ) : device?.gpsFix ? (
              <span className="text-success">Fix acquired</span>
            ) : (
              <span className="text-warning">No fix</span>
            )}
          </Tile>
        </div>
      </div>
    </div>
  );
}
