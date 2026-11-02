"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { formatDateIN } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function SchedulePage() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s] = await Promise.all([API.get("/api/v1/schedules")]);
        setSchedules(s);
        if (s[0]) { setSelected(s[0].id); loadRules(s[0].id); }
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  const loadRules = async (id: string) => {
    try {
      const r = await API.get(`/api/v1/schedules/${id}/rules`);
      setRules(r);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-text">Vaccination Schedule</h1>
          <p className="text-text-secondary/90 text-sm">Versioned, deterministic schedule rules. No LLM is the authoritative engine.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="flex-1">
          <label className="text-xs font-medium text-text-secondary mb-1 block">Schedule version</label>
          <select
            value={selected || ""}
            onChange={(e) => { setSelected(e.target.value); loadRules(e.target.value); }}
            className="block w-full rounded-md border border-border bg-navy-secondary text-text text-sm focus:border-cyan"
          >
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>{s.source_name} v{s.source_version}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 flex items-end">
          <p className="text-xs text-text-secondary/70">{rules.length} rules loaded</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-navy-secondary/50">
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Rule ID</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Vaccine</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Dose</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Eligible from (months)</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Window (days)</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Required</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rules.map((r) => (
              <tr key={r.id} className="hover:bg-surface/30 transition-colors">
                <td className="px-4 py-3 text-text-secondary font-mono">{r.rule_id}</td>
                <td className="px-4 py-3 text-text">{r.vaccine_code}</td>
                <td className="px-4 py-3 text-text-secondary">{r.dose_number}</td>
                <td className="px-4 py-3 text-text-secondary">{r.target_age_min_months}</td>
                <td className="px-4 py-3 text-text-secondary">{r.recommended_window_max_days}</td>
                <td className="px-4 py-3">
                  <Badge variant={r.is_required ? "verified" : "pending"}>{r.is_required ? "Required" : "Optional"}</Badge>
                </td>
              </tr>
            ))}
            {!rules.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-text-secondary/60">No rules in this schedule version.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">About the demonstration ruleset</h3>
        <p className="text-xs text-text-secondary/80 leading-relaxed">
          The active schedule is a manually validated sample (Universal Infant Immunization Schedule, v1.0.0-demo) for
          demonstration only. It is NOT comprehensive clinical guidance. Use an authoritative, versioned schedule for
          real clinical recommendations. VAXBRIDGE AI does not claim integration with any government immunisation registry.
        </p>
      </div>
    </div>
  );
}
