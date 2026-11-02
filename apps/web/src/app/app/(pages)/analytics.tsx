"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Lock, RefreshCw } from "lucide-react";
import { API } from "@/lib/api";
import { ANALYTICS_VIEW, can } from "@/lib/capabilities";
import { MetricCard } from "@/components/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

const TOOLTIP_STYLE = {
  background: "#0B1728",
  border: "1px solid #1d3450",
  borderRadius: 8,
  fontSize: 12,
} as const;

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

const STOCK_VARIANT: Record<string, any> = {
  adequate: "verified",
  low_stock: "pending",
  shortage_projected: "critical",
};

function Section({
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
          {note && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-text-secondary/70">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-text-secondary/70">{message}</p>;
}

export function AnalyticsPage() {
  const [summary, setSummary] = useState<any>(null);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [weekly, setWeekly] = useState<any>(null);
  const [trend, setTrend] = useState<any>(null);
  const [followup, setFollowup] = useState<any[]>([]);
  const [coverage, setCoverage] = useState<any>(null);
  const [backlog, setBacklog] = useState<any>(null);
  const [stock, setStock] = useState<any>(null);
  const [weeks, setWeeks] = useState(12);
  const [loading, setLoading] = useState(true);
  const [authorized] = useState(() => can(ANALYTICS_VIEW));

  const load = useCallback(async () => {
    if (!authorized) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const get = async (path: string) => {
      try {
        return await API.get(path);
      } catch (err: any) {
        // One refused widget must not blank the whole page.
        return null;
      }
    };
    const [s, d, w, t, f, c, b, k] = await Promise.all([
      get("/api/v1/analytics/summary"),
      get("/api/v1/analytics/status-distribution"),
      get(`/api/v1/analytics/events-by-week?weeks=${weeks}`),
      get(`/api/v1/analytics/resolution-trend?weeks=${Math.max(weeks, 12)}`),
      get("/api/v1/analytics/followup-status"),
      get("/api/v1/analytics/coverage-by-area"),
      get("/api/v1/analytics/verification-backlog"),
      get("/api/v1/analytics/inventory-levels"),
    ]);
    setSummary(s);
    setDistribution(Array.isArray(d) ? d : d?.items || []);
    setWeekly(w);
    setTrend(t);
    setFollowup(Array.isArray(f) ? f : f?.items || []);
    setCoverage(c);
    setBacklog(b);
    setStock(k);
    setLoading(false);
  }, [authorized, weeks]);

  useEffect(() => {
    load();
  }, [load]);

  if (!authorized) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-xl font-bold text-text">Analytics</h1>
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-6">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-text">Your role does not include analytics</p>
            <p className="text-sm text-text-secondary">
              Aggregate reporting is available to healthcare workers, clinic administrators and
              public-health administrators. This is enforced by the API, so the figures are not
              reachable by requesting them directly either.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const series = weekly?.series || [];
  const trendSeries = trend?.series || [];
  const coverageItems = coverage?.items || [];
  const backlogItems = backlog?.items || [];
  const stockItems = stock?.items || [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text">Analytics</h1>
          <p className="text-sm text-text-secondary/90">
            Aggregate views over the records this system holds. No figure is estimated, extrapolated
            or benchmarked, and none of these metrics describe a real population.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="week-range" className="text-xs text-text-secondary">Window</label>
          <select
            id="week-range"
            className="input h-9 w-auto"
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
          >
            {[4, 8, 12, 26].map((w) => (
              <option key={w} value={w}>{w} weeks</option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      {summary?.data_source && (
        <p className="rounded-md border border-border bg-navy-secondary/40 px-3 py-2 text-xs text-text-secondary">
          Source: <span className="text-text">{summary.data_source}</span> · Window: {summary.observation_period}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Registered patients" value={summary?.total_patients ?? "—"} status="muted" />
        <MetricCard
          label="Verified doses"
          value={summary?.verified_vaccination_events ?? "—"}
          delta={summary ? `${summary.unverified_vaccination_events} unverified` : undefined}
          status="ok"
        />
        <MetricCard label="Records needing verification" value={summary?.records_requiring_verification ?? "—"} status="warn" />
        <MetricCard label="Potentially overdue" value={summary?.potentially_overdue ?? "—"} status="warn" />
        <MetricCard
          label="Follow-up tasks"
          value={summary?.total_outreach_tasks ?? "—"}
          delta={summary ? `${summary.open_outreach_tasks ?? 0} open · ${summary.in_progress_outreach_tasks ?? 0} in progress` : undefined}
          status="muted"
        />
        <MetricCard
          label="Follow-ups resolved"
          value={summary ? `${summary.resolution_rate ?? 0}%` : "—"}
          delta={summary ? `${summary.resolved_outreach_tasks ?? 0} of ${summary.total_outreach_tasks ?? 0}` : undefined}
          status="ok"
        />
        <MetricCard
          label="Median days to resolve"
          value={summary?.median_days_to_resolution ?? "—"}
          delta="from task creation"
          status="muted"
        />
        <MetricCard label="Open sync conflicts" value={summary?.open_sync_conflicts ?? "—"} status={summary?.open_sync_conflicts ? "critical" : "ok"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Recorded doses by week"
          note={weekly?.note || "Weeks with no recorded events are shown as zero, not omitted."}
        >
          {series.length === 0 ? (
            <Empty message="No weekly data." />
          ) : (
            <>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#102238" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="#A5B6C9" axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} stroke="#A5B6C9" axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#F4F8FC" }} cursor={{ fill: "#38D9FF", opacity: 0.08 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="total_events" name="All recorded" fill="#38D9FF" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="verified_events" name="Verified" fill="#57E6B1" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {weekly?.observation_period && (
                <p className="mt-3 text-xs text-text-secondary/70">
                  {weekly.observation_period.start} to {weekly.observation_period.end} ·{" "}
                  {series.filter((r: any) => !r.has_data).length} of {series.length} weeks have no
                  recorded events. A gap means nothing was captured here — it is not evidence that
                  nothing was administered.
                </p>
              )}
            </>
          )}
        </Section>

        <Section
          title="Schedule status distribution"
          note="One stored recommendation per schedule rule per patient."
        >
          {distribution.length === 0 ? (
            <Empty message="No recommendations stored yet." />
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Pie data={distribution} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={52} outerRadius={84} paddingAngle={2}>
                      {distribution.map((row) => (
                        <Cell key={row.status} fill={STATUS_COLORS[row.status] || "#64748B"} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {distribution.map((row) => (
                  <li key={row.status} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-text-secondary">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[row.status] || "#64748B" }} aria-hidden />
                      {STATUS_LABELS[row.status] || row.status}
                    </span>
                    <span className="tabular-nums text-text">{row.count} · {row.percentage}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section
          title="Follow-up resolution trend"
          note="Tasks resolved per week, with the running total."
        >
          {trendSeries.length === 0 ? (
            <Empty message="No resolution history." />
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trendSeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cumulativeFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#57E6B1" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#57E6B1" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#102238" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="#A5B6C9" axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} stroke="#A5B6C9" axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#F4F8FC" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="cumulative" name="Cumulative resolved" stroke="#57E6B1" fill="url(#cumulativeFill)" strokeWidth={2} />
                    <Line type="monotone" dataKey="resolved" name="Resolved this week" stroke="#38D9FF" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-xs text-text-secondary/70">
                A rising cumulative line means tasks are being closed. It says nothing about whether
                the underlying doses were given.
              </p>
            </>
          )}
        </Section>

        <Section
          title="Follow-up task status"
          note="Current state of every outreach task in the queue."
        >
          {followup.length === 0 ? (
            <Empty message="No follow-up tasks." />
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={followup} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#102238" />
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="#A5B6C9" axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="status" tick={{ fontSize: 11 }} stroke="#A5B6C9" axisLine={false} tickLine={false} width={92} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#F4F8FC" }} cursor={{ fill: "#38D9FF", opacity: 0.08 }} />
                    <Bar dataKey="count" name="Tasks" fill="#A8E9FF" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-xs text-text-secondary/70">
                Buckets are mutually exclusive, so these counts add up to {summary?.total_outreach_tasks ?? "the"} total task{summary?.total_outreach_tasks === 1 ? "" : "s"}.
              </p>
            </>
          )}
        </Section>
      </div>

      <Section
        title="Record completeness by service area"
        note={coverage?.metric_definition?.note}
      >
        {coverageItems.length === 0 ? (
          <Empty message="No service areas recorded." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    {["Service area", "Registered patients", "Schedule items", "Up to date", "Share up to date", ""].map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left font-medium text-text-secondary">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {coverageItems.map((row: any) => (
                    <tr key={row.service_area}>
                      <td className="px-3 py-2.5 text-text">{row.service_area}</td>
                      <td className="px-3 py-2.5 tabular-nums text-text-secondary">
                        {row.suppressed ? <span className="text-text-secondary/60">suppressed</span> : row.patient_count}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-text-secondary">{row.suppressed ? "—" : row.recommendation_count}</td>
                      <td className="px-3 py-2.5 tabular-nums text-text-secondary">{row.suppressed ? "—" : row.up_to_date_count}</td>
                      <td className="px-3 py-2.5">
                        {row.suppressed ? (
                          <Badge variant="insufficient">suppressed</Badge>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-navy-secondary">
                              <div className="h-full rounded-full bg-gradient-to-r from-cyan to-mint" style={{ width: `${row.up_to_date_share ?? 0}%` }} aria-hidden />
                            </div>
                            <span className="tabular-nums text-text">{row.up_to_date_share}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary/70">
                        {row.suppressed ? `fewer than ${coverage.suppression_threshold} patients` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {coverage?.metric_definition && (
              <dl className="mt-4 grid gap-2 rounded-md border border-border/60 bg-navy-secondary/30 p-3 text-xs text-text-secondary md:grid-cols-2">
                <div><dt className="font-medium text-text">What is counted</dt><dd>{coverage.metric_definition.patient_count}</dd></div>
                <div><dt className="font-medium text-text">Share up to date</dt><dd>{coverage.metric_definition.up_to_date_share}</dd></div>
                <div><dt className="font-medium text-text">Population</dt><dd>{coverage.metric_definition.population}</dd></div>
                <div><dt className="font-medium text-text">Suppression</dt><dd>{coverage.metric_definition.suppression}</dd></div>
              </dl>
            )}
          </>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Verification backlog"
          note="Items that need a human decision before the record can be trusted."
        >
          {backlogItems.length === 0 ? (
            <Empty message="Nothing waiting for review." />
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
                Total {backlog?.total_backlog ?? 0} items ·{" "}
                {backlog?.recommendations_flagged_verification_required ?? 0} schedule items flagged as
                needing verification.
              </p>
            </>
          )}
        </Section>

        <Section
          title="Stock against expected demand"
          note={stock?.method?.note}
        >
          {stockItems.length === 0 ? (
            <Empty message="No inventory batches recorded." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      {["Vaccine", "Usable", "Expected demand", "Projected gap", "Status"].map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium text-text-secondary">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {stockItems.map((row: any) => (
                      <tr key={row.vaccine_code}>
                        <td className="px-3 py-2.5 text-text">
                          {row.vaccine_name}
                          <span className="block text-xs text-text-secondary/70">{row.vaccine_code}</span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-text-secondary">{row.usable_stock}</td>
                        <td className="px-3 py-2.5 tabular-nums text-text-secondary">{row.expected_demand}</td>
                        <td className="px-3 py-2.5 tabular-nums text-text-secondary">{row.projected_shortage}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant={STOCK_VARIANT[row.stock_status] || "default"}>
                            {row.stock_status.replace(/_/g, " ")}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {stock?.method && (
                <p className="mt-3 text-xs text-text-secondary/70">
                  Expected demand: {stock.method.expected_demand}. Usable stock: {stock.method.usable_stock}.
                </p>
              )}
            </>
          )}
        </Section>
      </div>

      <p className="rounded-md border border-border bg-navy-secondary/30 px-4 py-3 text-xs leading-relaxed text-text-secondary">
        These figures describe records held in a demonstration database of synthetic patients. They
        are not clinical-accuracy measurements, not real-world outcome statistics, and not evidence
        about any actual immunization programme. Registered-patient completeness is deliberately
        reported separately from any notion of population coverage, because the two are not the same
        measurement.
      </p>
    </div>
  );
}
