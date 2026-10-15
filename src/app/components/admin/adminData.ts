import { DEFAULT_LEVELS } from "../BatteryPanel";
import { resolveEventTime } from "../../../lib/time";
import { isDeviceOnline } from "../../../lib/deviceStatus";

export function familyDeviceId(f: any): string | undefined {
  return f?.deviceId || f?.deviceSerialNumber || undefined;
}

export function personName(f: any, device?: any): string {
  return f?.monitoredPerson?.name || f?.monitoredPersonName || f?.patientName || device?.user?.name || "Unknown";
}

// Same source as the caregiver dashboard: devices/{id}/batteries, static defaults until real values arrive
export function batteryLevels(device: any) {
  const b = device?.batteries || {};
  return {
    wearable: typeof b.wearable === 'number' ? b.wearable : DEFAULT_LEVELS.wearable,
    hub: typeof b.hub === 'number' ? b.hub : DEFAULT_LEVELS.hub,
  };
}

export type DeviceState = "online" | "offline" | "low_battery";

// Online = the hub sent a heartbeat in the last 60 s (same rule as the caregiver site)
export function deviceState(device: any, now: number = Date.now()): DeviceState {
  if (!isDeviceOnline(device, now)) return 'offline';
  const l = batteryLevels(device);
  return Math.min(l.wearable, l.hub) < 20 ? 'low_battery' : 'online';
}

/** events/{deviceId}/{eventId} -> flat list with real dates */
export function flattenEvents(events: any) {
  const out: { deviceId: string; eventId: string; status: string; date: Date; raw: any }[] = [];
  Object.keys(events || {}).forEach(deviceId => {
    const devEvents = events[deviceId];
    if (!devEvents || typeof devEvents !== 'object') return;
    Object.keys(devEvents).forEach(eventId => {
      const ev = devEvents[eventId];
      if (!ev || typeof ev !== 'object') return;
      out.push({ deviceId, eventId, status: ev.status, date: resolveEventTime(eventId, ev.timestamp), raw: ev });
    });
  });
  return out;
}
