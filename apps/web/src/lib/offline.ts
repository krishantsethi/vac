/**
 * Offline capture queue.
 *
 * Field workers regularly lose connectivity mid-visit. A dose that was actually
 * administered must not be lost because the network dropped, and it must not be
 * invented either — so captures are written to local storage with a stable
 * client-generated id, then replayed. The API is idempotent on that id, so a
 * replay after an uncertain response cannot create a duplicate dose.
 *
 * Local storage (not IndexedDB) is deliberate: the payloads are small, and the
 * queue must survive a reload, a closed tab and a device restart.
 */

import { getToken } from "./auth";

const STORAGE_KEY = "vaxbridge_offline_queue";
const SCHEMA_VERSION = 1;

/** Mirrors MAX_BATCH_SIZE in apps/api/app/offline.py. */
export const MAX_BATCH_SIZE = 100;

export interface QueuedEventPayload {
  patient_id: string;
  patient_label?: string;
  vaccine_code?: string;
  vaccine_name?: string;
  dose_label: string;
  /** ISO date the dose was actually administered. */
  administered_at: string;
  facility?: string | null;
  batch_number?: string | null;
}

export type QueuedStatus = "queued" | "syncing" | "needs_attention";

export interface QueuedEvent {
  client_event_id: string;
  queued_at: string;
  payload: QueuedEventPayload;
  status: QueuedStatus;
  attempts: number;
  last_error?: string | null;
  /** Set when the server routed the capture to conflict review. */
  conflict?: boolean;
}

export interface SyncSummary {
  attempted: number;
  submitted: number;
  accepted: number;
  deduplicated: number;
  conflicts: number;
  rejected: number;
  skipped: "offline" | "no_session" | "empty" | null;
  message: string;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older WebViews. Still unique enough to be an idempotency key,
  // and the server caps it at 64 characters.
  return `ce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function readQueue(): QueuedEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.items)) return [];
    return parsed.items as QueuedEvent[];
  } catch {
    // A corrupt queue must never take the app down. The raw value is left in
    // place so it can be recovered rather than silently discarded.
    return [];
  }
}

function writeQueue(items: QueuedEvent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, items, saved_at: new Date().toISOString() })
    );
  } catch {
    // Quota exceeded or storage disabled — surfaced by the caller's toast.
  }
}

export function queueLength(): number {
  return readQueue().length;
}

/** True when a capture is waiting on the network or on a human decision. */
export function pendingCount(): number {
  return readQueue().filter((item) => item.status !== "needs_attention").length;
}

export function attentionCount(): number {
  return readQueue().filter((item) => item.status === "needs_attention").length;
}

export interface EnqueueResult {
  item: QueuedEvent;
  error?: string;
}

/**
 * Validate and queue one capture locally.
 *
 * Validation runs before queueing so a worker gets the error while they are
 * still with the family, not hours later when the sync fails.
 */
export function enqueueEvent(payload: QueuedEventPayload): EnqueueResult {
  const errors: string[] = [];
  if (!payload.patient_id) errors.push("A patient is required.");
  if (!payload.vaccine_code && !payload.vaccine_name) errors.push("A vaccine is required.");
  if (!payload.dose_label || !payload.dose_label.trim()) errors.push("A dose label is required.");

  if (!payload.administered_at) {
    errors.push("The administration date is required.");
  } else {
    const when = new Date(payload.administered_at);
    if (Number.isNaN(when.getTime())) {
      errors.push("That date could not be read.");
    } else if (when.getTime() > Date.now()) {
      errors.push("A dose cannot be recorded in the future.");
    }
  }

  if (errors.length) return { item: null as unknown as QueuedEvent, error: errors.join(" ") };

  const item: QueuedEvent = {
    client_event_id: newId(),
    queued_at: new Date().toISOString(),
    payload: {
      ...payload,
      dose_label: payload.dose_label.trim(),
      administered_at: new Date(payload.administered_at).toISOString(),
    },
    status: "queued",
    attempts: 0,
  };

  const queue = readQueue();
  queue.push(item);
  writeQueue(queue);
  return { item };
}

export function removeQueued(clientEventId: string) {
  writeQueue(readQueue().filter((item) => item.client_event_id !== clientEventId));
}

export function clearQueue() {
  writeQueue([]);
}

/**
 * Replay the queue.
 *
 * `synchronized` and `deduplicated` leave the queue: both mean the dose is now
 * stored exactly once. `conflict_requires_review` also leaves the queue, because
 * the server has taken custody of it for review — but the summary reports it so
 * the worker knows a decision is pending. `rejected` stays, flagged for
 * attention with the server's reason, because retrying unchanged input cannot
 * succeed and silently dropping a real capture would be worse.
 */
export async function syncQueue(): Promise<SyncSummary> {
  const summary: SyncSummary = {
    attempted: 0,
    submitted: 0,
    accepted: 0,
    deduplicated: 0,
    conflicts: 0,
    rejected: 0,
    skipped: null,
    message: "",
  };

  const queue = readQueue().filter((item) => item.status !== "needs_attention");
  summary.attempted = queue.length;
  if (queue.length === 0) {
    summary.skipped = "empty";
    summary.message = "Nothing is waiting to sync.";
    return summary;
  }
  if (!isBrowserOnline()) {
    summary.skipped = "offline";
    summary.message = "Still offline. Captures are held safely on this device.";
    return summary;
  }
  const token = getToken();
  if (!token) {
    summary.skipped = "no_session";
    summary.message = "Sign in again to sync. Captures remain on this device until then.";
    return summary;
  }

  const batch = queue.slice(0, MAX_BATCH_SIZE);
  const rest = queue.slice(MAX_BATCH_SIZE);

  // Mark as syncing so a reload mid-flight does not lose track of the attempt.
  writeQueue(
    readQueue().map((item) =>
      batch.some((b) => b.client_event_id === item.client_event_id)
        ? { ...item, status: "syncing" as QueuedStatus, attempts: item.attempts + 1 }
        : item
    )
  );

  let response: any;
  try {
    const res = await fetch("/api/v1/vaccinations/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        events: batch.map((item) => ({
          client_event_id: item.client_event_id,
          patient_id: item.payload.patient_id,
          vaccine_code: item.payload.vaccine_code,
          vaccine_name: item.payload.vaccine_name,
          dose_label: item.payload.dose_label,
          administered_at: item.payload.administered_at,
          facility: item.payload.facility || null,
          batch_number: item.payload.batch_number || null,
          recorded_at: item.queued_at,
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Sync failed (HTTP ${res.status})`);
    }
    response = await res.json();
  } catch (err: any) {
    // Network or server failure: return everything to `queued` so the next
    // attempt retries. Nothing is discarded.
    const message = err?.message || "Sync failed";
    writeQueue(
      readQueue().map((item) =>
        batch.some((b) => b.client_event_id === item.client_event_id)
          ? { ...item, status: "queued" as QueuedStatus, last_error: message }
          : item
      )
    );
    summary.message = message;
    summary.rejected = 0;
    return summary;
  }

  summary.submitted = response?.submitted ?? batch.length;
  summary.accepted = response?.accepted ?? 0;
  summary.deduplicated = response?.deduplicated ?? 0;
  summary.conflicts = response?.conflicts ?? 0;
  summary.rejected = response?.rejected ?? 0;

  const results: any[] = Array.isArray(response?.results) ? response.results : [];
  const settled = new Set<string>();
  const flagged: string[] = [];

  results.forEach((result, index) => {
    const item = batch[index];
    if (!item) return;
    const outcome = result?.status;
    if (outcome === "synchronized" || outcome === "deduplicated") {
      settled.add(item.client_event_id);
    } else if (outcome === "conflict_requires_review") {
      // The server now holds it as a conflict; retrying would only re-queue it.
      settled.add(item.client_event_id);
      flagged.push(item.client_event_id);
    } else {
      // rejected — keep it, flagged, with the server's reason.
      item.last_error = result?.reason || result?.message || "Rejected by the server";
      item.status = "needs_attention";
    }
  });

  const remaining = readQueue()
    .filter((item) => !settled.has(item.client_event_id))
    .map((item) =>
      flagged.includes(item.client_event_id) ? { ...item, conflict: true } : item
    );

  writeQueue([...remaining, ...rest]);

  const parts: string[] = [];
  if (summary.accepted) parts.push(`${summary.accepted} saved`);
  if (summary.deduplicated) parts.push(`${summary.deduplicated} already recorded`);
  if (summary.conflicts) parts.push(`${summary.conflicts} sent for conflict review`);
  if (summary.rejected) parts.push(`${summary.rejected} need attention`);
  summary.message = parts.length ? parts.join(", ") + "." : "Nothing was accepted.";
  if (rest.length) summary.message += ` ${rest.length} more remain queued.`;
  return summary;
}

