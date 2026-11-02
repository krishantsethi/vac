"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Loader2,
  PhoneCall,
  Plus,
  RefreshCw,
  Send,
  UserCheck,
} from "lucide-react";
import { API } from "@/lib/api";
import { can, OUTREACH_MANAGE, OUTREACH_VIEW } from "@/lib/capabilities";
import { getUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { formatDateIN, formatDateShort } from "@/lib/utils";

interface OutreachTask {
  id: string;
  patient_id: string;
  title: string;
  reason?: string | null;
  priority_score?: number | null;
  priority_explanation?: string | null;
  status: string;
  assigned_worker_id?: string | null;
  due_date?: string | null;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
}

interface Attempt {
  id: string;
  attempt_type: string;
  outcome: string;
  notes?: string | null;
  attempted_at: string;
}

interface PatientBrief {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  service_area?: string | null;
}

const STATUSES = ["open", "in_progress", "escalated", "resolved"] as const;

const STATUS_BADGE: Record<string, "pending" | "warn" | "critical" | "verified" | "default"> = {
  open: "pending",
  in_progress: "warn",
  escalated: "critical",
  resolved: "verified",
};

const ATTEMPT_TYPES = [
  { value: "phone", label: "Phone call" },
  { value: "sms", label: "SMS / message" },
  { value: "visit", label: "Home or clinic visit" },
  { value: "other", label: "Other" },
];

/** Mirrors the server's OUTREACH_OUTCOMES. */
const OUTCOMES = [
  { value: "contacted", label: "Reached the family", tone: "ok" },
  { value: "attempted", label: "Attempted, no answer", tone: "neutral" },
  { value: "unreachable", label: "Unreachable on this contact detail", tone: "neutral" },
  { value: "appointment_scheduled", label: "Appointment scheduled", tone: "ok" },
  { value: "dose_administered", label: "Dose administered", tone: "ok" },
  { value: "refused", label: "Caregiver declined this dose", tone: "respect" },
  { value: "migrated", label: "Family has migrated / moved", tone: "respect" },
  { value: "deceased", label: "Child deceased", tone: "respect" },
];

const OUTCOME_TONE: Record<string, "verified" | "pending" | "default" | "warn"> = {
  ok: "verified",
  neutral: "pending",
  respect: "default",
};

export function OutreachPage() {
  const user = getUser();
  const isWorker = user?.role === "healthcare_worker";

  const [tasks, setTasks] = useState<OutreachTask[]>([]);
  const [patients, setPatients] = useState<PatientBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loadingAttempts, setLoadingAttempts] = useState(false);

  const [attemptForm, setAttemptForm] = useState({
    attempt_type: "phone",
    outcome: "contacted",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [prioritizing, setPrioritizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mayView = can(OUTREACH_VIEW);
  const mayManage = can(OUTREACH_MANAGE);

  const patientById = useMemo(() => {
    const map = new Map<string, PatientBrief>();
    patients.forEach((p) => map.set(p.id, p));
    return map;
  }, [patients]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}&page_size=100` : "?page_size=100";
      const data = await API.get(`/api/v1/outreach${query}`);
      setTasks(data?.items || []);
    } catch (err: any) {
      setError(err?.message || "Could not load outreach tasks.");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (!mayView) {
      setLoading(false);
      return;
    }
    loadTasks();
    (async () => {
      try {
        const data = await API.get("/api/v1/patients?page_size=100");
        setPatients(data?.items || []);
      } catch {
        // Names are a convenience; the task list still works without them.
      }
    })();
  }, [mayView, loadTasks]);

  const selected = tasks.find((t) => t.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId || !mayView) {
      setAttempts([]);
      return;
    }
    let alive = true;
    (async () => {
      setLoadingAttempts(true);
      try {
        const data = await API.get(`/api/v1/outreach/${selectedId}/attempts`);
        if (alive) setAttempts(Array.isArray(data) ? data : data?.items || []);
      } catch {
        if (alive) setAttempts([]);
      } finally {
        if (alive) setLoadingAttempts(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedId, mayView]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tasks;
    return tasks.filter((task) => {
      const patient = patientById.get(task.patient_id);
      const name = patient ? `${patient.first_name} ${patient.last_name}`.toLowerCase() : "";
      return (
        task.title.toLowerCase().includes(term) ||
        (task.reason || "").toLowerCase().includes(term) ||
        name.includes(term) ||
        (patient?.patient_id || "").toLowerCase().includes(term)
      );
    });
  }, [tasks, search, patientById]);

  async function logAttempt(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setSubmitting(true);
    try {
      await API.post(`/api/v1/outreach/${selectedId}/attempts`, {
        attempt_type: attemptForm.attempt_type,
        outcome: attemptForm.outcome,
        notes: attemptForm.notes.trim() || null,
      });
      toast("Contact attempt logged", { variant: "success" });
      setAttemptForm({ attempt_type: attemptForm.attempt_type, outcome: "contacted", notes: "" });
      const data = await API.get(`/api/v1/outreach/${selectedId}/attempts`);
      setAttempts(Array.isArray(data) ? data : data?.items || []);
      await loadTasks();
    } catch (err: any) {
      const message = err?.message || "Could not log the attempt";
      toast(message, { variant: "error" });
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(next: string) {
    if (!selectedId) return;
    try {
      await API.patch(`/api/v1/outreach/${selectedId}`, { status: next });
      toast(`Task marked ${next.replace(/_/g, " ")}`, { variant: "success" });
      await loadTasks();
    } catch (err: any) {
      const message = err?.message || "Could not update the task";
      toast(message, { variant: "error" });
      setError(message);
    }
  }

  async function reprioritize() {
    if (!selectedId) return;
    setPrioritizing(true);
    try {
      const result = await API.post(`/api/v1/outreach/${selectedId}/prioritize`, {});
      // The endpoint answers with {task_id, score, band, explanation, detail, disclaimer}.
      const score = typeof result?.score === "number" ? result.score.toFixed(1) : "—";
      toast(`Priority recomputed: ${score}${result?.band ? ` (${result.band})` : ""}`, {
        variant: "success",
      });
      await loadTasks();
      const data = await API.get(`/api/v1/outreach/${selectedId}/attempts`);
      setAttempts(Array.isArray(data) ? data : data?.items || []);
    } catch (err: any) {
      const message = err?.message || "Could not recompute priority";
      toast(message, { variant: "error" });
      setError(message);
    } finally {
      setPrioritizing(false);
    }
  }

  if (!mayView) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold text-text">Outreach</h1>
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-10">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
            <div className="space-y-2">
              <p className="text-sm font-medium text-text">
                Outreach follow-up is limited to clinical and public-health roles.
              </p>
              <p className="max-w-2xl text-xs leading-relaxed text-text-secondary">
                Your account can still see your own immunisation record, schedule and appointments.
                The API enforces this restriction independently of what the interface shows.
              </p>
              <Link href="/app" className="inline-block text-xs text-cyan hover:underline">
                Back to overview →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedPatient = selected ? patientById.get(selected.patient_id) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text">Outreach follow-up</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-secondary">
            Every task exists because a gap or an uncertain record was identified — not because a
            family failed to comply. Priority scores rank follow-up work; they are not a prediction
            of medical risk.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadTasks}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {isWorker && (
        <p className="rounded-md border border-border bg-navy-secondary/40 px-3 py-2 text-xs text-text-secondary">
          You are signed in as a healthcare worker, so only tasks assigned to you are listed and
          only those can be updated.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/8 p-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <p className="text-text-secondary">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter("")}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "" ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-border text-text-secondary hover:text-text"
            }`}
          >
            All
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                statusFilter === s ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-border text-text-secondary hover:text-text"
              }`}
            >
              {s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <div className="min-w-52 flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by patient, title or reason"
            aria-label="Search outreach tasks"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">Tasks ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && <Skeleton className="h-40 rounded-md" />}
            {!loading && filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-text-secondary">
                No tasks match this view.
              </p>
            )}
            {filtered.map((task) => {
              const patient = patientById.get(task.patient_id);
              const active = task.id === selectedId;
              const overdue =
                task.due_date && task.status !== "resolved" && new Date(task.due_date) < new Date();
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedId(task.id)}
                  aria-pressed={active}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    active ? "border-cyan/50 bg-cyan/8" : "border-border/60 bg-navy-secondary/30 hover:border-cyan/30"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text">{task.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-text-secondary">
                        {patient ? `${patient.first_name} ${patient.last_name}` : "Patient record"}
                        {patient?.patient_id ? ` · ${patient.patient_id}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-semibold text-cyan">
                        {typeof task.priority_score === "number" ? task.priority_score.toFixed(0) : "—"}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wider text-text-secondary/70">
                        priority
                      </span>
                    </span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant={STATUS_BADGE[task.status] || "default"}>{task.status.replace(/_/g, " ")}</Badge>
                    {overdue && <Badge variant="critical">past due</Badge>}
                    {task.due_date && (
                      <span className="flex items-center gap-1 text-[11px] text-text-secondary">
                        <CalendarClock className="h-3 w-3" aria-hidden />
                        {formatDateShort(task.due_date)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {!selected ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-text-secondary">
              Select a task to see its evidence, contact history and follow-up options.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="text-base">{selected.title}</CardTitle>
                  <p className="mt-1 text-xs text-text-secondary">
                    {selectedPatient ? (
                      <Link
                        href={`/app/patients/${selectedPatient.patient_id}`}
                        className="text-cyan hover:underline"
                      >
                        {selectedPatient.first_name} {selectedPatient.last_name} · {selectedPatient.patient_id}
                        <ArrowUpRight className="ml-1 inline h-3 w-3" aria-hidden />
                      </Link>
                    ) : (
                      "Patient details unavailable to this account"
                    )}
                    {selectedPatient?.service_area ? ` · ${selectedPatient.service_area}` : ""}
                  </p>
                </div>
                <Badge variant={STATUS_BADGE[selected.status] || "default"}>
                  {selected.status.replace(/_/g, " ")}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {selected.reason && (
                  <div className="rounded-md border border-border bg-navy-secondary/40 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                      Why this task exists
                    </p>
                    <p className="mt-1 text-sm text-text">{selected.reason}</p>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-border bg-navy-secondary/40 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                      Priority score
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold text-cyan">
                      {typeof selected.priority_score === "number" ? selected.priority_score.toFixed(1) : "—"}
                    </p>
                    {selected.priority_explanation ? (
                      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                        {selected.priority_explanation}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-text-secondary/80">
                        No stored explanation. Recompute to see the factors behind the ranking.
                      </p>
                    )}
                    <p className="mt-2 text-[11px] leading-relaxed text-text-secondary/70">
                      This ranks follow-up work. It is not a medical-risk prediction and must not be
                      read as a clinical judgement about this child.
                    </p>
                  </div>

                  <div className="rounded-md border border-border bg-navy-secondary/40 p-3 text-xs">
                    <p className="font-medium uppercase tracking-wider text-text-secondary">Timeline</p>
                    <dl className="mt-2 space-y-1.5 text-text-secondary">
                      <div className="flex justify-between gap-2">
                        <dt>Created</dt>
                        <dd className="text-text">{selected.created_at ? formatDateIN(selected.created_at) : "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Due</dt>
                        <dd className="text-text">{selected.due_date ? formatDateIN(selected.due_date) : "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Last updated</dt>
                        <dd className="text-text">{selected.updated_at ? formatDateIN(selected.updated_at) : "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Resolved</dt>
                        <dd className="text-text">{selected.resolved_at ? formatDateIN(selected.resolved_at) : "not resolved"}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Attempts logged</dt>
                        <dd className="text-text">{attempts.length}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {STATUSES.filter((s) => s !== selected.status).map((s) => (
                    <Button
                      key={s}
                      variant="outline"
                      size="sm"
                      onClick={() => changeStatus(s)}
                      disabled={!mayManage}
                    >
                      {s === "resolved" ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : null}
                      Mark {s.replace(/_/g, " ")}
                    </Button>
                  ))}
                  <Button variant="outline" size="sm" onClick={reprioritize} disabled={!mayManage || prioritizing}>
                    {prioritizing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-2 h-3.5 w-3.5" />}
                    Recompute priority
                  </Button>
                </div>
                {!mayManage && (
                  <p className="text-xs text-text-secondary">
                    Your role can view outreach tasks but not modify them.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PhoneCall className="h-4 w-4 text-cyan" aria-hidden />
                  Contact history
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingAttempts ? (
                  <Skeleton className="h-20 rounded-md" />
                ) : attempts.length === 0 ? (
                  <p className="text-sm text-text-secondary">
                    No contact attempts recorded yet. An absence of attempts is not evidence that
                    the family was uncontactable — it means nothing has been logged.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {attempts.map((attempt) => {
                      const meta = OUTCOMES.find((o) => o.value === attempt.outcome);
                      return (
                        <li
                          key={attempt.id}
                          className="rounded-md border border-border/60 bg-navy-secondary/30 p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                              <Badge variant={OUTCOME_TONE[meta?.tone || "neutral"] || "pending"}>
                                {meta?.label || attempt.outcome}
                              </Badge>
                              <span className="text-xs text-text-secondary">
                                via {ATTEMPT_TYPES.find((t) => t.value === attempt.attempt_type)?.label || attempt.attempt_type}
                              </span>
                            </span>
                            <span className="text-xs text-text-secondary">{formatDateIN(attempt.attempted_at)}</span>
                          </div>
                          {attempt.notes && (
                            <p className="mt-1.5 text-xs leading-relaxed text-text-secondary/90">{attempt.notes}</p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}

                <form onSubmit={logAttempt} className="space-y-3 rounded-md border border-border bg-navy-secondary/20 p-4">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    <Send className="h-3.5 w-3.5" aria-hidden />
                    Log a contact attempt
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="attempt-type" className="mb-1.5 block text-xs text-text-secondary">
                        Method
                      </label>
                      <select
                        id="attempt-type"
                        value={attemptForm.attempt_type}
                        onChange={(e) => setAttemptForm({ ...attemptForm, attempt_type: e.target.value })}
                        className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
                      >
                        {ATTEMPT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="attempt-outcome" className="mb-1.5 block text-xs text-text-secondary">
                        Outcome
                      </label>
                      <select
                        id="attempt-outcome"
                        value={attemptForm.outcome}
                        onChange={(e) => setAttemptForm({ ...attemptForm, outcome: e.target.value })}
                        className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
                      >
                        {OUTCOMES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="attempt-notes" className="mb-1.5 block text-xs text-text-secondary">
                      Notes (optional)
                    </label>
                    <textarea
                      id="attempt-notes"
                      rows={3}
                      value={attemptForm.notes}
                      onChange={(e) => setAttemptForm({ ...attemptForm, notes: e.target.value })}
                      placeholder="What was said, what was agreed, what to try next"
                      className="w-full rounded-md border border-border bg-navy-secondary px-3 py-2 text-sm text-text outline-none placeholder:text-text-secondary/50 focus:border-cyan"
                    />
                  </div>
                  <Button variant="primary" size="sm" type="submit" disabled={submitting || !mayManage}>
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
                    {submitting ? "Logging…" : "Log attempt"}
                  </Button>
                </form>

                <p className="rounded-md border border-border/60 bg-navy-secondary/20 p-3 text-xs leading-relaxed text-text-secondary">
                  A refusal, a migration or a death is recorded as a factual outcome so follow-up can
                  change appropriately. It never reduces the care offered, never marks a family as
                  non-compliant, and never blocks future contact.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default OutreachPage;
