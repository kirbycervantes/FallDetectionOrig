import { useEffect, useState } from 'react';
import { validDate } from './time';

// The hub saves its status every 10 s. If nothing arrived for 60 s it is offline.
export const ONLINE_WINDOW_MS = 60_000;

/** Re-renders every `intervalMs` so "online" and "x min ago" stay correct. */
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function lastSeen(device: any): Date | null {
  return validDate(device?.lastUpdate) ?? validDate(device?.lastSeen);
}

export function isDeviceOnline(device: any, now: number): boolean {
  const seen = lastSeen(device);
  return !!seen && now - seen.getTime() < ONLINE_WINDOW_MS;
}

/** "just now", "3 min ago", "2 h ago", "4 days ago" */
export function timeAgo(date: Date | null, now: number): string {
  if (!date) return 'never';
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 30) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** 93784000 ms -> "1d 2h 3m" */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor(ms / 1000) % 60;
  return `${m}m ${s}s`;
}
