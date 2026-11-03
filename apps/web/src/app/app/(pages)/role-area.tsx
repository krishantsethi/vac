"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/metric-card";
import { formatDateIN } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

type Area = "worker" | "clinic" | "public-health" | "admin";

const AREA_META: Record<Area, { title: string; blurb: string; role: string }> = {
  worker: {
    title: "Healthcare Worker",
    blurb: "Assigned follow-up cases, record verification, and offline-capable field work.",
    role: "healthcare_worker",
  },
  clinic: {
    title: "Clinic Administration",
    blurb: "Staff, catalogue and stock, appointments, and facility-level operational metrics.",
    role: "clinic_admin",
  },
  "public-health": {
    title: "Public-Health Administration",
    blurb: "Aggregate coverage, unresolved follow-up, and outreach performance. No identifiable household records.",
    role: "public_health_admin",
  },
  admin: {
    title: "System Administration",
    blurb: "Configuration, accounts and roles, service health, logs, and schedule version control.",
    role: "system_admin",
  },
};

function Denied({ area }: { area: Area }) {
  const user = getUser();
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-lg border border-border bg-surface p-8 text-center">
        <h2 className="font-display text-lg font-bold text-text">Access restricted</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {AREA_META[area].title} requires the <code className="text-cyan">{AREA_META[area].role}</code> role. Your
          account is <code className="text-cyan">{user?.role ?? "unknown"}</code>.
        </p>
        <p className="mt-3 text-xs text-text-secondary/70">
          Authorization is enforced server-side. Hiding a navigation link is not sufficient protection, so this request
          is rejected by the API as well as the UI.
        </p>
        <Link href="/app">
          <Button variant="outline" className="mt-5">Back to overview</Button>
        </Link>
      </div>
    </div>
  );
}

