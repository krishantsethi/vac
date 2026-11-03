"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CalendarClock, ShieldCheck } from "lucide-react";
import { API } from "@/lib/api";
import { ageLabel, formatDateIN } from "@/lib/utils";
import { ANALYTICS_VIEW, OUTREACH_VIEW, can, currentRole } from "@/lib/capabilities";
import { MetricCard } from "@/components/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";

const STATUS_COLORS: Record<string, string> = {
  up_to_date: "#57E6B1",
  upcoming: "#38D9FF",
  due: "#FBBF24",
  potentially_overdue: "#F59E0B",
  verification_required: "#EF4444",
  no_recommendations: "#64748B",
};

const STATUS_LABELS: Record<string, string> = {
  up_to_date: "Up to date",
  upcoming: "Upcoming",
  due: "Due now",
  potentially_overdue: "Potentially overdue",
  verification_required: "Needs verification",
  no_recommendations: "Not yet assessed",
};

/** Fetch that tolerates a refusal: an unauthorized widget must not blank the page. */
async function safeGet(path: string): Promise<any | null> {
  try {
    return await API.get(path);
  } catch {
    return null;
  }
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-12 text-center">
      <span
        className="mx-auto block h-8 w-8 animate-[spin_1s_linear_infinite] rounded-full border-4 border-cyan/30 border-t-cyan"
        role="status"
        aria-label={label}
      />
      <p className="mt-4 text-sm text-text-secondary">{label}</p>
    </div>
  );
}

