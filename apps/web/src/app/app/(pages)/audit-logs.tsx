"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { formatDateIN } from "@/lib/utils";

export function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/api/v1/audit?page_size=50");
        setLogs(res.items);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="h-64 flex items-center justify-center"><span className="h-8 w-8 rounded-full border-4 border-cyan/30 border-t-cyan animate-[spin_1s_linear_infinite]" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold text-text">Audit Logs</h1>
      <p className="text-text-secondary/90 text-sm">Security and application events, server-side. System administration does not grant unrestricted access to every clinical record.</p>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-navy-secondary/50">
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Time</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Actor</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Action</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Entity</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Entity ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {logs.map((l) => (
              <tr key={l.id} className="hover:bg-surface/30 transition-colors">
                <td className="px-4 py-3 text-text-secondary">{formatDateIN(l.created_at)}</td>
                <td className="px-4 py-3 text-text-secondary">{l.user?.full_name || l.user_id || "system"}</td>
                <td className="px-4 py-3 text-text font-mono text-xs">{l.action}</td>
                <td className="px-4 py-3 text-text-secondary">{l.entity_type}</td>
                <td className="px-4 py-3 text-text-secondary font-mono text-xs">{l.entity_id}</td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-text-secondary/60">No audit events.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
