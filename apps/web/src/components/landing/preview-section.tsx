"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";
import { AlertTriangle, CalendarClock, FileSearch, ClipboardList, TrendingUp, PackageX } from "lucide-react";

const TREND = [
  { period: "W1", verified: 18, resolved: 6 },
  { period: "W2", verified: 24, resolved: 9 },
  { period: "W3", verified: 21, resolved: 12 },
  { period: "W4", verified: 30, resolved: 14 },
  { period: "W5", verified: 27, resolved: 19 },
  { period: "W6", verified: 35, resolved: 22 },
];

const BACKLOG = [
  { area: "Delhi Central", pending: 7 },
  { area: "Mumbai East", pending: 4 },
  { area: "Chennai South", pending: 9 },
];

const METRICS = [
  { icon: CalendarClock, label: "Upcoming vaccinations", value: "12", tone: "text-cyan" },
  { icon: FileSearch, label: "Records requiring verification", value: "3", tone: "text-amber-400" },
  { icon: ClipboardList, label: "Unresolved follow-up tasks", value: "2", tone: "text-amber-400" },
  { icon: PackageX, label: "Inventory warnings", value: "2", tone: "text-red-400" },
];

export function PreviewSection() {
  return (
    <section id="preview" className="px-6 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan">Product preview</p>
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-text md:text-4xl">
              What the dashboard actually shows.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-text-secondary">
              The same figures appear in the live application, computed from the seeded demonstration database rather
              than hardcoded per page.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Demonstration data
          </span>
        </div>

        <div className="mt-10 overflow-hidden rounded-xl border border-border bg-surface/60 shadow-[0_24px_70px_-30px_rgba(56,217,255,0.25)]">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-border/60 bg-navy-secondary/60 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/50" aria-hidden="true" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/50" aria-hidden="true" />
            <span className="h-2.5 w-2.5 rounded-full bg-mint/50" aria-hidden="true" />
            <span className="ml-3 font-mono text-[11px] text-text-secondary/60">
              vaxbridge · vaccination intelligence overview
            </span>
          </div>

          <div className="p-4 md:p-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {METRICS.map((m) => {
                const Icon = m.icon;
                return (
                  <div key={m.label} className="rounded-lg border border-border/60 bg-navy-secondary/40 p-4">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${m.tone}`} aria-hidden="true" />
                      <p className="text-[11px] font-medium uppercase tracking-wider text-text-secondary/70">{m.label}</p>
                    </div>
                    <p className="mt-2 font-display text-2xl font-bold tabular-nums text-text">{m.value}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="rounded-lg border border-border/60 bg-navy-secondary/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
                    <TrendingUp className="h-4 w-4 text-mint" aria-hidden="true" />
                    Verified events &amp; resolved cases
                  </h3>
                  <span className="text-[11px] text-text-secondary/60">trailing 6 weeks</span>
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={TREND} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                      <defs>
                        <linearGradient id="gVerified" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38D9FF" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#38D9FF" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gResolved" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#57E6B1" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#57E6B1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(165,182,201,0.12)" />
                      <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#A5B6C9" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#A5B6C9" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: "#102238",
                          border: "1px solid rgba(165,182,201,0.2)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "#F4F8FC" }}
                      />
                      <Area type="monotone" dataKey="verified" stroke="#38D9FF" strokeWidth={2} fill="url(#gVerified)" name="Verified events" />
                      <Area type="monotone" dataKey="resolved" stroke="#57E6B1" strokeWidth={2} fill="url(#gResolved)" name="Resolved cases" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-navy-secondary/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text">Verification backlog</h3>
                  <span className="text-[11px] text-text-secondary/60">by service area</span>
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={BACKLOG} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(165,182,201,0.12)" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#A5B6C9" }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="area"
                        width={92}
                        tick={{ fontSize: 11, fill: "#A5B6C9" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(56,217,255,0.07)" }}
                        contentStyle={{
                          background: "#102238",
                          border: "1px solid rgba(165,182,201,0.2)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "#F4F8FC" }}
                      />
                      <Bar dataKey="pending" fill="#A8E9FF" radius={[0, 4, 4, 0]} name="Awaiting review" barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <p className="mt-5 rounded-md border border-border/50 bg-navy/50 px-4 py-3 text-[11px] leading-relaxed text-text-secondary/65">
              Sample data shown for demonstration. These are synthetic figures from a seeded database — not government
              statistics, not a real population, and not evidence of any real-world programme outcome.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
