import { useState, useEffect, type ReactNode } from 'react';
import { Clock, MapPin, Cpu, Signal, Wifi } from 'lucide-react';
import { db, ref, onValue } from '../../lib/db';
import { SkeletonCard } from './ui/skeleton';
import { formatDuration, isDeviceOnline, lastSeen, timeAgo, useNow } from '../../lib/deviceStatus';

interface DeviceStatusProps {
  deviceId: string;
}

/** WiFi RSSI (dBm) -> 0..4 bars */
function wifiBars(rssi: number) {
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

/** SIM800L AT+CSQ value (0-31, 99 = unknown) -> 0..4 bars */
function gsmBars(csq: number) {
  if (csq >= 20) return 4;
  if (csq >= 15) return 3;
  if (csq >= 10) return 2;
  if (csq >= 2) return 1;
  return 0;
}

const BAR_LABEL = ['No signal', 'Weak', 'Fair', 'Good', 'Excellent'];

function Bars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-end gap-0.5 h-4" aria-hidden="true">
      {[1, 2, 3, 4].map((b) => (
        <span
          key={b}
          className={`w-1 rounded-full ${b <= value ? 'bg-success' : 'bg-border'}`}
          style={{ height: `${b * 3 + 4}px` }}
        />
      ))}
    </span>
  );
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

  const wifiRssi = Number(device?.wifiRssi);
  const hasWifi = Number.isFinite(wifiRssi) && wifiRssi < 0;
  const gsmCsq = Number(device?.gsmSignal);
  const hasGsm = Number.isFinite(gsmCsq) && gsmCsq >= 0 && gsmCsq <= 31;

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
          <Tile icon={<Cpu className="size-5" />} label="Device ID (serial number)">
            <span className="font-mono">{deviceId}</span>
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

          <Tile icon={<Signal className="size-5" />} label="Signal Strength">
            {!online ? (
              <span className="text-muted-foreground">Unknown (hub offline)</span>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Signal className="size-3.5 text-muted-foreground" />
                  <span className="w-20 text-xs text-muted-foreground font-normal">Mobile (SIM)</span>
                  {hasGsm ? (
                    <>
                      <Bars value={gsmBars(gsmCsq)} />
                      <span>{BAR_LABEL[gsmBars(gsmCsq)]}</span>
                      <span className="text-xs text-muted-foreground font-normal">({gsmCsq}/31)</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground font-normal">Not reported</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Wifi className="size-3.5 text-muted-foreground" />
                  <span className="w-20 text-xs text-muted-foreground font-normal">WiFi</span>
                  {hasWifi ? (
                    <>
                      <Bars value={wifiBars(wifiRssi)} />
                      <span>{BAR_LABEL[wifiBars(wifiRssi)]}</span>
                      <span className="text-xs text-muted-foreground font-normal">({wifiRssi} dBm)</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground font-normal">Not reported</span>
                  )}
                </div>
              </div>
            )}
          </Tile>
        </div>
      </div>
    </div>
  );
}
