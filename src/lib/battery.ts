import { useEffect, useState } from 'react';
import { db, ref, onValue, runTransaction } from './db';

/**
 * Demo battery: the real battery readings are not available yet, so the percentage
 * shown on the website goes down 3 % for every 30 minutes the website is OPEN.
 * While the website is closed nothing goes down.
 *
 * The values live in Firebase (devices/{id}/batteries = { wearable, hub, tickAt, acc })
 * so the admin side and the user side always show the same numbers.
 * To make a device 100 % again, delete its "batteries" node in the Firebase console.
 */

export const DEFAULT_LEVELS = { wearable: 100, hub: 100 };

export const DRAIN_PERCENT = 3;
const DRAIN_EVERY_MS = 30 * 60 * 1000;   // 30 minutes of "website open" time
const TICK_MS = 60 * 1000;               // check once a minute
const MAX_GAP_MS = 150 * 1000;           // a longer gap means the website was closed -> not counted

/** Green 50 % and up, yellow 21-49 %, red 20 % and below. */
export type BatteryTone = 'good' | 'medium' | 'low';

export function batteryTone(level: number): BatteryTone {
  if (level >= 50) return 'good';
  if (level > 20) return 'medium';
  return 'low';
}

export const BATTERY_CLASSES: Record<BatteryTone, { text: string; bg: string; soft: string; label: string }> = {
  good: { text: 'text-success', bg: 'bg-success', soft: 'bg-success/15', label: 'Good' },
  medium: { text: 'text-warning', bg: 'bg-warning', soft: 'bg-warning/15', label: 'Medium' },
  low: { text: 'text-destructive', bg: 'bg-destructive', soft: 'bg-destructive/15', label: 'Low' },
};

export function batteryClasses(level: number) {
  return BATTERY_CLASSES[batteryTone(level)];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One "the website is open" tick for one device. Safe when several tabs / admin + user are open at once. */
export function drainBatteryOnce(deviceId: string) {
  return runTransaction(ref(db, `devices/${deviceId}/batteries`), (current: any) => {
    const c = current && typeof current === 'object' ? current : {};
    const now = Date.now();

    let wearable = isNum(c.wearable) ? c.wearable : DEFAULT_LEVELS.wearable;
    let hub = isNum(c.hub) ? c.hub : DEFAULT_LEVELS.hub;
    let acc = isNum(c.acc) ? c.acc : 0;

    // time since the last tick by ANY open tab; only a short gap counts as "website open"
    const gap = isNum(c.tickAt) ? now - c.tickAt : 0;
    if (gap > 0 && gap <= MAX_GAP_MS) acc += gap;

    while (acc >= DRAIN_EVERY_MS) {
      wearable = Math.max(0, wearable - DRAIN_PERCENT);
      hub = Math.max(0, hub - DRAIN_PERCENT);
      acc -= DRAIN_EVERY_MS;
    }

    return { ...c, wearable, hub, tickAt: now, acc };
  });
}

/** Keeps the battery going down while this page is open. */
export function useBatteryDrain(deviceIds: string[]) {
  const key = [...deviceIds].sort().join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (!ids.length) return;
    const tick = () => ids.forEach((id) => { drainBatteryOnce(id).catch(() => {}); });
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [key]);
}

/** Admin side: every device that belongs to a registered family. */
export function useAdminBatteryDrain() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    const unsub = onValue(ref(db, 'families'), (snap) => {
      const v = snap.val() || {};
      const set = new Set<string>();
      Object.values(v).forEach((f: any) => {
        const id = f?.deviceId || f?.deviceSerialNumber;
        if (id) set.add(String(id));
      });
      setIds([...set]);
    }, () => {});
    return () => unsub();
  }, []);

  useBatteryDrain(ids);
}
