import { batteryClasses } from '../../lib/battery';

/** Battery percentage as a bold coloured pill: green 50 % and up, yellow 21-49 %, red 20 % and below. */
export function BatteryBadge({ level }: { level: number | null | undefined }) {
  if (level === null || level === undefined || Number.isNaN(level)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const pct = Math.max(0, Math.min(100, Math.round(level)));
  const c = batteryClasses(pct);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${c.soft} ${c.text}`}>
      {pct}%
    </span>
  );
}