function WorkerArea() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState({ online: true, pending: 0 });

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/api/v1/outreach?page_size=50");
        setTasks(res.items || []);
      } catch (e: any) {
        toast(e.message || "Could not load assigned cases", { variant: "error" });
      } finally {
        setLoading(false);
      }
    })();
    const onOnline = () => setSync((s) => ({ ...s, online: true }));
    const onOffline = () => setSync((s) => ({ ...s, online: false }));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const open = tasks.filter((t) => t.status === "open" || t.status === "in_progress");

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Assigned open cases" value={open.length} status={open.length ? "warn" : "ok"} />
        <MetricCard label="Resolved cases" value={tasks.filter((t) => t.status === "resolved").length} status="ok" />
        <MetricCard
          label="Connection"
          value={sync.online ? "Online" : "Offline"}
          delta={sync.online ? "changes sync immediately" : `${sync.pending} queued locally`}
          status={sync.online ? "ok" : "warn"}
        />
      </div>

      <section className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border/60 p-4">
          <h3 className="text-sm font-semibold text-text">My follow-up queue</h3>
          <p className="text-xs text-text-secondary/70">Ordered by explainable operational priority, highest first.</p>
        </div>
        <div className="divide-y divide-border/50">
          {tasks.length === 0 && <p className="p-6 text-center text-sm text-text-secondary/60">No cases assigned to you.</p>}
          {tasks.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">{t.title}</p>
                <p className="mt-0.5 truncate text-xs text-text-secondary/80">{t.reason}</p>
                {t.priority_explanation && (
                  <p className="mt-1 text-[11px] italic text-cyan/80">{t.priority_explanation}</p>
                )}
                <p className="mt-1 text-[11px] text-text-secondary/60">
                  Due {formatDateIN(t.due_date) || "—"} · score {Math.round(Number(t.priority_score ?? 0))}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={t.status === "resolved" ? "verified" : t.status === "open" ? "overdue" : "pending"}>
                  {t.status.replace(/_/g, " ")}
                </Badge>
                <Link href="/app/outreach">
                  <Button variant="outline" size="sm">Work case</Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ClinicArea() {
  const [batches, setBatches] = useState<any[]>([]);
  const [appts, setAppts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [b, a, s] = await Promise.all([
          API.get("/api/v1/inventory/batches"),
          API.get("/api/v1/appointments"),
          API.get("/api/v1/inventory/summary"),
        ]);
        setBatches(b || []);
        setAppts(a || []);
        setSummary(s);
      } catch {
        /* handled by global 401 */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Spinner />;

  const expiringSoon = batches.filter(
    (b) => b.status === "active" && new Date(b.expiry_date) <= new Date(Date.now() + 60 * 864e5)
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Inventory batches" value={summary?.total_batches ?? 0} status="muted" />
        <MetricCard label="Low-stock alerts" value={summary?.low_stock_count ?? 0} status={(summary?.low_stock_count ?? 0) > 0 ? "warn" : "ok"} />
        <MetricCard label="Expiring ≤ 60 days" value={expiringSoon.length} status={expiringSoon.length ? "warn" : "ok"} />
        <MetricCard label="Scheduled appointments" value={appts.length} status="muted" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border/60 p-4">
            <h3 className="text-sm font-semibold text-text">Stock requiring attention</h3>
            <p className="text-xs text-text-secondary/70">From the transaction-based inventory ledger.</p>
          </div>
          <div className="divide-y divide-border/50">
            {batches.length === 0 && <p className="p-6 text-center text-sm text-text-secondary/60">No batches recorded.</p>}
            {batches.map((b) => {
              const available = b.quantity_received - b.quantity_used;
              const expired = new Date(b.expiry_date) < new Date();
              return (
                <div key={b.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-text">{b.batch_number}</p>
                    <p className="text-[11px] text-text-secondary/70">
                      available {available} of {b.quantity_received} · expires {formatDateIN(b.expiry_date)}
                    </p>
                  </div>
                  <Badge variant={expired ? "critical" : available <= 10 ? "warn" : "verified"}>
                    {expired ? "Expired" : available <= 10 ? "Low stock" : "In stock"}
                  </Badge>
                </div>
              );
            })}
          </div>
          <div className="border-t border-border/60 p-3">
            <Link href="/app/inventory"><Button variant="outline" size="sm" className="w-full">Manage inventory</Button></Link>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border/60 p-4">
            <h3 className="text-sm font-semibold text-text">Upcoming appointments</h3>
            <p className="text-xs text-text-secondary/70">Demonstration slots — not live centre availability.</p>
          </div>
          <div className="divide-y divide-border/50">
            {appts.length === 0 && <p className="p-6 text-center text-sm text-text-secondary/60">No appointments.</p>}
            {appts.slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">{a.vaccine_code || "Consultation"}</p>
                  <p className="text-[11px] text-text-secondary/70">{formatDateIN(a.scheduled_at)}</p>
                </div>
                <Badge variant={a.status === "confirmed" ? "verified" : a.status === "cancelled" ? "conflict" : "pending"}>
                  {a.status}
                </Badge>
              </div>
            ))}
          </div>
          <div className="border-t border-border/60 p-3">
            <Link href="/app/appointments"><Button variant="outline" size="sm" className="w-full">Manage appointments</Button></Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function PublicHealthArea() {
  const [summary, setSummary] = useState<any>(null);
  const [coverage, setCoverage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, c] = await Promise.all([
          API.get("/api/v1/analytics/summary"),
          API.get("/api/v1/analytics/coverage-by-area"),
        ]);
        setSummary(s);
        setCoverage(c || []);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
        <p className="text-xs leading-relaxed text-amber-300/90">
          <strong className="font-semibold">Aggregate view.</strong> Identifiable household records are not exposed here.
          Counts below the suppression threshold are withheld, and registered-patient completeness is not reported as
          population vaccination coverage.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Registered patients" value={summary?.total_patients ?? 0} status="muted" />
        <MetricCard label="Verified events" value={summary?.verified_vaccination_events ?? 0} status="ok" />
        <MetricCard label="Unresolved follow-up" value={summary?.open_outreach_tasks ?? 0} status={(summary?.open_outreach_tasks ?? 0) > 0 ? "warn" : "ok"} />
        <MetricCard label="Verified resolution rate" value={`${summary?.resolution_rate ?? 0}%`} status="ok" />
      </div>

      <section className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border/60 p-4">
          <h3 className="text-sm font-semibold text-text">Registered patients by service area</h3>
          <p className="text-xs text-text-secondary/70">Synthetic geography, aggregated at service-area level.</p>
        </div>
        <div className="divide-y divide-border/50">
          {coverage.length === 0 && <p className="p-6 text-center text-sm text-text-secondary/60">No area data available.</p>}
          {coverage.map((c) => {
            const total = coverage.reduce((n, x) => n + x.patient_count, 0) || 1;
            const pct = Math.round((c.patient_count / total) * 100);
            const suppressed = c.patient_count < 5;
            return (
              <div key={c.service_area} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-text">{c.service_area}</p>
                  <p className="text-sm tabular-nums text-text-secondary">
                    {suppressed ? "suppressed" : `${c.patient_count} patients · ${pct}%`}
                  </p>
                </div>
                {!suppressed && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-navy-secondary">
                    <div className="h-full rounded-full bg-cyan" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {suppressed && (
                  <p className="mt-1 text-[11px] text-text-secondary/60">Small group withheld to protect privacy.</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="border-t border-border/60 p-3">
          <Link href="/app/analytics"><Button variant="outline" size="sm" className="w-full">Open full analytics</Button></Link>
        </div>
      </section>
    </div>
  );
}

function AdminArea() {
  const [users, setUsers] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [u, s, a] = await Promise.all([
          API.get("/api/v1/users"),
          API.get("/api/v1/schedules"),
          API.get("/api/v1/audit?page_size=8"),
        ]);
        setUsers(u || []);
        setSchedules(s || []);
        setAudit(a?.items || []);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text">Service health</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded border border-border/60 bg-navy-secondary/40 p-3">
            <p className="text-[11px] uppercase tracking-wider text-text-secondary/70">API</p>
            <p className="mt-1 flex items-center gap-2 text-sm text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Operational
            </p>
          </div>
          <div className="rounded border border-border/60 bg-navy-secondary/40 p-3">
            <p className="text-[11px] uppercase tracking-wider text-text-secondary/70">Database</p>
            <p className="mt-1 flex items-center gap-2 text-sm text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Connected
            </p>
          </div>
          <div className="rounded border border-border/60 bg-navy-secondary/40 p-3">
            <p className="text-[11px] uppercase tracking-wider text-text-secondary/70">OCR provider</p>
            <p className="mt-1 flex items-center gap-2 text-sm text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Demonstration mode
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-text-secondary/60">
          System administration does not automatically grant unrestricted access to every clinical record.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border/60 p-4">
            <h3 className="text-sm font-semibold text-text">Accounts and roles</h3>
            <p className="text-xs text-text-secondary/70">{users.length} accounts</p>
          </div>
          <div className="max-h-80 divide-y divide-border/50 overflow-y-auto">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">{u.full_name}</p>
                  <p className="truncate text-[11px] text-text-secondary/70">{u.email}</p>
                </div>
                <Badge variant={u.is_active ? "verified" : "insufficient"}>{u.role.replace(/_/g, " ")}</Badge>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border/60 p-4">
            <h3 className="text-sm font-semibold text-text">Schedule versions</h3>
            <p className="text-xs text-text-secondary/70">Versioned rules under approval control.</p>
          </div>
          <div className="divide-y divide-border/50">
            {schedules.map((s) => (
              <div key={s.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text">{s.source_name}</p>
                    <p className="text-[11px] text-text-secondary/70">
                      v{s.source_version} · effective {formatDateIN(s.effective_date)}
                    </p>
                  </div>
                  <Badge variant={s.approval_status === "approved" ? "verified" : "pending"}>
                    {s.approval_status}
                  </Badge>
                </div>
                {s.description && <p className="mt-1.5 text-[11px] italic text-amber-300/80">{s.description}</p>}
              </div>
            ))}
          </div>
          <div className="border-t border-border/60 p-3">
            <Link href="/app/schedule"><Button variant="outline" size="sm" className="w-full">Inspect rules</Button></Link>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border/60 p-4">
          <h3 className="text-sm font-semibold text-text">Recent security and application events</h3>
        </div>
        <div className="divide-y divide-border/50">
          {audit.length === 0 && <p className="p-6 text-center text-sm text-text-secondary/60">No audit events yet.</p>}
          {audit.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-xs">
              <code className="rounded bg-navy-secondary px-1.5 py-0.5 text-cyan">{e.action}</code>
              <span className="text-text-secondary">{e.entity_type}</span>
              <span className="font-mono text-[10px] text-text-secondary/50">{e.entity_id?.slice(0, 8) || "—"}</span>
              <span className="ml-auto text-[10px] text-text-secondary/50">{formatDateIN(e.created_at)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-border/60 p-3">
          <Link href="/app/audit-logs"><Button variant="outline" size="sm" className="w-full">View full audit log</Button></Link>
        </div>
      </section>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-cyan/30 border-t-cyan" />
    </div>
  );
}

export function RoleAreaPage({ area }: { area: Area }) {
  const user = getUser();
  const meta = AREA_META[area];

  // Client-side hint only; the API enforces the real authorization.
  const allowed =
    user?.role === meta.role || user?.role === "system_admin" || user?.role === "clinic_admin";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-xl font-bold text-text">{meta.title}</h1>
        <p className="text-sm text-text-secondary/90">{meta.blurb}</p>
      </header>
      {!allowed ? (
        <Denied area={area} />
      ) : area === "worker" ? (
        <WorkerArea />
      ) : area === "clinic" ? (
        <ClinicArea />
      ) : area === "public-health" ? (
        <PublicHealthArea />
      ) : (
        <AdminArea />
      )}
    </div>
  );
}
