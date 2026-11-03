"use client";

import { Badge } from "@/components/ui/badge";

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  delta?: string;
  status?: "ok" | "warn" | "critical" | "muted";
}

export function MetricCard({ label, value, delta, status }: MetricCardProps) {
  const statusConfig: Record<string, { bg: string; border: string; text: string }> = {
    ok: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400" },
    warn: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400" },
    critical: { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400" },
    muted: { bg: "bg-slate-500/10", border: "border-slate-500/20", text: "text-slate-400" },
  };
  const cfg = statusConfig[status ?? "muted"];
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="font-display font-bold text-2xl text-text tabular-nums">{value}</span>
        {delta && (
          <span className="text-sm font-medium {cfg.text}">{delta}</span>
        )}
      </div>
      <span className={`inline-block mt-2 rounded-full px-2 py-0.5 text-xs border ${cfg.border} ${cfg.bg} ${cfg.text}`}>
        {status ? status.toUpperCase() : "—"}
      </span>
    </div>
  );
}
