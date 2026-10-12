import { useState, useEffect } from 'react';
import { Battery, Wifi, Radio, Activity, Clock, MapPin, Cpu, Signal, Zap } from 'lucide-react';
import { db, ref, onValue } from '../../lib/db';
import { SkeletonCard } from './ui/skeleton';
import { BatteryPanel } from './BatteryPanel';
import { validDate } from '../../lib/time';

interface DeviceStatusProps {
  deviceId: string;
}

export function DeviceStatus({ deviceId }: DeviceStatusProps) {
  const [deviceData, setDeviceData] = useState<any>(null);

  useEffect(() => {
    const deviceRef = ref(db, `devices/${deviceId}`);
    const unsubscribe = onValue(deviceRef, (snapshot) => {
      setDeviceData(snapshot.val());
    });
    return () => unsubscribe();
  }, [deviceId]);

  if (!deviceData) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-foreground">System Diagnostics</h2>
          <p className="text-sm text-muted-foreground">Real-time hardware monitoring</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }
  const getBatteryColor = (level: number) => {
    if (level > 50) return 'emerald';
    if (level > 20) return 'amber';
    return 'red';
  };
  
  const batteryColor = getBatteryColor(deviceData.battery);
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-1 text-foreground">System Diagnostics</h2>
        <p className="text-sm text-muted-foreground">Real-time hardware monitoring</p>
      </div>
      
      {/* Primary Status Cards */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Connection Status */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Network Status</p>
              <p className="text-3xl font-bold capitalize text-foreground">{deviceData.status}</p>
            </div>
            <div className="p-3 bg-success/10 rounded-xl">
              <Wifi className="size-8 text-success" />
            </div>
          </div>
          
          <div className="flex items-center gap-2 pt-4 border-t border-border">
            <Clock className="size-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Last seen: {validDate(deviceData.lastUpdate)?.toLocaleString() ?? 'Just now'}
            </span>
          </div>
          
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Signal Strength</span>
            <div className="flex gap-1 items-end h-5">
              {[1, 2, 3, 4, 5].map((bar) => (
                <div
                  key={bar}
                  className={`w-1 rounded-full ${
                    bar <= 4 ? 'bg-success' : 'bg-muted'
                  }`}
                  style={{ height: `${bar * 3 + 2}px` }}
                ></div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Battery Status: Wearable + Central Hub */}
        <BatteryPanel deviceId={deviceId} />
      </div>
      
      {/* Technical Information Grid */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-6 text-foreground">Technical Details</h3>
        
        <div className="grid md:grid-cols-2 gap-4">
          <div className="flex items-center gap-4 p-4 bg-muted border border-border rounded-xl">
            <div className="p-2.5 bg-primary/10 rounded-lg">
              <Cpu className="size-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Device ID</p>
              <p className="font-mono text-sm font-semibold text-foreground">ESP32-FD-001</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 p-4 bg-muted border border-border rounded-xl">
            <div className="p-2.5 bg-primary/10 rounded-lg">
              <Signal className="size-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Network Type</p>
              <p className="text-sm font-semibold text-foreground">GSM/GPRS</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 p-4 bg-muted border border-border rounded-xl">
            <div className="p-2.5 bg-success/10 rounded-lg">
              <Radio className="size-5 text-success" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Signal Strength</p>
              <p className="text-sm font-semibold text-success">Strong (4/5)</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 p-4 bg-muted border border-border rounded-xl">
            <div className="p-2.5 bg-success/10 rounded-lg">
              <MapPin className="size-5 text-success" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">GPS Status</p>
              <p className="text-sm font-semibold text-success">Active</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 p-4 bg-muted border border-border rounded-xl">
            <div className="p-2.5 bg-warning/10 rounded-lg">
              <Zap className="size-5 text-warning" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Firmware Version</p>
              <p className="font-mono text-sm font-semibold text-foreground">v1.2.0</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 p-4 bg-muted border border-border rounded-xl">
            <div className="p-2.5 bg-primary/10 rounded-lg">
              <Clock className="size-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">System Uptime</p>
              <p className="text-sm font-semibold text-foreground">12h 34m</p>
            </div>
          </div>
        </div>
      </div>


    </div>
  );
}
