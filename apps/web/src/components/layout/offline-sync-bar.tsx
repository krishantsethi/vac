"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Loader2,
  RefreshCw,
  Trash2,
  Wifi,
} from "lucide-react";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import { removeQueued } from "@/lib/offline";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDateIN } from "@/lib/utils";

/**
 * Persistent connectivity and capture-queue indicator.
 *
 * Sits above the app content so a field worker always knows two things: whether
 * the device is connected, and whether any dose they recorded is still waiting
 * on this device. Silence here would be the worst outcome — an unsynced capture
 * that looks like a saved one is how real doses get lost.
 */
export function OfflineSyncBar() {
  const { online, pending, needsAttention, items, syncing, lastSummary, refresh, sync } =
    useOfflineQueue();
  const [expanded, setExpanded] = useState(false);

  const total = items.length;
  if (online && total === 0 && !lastSummary) return null;

  async function handleSync() {
    const summary = await sync();
    if (summary.skipped === "offline") {
      toast(summary.message, { variant: "info" });
    } else if (summary.skipped === "no_session") {
      toast(summary.message, { variant: "error" });
    } else if (summary.rejected > 0) {
      toast(summary.message, { variant: "error" });
    } else if (summary.attempted > 0) {
      toast(summary.message, { variant: "success" });
    }
  }

  const tone = !online
    ? "border-amber-500/35 bg-amber-500/10"
    : needsAttention > 0
    ? "border-red-500/35 bg-red-500/10"
    : pending > 0
    ? "border-cyan/35 bg-cyan/8"
    : "border-mint/30 bg-mint/8";

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${tone}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2 text-sm font-medium text-text">
          {online ? (
            <Wifi className="h-4 w-4 shrink-0 text-mint" aria-hidden />
          ) : (
            <CloudOff className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          )}
          {online ? "Connected" : "Offline"}
        </span>

        <span className="text-xs text-text-secondary">
          {total === 0
            ? online
              ? "No captures are waiting on this device."
              : "Captures you record now are stored on this device and sent when you reconnect."
            : `${total} capture${total === 1 ? "" : "s"} on this device`}
          {pending > 0 && total > 0 ? ` · ${pending} ready to send` : ""}
          {needsAttention > 0 ? ` · ${needsAttention} need attention` : ""}
        </span>

        <span className="ml-auto flex items-center gap-2">
          {total > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-cyan"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expanded ? "Hide queue" : "View queue"}
            </button>
          )}
          {pending > 0 && (
            <Button variant="primary" size="sm" onClick={handleSync} disabled={syncing || !online}>
              {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
              {syncing ? "Syncing…" : `Sync ${pending}`}
            </Button>
          )}
        </span>
      </div>

      {lastSummary && lastSummary.attempted > 0 && (
        <p className="mt-2 flex items-start gap-2 border-t border-border/40 pt-2 text-xs text-text-secondary">
          {lastSummary.rejected > 0 ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint" aria-hidden />
          )}
          Last sync: {lastSummary.message}
        </p>
      )}

      {!online && (
        <p className="mt-2 border-t border-border/40 pt-2 text-[11px] leading-relaxed text-text-secondary/85">
          Offline mode stores captures locally with a stable id. Replaying after a dropped response
          cannot create a duplicate dose, and a capture that conflicts with an existing record is
          routed for review rather than overwriting it.
        </p>
      )}

      {expanded && total > 0 && (
        <ul className="mt-3 space-y-2 border-t border-border/40 pt-3">
          {items.map((item) => (
            <li
              key={item.client_event_id}
              className="rounded-md border border-border/60 bg-navy-secondary/40 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">
                    {item.payload.vaccine_code || item.payload.vaccine_name} · {item.payload.dose_label}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {item.payload.patient_label || item.payload.patient_id} · administered{" "}
                    {formatDateIN(item.payload.administered_at)} · queued {formatDateIN(item.queued_at)}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-text-secondary/60">
                    {item.client_event_id}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.status === "needs_attention" ? (
                    <span className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-red-300">
                      needs attention
                    </span>
                  ) : item.status === "syncing" ? (
                    <span className="rounded border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan">
                      syncing
                    </span>
                  ) : (
                    <span className="rounded border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-secondary">
                      queued
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      removeQueued(item.client_event_id);
                      refresh();
                      toast("Capture removed from this device", { variant: "info" });
                    }}
                    aria-label={`Discard queued capture for ${item.payload.vaccine_code || "vaccine"}`}
                    className="rounded p-1 text-text-secondary/70 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              {item.last_error && (
                <p className="mt-2 rounded border border-red-500/25 bg-red-500/8 p-2 text-[11px] leading-relaxed text-text-secondary">
                  {item.last_error}
                </p>
              )}
              {item.conflict && (
                <p className="mt-2 rounded border border-amber-500/25 bg-amber-500/8 p-2 text-[11px] leading-relaxed text-text-secondary">
                  The server routed this capture to conflict review. The stored record was not
                  changed; resolve it under Vaccination Records.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {expanded && total > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-text-secondary/80">
          Discarding removes a capture from this device only. It never deletes anything already
          stored on the server.
        </p>
      )}
    </div>
  );
}
