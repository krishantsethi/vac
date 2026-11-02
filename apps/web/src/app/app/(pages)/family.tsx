"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Home,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { API } from "@/lib/api";
import { can, CAREGIVER_MANAGE, CLINICAL_READ } from "@/lib/capabilities";
import { currentRole } from "@/lib/capabilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ageLabel, formatDateIN } from "@/lib/utils";

interface CaregiverLink {
  id: string;
  caregiver_user_id: string;
  patient_id: string;
  relationship_type: string;
  authorized: boolean;
  created_at?: string;
  caregiver_name?: string | null;
  caregiver_email?: string | null;
  patient_display_id?: string | null;
  patient_name?: string | null;
}

interface CaregiverAccount {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
}

interface PatientRow {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  date_of_birth?: string;
  service_area?: string | null;
  status_summary?: {
    record_status?: string;
    actionable_count?: number;
    unverified_entries?: number;
  } | null;
}

const RELATIONSHIPS = [
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Legal guardian" },
  { value: "grandparent", label: "Grandparent" },
  { value: "sibling", label: "Sibling" },
  { value: "family", label: "Other family member" },
];

const RECORD_BADGE: Record<string, "verified" | "pending" | "warn" | "critical" | "default"> = {
  up_to_date: "verified",
  upcoming: "default",
  due: "warn",
  potentially_overdue: "critical",
  verification_required: "pending",
};

