"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  EyeOff,
  FileWarning,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { API } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { formatDateIN } from "@/lib/utils";

interface PatientOption {
  patient_id: string;
  first_name: string;
  last_name: string;
  date_of_birth?: string;
}

interface RecordEvent {
  vaccine_code: string;
  vaccine_name?: string;
  dose_label?: string;
  administered_at?: string;
  facility?: string | null;
  batch_number?: string | null;
  is_verified: boolean;
  source?: string | null;
}

interface VerificationResult {
  valid: boolean;
  reason?: string;
  record_reference?: string;
  issuing_instance?: string;
  issued_at?: string;
  expires_at?: string;
  summary?: Record<string, unknown>;
  record_found_in_registry?: boolean;
  official_status?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manually entered",
  ocr: "From document (reviewed)",
  import: "Imported",
  sync: "Offline sync",
};

export default function DigitalRecord() {
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [record, setRecord] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [copied, setCopied] = useState<"token" | "link" | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await API.get("/api/v1/patients?page_size=100");
        if (!alive) return;
        const items = data?.items || [];
        setPatients(items);
        if (items.length === 1) setSelectedId(items[0].patient_id);
      } catch (err: any) {
        if (alive) setError(err?.message || "Could not load the patient list.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadRecord = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    setError(null);
    setVerification(null);
    try {
      const data = await API.get(`/api/v1/patients/${pid}/digital-record`);
      setRecord(data);
    } catch (err: any) {
      setRecord(null);
      setError(err?.message || "Could not generate the digital record.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadRecord(selectedId);
  }, [selectedId, loadRecord]);

  const qrPayload: string | null = record?.qr?.payload ?? null;

  const verificationUrl = useMemo(() => {
    if (!record?.qr?.verification_path) return null;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}${record.qr.verification_path}`;
  }, [record]);

  async function runVerification() {
    if (!qrPayload) return;
    setVerifying(true);
    setVerification(null);
    try {
      // Public endpoint: this is exactly what a scanner on the other side would call.
      const result = await API.get(
        `/api/v1/records/verify?token=${encodeURIComponent(qrPayload)}`
      );
      setVerification(result);
    } catch (err: any) {
      setVerification({ valid: false, reason: err?.message || "Verification request failed." });
    } finally {
      setVerifying(false);
    }
  }

  async function copy(value: string | null | undefined, kind: "token" | "link") {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      toast(kind === "token" ? "Signed token copied" : "Verification link copied", {
        variant: "success",
      });
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast("Clipboard access was blocked by the browser", { variant: "error" });
    }
  }

  const counts = record?.counts || {};
  const events: RecordEvent[] = record?.events || [];
  const pending = record?.pending_items || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-text">Digital immunisation record</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-secondary">
          A portable summary of one patient's recorded immunisations, with a signed QR code that
          anyone can check. The code proves the summary was issued by this instance and has not been
          altered — it does not disclose the holder's identity or per-dose clinical detail.
        </p>
      </div>

      {record?.official_status && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/8 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-text">{record.official_status}</p>
            <p className="text-xs leading-relaxed text-text-secondary">
              Issued by {record.issuing_organization || "this demonstration instance"} ·{" "}
              {record.record_id} · generated {formatDateIN(record.generated_at)}
            </p>
          </div>
        </div>
      )}

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" aria-hidden />
            <div className="space-y-2">
              <p className="text-sm font-medium text-text">{error}</p>
              <p className="text-xs text-text-secondary">
                A record can only be generated for patients this account is authorized to see.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {patients.length > 1 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label
              htmlFor="record-patient"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-secondary"
            >
              Patient
            </label>
            <select
              id="record-patient"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
            >
              <option value="">Select a patient…</option>
              {patients.map((p) => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.first_name} {p.last_name} · {p.patient_id}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadRecord(selectedId)}
            disabled={!selectedId || loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
        </div>
      )}

      {patients.length === 0 && !loading && !error && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-text-secondary">
            No patients are visible to this account.
          </CardContent>
        </Card>
      )}

      {!selectedId && patients.length > 1 && !loading && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-text-secondary">
            Select a patient to generate their record.
          </CardContent>
        </Card>
      )}

      {loading && selectedId && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      )}

      {record && !loading && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <QrCode className="h-4 w-4 text-cyan" aria-hidden />
                Signed verification code
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-center rounded-lg bg-white p-4">
                {verificationUrl ? (
                  <QRCodeSVG
                    value={verificationUrl}
                    size={208}
                    level="M"
                    marginSize={2}
                    bgColor="#FFFFFF"
                    fgColor="#07111F"
                    aria-label={`QR code linking to the verification endpoint for record ${record.record_id}`}
                  />
                ) : (
                  <p className="text-sm text-slate-700">QR unavailable</p>
                )}
              </div>

              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Record reference</dt>
                  <dd className="font-mono text-text">{record.record_id}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Record status</dt>
                  <dd>
                    <Badge variant={record.record_status === "verified" ? "verified" : "warn"}>
                      {record.record_status_label || record.record_status}
                    </Badge>
                  </dd>
                </div>
                {record.schedule_version?.source_name && (
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-text-secondary">Schedule basis</dt>
                    <dd className="text-right text-text">
                      {record.schedule_version.source_name}
                      <span className="ml-1 font-mono text-text-secondary/70">
                        v{record.schedule_version.source_version}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>

              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => copy(qrPayload, "token")}
                >
                  {copied === "token" ? (
                    <Check className="mr-2 h-4 w-4 text-mint" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  Copy signed token
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => copy(verificationUrl, "link")}
                >
                  {copied === "link" ? (
                    <Check className="mr-2 h-4 w-4 text-mint" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  Copy verification link
                </Button>
                <Button variant="primary" size="sm" className="w-full" onClick={runVerification} disabled={verifying}>
                  {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  {verifying ? "Checking…" : "Verify this code now"}
                </Button>
              </div>

              {verification && (
                <div
                  className={`rounded-md border p-3 text-xs ${
                    verification.valid
                      ? "border-mint/30 bg-mint/8"
                      : "border-red-500/30 bg-red-500/8"
                  }`}
                >
                  <p className="flex items-center gap-2 font-medium text-text">
                    {verification.valid ? (
                      <CheckCircle2 className="h-4 w-4 text-mint" aria-hidden />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400" aria-hidden />
                    )}
                    {verification.valid ? "Signature valid" : "Verification failed"}
                  </p>
                  {verification.reason && (
                    <p className="mt-1 text-text-secondary">{verification.reason}</p>
                  )}
                  {verification.expires_at && (
                    <p className="mt-1 text-text-secondary">
                      Expires {formatDateIN(verification.expires_at)}
                    </p>
                  )}
                  {verification.summary && (
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-navy/60 p-2 font-mono text-[11px] text-text-secondary">
                      {JSON.stringify(verification.summary, null, 2)}
                    </pre>
                  )}
                  {verification.valid && (
                    <p className="mt-2 text-text-secondary/85">
                      Note what is absent: no name, no date of birth, no per-dose detail was returned
                      to this unauthenticated check.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">What the code does and does not reveal</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-md border border-border bg-navy-secondary/30 p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mint">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Included
                  </p>
                  <ul className="space-y-1 text-xs text-text-secondary">
                    {(record.qr?.contains || []).map((item: string) => (
                      <li key={item} className="flex gap-2">
                        <span className="text-mint" aria-hidden>·</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-border bg-navy-secondary/30 p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
                    <EyeOff className="h-3.5 w-3.5" aria-hidden /> Never included
                  </p>
                  <ul className="space-y-1 text-xs text-text-secondary">
                    {(record.qr?.does_not_contain || []).map((item: string) => (
                      <li key={item} className="flex gap-2">
                        <span className="text-amber-400" aria-hidden>·</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Recorded immunisations</CardTitle>
                <div className="flex gap-2 text-xs">
                  <Badge variant="verified">{counts.verified_events ?? 0} verified</Badge>
                  {(counts.unverified_events ?? 0) > 0 && (
                    <Badge variant="warn">{counts.unverified_events} unverified</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                  <span className="font-medium text-text">
                    {record.patient?.name} · {record.patient?.patient_id}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {record.patient?.date_of_birth
                      ? `Born ${formatDateIN(record.patient.date_of_birth)}`
                      : "Date of birth not recorded"}
                    {record.patient?.gender ? ` · ${record.patient.gender}` : ""}
                    {record.patient?.service_area ? ` · ${record.patient.service_area}` : ""}
                  </span>
                  <Link
                    href={`/app/patients/${record.patient?.patient_id}`}
                    className="text-xs text-cyan hover:underline"
                  >
                    Open full clinical profile →
                  </Link>
                </div>

                {events.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-secondary">
                    No immunisation events are recorded for this patient. An empty record means
                    nothing has been captured here — it is not evidence that no dose was given
                    elsewhere.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-secondary">
                          <th className="pb-2 pr-4 font-medium">Vaccine</th>
                          <th className="pb-2 pr-4 font-medium">Dose</th>
                          <th className="pb-2 pr-4 font-medium">Date</th>
                          <th className="pb-2 pr-4 font-medium">Facility</th>
                          <th className="pb-2 font-medium">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {events.map((event, index) => (
                          <tr key={`${event.vaccine_code}-${index}`}>
                            <td className="py-2.5 pr-4">
                              <span className="font-medium text-text">{event.vaccine_name || event.vaccine_code}</span>
                              <span className="ml-2 font-mono text-[11px] text-text-secondary/70">
                                {event.vaccine_code}
                              </span>
                              {!event.is_verified && (
                                <Badge variant="warn" className="ml-2">
                                  Unverified
                                </Badge>
                              )}
                            </td>
                            <td className="py-2.5 pr-4 text-text-secondary">{event.dose_label || "—"}</td>
                            <td className="py-2.5 pr-4 text-text-secondary">
                              {event.administered_at ? formatDateIN(event.administered_at) : "—"}
                            </td>
                            <td className="py-2.5 pr-4 text-text-secondary">{event.facility || "—"}</td>
                            <td className="py-2.5 text-xs text-text-secondary">
                              {event.source ? SOURCE_LABELS[event.source] || event.source : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {pending.length > 0 && (
                  <div className="rounded-md border border-amber-500/25 bg-amber-500/8 p-3">
                    <p className="flex items-center gap-2 text-xs font-semibold text-text">
                      <FileWarning className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                      Recorded as pending on this document
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-text-secondary">
                      {pending.map((item: any, index: number) => (
                        <li key={index}>
                          {typeof item === "string" ? item : JSON.stringify(item)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-text-secondary/85">
                      These are excluded from the verified counts above until they are reviewed.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2 pt-6 text-xs leading-relaxed text-text-secondary">
                <p className="font-medium text-text">How this signature works — and its limits</p>
                <p>
                  The token is an HMAC-SHA256 signature over the summary fields, using a server-side
                  secret. It confirms the payload was produced by this instance and has not been
                  edited, and it carries an expiry so an old code cannot be presented indefinitely.
                </p>
                <p>
                  It is not a public-key credential: there is no certificate chain, no issuer
                  directory and no offline verification. Anyone checking must reach this server. It
                  is not recognized by any government or official immunisation registry.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {record?.verification_instructions && (
        <p className="rounded-lg border border-border bg-navy-secondary/30 p-4 text-xs leading-relaxed text-text-secondary">
          {record.verification_instructions}
        </p>
      )}
    </div>
  );
}
