/** Time format used by the Alert Delivery page. */
export function fmtTime(d: Date | null): string {
  return d ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—";
}