/* ------------------------------------------------------------------------- */
/* Reference cache                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Minimal patient reference list, cached so a capture can still be recorded
 * while offline. Without this, going offline would make the patient picker
 * empty and the field worker could not record anything at all.
 *
 * Cached values are identifiers and names only — no clinical detail — and they
 * are refreshed on every successful load. A stale cache is a convenience for
 * capture, never a source of truth for display: each queued item stores the
 * label chosen at capture time, and the server re-resolves the patient on sync.
 */

const REFERENCE_KEY = "vaxbridge_reference_cache";

export interface CachedPatientOption {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  service_area?: string | null;
}

export interface CachedVaccineOption {
  code: string;
  name: string;
}

interface ReferenceCache {
  version: number;
  saved_at: string;
  patients: CachedPatientOption[];
  vaccines: CachedVaccineOption[];
}

function readReferenceCache(): ReferenceCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REFERENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReferenceCache;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function cachePatientOptions(patients: CachedPatientOption[]) {
  if (typeof window === "undefined" || !patients.length) return;
  const existing = readReferenceCache();
  try {
    window.localStorage.setItem(
      REFERENCE_KEY,
      JSON.stringify({
        version: 1,
        saved_at: new Date().toISOString(),
        patients,
        vaccines: existing?.vaccines || [],
      })
    );
  } catch {
    /* quota — the cache is a convenience, not a requirement */
  }
}

export function cacheVaccineOptions(vaccines: CachedVaccineOption[]) {
  if (typeof window === "undefined" || !vaccines.length) return;
  const existing = readReferenceCache();
  try {
    window.localStorage.setItem(
      REFERENCE_KEY,
      JSON.stringify({
        version: 1,
        saved_at: new Date().toISOString(),
        patients: existing?.patients || [],
        vaccines,
      })
    );
  } catch {
    /* quota — the cache is a convenience, not a requirement */
  }
}

export function readCachedPatients(): CachedPatientOption[] {
  return readReferenceCache()?.patients || [];
}

export function readCachedVaccines(): CachedVaccineOption[] {
  return readReferenceCache()?.vaccines || [];
}

/** When the reference cache was last refreshed, for honest "may be stale" copy. */
export function referenceCacheAge(): string | null {
  return readReferenceCache()?.saved_at || null;
}
