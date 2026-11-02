"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateIN } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

export function AppointmentsPage() {
  const [appts, setAppts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/api/v1/appointments");
        setAppts(res);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-text">Appointments</h1>
          <p className="text-text-secondary/90 text-sm">Demonstration slots — no real-time center availability is claimed.</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-navy-secondary/50">
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Patient</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Vaccine</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Scheduled</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Facility</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {appts.map((a) => (
              <tr key={a.id} className="hover:bg-surface/30 transition-colors">
                <td className="px-4 py-3 text-text-secondary">{a.patient_id.slice(0, 8)}</td>
                <td className="px-4 py-3 text-text">{a.vaccine_code || "—"}</td>
                <td className="px-4 py-3 text-text-secondary">{formatDateIN(a.scheduled_at)}</td>
                <td className="px-4 py-3 text-text-secondary">{a.facility_id?.slice(0, 8) || "—"}</td>
                <td className="px-4 py-3">
                  <Badge variant={a.status === "confirmed" ? "verified" : a.status === "completed" ? "verified" : "pending"}>{a.status}</Badge>
                </td>
              </tr>
            ))}
            {!appts.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-text-secondary/60">No appointments.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Reminders</h3>
        <p className="text-xs text-text-secondary/80 leading-relaxed">
          In-app notification center is used for reminders. SMS/WhatsApp delivery is simulated only — no messaging provider
          credentials are configured, so no real messages are sent. Notifications do not disclose unnecessary medical detail.
        </p>
      </div>
    </div>
  );
}
