"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Filter, RefreshCw, Search } from "lucide-react";
import { API } from "@/lib/api";
import { formatDateIN } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { OfflineCapture } from "@/components/app/offline-capture";

type VerificationFilter = "all" | "verified" | "unverified";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual entry",
  ocr: "Document (OCR)",
  record: "Legacy record",
  offline_sync: "Offline sync",
};

export function VaccinationsPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [verification, setVerification] = useState<VerificationFilter>("all");
  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState<any[] | null>(null);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (search) params.set("search", search);
      if (verification !== "all") params.set("verification", verification);
      const res = await API.get(`/api/v1/vaccinations?${params.toString()}`);
      setEvents(res.items || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      toast(err?.message || "Could not load vaccination records", { variant: "destructive" });
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, search, verification]);

  useEffect(() => {
    load();
  }, [load]);

  // The conflict queue is restricted to review roles server-side; a 403 here is
  // expected for patients and caregivers, so it is not treated as an error.
  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/api/v1/vaccinations/conflicts?page_size=50");
        const items = Array.isArray(res) ? res : res?.items || [];
        setConflicts(items.filter((c: any) => c.status === "open"));
      } catch {
        setConflicts(null);
      }
    })();
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const unverifiedOnPage = events.filter((e) => !e.is_verified).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-text">Vaccination Records</h1>
          <p className="text-sm text-text-secondary/90">
            Every dose on file across the patients you are authorized to see. An unverified entry is
            a record that needs confirming — it is not proof that a dose was missed.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <OfflineCapture />

      {conflicts && conflicts.length > 0 && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-text">
                {conflicts.length} sync {conflicts.length === 1 ? "conflict" : "conflicts"} awaiting review
              </p>
              <p className="text-sm text-text-secondary">
                An offline submission disagreed with a stored record. Nothing was overwritten —
                each one needs a decision before the schedule can be trusted.
              </p>
              <Link href="/app/record-verification" className="text-sm text-cyan underline-offset-2 hover:underline">
                Open the review queue
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary/60" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                setSearch(searchInput.trim());
              }
            }}
            placeholder="Search by patient, vaccine or batch number…"
            className="pl-9"
            aria-label="Search vaccination records"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-text-secondary/60" aria-hidden />
          <label htmlFor="verification-filter" className="sr-only">
            Verification status
          </label>
          <select
            id="verification-filter"
            value={verification}
            onChange={(e) => {
              setPage(1);
              setVerification(e.target.value as VerificationFilter);
            }}
            className="input h-10 w-auto min-w-[9rem]"
          >
            <option value="all">All records</option>
            <option value="verified">Verified only</option>
            <option value="unverified">Unverified only</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPage(1);
              setSearch(searchInput.trim());
            }}
          >
            Apply
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
        <p>
          {loading ? "Loading…" : `${total} record${total === 1 ? "" : "s"}`}
          {!loading && verification === "all" && unverifiedOnPage > 0 && (
            <span className="text-amber-400"> · {unverifiedOnPage} unverified on this page</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
            Previous
          </Button>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Next
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-navy-secondary/50">
              {["Patient", "Vaccine", "Dose", "Date given", "Facility", "Batch", "Source", "Status"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium text-text-secondary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text-secondary/60">
                  Loading records…
                </td>
              </tr>
            )}
            {!loading &&
              events.map((e) => (
                <tr key={e.id} className="transition-colors hover:bg-navy-secondary/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/patients/${e.patient?.patient_id}`}
                      className="text-text hover:text-cyan"
                    >
                      {e.patient?.first_name} {e.patient?.last_name}
                    </Link>
                    <span className="block text-xs text-text-secondary/70">{e.patient?.patient_id}</span>
                  </td>
                  <td className="px-4 py-3 text-text">
                    {e.vaccine_name}
                    <span className="block text-xs text-text-secondary/70">{e.vaccine_code}</span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{e.dose_label}</td>
                  <td className="px-4 py-3 text-text-secondary tabular-nums">{formatDateIN(e.administered_at)}</td>
                  <td className="px-4 py-3 text-text-secondary">{e.facility || "—"}</td>
                  <td className="px-4 py-3 text-text-secondary">{e.batch_number || "—"}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {SOURCE_LABELS[e.source] || e.source}
                    {e.sync_status === "conflict" && (
                      <Badge variant="conflict" className="ml-2">
                        conflict
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={e.is_verified ? "verified" : "insufficient"}>
                      {e.is_verified ? "Verified" : "Unverified"}
                    </Badge>
                  </td>
                </tr>
              ))}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text-secondary/60">
                  No vaccination records match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