export function FamilyPage() {
  const role = currentRole();
  const manages = can(CAREGIVER_MANAGE);

  const [links, setLinks] = useState<CaregiverLink[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [caregivers, setCaregivers] = useState<CaregiverAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);

  const [form, setForm] = useState({
    caregiver_user_id: "",
    patient_id: "",
    relationship_type: "parent",
    authorized: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await API.get("/api/v1/caregivers");
      setLinks(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || "Could not load caregiver relationships.");
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Patient names are needed by every view; the caregiver directory is only
  // fetched by roles the API will actually serve it to.
  useEffect(() => {
    (async () => {
      try {
        const data = await API.get("/api/v1/patients?page_size=100&include_status=true");
        setPatients(data?.items || []);
      } catch {
        /* names are a convenience; links still render without them */
      }
    })();
    if (!manages) return;
    (async () => {
      try {
        const data = await API.get("/api/v1/users/caregivers");
        setCaregivers(Array.isArray(data) ? data : []);
      } catch (err: any) {
        setError(err?.message || "Could not load caregiver accounts.");
      }
    })();
  }, [manages]);

  const patientByUuid = useMemo(() => {
    const map = new Map<string, PatientRow>();
    patients.forEach((p) => map.set(p.id, p));
    return map;
  }, [patients]);

  async function createLink(e: React.FormEvent) {
    e.preventDefault();
    if (!form.caregiver_user_id || !form.patient_id) {
      toast("Choose both a caregiver and a dependent", { variant: "error" });
      return;
    }
    setSaving(true);
    try {
      await API.post("/api/v1/caregivers", { ...form });
      toast("Caregiver relationship created", { variant: "success" });
      setForm({ caregiver_user_id: "", patient_id: "", relationship_type: "parent", authorized: true });
      await load();
    } catch (err: any) {
      // 409 means the link already exists — surfaced verbatim, never overwritten.
      toast(err?.message || "Could not create the relationship", { variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function setAuthorized(link: CaregiverLink, authorized: boolean) {
    setBusyLinkId(link.id);
    try {
      await API.patch(`/api/v1/caregivers/${link.id}`, {
        caregiver_user_id: link.caregiver_user_id,
        patient_id: link.patient_id,
        relationship_type: link.relationship_type,
        authorized,
      });
      toast(authorized ? "Access authorized" : "Access revoked", {
        variant: authorized ? "success" : "info",
      });
      await load();
    } catch (err: any) {
      toast(err?.message || "Could not update the relationship", { variant: "error" });
    } finally {
      setBusyLinkId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56 rounded" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-text">
            <Home className="h-5 w-5 text-cyan" aria-hidden />
            Family profiles
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-secondary">
            {manages
              ? "Authorize who may act for a child, and review every existing authorization. Access is granted explicitly — it is never inferred from a shared surname or address."
              : "Caregiver access to a child's record is granted explicitly, one relationship at a time."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/8 p-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <p className="text-text-secondary">{error}</p>
        </div>
      )}

      {!manages && role !== "patient" && role !== "caregiver" && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-8">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
            <div className="space-y-2">
              <p className="text-sm font-medium text-text">
                Caregiver authorization is managed by clinic and public-health administrators.
              </p>
              <p className="max-w-2xl text-xs leading-relaxed text-text-secondary">
                Your role ({role}) has no caregiver relationships to display and cannot create them.
                The API refuses these requests independently of what the interface shows.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {manages && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-cyan" aria-hidden />
              Authorize a caregiver for a dependent
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={createLink} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label htmlFor="cg-user" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-secondary">
                  Caregiver account
                </label>
                <select
                  id="cg-user"
                  value={form.caregiver_user_id}
                  onChange={(e) => setForm({ ...form, caregiver_user_id: e.target.value })}
                  className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
                  required
                >
                  <option value="">Select a caregiver…</option>
                  {caregivers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} — {c.email}
                    </option>
                  ))}
                </select>
                {caregivers.length === 0 && (
                  <p className="mt-1 text-[11px] text-text-secondary/80">
                    No active caregiver accounts exist yet. Create one from Settings first.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="cg-patient" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-secondary">
                  Dependent
                </label>
                <select
                  id="cg-patient"
                  value={form.patient_id}
                  onChange={(e) => setForm({ ...form, patient_id: e.target.value })}
                  className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
                  required
                >
                  <option value="">Select a dependent…</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} — {p.patient_id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="cg-rel" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-secondary">
                  Relationship
                </label>
                <select
                  id="cg-rel"
                  value={form.relationship_type}
                  onChange={(e) => setForm({ ...form, relationship_type: e.target.value })}
                  className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
                >
                  {RELATIONSHIPS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <Button variant="primary" type="submit" disabled={saving} className="w-full">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  {saving ? "Saving…" : "Authorize"}
                </Button>
              </div>
            </form>

            <label className="flex items-start gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={form.authorized}
                onChange={(e) => setForm({ ...form, authorized: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-cyan"
              />
              <span>
                Grant immediate access. Leave unchecked to record the relationship without
                authorizing it — useful when consent is still being confirmed.
              </span>
            </label>
          </CardContent>
        </Card>
      )}

      {role === "patient" && links.length > 0 && (
        <Card className="border-cyan/25 bg-cyan/5">
          <CardContent className="flex items-start gap-3 py-5">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan" aria-hidden />
            <p className="text-xs leading-relaxed text-text-secondary">
              <span className="font-medium text-text">These people can access your record.</span>{" "}
              Contact details are withheld here. If any of them should no longer have access, ask a
              clinic administrator to revoke it — you cannot be locked out of your own record.
            </p>
          </CardContent>
        </Card>
      )}

      {links.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Users className="mx-auto mb-3 h-8 w-8 text-text-secondary/40" aria-hidden />
            <p className="text-sm text-text-secondary">
              {manages
                ? "No caregiver relationships have been recorded yet."
                : "No caregiver relationships apply to this account."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {links.map((link) => {
            const patient = patientByUuid.get(link.patient_id);
            const displayId = link.patient_display_id || patient?.patient_id;
            const name = link.patient_name || (patient ? `${patient.first_name} ${patient.last_name}` : null);
            const summary = patient?.status_summary;
            const busy = busyLinkId === link.id;
            return (
              <Card key={link.id} className={!link.authorized ? "border-border/60 opacity-90" : undefined}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text">
                        {name || "Dependent record"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-text-secondary">
                        {displayId || "identifier withheld"}
                        {patient?.date_of_birth ? ` · ${ageLabel(patient.date_of_birth)}` : ""}
                        {patient?.service_area ? ` · ${patient.service_area}` : ""}
                      </p>
                    </div>
                    <Badge variant={link.authorized ? "verified" : "insufficient"}>
                      {link.authorized ? "Authorized" : "Not authorized"}
                    </Badge>
                  </div>

                  <dl className="space-y-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-secondary">Caregiver</dt>
                      <dd className="truncate text-right text-text">
                        {link.caregiver_name || "name withheld"}
                      </dd>
                    </div>
                    {link.caregiver_email && (
                      <div className="flex justify-between gap-2">
                        <dt className="text-text-secondary">Contact</dt>
                        <dd className="truncate text-right font-mono text-[11px] text-text-secondary">
                          {link.caregiver_email}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-secondary">Relationship</dt>
                      <dd className="text-text capitalize">{link.relationship_type.replace(/_/g, " ")}</dd>
                    </div>
                    {link.created_at && (
                      <div className="flex justify-between gap-2">
                        <dt className="text-text-secondary">Since</dt>
                        <dd className="text-text">{formatDateIN(link.created_at)}</dd>
                      </div>
                    )}
                  </dl>

                  {summary?.record_status && (
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                      <Badge variant={RECORD_BADGE[summary.record_status] || "default"}>
                        {summary.record_status.replace(/_/g, " ")}
                      </Badge>
                      {(summary.actionable_count ?? 0) > 0 && (
                        <span className="text-[11px] text-text-secondary">
                          {summary.actionable_count} actionable
                        </span>
                      )}
                      {(summary.unverified_entries ?? 0) > 0 && (
                        <span className="text-[11px] text-amber-400">
                          {summary.unverified_entries} unverified
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                    {displayId && (
                      <Link
                        href={`/app/patients/${displayId}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-cyan/40 hover:text-cyan"
                      >
                        Open record
                        <ArrowUpRight className="h-3 w-3" aria-hidden />
                      </Link>
                    )}
                    {manages && (
                      <Button
                        variant={link.authorized ? "ghost" : "outline"}
                        size="sm"
                        onClick={() => setAuthorized(link, !link.authorized)}
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : link.authorized ? (
                          <Ban className="mr-1.5 h-3.5 w-3.5" />
                        ) : (
                          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {link.authorized ? "Revoke access" : "Authorize"}
                      </Button>
                    )}
                  </div>

                  {!link.authorized && (
                    <p className="text-[11px] leading-relaxed text-text-secondary/80">
                      This relationship is recorded but grants no access. The caregiver sees nothing
                      for this child until it is authorized.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="space-y-2 pt-6 text-xs leading-relaxed text-text-secondary">
          <p className="font-medium text-text">How caregiver access works here</p>
          <p>
            Access is granted per relationship, and the API checks it on every request — a caregiver
            account cannot reach a child they are not authorized for, even by editing the URL.
          </p>
          <p>
            Relationships are never created automatically. A matching surname, address or phone
            number is treated as a reason for a human to check, not as proof of a relationship.
            Revoking access keeps the relationship on record for audit rather than deleting it.
          </p>
          {can(CLINICAL_READ) && (
            <p>
              You are viewing these links as a clinical or administrative role. A patient sees the
              same list without caregiver contact details.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default FamilyPage;
