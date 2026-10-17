import { useEffect, useRef, useState } from 'react';
import { useBatteryLevels } from './BatteryPanel';

type Kind = 'wearable' | 'hub';

interface Msg {
  kind: Kind;
  level: number;
  /** 20, 15, 10, 5 or 0 */
  threshold: number;
}

const KINDS: Kind[] = ['wearable', 'hub'];
const LABEL: Record<Kind, string> = { wearable: 'Wearable', hub: 'Central hub' };
const ZERO_REPEAT_MS = 10_000;

/** the lowest warning step the battery is at or under (20, 15, 10, 5, 0), or null when it is above 20 % */
function stepFor(level: number): number | null {
  if (level <= 0) return 0;
  for (const t of [5, 10, 15, 20]) if (level <= t) return t;
  return null;
}

const ackKey = (deviceId: string, kind: Kind) => `lowBatteryAck:${deviceId}:${kind}`;
function getAck(deviceId: string, kind: Kind): number | null {
  try {
    const v = localStorage.getItem(ackKey(deviceId, kind));
    return v === null ? null : Number(v);
  } catch { return null; }
}
function setAck(deviceId: string, kind: Kind, v: number | null) {
  try {
    if (v === null) localStorage.removeItem(ackKey(deviceId, kind));
    else localStorage.setItem(ackKey(deviceId, kind), String(v));
  } catch { /* storage not available */ }
}

/**
 * User side pop-ups:
 *  - once at 20 %, 15 %, 10 % and 5 % (until the user presses OK)
 *  - at 0 % the pop-up comes back every 10 seconds until the battery is charged
 */
export function LowBatteryAlerts({ deviceId }: { deviceId: string }) {
  const levels = useBatteryLevels(deviceId);
  const [queue, setQueue] = useState<Msg[]>([]);
  const zeroDismissedAt = useRef<Partial<Record<Kind, number>>>({});
  const okRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      setQueue((q) => {
        let next = [...q];
        for (const kind of KINDS) {
          const level = Math.max(0, Math.min(100, Math.round(levels[kind])));
          const step = stepFor(level);

          // the battery moved to another step (or was charged): the old message is stale
          next = next.filter((m) => m.kind !== kind || (step !== null && m.threshold === step));

          if (step === null) {          // above 20 % again: forget the earlier warnings
            setAck(deviceId, kind, null);
            delete zeroDismissedAt.current[kind];
            continue;
          }

          const queued = next.find((m) => m.kind === kind);
          if (queued) {
            queued.level = level;       // keep the shown number current
            continue;
          }

          if (step === 0) {
            const last = zeroDismissedAt.current[kind];
            if (!last || now - last >= ZERO_REPEAT_MS) next.push({ kind, level, threshold: 0 });
          } else {
            const ack = getAck(deviceId, kind);
            if (ack === null || step < ack) next.push({ kind, level, threshold: step });
          }
        }
        return next;
      });
    };
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [levels.wearable, levels.hub, deviceId]);

  const current = queue[0];

  useEffect(() => {
    if (current) okRef.current?.focus();
  }, [current?.kind, current?.threshold]);

  if (!current) return null;

  const onOk = () => {
    if (current.threshold === 0) zeroDismissedAt.current[current.kind] = Date.now();
    else setAck(deviceId, current.kind, current.threshold);
    setQueue((q) => q.slice(1));
  };

  const label = LABEL[current.kind];
  const zero = current.threshold === 0;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="low-battery-title"
        className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full text-center animate-in zoom-in-95 fade-in duration-150"
      >
        <h3 id="low-battery-title" className="text-lg font-semibold text-destructive mb-2">
          {zero ? 'Low battery' : `Battery at ${current.threshold}%`}
        </h3>
        <p className="text-sm text-foreground mb-1">
          {label} battery is at <strong>{current.level}%</strong>.
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          {zero ? `Low battery, please charge the ${label.toLowerCase()} now.` : `Please charge the ${label.toLowerCase()} soon.`}
        </p>
        <button
          ref={okRef}
          type="button"
          onClick={onOk}
          className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
        >
          OK
        </button>
      </div>
    </div>
  );
}
