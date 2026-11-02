"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateIN } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

export function InventoryPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [b, s] = await Promise.all([API.get("/api/v1/inventory/batches"), API.get("/api/v1/inventory/summary")]);
        setBatches(b);
        setSummary(s);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-text">Vaccine Inventory</h1>
          <p className="text-text-secondary/90 text-sm">Transaction-based ledger with batch tracking and expiry monitoring.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg border border-border bg-surface">
          <div className="text-xs text-text-secondary uppercase tracking-wider">Total batches</div>
          <div className="text-2xl font-display font-bold text-text">{summary?.total_batches ?? "—"}</div>
        </div>
        <div className="p-4 rounded-lg border border-border bg-surface">
          <div className="text-xs text-text-secondary uppercase tracking-wider">Low-stock alerts</div>
          <div className="text-2xl font-display font-bold text-amber-400">{summary?.low_stock_count ?? "—"}</div>
        </div>
        <div className="p-4 rounded-lg border border-border bg-surface">
          <div className="text-xs text-text-secondary uppercase tracking-wider">Expiring soon</div>
          <div className="text-2xl font-display font-bold text-text">{summary?.expiring_soon_count ?? "—"}</div>
        </div>
        <div className="p-4 rounded-lg border border-border bg-surface">
          <div className="text-xs text-text-secondary uppercase tracking-wider">Expired</div>
          <div className="text-2xl font-display font-bold text-red-400">{summary?.expired_count ?? "—"}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-navy-secondary/50">
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Batch / lot</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Vaccine</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Received</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Used</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Available</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Expiry</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {batches.map((b) => {
              const available = b.quantity_received - b.quantity_used;
              const isLow = available <= 10 && b.status === "active";
              const expired = new Date(b.expiry_date) < new Date();
              return (
                <tr key={b.id} className="hover:bg-surface/30 transition-colors">
                  <td className="px-4 py-3 text-text-secondary font-mono">{b.batch_number}</td>
                  <td className="px-4 py-3 text-text-secondary">{b.vaccine_id?.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-text">{b.quantity_received}</td>
                  <td className="px-4 py-3 text-text-secondary">{b.quantity_used}</td>
                  <td className="px-4 py-3 text-text">{available}</td>
                  <td className="px-4 py-3 text-text-secondary">{formatDateIN(b.expiry_date)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={expired ? "critical" : isLow ? "warn" : "verified"}>{expired ? "Expired" : isLow ? "Low stock" : "Active"}</Badge>
                  </td>
                </tr>
              );
            })}
            {!batches.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-text-secondary/60">No inventory batches.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Deterministic demand check</h3>
        <p className="text-xs text-text-secondary/80 leading-relaxed">
          Expected demand for planned sessions is compared against recorded usable stock. A mismatch is labeled as a
          projected shortage requiring verification — never as a confirmed stock-out. Forecasting is only shown when
          sufficient historical data exists; otherwise a clearly labeled demonstration baseline is used.
        </p>
      </div>
    </div>
  );
}
