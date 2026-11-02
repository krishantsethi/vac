"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileText, RefreshCw, Search, ShieldAlert, Upload } from "lucide-react";
import { API } from "@/lib/api";
import { formatDateIN } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { RECORD_REVIEW, can } from "@/lib/capabilities";

const STATUS_META: Record<string, { label: string; variant: any }> = {
  completed: { label: "Finalized", variant: "verified" },
  review_required: { label: "Review required", variant: "pending" },
  review_complete: { label: "Review complete", variant: "pending" },
  processing: { label: "Processing", variant: "default" },
  failed: { label: "Extraction failed", variant: "conflict" },
};

function formatSize(bytes?: number | null) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function DocumentsPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [canReview, setCanReview] = useState(false);

  // Upload form state
  const [uploadPatient, setUploadPatient] = useState("");
  const [uploading, setUploading] = useState(false);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await API.get(`/api/v1/documents?${params.toString()}`);
      setDocs(res.items || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      toast(err?.message || "Could not load documents", { variant: "destructive" });
      setDocs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/api/v1/patients?page_size=100");
        setPatients(res.items || []);
        if (res.items?.length) setUploadPatient(res.items[0].patient_id);
      } catch {
        setPatients([]);
      }
      // Display only: the server re-checks this capability on every request.
      setCanReview(can(RECORD_REVIEW));
    })();
  }, []);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file") as File | null;
    if (!uploadPatient) {
      toast("Choose which patient this document belongs to", { variant: "destructive" });
      return;
    }
    if (!file || file.size === 0) {
      toast("Choose a file to upload", { variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const payload = new FormData();
      payload.append("patient_id", uploadPatient);
      payload.append("file", file);
      const res = await API.postForm("/api/v1/documents/upload", payload);
      if (res.demo_mode) {
        toast("Uploaded in labeled demonstration OCR mode — no live OCR provider is connected");
      } else {
        toast("Document uploaded");
      }
      event.currentTarget.reset();
      setPage(1);
      await load();
    } catch (err: any) {
      toast(err?.message || "Upload failed", { variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const demoDocs = docs.filter((d) => (d.ocr_provider || "").startsWith("demo"));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-text">Documents</h1>
          <p className="text-sm text-text-secondary/90">
            Vaccination cards and historical records. Extracted fields are proposals until a person
            approves them — approving a field never writes a dose on its own.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-cyan/20 bg-cyan/5 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-cyan" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-text">Demonstration OCR mode</p>
          <p className="text-text-secondary">
            Text extraction runs against clearly-labeled local fixtures. No third-party OCR service
            is connected, and no confidence score is shown because the demo provider does not supply
            a meaningful one. Every extracted value must be reviewed by a person before it can
            become a clinical record.
          </p>
        </div>
      </div>

      {patients.length > 0 && (
        <form
          onSubmit={handleUpload}
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:flex-row md:items-end"
        >
          <div className="flex-1 space-y-1">
            <label htmlFor="doc-patient" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              Patient
            </label>
            <select
              id="doc-patient"
              className="input h-10 w-full"
              value={uploadPatient}
              onChange={(e) => setUploadPatient(e.target.value)}
            >
              {patients.map((p) => (
                <option key={p.id} value={p.patient_id}>
                  {p.patient_id} — {p.first_name} {p.last_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 space-y-1">
            <label htmlFor="doc-file" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              Card image or PDF (max 10 MB)
            </label>
            <Input id="doc-file" name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="h-10" />
          </div>
          <Button type="submit" variant="primary" disabled={uploading}>
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </form>
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
            placeholder="Search by file name or patient…"
            className="pl-9"
            aria-label="Search documents"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="doc-status" className="sr-only">
            Status
          </label>
          <select
            id="doc-status"
            className="input h-10 w-auto min-w-[11rem]"
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="all">All statuses</option>
            <option value="review_required">Review required</option>
            <option value="review_complete">Review complete</option>
            <option value="completed">Finalized</option>
            <option value="processing">Processing</option>
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
          {loading ? "Loading…" : `${total} document${total === 1 ? "" : "s"}`}
          {!loading && demoDocs.length > 0 && <span className="text-cyan"> · {demoDocs.length} demo-extracted on this page</span>}
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
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-navy-secondary/50">
              {["File", "Patient", "Type", "Size", "Uploaded", "Extraction", "Status", ""].map((h, i) => (
                <th key={i} className="px-4 py-3 text-left font-medium text-text-secondary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text-secondary/60">
                  Loading documents…
                </td>
              </tr>
            )}
            {!loading &&
              docs.map((d) => {
                const meta = STATUS_META[d.status] || { label: d.status, variant: "default" };
                return (
                  <tr key={d.id} className="transition-colors hover:bg-navy-secondary/30">
                    <td className="px-4 py-3 text-text">
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-text-secondary/70" aria-hidden />
                        {d.file_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/app/patients/${d.patient?.patient_id}`} className="text-text-secondary hover:text-cyan">
                        {d.patient?.first_name} {d.patient?.last_name}
                      </Link>
                      <span className="block text-xs text-text-secondary/70">{d.patient?.patient_id}</span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{d.file_type || "—"}</td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{formatSize(d.file_size)}</td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{formatDateIN(d.created_at)}</td>
                    <td className="px-4 py-3">
                      {(d.ocr_provider || "").startsWith("demo") ? (
                        <Badge variant="pending">Demo OCR</Badge>
                      ) : (
                        <span className="text-text-secondary">{d.ocr_provider || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canReview ? (
                        <Link href={`/app/record-verification?document=${d.id}`} className="text-sm text-cyan hover:underline">
                          Review fields
                        </Link>
                      ) : (
                        <Link href={`/app/patients/${d.patient?.patient_id}`} className="text-sm text-text-secondary hover:text-cyan">
                          Open patient
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            {!loading && docs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text-secondary/60">
                  No documents match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
