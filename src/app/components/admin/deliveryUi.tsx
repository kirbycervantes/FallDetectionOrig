import {
  CheckCircle2, XCircle, Clock, HelpCircle, Loader2, MessageSquare, PhoneCall,
} from "lucide-react";
import {
  channelKind, type AlertRow, type Channel, type ChannelKind, type ChannelRecord, type ChannelStatus, type Overall,
} from "./deliveryModel";

/* ------------------------------------------------------------------ */
/* Presentational pieces                                               */
/* ------------------------------------------------------------------ */

export const KIND_STYLE: Record<ChannelKind, string> = {
  success: "bg-success/10 text-success border-success/25",
  pending: "bg-warning/10 text-warning border-warning/25",
  failure: "bg-destructive/10 text-destructive border-destructive/25",
  unknown: "bg-muted text-muted-foreground border-border",
};

export function StatusIcon({ status, className = "size-3.5" }: { status: ChannelStatus; className?: string }) {
  const kind = channelKind(status);
  if (kind === "success") return <CheckCircle2 className={className} aria-hidden="true" />;
  if (kind === "failure") return <XCircle className={className} aria-hidden="true" />;
  if (status === "Sending") return <Loader2 className={`${className} animate-spin motion-reduce:animate-none`} aria-hidden="true" />;
  if (kind === "pending") return <Clock className={className} aria-hidden="true" />;
  return <HelpCircle className={className} aria-hidden="true" />;
}

export function ChannelBadge({ status, label }: { status: ChannelStatus; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-medium ${KIND_STYLE[channelKind(status)]}`}>
      <StatusIcon status={status} />
      {label ? <span className="sr-only">{label}: </span> : null}
      {status}
    </span>
  );
}

export const OVERALL_STYLE: Record<Overall, { cls: string; icon: JSX.Element }> = {
  Successful: { cls: "bg-success text-white border-success", icon: <CheckCircle2 className="size-3.5" aria-hidden="true" /> },
  Failed: { cls: "bg-destructive text-white border-destructive", icon: <XCircle className="size-3.5" aria-hidden="true" /> },
  "In progress": { cls: "bg-warning/15 text-warning border-warning/30", icon: <Clock className="size-3.5" aria-hidden="true" /> },
  Unconfirmed: { cls: "bg-muted text-muted-foreground border-border", icon: <HelpCircle className="size-3.5" aria-hidden="true" /> },
};

export function OverallBadge({ row }: { row: AlertRow }) {
  const st = OVERALL_STYLE[row.overall];
  const partial = row.overall === "Successful" && (channelKind(row.sms) !== "success" || channelKind(row.call) !== "success");
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-semibold ${st.cls}`}>
        {st.icon}
        {row.overall}
      </span>
      {partial && (
        <span className="text-[11px] text-muted-foreground">
          {channelKind(row.sms) === "success" ? "Call did not connect" : "SMS not confirmed"}
        </span>
      )}
    </div>
  );
}

export function fmtTime(d: Date | null): string {
  return d ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—";
}

export function ChannelDetail({ channel, rec }: { channel: Channel; rec: ChannelRecord }) {
  const title = channel === "sms" ? "SMS" : "Call";
  const first = rec.attempts[0]?.at ?? null;
  const last = rec.attempts[rec.attempts.length - 1]?.at ?? null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h5 className="flex items-center gap-2 text-sm font-medium text-foreground">
          {channel === "sms" ? <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" /> : <PhoneCall className="size-4 text-muted-foreground" aria-hidden="true" />}
          {title}
        </h5>
        <ChannelBadge status={rec.status} label={title} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Provider</dt>
        <dd className="text-foreground">{rec.provider ?? "—"}</dd>
        <dt className="text-muted-foreground">Provider response</dt>
        <dd className="font-mono text-foreground break-all">{rec.providerResponse ?? "—"}</dd>
        <dt className="text-muted-foreground">Failure reason / code</dt>
        <dd className={channelKind(rec.status) === "failure" ? "text-destructive" : "text-foreground"}>
          {rec.reason || rec.code ? [rec.reason, rec.code ? `(${rec.code})` : null].filter(Boolean).join(" ") : "—"}
        </dd>
        <dt className="text-muted-foreground">Attempts</dt>
        <dd className="text-foreground">{rec.attempts.length}</dd>
        <dt className="text-muted-foreground">First attempt</dt>
        <dd className="text-foreground">{fmtTime(first)}</dd>
        <dt className="text-muted-foreground">Last update</dt>
        <dd className="text-foreground">{fmtTime(last)}</dd>
      </dl>
      {rec.attempts.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Retry history</p>
          <ol className="space-y-1.5 border-l border-border pl-3">
            {rec.attempts.map((a, i) => (
              <li key={i} className="text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">#{i + 1}</span>
                  <span className="text-foreground">{fmtTime(a.at)}</span>
                  <ChannelBadge status={a.status} />
                </div>
                {(a.response || a.code) && (
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground break-all">
                    {a.response}{a.code && a.response?.includes(a.code) === false ? ` · ${a.code}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

