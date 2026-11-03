"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { API } from "@/lib/api";
import { can, CLINICAL_WRITE } from "@/lib/capabilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { formatDateIN } from "@/lib/utils";

interface ExtractedField {
  id: string;
  field_name: string;
  field_value: string;
  confidence: number | null;
  is_approved: boolean;
  requires_review: boolean;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface DocumentRow {
  id: string;
  file_name: string;
  status: string;
  ocr_status?: string;
  ocr_provider?: string;
  file_type?: string;
  created_at?: string;
  patient?: { patient_id?: string; first_name?: string; last_name?: string } | null;
  patient_id?: string;
}

/** Mirrors the server's REQUIRED_FINALIZE_FIELDS. */
const REQUIRED_FIELDS = ["vaccination_date", "vaccine_name", "dose_label"];

const FIELD_LABELS: Record<string, string> = {
  vaccination_date: "Vaccination date",
  vaccine_name: "Vaccine name",
  dose_label: "Dose",
  facility: "Facility",
  batch_number: "Batch number",
};

const STATUS_BADGE: Record<string, "pending" | "verified" | "warn" | "conflict" | "default"> = {
  review_required: "pending",
  review_complete: "warn",
  completed: "verified",
  uploaded: "default",
  processing: "pending",
  failed: "conflict",
};

function isDemoOcr(doc?: DocumentRow | null) {
  return !!doc?.ocr_provider && doc.ocr_provider.includes("demo");
}

export function RecordVerificationPage() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("review_required");
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [loadingFields, setLoadingFields] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizedEvent, setFinalizedEvent] = useState<any>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "warn" | "ok"; text: string } | null>(null);

  const selectedDoc = docs.find((d) => d.id === selectedId) || null;
  const mayWrite = can(CLINICAL_WRITE);

  const loadFields = useCallback(async (docId: string) => {
    if (!docId) return;
    setLoadingFields(true);
    setFinalizedEvent(null);
    setNotice(null);
    try {
      const data = await API.get(`/api/v1/documents/${docId}/fields`);
      setFields(Array.isArray(data) ? data : data?.items || []);
    } catch (err: any) {
      setFields([]);
      setNotice({ tone: "error", text: err?.message || "Could not load the extracted fields." });
    } finally {
      setLoadingFields(false);
    }
  }, []);

  const loadDocs = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}&page_size=50` : "?page_size=50";
      const data = await API.get(`/api/v1/documents${query}`);
      const items: DocumentRow[] = data?.items || [];
      setDocs(items);
      setSelectedId((current) => {
        if (current && items.some((d) => d.id === current)) return current;
        return items[0]?.id || "";
      });
      if (items.length === 0) setFields([]);
    } catch (err: any) {
      setDocs([]);
      setNotice({ tone: "error", text: err?.message || "Could not load documents." });
    } finally {
      setLoadingDocs(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    if (selectedId) loadFields(selectedId);
  }, [selectedId, loadFields]);

  async function reviewField(field: ExtractedField, approved: boolean) {
    if (!selectedId) return;
    setNotice(null);
    try {
      await API.post(`/api/v1/extracted-fields/${field.id}/review`, {
        field_id: field.id,
        approved,
        reason: approved
          ? "Checked against the source document by a human reviewer"
          : "Does not match the source document",
      });
      toast(approved ? "Field approved" : "Field rejected", {
        variant: approved ? "success" : "info",
      });
      await loadFields(selectedId);
    } catch (err: any) {
      const message = err?.message || "Review failed";
      setNotice({ tone: "error", text: message });
      toast(message, { variant: "error" });
    }
  }

  async function finalize() {
    if (!selectedId) return;
    setFinalizing(true);
    setNotice(null);
    setFinalizedEvent(null);
    try {
      const event = await API.post(`/api/v1/documents/${selectedId}/finalize`, {});
      setFinalizedEvent(event);
      toast("Document finalized — a verified vaccination event was created", {
        variant: "success",
      });
      await loadFields(selectedId);
      await loadDocs();
    } catch (err: any) {
      // The server refuses for specific, meaningful reasons. Show them verbatim
      // rather than a generic failure — the reviewer needs to know what to fix.
      const message = err?.message || "Finalization was refused";
      setNotice({ tone: "warn", text: message });
      toast(message, { variant: "error" });
    } finally {
      setFinalizing(false);
    }
  }

  const progress = useMemo(() => {
    const decided = fields.filter((f) => f.reviewed_by !== null);
    const approvedNames = new Set(
      fields.filter((f) => f.is_approved).map((f) => f.field_name)
    );
    const missingRequired = REQUIRED_FIELDS.filter((name) => !approvedNames.has(name));
    return {
      decided: decided.length,
      total: fields.length,
      missingRequired,
      ready: fields.length > 0 && decided.length === fields.length && missingRequired.length === 0,
      approvedNames,
    };
  }, [fields]);

  if (loadingDocs) {
    return (
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text">Record verification</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-secondary">
            Extraction proposes values; a human decides. Nothing becomes a vaccination record until
            every extracted field has an explicit decision and the required fields are approved.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter documents by status"
            className="h-9 rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
          >
            <option value="">All statuses</option>
            <option value="review_required">Awaiting review</option>
            <option value="review_complete">Decided, not finalized</option>
            <option value="completed">Finalized</option>
            <option value="uploaded">Uploaded</option>
          </select>
          <Button variant="outline" size="sm" onClick={loadDocs}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {isDemoOcr(selectedDoc) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/8 p-4">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-text">
              Demonstration extraction — provider: {selectedDoc?.ocr_provider}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              No live OCR service is connected. These values come from labeled demonstration
              fixtures, so they are not the product of reading this file. Every value still requires
              a human decision before it can become a record, and no confidence score is shown
              because this provider does not supply a calibrated one.
            </p>
          </div>
        </div>
      )}

      {notice && (
        <div
          className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
            notice.tone === "error"
              ? "border-red-500/30 bg-red-500/8"
              : notice.tone === "warn"
              ? "border-amber-500/30 bg-amber-500/8"
              : "border-mint/30 bg-mint/8"
          }`}
          role="status"
        >
          {notice.tone === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          )}
          <p className="text-text-secondary">{notice.text}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">Documents ({docs.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {docs.length === 0 && (
              <p className="py-6 text-center text-sm text-text-secondary">
                No documents match this filter.
              </p>
            )}
            {docs.map((doc) => {
              const active = doc.id === selectedId;
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setSelectedId(doc.id)}
                  aria-pressed={active}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    active
                      ? "border-cyan/50 bg-cyan/8"
                      : "border-border/60 bg-navy-secondary/30 hover:border-cyan/30"
                  }`}
                >
                  <span className="flex items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-cyan" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">
                        {doc.file_name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-text-secondary">
                        {doc.patient?.first_name
                          ? `${doc.patient.first_name} ${doc.patient.last_name || ""}`
                          : "Patient not resolved"}
                        {doc.patient?.patient_id ? ` · ${doc.patient.patient_id}` : ""}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant={STATUS_BADGE[doc.status] || "default"}>{doc.status.replace(/_/g, " ")}</Badge>
                        {isDemoOcr(doc) && <Badge variant="warn">demo extraction</Badge>}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {!selectedDoc ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-text-secondary">
              Select a document to review its extracted fields.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{selectedDoc.file_name}</CardTitle>
                  <p className="mt-1 text-xs text-text-secondary">
                    {selectedDoc.patient?.first_name
                      ? `${selectedDoc.patient.first_name} ${selectedDoc.patient.last_name || ""} · ${selectedDoc.patient.patient_id}`
                      : "Patient not resolved"}
                    {selectedDoc.created_at ? ` · uploaded ${formatDateIN(selectedDoc.created_at)}` : ""}
                    {selectedDoc.file_type ? ` · ${selectedDoc.file_type}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-text-secondary">
                    {progress.decided} of {progress.total} fields decided
                  </p>
                  <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-navy-secondary">
                    <div
                      className="h-full rounded-full bg-cyan transition-all"
                      style={{ width: progress.total ? `${(progress.decided / progress.total) * 100}%` : "0%" }}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingFields ? (
                  <Skeleton className="h-32 rounded-md" />
                ) : fields.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-secondary">
                    No fields were extracted from this document. Finalization is not possible, so
                    the underlying dose must be entered manually if it is confirmed.
                  </p>
                ) : (
                  fields.map((field) => {
                    const decided = field.reviewed_by !== null;
                    const required = REQUIRED_FIELDS.includes(field.field_name);
                    return (
                      <div
                        key={field.id}
                        className={`rounded-md border p-3 ${
                          field.is_approved
                            ? "border-mint/30 bg-mint/5"
                            : decided
                            ? "border-red-500/25 bg-red-500/5"
                            : "border-border/60 bg-navy-secondary/40"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-text-secondary">
                            {FIELD_LABELS[field.field_name] || field.field_name}
                            <span className="font-mono text-[10px] normal-case tracking-normal text-text-secondary/60">
                              {field.field_name}
                            </span>
                            {required && <Badge variant="default">required</Badge>}
                            {field.requires_review && <Badge variant="conflict">flagged</Badge>}
                          </span>
                          {decided ? (
                            <Badge variant={field.is_approved ? "verified" : "critical"}>
                              {field.is_approved ? "Approved" : "Rejected"}
                            </Badge>
                          ) : (
                            <Badge variant="pending">Awaiting decision</Badge>
                          )}
                        </div>

                        <p className="mt-2 font-mono text-sm text-text">
                          {field.field_value === "" ? (
                            <span className="italic text-text-secondary/60">(empty — nothing extracted)</span>
                          ) : (
                            field.field_value
                          )}
                        </p>

                        {field.confidence === null || field.confidence === undefined ? (
                          <p className="mt-1 text-[11px] text-text-secondary/70">
                            No confidence measure supplied by this extraction provider — none is
                            displayed rather than estimated.
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-text-secondary">
                            Provider confidence: {(field.confidence * 100).toFixed(0)}%
                          </p>
                        )}

                        {field.review_note && (
                          <p className="mt-1 text-[11px] text-text-secondary/85">
                            Reviewer note: {field.review_note}
                          </p>
                        )}

                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            variant={field.is_approved ? "ghost" : "outline"}
                            size="sm"
                            onClick={() => reviewField(field, true)}
                          >
                            <Check className="mr-1.5 h-3.5 w-3.5" />
                            {decided ? "Re-approve" : "Approve"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => reviewField(field, false)}
                          >
                            <X className="mr-1.5 h-3.5 w-3.5" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Finalize into a clinical record</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  {REQUIRED_FIELDS.map((name) => {
                    const ok = progress.approvedNames.has(name);
                    const field = fields.find((f) => f.field_name === name);
                    return (
                      <div
                        key={name}
                        className={`rounded-md border p-3 text-xs ${
                          ok ? "border-mint/30 bg-mint/5" : "border-border/60 bg-navy-secondary/30"
                        }`}
                      >
                        <p className="flex items-center gap-2 font-medium text-text">
                          {ok ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-mint" aria-hidden />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-text-secondary/60" aria-hidden />
                          )}
                          {FIELD_LABELS[name] || name}
                        </p>
                        <p className="mt-1 truncate font-mono text-text-secondary">
                          {field?.field_value || "(none)"}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {!progress.ready && fields.length > 0 && (
                  <p className="text-xs leading-relaxed text-text-secondary">
                    {progress.decided < progress.total
                      ? `${progress.total - progress.decided} field(s) still need an explicit decision. `
                      : ""}
                    {progress.missingRequired.length > 0 &&
                      `Required but not approved: ${progress.missingRequired.join(", ")}. `}
                    Finalization is refused until this is complete — the system will not invent a
                    vaccine name or a date.
                  </p>
                )}

                {finalizedEvent && (
                  <div className="rounded-md border border-mint/30 bg-mint/8 p-3 text-xs">
                    <p className="flex items-center gap-2 font-medium text-text">
                      <CheckCircle2 className="h-4 w-4 text-mint" aria-hidden />
                      Verified vaccination event created
                    </p>
                    <p className="mt-1 text-text-secondary">
                      {finalizedEvent.vaccine_name || finalizedEvent.vaccine_id} ·{" "}
                      {finalizedEvent.dose_label || "dose not specified"} ·{" "}
                      {finalizedEvent.administered_at
                        ? formatDateIN(finalizedEvent.administered_at)
                        : "date not recorded"}{" "}
                      · source {finalizedEvent.source || "ocr"}
                    </p>
                    <p className="mt-1 text-text-secondary/85">
                      The schedule was recalculated for this patient. Nothing else was changed
                      automatically.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={finalize}
                    disabled={!progress.ready || finalizing || !mayWrite}
                  >
                    {finalizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
                    {finalizing ? "Finalizing…" : "Finalize document"}
                  </Button>
                  {!mayWrite && (
                    <p className="text-xs text-text-secondary">
                      Your role can review documents but cannot write clinical records, so
                      finalization is disabled here and refused by the API.
                    </p>
                  )}
                  {selectedDoc.status === "completed" && (
                    <Badge variant="verified">already finalized</Badge>
                  )}
                </div>

                <p className="text-xs leading-relaxed text-text-secondary/85">
                  Finalizing writes exactly one event from the approved fields, marks the document
                  complete, and refuses if an identical dose for this patient already exists — it
                  never overwrites or merges an existing record silently.
                </p>
              </CardContent>
            </Card>

            {selectedDoc.patient?.patient_id && (
              <p className="text-xs text-text-secondary">
                <Link
                  href={`/app/patients/${selectedDoc.patient.patient_id}`}
                  className="text-cyan hover:underline"
                >
                  Open {selectedDoc.patient.first_name} {selectedDoc.patient.last_name}'s full record →
                </Link>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RecordVerificationPage;