function Panel({
  title, note, action, children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">{title}</h2>
          {note && <p className="mt-1 text-xs text-text-secondary/70">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Staff: operational overview                                                */
/* ------------------------------------------------------------------------- */

function StaffDashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [weekly, setWeekly] = useState<any>(null);
  const [coverage, setCoverage] = useState<any>(null);
  const [backlog, setBacklog] = useState<any>(null);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [recentPatients, setRecentPatients] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, w, c, b, d, p, t] = await Promise.all([
        safeGet("/api/v1/analytics/summary"),
        safeGet("/api/v1/analytics/events-by-week?weeks=12"),
        safeGet("/api/v1/analytics/coverage-by-area"),
        safeGet("/api/v1/analytics/verification-backlog"),
        safeGet("/api/v1/analytics/status-distribution"),
        safeGet("/api/v1/patients?page_size=6&include_status=true"),
        safeGet("/api/v1/outreach?page_size=5&status=open"),
      ]);
      if (cancelled) return;
      setSummary(s);
      setWeekly(w);
      setCoverage(c);
      setBacklog(b);
      setDistribution(Array.isArray(d) ? d : d?.items || []);
      setRecentPatients(p?.items || []);
      setTasks(t?.items || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Spinner label="Loading the operational overview…" />;

  const series = weekly?.series || [];
  const coverageItems = coverage?.items || [];
  const backlogItems = backlog?.items || [];
  const actionable = summary
    ? (summary.records_requiring_verification ?? 0)
    : 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text">Operational overview</h1>
          <p className="text-sm text-text-secondary/90">
            Every figure below is computed from records in the demonstration database. Nothing is
            estimated, and no target or success rate is implied.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={ROUTES.patients}><Button variant="ghost">Patients</Button></Link>
          <Link href={ROUTES.outreach}><Button variant="primary">Follow-up queue</Button></Link>
        </div>
      </header>

      {summary?.data_source && (
        <p className="rounded-md border border-border bg-navy-secondary/40 px-3 py-2 text-xs text-text-secondary">
          Data source: <span className="text-text">{summary.data_source}</span> · Observation window:{" "}
          {summary.observation_period}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Registered patients"
          value={summary?.total_patients ?? "—"}
          status="muted"
        />
        <MetricCard
          label="Verified doses on file"
          value={summary?.verified_vaccination_events ?? "—"}
          delta={summary ? `${summary.unverified_vaccination_events} unverified` : undefined}
          status="ok"
        />
        <MetricCard
          label="Needs verification"
          value={actionable}
          delta="records, documents and entries"
          status="warn"
        />
        <MetricCard
          label="Open follow-ups"
          value={summary ? (summary.open_outreach_tasks ?? 0) + (summary.in_progress_outreach_tasks ?? 0) : "—"}
          delta={summary ? `${summary.escalated_outreach_tasks ?? 0} escalated` : undefined}
          status="critical"
        />
        <MetricCard
          label="Potentially overdue"
          value={summary?.potentially_overdue ?? "—"}
          delta="past the schedule window"
          status="warn"
        />
        <MetricCard
          label="Documents pending review"
          value={summary?.documents_pending_review ?? "—"}
          status="warn"
        />
        <MetricCard
          label="Follow-ups resolved"
          value={summary ? `${summary.resolution_rate ?? 0}%` : "—"}
          delta={summary ? `${summary.resolved_outreach_tasks ?? 0} of ${summary.total_outreach_tasks ?? 0} tasks` : undefined}
          status="ok"
        />
        <MetricCard
          label="Inventory alerts"
          value={summary?.inventory_alerts ?? "—"}
          delta={summary ? `${summary.low_stock_alerts ?? 0} low · ${summary.expiring_soon_alerts ?? 0} expiring` : undefined}
          status="warn"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="Recorded doses by week"
            note={weekly?.note || "Weeks with no recorded events are shown as zero, not omitted."}
          >
            {series.length === 0 ? (
              <p className="py-10 text-center text-sm text-text-secondary/70">No weekly data available.</p>
            ) : (
              <>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#102238" />
                      <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="#A5B6C9" axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} stroke="#A5B6C9" axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: "#38D9FF", opacity: 0.08 }}
                        contentStyle={{ background: "#0B1728", border: "1px solid #1d3450", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "#F4F8FC" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="total_events" name="All recorded" fill="#38D9FF" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="verified_events" name="Verified" fill="#57E6B1" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-3 text-xs text-text-secondary/70">
                  This counts entries written to the database. A quiet week means fewer records were
                  captured — it does not mean fewer children were vaccinated.
                </p>
              </>
            )}
          </Panel>
        </div>

        <Panel
          title="Schedule status"
          note="Stored recommendations across every registered patient."
        >
          {distribution.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-secondary/70">No recommendations stored yet.</p>
          ) : (
            <>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip
                      contentStyle={{ background: "#0B1728", border: "1px solid #1d3450", borderRadius: 8, fontSize: 12 }}
                    />
                    <Pie
                      data={distribution}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={76}
                      paddingAngle={2}
                    >
                      {distribution.map((row) => (
                        <Cell key={row.status} fill={STATUS_COLORS[row.status] || "#64748B"} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5">
                {distribution.map((row) => (
                  <li key={row.status} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-text-secondary">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: STATUS_COLORS[row.status] || "#64748B" }}
                        aria-hidden
                      />
                      {STATUS_LABELS[row.status] || row.status}
                    </span>
                    <span className="tabular-nums text-text">
                      {row.count} · {row.percentage}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Record completeness by service area"
          note={coverage?.metric_definition?.note}
        >
          {coverageItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-secondary/70">No service areas recorded.</p>
          ) : (
            <>
              <ul className="space-y-3">
                {coverageItems.map((row: any) => (
                  <li key={row.service_area}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-text">{row.service_area}</span>
                      {row.suppressed ? (
                        <span className="text-xs text-text-secondary/70">
                          suppressed (fewer than {coverage.suppression_threshold} patients)
                        </span>
                      ) : (
                        <span className="tabular-nums text-text-secondary">
                          {row.up_to_date_share}% of {row.recommendation_count} schedule items
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-navy-secondary">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan to-mint"
                        style={{ width: row.suppressed ? "0%" : `${row.up_to_date_share ?? 0}%` }}
                        aria-hidden
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-text-secondary/70">
                {coverage?.metric_definition?.up_to_date_share} This is not population coverage: the
                denominator is patients registered here, so children never registered do not appear.
              </p>
            </>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel
            title="Verification backlog"
            note="Work that needs a person before the record can be trusted."
            action={
              can(ANALYTICS_VIEW) ? (
                <Link href="/app/record-verification">
                  <Button variant="ghost" size="sm">Review</Button>
                </Link>
              ) : undefined
            }
          >
            {backlogItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary/70">Nothing waiting for review.</p>
            ) : (
              <>
                <ul className="divide-y divide-border/60">
                  {backlogItems.map((row: any) => (
                    <li key={row.category} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-text-secondary">{row.category}</span>
                      <span className="tabular-nums font-medium text-text">{row.count}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-text-secondary/70">
                  Total backlog: <span className="text-text">{backlog?.total_backlog ?? 0}</span> ·{" "}
                  {backlog?.recommendations_flagged_verification_required ?? 0} schedule items flagged
                  as needing verification.
                </p>
              </>
            )}
          </Panel>

          <Panel
            title="Priority follow-ups"
            note="Highest-priority open tasks. Priority is an operational ordering, not a medical risk prediction."
            action={
              can(OUTREACH_VIEW) ? (
                <Link href="/app/outreach">
                  <Button variant="ghost" size="sm">Open queue</Button>
                </Link>
              ) : undefined
            }
          >
            {tasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary/70">
                {can(OUTREACH_VIEW) ? "No open follow-up tasks." : "Your role does not include the follow-up queue."}
              </p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((t: any) => (
                  <li key={t.id} className="rounded-md border border-border/60 bg-navy-secondary/30 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-text">{t.title}</p>
                        <p className="truncate text-xs text-text-secondary/80">{t.reason}</p>
                      </div>
                      {typeof t.priority_score === "number" && (
                        <Badge variant="pending">
                          priority {t.priority_score.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Recently registered" note="Newest patient records first.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-border/50">
                {["Patient", "Age", "Service area", "Schedule status", "Actionable", ""].map((h, i) => (
                  <th key={i} className="px-4 py-2 text-left font-medium text-text-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {recentPatients.map((p: any) => {
                const s = p.status_summary || {};
                return (
                  <tr key={p.id} className="transition-colors hover:bg-navy-secondary/30">
                    <td className="px-4 py-3">
                      <Link href={ROUTES.patient(p.patient_id)} className="text-text hover:text-cyan">
                        {p.first_name} {p.last_name}
                      </Link>
                      <span className="block text-xs text-text-secondary/70">{p.patient_id}</span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{ageLabel(p.date_of_birth)}</td>
                    <td className="px-4 py-3 text-text-secondary">{p.service_area || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={s.record_status === "up_to_date" ? "verified" : s.record_status === "verification_required" ? "conflict" : "overdue"}>
                        {STATUS_LABELS[s.record_status] || s.record_status || "—"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{s.actionable_count ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={ROUTES.patient(p.patient_id)}>
                        <Button variant="ghost" size="sm">Open</Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {recentPatients.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary/60">
                    No patients are visible to this account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Patient and caregiver: personal overview                                   */
/* ------------------------------------------------------------------------- */

function PersonalDashboard() {
  const [patients, setPatients] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, a, n] = await Promise.all([
        safeGet("/api/v1/patients?page_size=20&include_status=true"),
        safeGet("/api/v1/appointments"),
        safeGet("/api/v1/notifications"),
      ]);
      if (cancelled) return;
      const list = p?.items || [];
      setPatients(list);
      setAppointments(a || []);
      setNotifications(n || []);
      const recs: Record<string, any[]> = {};
      await Promise.all(
        list.map(async (pt: any) => {
          const r = await safeGet(`/api/v1/patients/${pt.patient_id}/recommendations`);
          recs[pt.patient_id] = Array.isArray(r) ? r : r?.items || [];
        })
      );
      if (cancelled) return;
      setRecommendations(recs);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Spinner label="Loading your records…" />;

  const upcoming = appointments
    .filter((a) => new Date(a.scheduled_at).getTime() >= Date.now() && a.status !== "cancelled")
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  const actionable: { patient: any; rec: any }[] = [];
  patients.forEach((p) => {
    (recommendations[p.patient_id] || []).forEach((rec) => {
      if (["due", "potentially_overdue", "verification_required"].includes(rec.status)) {
        actionable.push({ patient: p, rec });
      }
    });
  });
  actionable.sort((a, b) => {
    const rank = (s: string) => (s === "verification_required" ? 0 : s === "potentially_overdue" ? 1 : 2);
    return rank(a.rec.status) - rank(b.rec.status);
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-text">Your vaccination records</h1>
        <p className="text-sm text-text-secondary/90">
          Everything shown here comes from records held in this system. If a dose is missing from this
          list, that means we have no record of it — not proof that it was not given. Bring any paper
          card you have and we will add it.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="People in your care" value={patients.length} status="muted" />
        <MetricCard label="Doses needing attention" value={actionable.length} status={actionable.length ? "warn" : "ok"} />
        <MetricCard label="Upcoming appointments" value={upcoming.length} status={upcoming.length ? "ok" : "muted"} />
        <MetricCard
          label="Unread notifications"
          value={notifications.filter((n) => !n.is_read).length}
          status="muted"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Who you can see" note="Only records you are authorized for are listed.">
          {patients.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary/70">
              No patient records are linked to this account yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {patients.map((p) => {
                const s = p.status_summary || {};
                return (
                  <li key={p.id}>
                    <Link
                      href={ROUTES.patient(p.patient_id)}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-navy-secondary/30 p-3 transition-colors hover:border-cyan/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-text">
                          {p.first_name} {p.last_name}
                        </span>
                        <span className="block text-xs text-text-secondary/80">
                          {p.patient_id} · {ageLabel(p.date_of_birth)}
                        </span>
                      </span>
                      <Badge variant={s.record_status === "up_to_date" ? "verified" : s.record_status === "verification_required" ? "conflict" : "overdue"}>
                        {STATUS_LABELS[s.record_status] || "—"}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Next appointments" note="Requests still need to be confirmed by the clinic.">
            {upcoming.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary/70">
                No upcoming appointments. <Link href="/app/appointments" className="text-cyan hover:underline">Book a time</Link>.
              </p>
            ) : (
              <ul className="space-y-2">
                {upcoming.slice(0, 4).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-navy-secondary/30 p-3 text-sm">
                    <span className="flex items-center gap-2 text-text">
                      <CalendarClock className="h-4 w-4 text-cyan" aria-hidden />
                      {formatDateIN(a.scheduled_at)}
                    </span>
                    <Badge variant={a.status === "confirmed" ? "verified" : a.status === "cancelled" ? "insufficient" : "pending"}>
                      {a.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="What needs doing" note="Doses the schedule says are due, and records we could not confirm.">
            {actionable.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary/70">
                Nothing is flagged right now.
              </p>
            ) : (
              <ul className="space-y-2">
                {actionable.slice(0, 6).map(({ patient, rec }, i) => (
                  <li key={`${patient.patient_id}-${rec.vaccine_code}-${i}`} className="rounded-md border border-border/60 bg-navy-secondary/30 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-text">
                          {patient.first_name} · {rec.vaccine_code}
                        </p>
                        <p className="mt-0.5 text-xs text-text-secondary/80">{rec.explanation}</p>
                      </div>
                      <Badge variant={rec.status === "verification_required" ? "conflict" : "overdue"}>
                        {STATUS_LABELS[rec.status] || rec.status}
                      </Badge>
                    </div>
                    <Link
                      href={ROUTES.patient(patient.patient_id)}
                      className="mt-2 inline-block text-xs text-cyan hover:underline"
                    >
                      Open record
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Recent notifications">
        {notifications.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-secondary/70">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {notifications.slice(0, 5).map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span className="text-text-secondary">{n.message || n.title || "Notification"}</span>
                <span className="shrink-0 text-xs text-text-secondary/60">{formatDateIN(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 text-right">
          <Link href="/app/notifications"><Button variant="ghost" size="sm">All notifications</Button></Link>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* System administrator: platform view, no clinical data                      */
/* ------------------------------------------------------------------------- */

function AdminDashboard() {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [u, r, a] = await Promise.all([
        safeGet("/api/v1/users"),
        safeGet("/api/v1/roles"),
        safeGet("/api/v1/audit?page_size=10"),
      ]);
      if (cancelled) return;
      setUsers(Array.isArray(u) ? u : u?.items || []);
      setRoles(Array.isArray(r) ? r : r?.items || []);
      setAudit(Array.isArray(a) ? a : a?.items || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Spinner label="Loading platform status…" />;

  const byRole = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-text">Platform administration</h1>
        <p className="text-sm text-text-secondary/90">
          Accounts, roles and platform activity.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-text">This role has no clinical record access</p>
          <p className="text-text-secondary">
            Administering the platform deliberately does not grant access to patient health data.
            Patient lists, vaccination records, documents, outreach and analytics are all refused for
            this role on the server — not merely hidden in the navigation. Ask a clinic administrator
            if you need clinical access; it is granted as its own role.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="User accounts" value={users.length} status="muted" />
        <MetricCard label="Roles defined" value={roles.length} status="muted" />
        <MetricCard label="Inactive accounts" value={users.filter((u) => !u.is_active).length} status="warn" />
        <MetricCard label="Audit entries shown" value={audit.length} status="muted" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Accounts by role" note="Role assignment is what the server checks on every request.">
          <ul className="space-y-2">
            {Object.entries(byRole).sort((a, b) => b[1] - a[1]).map(([role, count]) => (
              <li key={role} className="flex items-center justify-between rounded-md border border-border/60 bg-navy-secondary/30 px-3 py-2 text-sm">
                <span className="text-text">{role.replace(/_/g, " ")}</span>
                <span className="tabular-nums text-text-secondary">{count}</span>
              </li>
            ))}
            {Object.keys(byRole).length === 0 && (
              <li className="py-6 text-center text-sm text-text-secondary/70">No accounts visible.</li>
            )}
          </ul>
          <div className="mt-4 flex gap-2">
            <Link href="/app/admin"><Button variant="ghost" size="sm">Administration area</Button></Link>
            <Link href="/app/audit-logs"><Button variant="ghost" size="sm">Audit logs</Button></Link>
          </div>
        </Panel>

        <Panel title="Recent platform activity" note="Newest entries from the audit log.">
          {audit.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary/70">No audit entries available.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {audit.slice(0, 8).map((entry: any) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-text">
                      {entry.action} · {entry.resource_type || entry.entity || "—"}
                    </span>
                    <span className="block truncate text-xs text-text-secondary/70">
                      {entry.user_email || entry.actor || "system"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-text-secondary/60">{formatDateIN(entry.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Role definitions" note="What each role is described as doing in this deployment.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border/50">
                {["Role", "Description"].map((h) => (
                  <th key={h} className="px-4 py-2 text-left font-medium text-text-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {roles.map((r: any) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-text">{r.name}</td>
                  <td className="px-4 py-2 text-text-secondary">{r.description || "—"}</td>
                </tr>
              ))}
              {roles.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-6 text-center text-text-secondary/60">No roles returned.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function DashboardOverview() {
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setRole(currentRole());
    setReady(true);
  }, []);

  if (!ready) return <Spinner label="Preparing your workspace…" />;

  // Patient and caregiver accounts have no analytics access at all, so they get
  // a view of their own records rather than an empty operational dashboard.
  if (role === "patient" || role === "caregiver") return <PersonalDashboard />;
  if (!can(ANALYTICS_VIEW)) return <AdminDashboard />;
  return <StaffDashboard />;
}
