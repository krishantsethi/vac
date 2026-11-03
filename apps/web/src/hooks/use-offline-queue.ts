"use client";

import { useCallback, useEffect, useState } from "react";
import {
  attentionCount,
  isBrowserOnline,
  pendingCount,
  readQueue,
  syncQueue,
  type QueuedEvent,
  type SyncSummary,
} from "@/lib/offline";

export interface OfflineQueueState {
  online: boolean;
  pending: number;
  needsAttention: number;
  items: QueuedEvent[];
  syncing: boolean;
  lastSummary: SyncSummary | null;
  refresh: () => void;
  sync: () => Promise<SyncSummary>;
}

/**
 * Reactive view of the offline capture queue.
 *
 * Tracks the browser's connectivity and re-reads local storage, including from
 * other tabs, so a capture made in one tab is visible in another.
 */
export function useOfflineQueue(): OfflineQueueState {
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState<QueuedEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);

  const refresh = useCallback(() => {
    setItems(readQueue());
    setOnline(isBrowserOnline());
  }, []);

  useEffect(() => {
    refresh();

    const goOnline = () => {
      setOnline(true);
    };
    const goOffline = () => {
      setOnline(false);
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const summary = await syncQueue();
      setLastSummary(summary);
      refresh();
      return summary;
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  return {
    online,
    pending: items.filter((item) => item.status !== "needs_attention").length,
    needsAttention: items.filter((item) => item.status === "needs_attention").length,
    items,
    syncing,
    lastSummary,
    refresh,
    sync,
  };
}

/** Convenience counters for components that only need the badge numbers. */
export function useQueueCounts() {
  return { pending: pendingCount(), needsAttention: attentionCount() };
}
