"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  PhoneCall,
  QrCode,
  RefreshCw,
  Save,
  ScrollText,
  ShieldCheck,
  Syringe,
  TriangleAlert,
  Upload,
  UserRound,
} from "lucide-react";
import { API } from "@/lib/api";
import {
  can,
  AUDIT_VIEW,
  CLINICAL_READ,
  CLINICAL_WRITE,
  OUTREACH_VIEW,
  PATIENT_MANAGEMENT,
} from "@/lib/capabilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { ageLabel, formatDateIN, formatIndianPhone, isValidIndianPhone } from "@/lib/utils";

interface VaccinationEvent {
  id: string;
  vaccine_code: string;
  vaccine_name?: string;
  dose_label?: string;
  administered_at?: string;
  facility?: string | null;
  batch_number?: string | null;
  is_verified: boolean;
  source?: string | null;
  source_document_id?: string | null;
  created_at?: string;
}

interface Recommendation {
  id: string;
  vaccine_code: string;
  rule_id?: string;
  status: string;
  explanation?: string;
  due_date?: string | null;
}

interface RecordIssue {
  type: string;
  severity: string;
  vaccine_code?: string;
  dose_number?: number;
  dates?: string[];
  event_ids?: string[];
  evidence?: Record<string, any>;
  conflicting_fields?: string[];
  recommended_action?: string;
}

interface OutreachTask {
  id: string;
  title: string;
  reason?: string | null;
  status: string;
  priority_score?: number | null;
  due_date?: string | null;
  attempt_count?: number;
  assigned_worker_name?: string | null;
}

const TABS = [
  { id: "overview", label: "Overview", icon: UserRound },
  { id: "history", label: "Vaccinations", icon: Syringe },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "verification", label: "Verification", icon: ShieldCheck },
  { id: "followup", label: "Follow-up", icon: PhoneCall },
  { id: "audit", label: "Audit", icon: ScrollText },
] as const;

const REC_BADGE: Record<string, "verified" | "default" | "warn" | "critical" | "pending"> = {
  up_to_date: "verified",
  upcoming: "default",
  due: "warn",
  potentially_overdue: "critical",
  verification_required: "pending",
};

const REC_ORDER = ["potentially_overdue", "due", "verification_required", "upcoming", "up_to_date"];

const SEVERITY_BADGE: Record<string, "critical" | "warn" | "pending" | "default"> = {
  high: "critical",
  medium: "warn",
  low: "pending",
};

const ISSUE_LABELS: Record<string, string> = {
  conflicting_dates: "Conflicting dates for the same dose",
  duplicate_event: "Possible duplicate entry",
  unverified_dose: "Unverified dose",
  terminology_variance: "Vaccine naming variance",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manually entered",
  ocr: "From reviewed document",
  import: "Imported",
  sync: "Offline sync",
};

export function PatientProfilePage() {
  const params = useParams<{ id: string }>();
  const patientId = params?.id ? String(params.id) : "";

  const [patient, setPatient] = useState<any>(null);
  const [events, setEvents] = useState<VaccinationEvent[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [issues, setIssues] = useState<RecordIssue[]>([]);
  const [issueNote, setIssueNote] = useState<string>("");
  const [tasks, setTasks] = useState<OutreachTask[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [vaccines, setVaccines] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [savingDose, setSavingDose] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [profileForm, setProfileForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    address: "",
    service_area: "",
    gender: "",
  });

  const [doseForm, setDoseForm] = useState({
    vaccine_code: "",
    dose_label: "",
    administered_at: "",
    facility: "",
    batch_number: "",
  });

  const mayWrite = can(CLINICAL_WRITE);
  const mayManage = can(PATIENT_MANAGEMENT);
  const maySeeOutreach = can(OUTREACH_VIEW);
  const maySeeAudit = can(AUDIT_VIEW);

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const base = await API.get(`/api/v1/patients/${patientId}`);
      setPatient(base);
      setProfileForm({
        first_name: base?.first_name || "",
        last_name: base?.last_name || "",
        phone: base?.phone || "",
        address: base?.address || "",
        service_area: base?.service_area || "",
        gender: base?.gender || "",
      });

      // Each panel loads independently: a role that is refused one view still
      // gets the rest of the record instead of a blank page.
      const settled = await Promise.allSettled([
        API.get(`/api/v1/patients/${patientId}/vaccinations`),
        API.get(`/api/v1/patients/${patientId}/recommendations`),
        API.get(`/api/v1/patients/${patientId}/documents`),
        API.get(`/api/v1/patients/${patientId}/record-issues`),
      ]);
      const [ev, rc, dm, iss] = settled;
      setEvents(ev.status === "fulfilled" && Array.isArray(ev.value) ? ev.value : []);
      setRecs(rc.status === "fulfilled" && Array.isArray(rc.value) ? rc.value : []);
      setDocs(dm.status === "fulfilled" && Array.isArray(dm.value) ? dm.value : []);
      if (iss.status === "fulfilled" && iss.value) {
        setIssues(iss.value.issues || []);
        setIssueNote(iss.value.note || "");
      } else {
        setIssues([]);
      }
    } catch (err: any) {
      setError(err?.message || "Could not load this patient record.");
      setPatient(null);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!patient?.id) return;
    if (maySeeOutreach) {
      API.get(`/api/v1/outreach?patient_id=${encodeURIComponent(patientId)}&page_size=50`)
        .then((d) => setTasks(d?.items || []))
        .catch(() => setTasks([]));
    }
    if (maySeeAudit) {
      API.get(`/api/v1/audit?entity_type=patients&entity_id=${encodeURIComponent(patient.id)}&page_size=50`)
        .then((d) => setAudit(d?.items || []))
        .catch(() => setAudit([]));
    }
  }, [patient?.id, patientId, maySeeOutreach, maySeeAudit]);

  useEffect(() => {
    if (!mayWrite) return;
    API.get("/api/v1/vaccines")
      .then((d) => setVaccines(Array.isArray(d) ? d : []))
      .catch(() => setVaccines([]));
  }, [mayWrite]);

  const grouped = useMemo(() => {
    const map = new Map<string, Recommendation[]>();
    recs.forEach((rec) => {
      const list = map.get(rec.status) || [];
      list.push(rec);
      map.set(rec.status, list);
    });
    return REC_ORDER.filter((status) => map.has(status)).map((status) => ({
      status,
      items: map.get(status)!,
    }));
  }, [recs]);

  const counts = useMemo(() => {
    const verified = events.filter((e) => e.is_verified).length;
    return {
      total: events.length,
      verified,
      unverified: events.length - verified,
      actionable: recs.filter((r) => r.status !== "up_to_date").length,
      upToDate: recs.filter((r) => r.status === "up_to_date").length,
    };
  }, [events, recs]);

  async function recalculate() {
    setRecalculating(true);
    try {
      await API.post(`/api/v1/patients/${patientId}/recommendations/recalculate`, {});
      toast("Schedule recalculated from the current record", { variant: "success" });
      const fresh = await API.get(`/api/v1/patients/${patientId}/recommendations`);
      setRecs(Array.isArray(fresh) ? fresh : []);
      const iss = await API.get(`/api/v1/patients/${patientId}/record-issues`);
      setIssues(iss?.issues || []);
    } catch (err: any) {
      toast(err?.message || "Recalculation failed", { variant: "error" });
    } finally {
      setRecalculating(false);
    }
  }

  async function saveDose(e: React.FormEvent) {
    e.preventDefault();
    const vaccine = vaccines.find((v) => v.code === doseForm.vaccine_code);
    if (!vaccine) {
      toast("Choose a vaccine from the catalogue", { variant: "error" });
      return;
    }
    if (!doseForm.administered_at) {
      toast("An administration date is required", { variant: "error" });
      return;
    }
    const when = new Date(doseForm.administered_at);
    if (Number.isNaN(when.getTime())) {
      toast("That date could not be read", { variant: "error" });
      return;
    }
    if (when > new Date()) {
      toast("A dose cannot be recorded in the future. Use scheduling for a planned dose.", {
        variant: "error",
      });
      return;
    }
    if (patient?.date_of_birth && when < new Date(patient.date_of_birth)) {
      toast("The date is before this patient's recorded date of birth", { variant: "error" });
      return;
    }
    setSavingDose(true);
    try {
      await API.post(`/api/v1/patients/${patientId}/vaccinations`, {
        vaccine_code: vaccine.code,
        vaccine_name: vaccine.name || doseForm.vaccine_code,
        dose_label: doseForm.dose_label.trim() || "Dose 1",
        administered_at: when.toISOString(),
        facility: doseForm.facility.trim() || null,
        batch_number: doseForm.batch_number.trim() || null,
      });
      toast("Dose recorded and the schedule was recalculated", { variant: "success" });
      setDoseForm({ ...doseForm, dose_label: "", batch_number: "" });
      await load();
    } catch (err: any) {
      toast(err?.message || "Could not record the dose", { variant: "error" });
    } finally {
      setSavingDose(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (profileForm.phone && !isValidIndianPhone(profileForm.phone)) {
      toast("Enter a valid Indian phone number (10 digits, or +91 followed by 10 digits)", {
        variant: "error",
      });
      return;
    }
    setSavingProfile(true);
    try {
      await API.patch(`/api/v1/patients/${patientId}`, {
        first_name: profileForm.first_name.trim(),
        last_name: profileForm.last_name.trim(),
        phone: profileForm.phone.trim() || null,
        address: profileForm.address.trim() || null,
        service_area: profileForm.service_area.trim() || null,
        gender: profileForm.gender || null,
      });
      toast("Record updated", { variant: "success" });
      setEditing(false);
      await load();
    } catch (err: any) {
      toast(err?.message || "Could not update the record", { variant: "error" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadDocument(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file") as File | null;
    if (!file) {
      toast("Choose a file to upload", { variant: "error" });
      return;
    }
    form.set("patient_id", patient?.id || patientId);
    setUploading(true);
    try {
      await API.postForm("/api/v1/documents/upload", form);
      toast("Document uploaded and queued for extraction", { variant: "success" });
      e.currentTarget.reset();
      await load();
    } catch (err: any) {
      toast(err?.message || "Upload failed", { variant: "error" });
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 rounded" />
        <Skeleton className="h-12 w-full rounded" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold text-text">Patient record</h1>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="flex items-start gap-3 py-10">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" aria-hidden />
            <div className="space-y-2">
              <p className="text-sm font-medium text-text">
                {error || "This record is not available to your account."}
              </p>
              <p className="text-xs text-text-secondary">
                Access is checked per record on the server. If you believe you should see this
                patient, ask a clinic administrator to confirm the authorization.
              </p>
              <Link href="/app/patients" className="inline-block text-xs text-cyan hover:underline">
                ← Back to the patient list
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const fullName = `${patient.first_name} ${patient.last_name}`.trim();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            href="/app/patients"
            className="text-xs text-text-secondary hover:text-cyan"
          >
            ← All patients
          </Link>
          <h1 className="mt-1 truncate font-display text-2xl font-bold text-text">{fullName}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
            <span className="font-mono text-xs text-cyan">{patient.patient_id}</span>
            {patient.date_of_birth && <span>{ageLabel(patient.date_of_birth)}</span>}
            {patient.gender && <span>{patient.gender}</span>}
            {patient.service_area && <span>{patient.service_area}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={recalculate} disabled={recalculating}>
            {recalculating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Recalculate schedule
          </Button>
          <Link
            href="/app/digital-record"
            className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium text-text transition-colors hover:border-cyan/40 hover:text-cyan"
          >
            <QrCode className="mr-2 h-4 w-4" aria-hidden />
            Digital record
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Recorded events", value: counts.total, sub: `${counts.verified} verified`, tone: "text-text" },
          {
            label: "Unverified entries",
            value: counts.unverified,
            sub: counts.unverified ? "needs a human decision" : "nothing outstanding",
            tone: counts.unverified ? "text-amber-400" : "text-mint",
          },
          {
            label: "Actionable doses",
            value: counts.actionable,
            sub: `${counts.upToDate} up to date`,
            tone: counts.actionable ? "text-cyan" : "text-mint",
          },
          {
            label: "Record issues",
            value: issues.length,
            sub: issues.length ? "detection only" : "none detected",
            tone: issues.length ? "text-amber-400" : "text-mint",
          },
        ].map((tile) => (
          <Card key={tile.label}>
            <CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wider text-text-secondary">{tile.label}</p>
              <p className={`mt-1 font-display text-2xl font-bold ${tile.tone}`}>{tile.value}</p>
              <p className="mt-0.5 text-[11px] text-text-secondary/80">{tile.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="grid w-full grid-cols-2 border-b border-border/60 sm:grid-cols-4 lg:grid-cols-7">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="-mb-px flex items-center gap-1.5 border-b-2 px-2 py-3 text-xs font-medium sm:text-sm"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{tab.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* ---------------- Overview ---------------- */}
        <TabsContent value="overview" className="mt-5 space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Demographics</CardTitle>
              {mayManage && !editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit details
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {editing ? (
                <form onSubmit={saveProfile} className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="pf-first" className="mb-1.5 block text-xs text-text-secondary">First name</label>
                      <Input id="pf-first" value={profileForm.first_name} onChange={(e) => setProfileForm({ ...profileForm, first_name: e.target.value })} required />
                    </div>
                    <div>
                      <label htmlFor="pf-last" className="mb-1.5 block text-xs text-text-secondary">Last name</label>
                      <Input id="pf-last" value={profileForm.last_name} onChange={(e) => setProfileForm({ ...profileForm, last_name: e.target.value })} required />
                    </div>
                    <div>
                      <label htmlFor="pf-phone" className="mb-1.5 block text-xs text-text-secondary">Phone (India)</label>
                      <Input id="pf-phone" value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} placeholder="+91 98XXXXXXXX" />
                      <p className="mt-1 text-[11px] text-text-secondary/70">
                        10 digits, optionally prefixed with +91.
                      </p>
                    </div>
                    <div>
                      <label htmlFor="pf-gender" className="mb-1.5 block text-xs text-text-secondary">Gender</label>
                      <select
                        id="pf-gender"
                        value={profileForm.gender}
                        onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value })}
                        className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
                      >
                        <option value="">Not recorded</option>
                        <option value="Female">Female</option>
                        <option value="Male">Male</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="pf-area" className="mb-1.5 block text-xs text-text-secondary">Service area</label>
                      <Input id="pf-area" value={profileForm.service_area} onChange={(e) => setProfileForm({ ...profileForm, service_area: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor="pf-address" className="mb-1.5 block text-xs text-text-secondary">Address</label>
                      <Input id="pf-address" value={profileForm.address} onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })} />
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-text-secondary/80">
                    Date of birth is not editable here. Changing it would silently rewrite every
                    schedule calculation, so it requires a reviewed correction instead.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" type="submit" disabled={savingProfile}>
                      {savingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save changes
                    </Button>
                    <Button variant="ghost" size="sm" type="button" onClick={() => { setEditing(false); load(); }}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  {[
                    ["Display ID", patient.patient_id],
                    ["Date of birth", patient.date_of_birth ? `${formatDateIN(patient.date_of_birth)} (${ageLabel(patient.date_of_birth)})` : "Not recorded"],
                    ["Gender", patient.gender || "Not recorded"],
                    ["Phone", patient.phone ? formatIndianPhone(patient.phone) : "Not recorded"],
                    ["Service area", patient.service_area || "Not recorded"],
                    ["Address", patient.address || "Not recorded"],
                    ["Record created", patient.created_at ? formatDateIN(patient.created_at) : "—"],
                    ["Last updated", patient.updated_at ? formatDateIN(patient.updated_at) : "—"],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex justify-between gap-3 border-b border-border/40 pb-2">
                      <dt className="text-text-secondary">{label}</dt>
                      <dd className="text-right text-text">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6 text-xs leading-relaxed text-text-secondary">
              <p className="font-medium text-text">Reading this record honestly</p>
              <p>
                {counts.total === 0
                  ? "No immunisation events are stored for this patient. That means nothing has been captured here — it is not proof that no dose was ever given elsewhere."
                  : `${counts.verified} of ${counts.total} stored events are verified. Unverified entries are treated as uncertain, never as confirmation and never as absence of a dose.`}
              </p>
              <p>
                Completeness of this record is not population coverage, and a gap found here is a
                prompt to check with the family and the previous facility before anything is
                re-administered.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Vaccination history ---------------- */}
        <TabsContent value="history" className="mt-5 space-y-4">
          {mayWrite && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Syringe className="h-4 w-4 text-cyan" aria-hidden />
                  Record an administered dose
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={saveDose} className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label htmlFor="dose-vaccine" className="mb-1.5 block text-xs text-text-secondary">Vaccine</label>
                      <select
                        id="dose-vaccine"
                        value={doseForm.vaccine_code}
                        onChange={(e) => setDoseForm({ ...doseForm, vaccine_code: e.target.value })}
                        className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
                        required
                      >
                        <option value="">Select from the catalogue…</option>
                        {vaccines.map((v) => (
                          <option key={v.code} value={v.code}>
                            {v.name} ({v.code})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="dose-label" className="mb-1.5 block text-xs text-text-secondary">Dose</label>
                      <Input
                        id="dose-label"
                        value={doseForm.dose_label}
                        onChange={(e) => setDoseForm({ ...doseForm, dose_label: e.target.value })}
                        placeholder="Dose 1 / Birth dose / Booster"
                      />
                    </div>
                    <div>
                      <label htmlFor="dose-date" className="mb-1.5 block text-xs text-text-secondary">Date administered</label>
                      <Input
                        id="dose-date"
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        value={doseForm.administered_at}
                        onChange={(e) => setDoseForm({ ...doseForm, administered_at: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="dose-facility" className="mb-1.5 block text-xs text-text-secondary">Facility</label>
                      <Input
                        id="dose-facility"
                        value={doseForm.facility}
                        onChange={(e) => setDoseForm({ ...doseForm, facility: e.target.value })}
                        placeholder="Where it was given"
                      />
                    </div>
                    <div>
                      <label htmlFor="dose-batch" className="mb-1.5 block text-xs text-text-secondary">Batch number</label>
                      <Input
                        id="dose-batch"
                        value={doseForm.batch_number}
                        onChange={(e) => setDoseForm({ ...doseForm, batch_number: e.target.value })}
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="primary" size="sm" type="submit" disabled={savingDose}>
                      {savingDose ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      {savingDose ? "Saving…" : "Record dose"}
                    </Button>
                    <p className="text-[11px] text-text-secondary/80">
                      Saving recalculates the schedule for this patient. A future date is refused —
                      planned doses belong in scheduling, not in the administered record.
                    </p>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Recorded events ({events.length})</CardTitle>
              <div className="flex gap-2">
                <Badge variant="verified">{counts.verified} verified</Badge>
                {counts.unverified > 0 && <Badge variant="warn">{counts.unverified} unverified</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-secondary">
                  No events are stored for this patient. An empty history is not evidence that no
                  dose was given — check the paper card and any previous facility before concluding
                  a dose is missing.
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
                        <th className="pb-2 pr-4 font-medium">Source</th>
                        <th className="pb-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {events.map((event) => (
                        <tr key={event.id}>
                          <td className="py-2.5 pr-4">
                            <span className="font-medium text-text">{event.vaccine_name || event.vaccine_code}</span>
                            <span className="ml-2 font-mono text-[11px] text-text-secondary/70">{event.vaccine_code}</span>
                          </td>
                          <td className="py-2.5 pr-4 text-text-secondary">{event.dose_label || "—"}</td>
                          <td className="py-2.5 pr-4 text-text-secondary">
                            {event.administered_at ? formatDateIN(event.administered_at) : "—"}
                          </td>
                          <td className="py-2.5 pr-4 text-text-secondary">{event.facility || "—"}</td>
                          <td className="py-2.5 pr-4 text-xs text-text-secondary">
                            {event.source ? SOURCE_LABELS[event.source] || event.source : "—"}
                            {event.source_document_id && (
                              <Link href="/app/record-verification" className="ml-1 text-cyan hover:underline">
                                (doc)
                              </Link>
                            )}
                          </td>
                          <td className="py-2.5">
                            <Badge variant={event.is_verified ? "verified" : "warn"}>
                              {event.is_verified ? "Verified" : "Unverified"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Schedule ---------------- */}
        <TabsContent value="schedule" className="mt-5 space-y-4">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Calculated schedule ({recs.length} rules)</CardTitle>
              <Button variant="outline" size="sm" onClick={recalculate} disabled={recalculating}>
                {recalculating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Recalculate
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {recs.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-secondary">
                  No schedule has been calculated yet.
                </p>
              ) : (
                grouped.map(({ status: groupStatus, items }) => (
                  <div key={groupStatus}>
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                      <Badge variant={REC_BADGE[groupStatus] || "default"}>{groupStatus.replace(/_/g, " ")}</Badge>
                      <span>{items.length}</span>
                    </p>
                    <ul className="space-y-2">
                      {items.map((rec) => (
                        <li key={rec.id} className="rounded-md border border-border/60 bg-navy-secondary/30 p-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm font-medium text-text">
                              {rec.vaccine_code}
                              {rec.rule_id && (
                                <span className="ml-2 font-mono text-[11px] text-text-secondary/70">rule {rec.rule_id}</span>
                              )}
                            </span>
                            {rec.due_date && (
                              <span className="text-xs text-text-secondary">
                                {groupStatus === "up_to_date" ? "due was" : "due"} {formatDateIN(rec.due_date)}
                              </span>
                            )}
                          </div>
                          {rec.explanation && (
                            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                              {rec.explanation}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
              <p className="rounded-md border border-border/60 bg-navy-secondary/20 p-3 text-[11px] leading-relaxed text-text-secondary">
                These statuses come from a deterministic rules engine, not a language model. A
                non-<span className="text-text">up to date</span> status means no verified record
                exists here — it never asserts the dose was not given.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Documents ---------------- */}
        <TabsContent value="documents" className="mt-5 space-y-4">
          {can(CLINICAL_READ) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Upload className="h-4 w-4 text-cyan" aria-hidden />
                  Upload a vaccination card or document
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={uploadDocument} className="space-y-3">
                  <input
                    type="file"
                    name="file"
                    accept="image/png,image/jpeg,image/jpg,application/pdf"
                    className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-md file:border file:border-border file:bg-navy-secondary file:px-3 file:py-2 file:text-sm file:text-text hover:file:border-cyan/40"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="primary" size="sm" type="submit" disabled={uploading}>
                      {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      {uploading ? "Uploading…" : "Upload"}
                    </Button>
                    <p className="text-[11px] text-text-secondary/80">
                      Extraction runs in labeled demonstration mode. Nothing becomes a record until a
                      person approves each field on the verification page.
                    </p>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documents ({docs.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {docs.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-secondary">No documents attached.</p>
              ) : (
                <ul className="space-y-2">
                  {docs.map((doc: any) => (
                    <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-navy-secondary/30 p-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-cyan" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-text">{doc.file_name}</span>
                          <span className="block text-[11px] text-text-secondary">
                            {doc.created_at ? formatDateIN(doc.created_at) : ""}
                            {doc.ocr_provider ? ` · ${doc.ocr_provider}` : ""}
                          </span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge variant={doc.status === "completed" ? "verified" : doc.status === "review_required" ? "pending" : "default"}>
                          {(doc.status || "unknown").replace(/_/g, " ")}
                        </Badge>
                        {can(CLINICAL_READ) && (
                          <Link href="/app/record-verification" className="text-xs text-cyan hover:underline">
                            Review →
                          </Link>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Verification ---------------- */}
        <TabsContent value="verification" className="mt-5 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TriangleAlert className="h-4 w-4 text-amber-400" aria-hidden />
                Detected record issues ({issues.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {issues.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-secondary">
                  No inconsistencies were detected. Detection is heuristic — a clean result means
                  nothing matched the checks, not that the record is proven complete.
                </p>
              ) : (
                issues.map((issue, index) => (
                  <div key={index} className="rounded-md border border-border/60 bg-navy-secondary/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-text">
                        {ISSUE_LABELS[issue.type] || issue.type}
                        {issue.vaccine_code && (
                          <span className="ml-2 font-mono text-[11px] text-text-secondary/70">
                            {issue.vaccine_code}
                            {typeof issue.dose_number === "number" && issue.dose_number < 90
                              ? ` dose ${issue.dose_number}`
                              : ""}
                          </span>
                        )}
                      </p>
                      <Badge variant={SEVERITY_BADGE[issue.severity] || "default"}>{issue.severity}</Badge>
                    </div>

                    {issue.dates && issue.dates.length > 0 && (
                      <p className="mt-2 text-xs text-text-secondary">
                        Conflicting dates on record:{" "}
                        {issue.dates.map((d) => (
                          <span key={d} className="mr-2 font-mono text-text">{formatDateIN(d)}</span>
                        ))}
                      </p>
                    )}

                    {issue.evidence && (
                      <div className="mt-2 space-y-1 text-[11px] text-text-secondary/85">
                        {issue.evidence.matched_on && (
                          <p>Matched on: {issue.evidence.matched_on.join(", ")}</p>
                        )}
                        {issue.evidence.differing && (
                          <p>Differs on: {issue.evidence.differing.join(", ")}</p>
                        )}
                        {typeof issue.evidence.verified_count === "number" && (
                          <p>Verified copies: {issue.evidence.verified_count}</p>
                        )}
                      </div>
                    )}

                    {issue.recommended_action && (
                      <p className="mt-2 rounded border border-border/60 bg-navy/50 p-2 text-xs leading-relaxed text-text-secondary">
                        {issue.recommended_action}
                      </p>
                    )}
                  </div>
                ))
              )}

              {issueNote && (
                <p className="rounded-md border border-border/60 bg-navy-secondary/20 p-3 text-[11px] leading-relaxed text-text-secondary">
                  {issueNote}
                </p>
              )}

              <p className="text-[11px] leading-relaxed text-text-secondary/85">
                Detection never edits or deletes anything. Suspected duplicates are surfaced for a
                human decision; history is retained even when a duplicate is confirmed, so no dose is
                lost by a cleanup.
              </p>

              {can(CLINICAL_READ) && (
                <Link
                  href="/app/record-verification"
                  className="inline-flex items-center gap-1.5 text-xs text-cyan hover:underline"
                >
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                  Open the document review queue →
                </Link>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Follow-up ---------------- */}
        <TabsContent value="followup" className="mt-5 space-y-4">
          {!maySeeOutreach ? (
            <Card>
              <CardContent className="flex items-start gap-3 py-10">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
                <p className="max-w-2xl text-sm text-text-secondary">
                  The outreach queue contains follow-up reasoning about named families, so it is
                  restricted to clinical and public-health roles. Your own appointments remain
                  visible under <Link href="/app/appointments" className="text-cyan hover:underline">Appointments</Link>.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PhoneCall className="h-4 w-4 text-cyan" aria-hidden />
                  Follow-up tasks ({tasks.length})
                </CardTitle>
                <Link href="/app/outreach" className="text-xs text-cyan hover:underline">
                  Open the queue →
                </Link>
              </CardHeader>
              <CardContent>
                {tasks.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-secondary">
                    No follow-up task exists for this patient. That does not mean none is needed —
                    the actionable doses on the Schedule tab are the source of truth.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {tasks.map((task) => (
                      <li key={task.id} className="rounded-md border border-border/60 bg-navy-secondary/30 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-text">{task.title}</span>
                          <span className="flex items-center gap-2">
                            <Badge variant={task.status === "resolved" ? "verified" : task.status === "escalated" ? "critical" : task.status === "in_progress" ? "warn" : "pending"}>
                              {task.status.replace(/_/g, " ")}
                            </Badge>
                            {typeof task.priority_score === "number" && (
                              <span className="font-mono text-xs text-cyan">{task.priority_score.toFixed(0)}</span>
                            )}
                          </span>
                        </div>
                        {task.reason && (
                          <p className="mt-1 text-xs leading-relaxed text-text-secondary">{task.reason}</p>
                        )}
                        <p className="mt-1.5 text-[11px] text-text-secondary/80">
                          {task.due_date ? `Due ${formatDateIN(task.due_date)}` : "No due date"}
                          {task.assigned_worker_name ? ` · assigned to ${task.assigned_worker_name}` : " · unassigned"}
                          {typeof task.attempt_count === "number" ? ` · ${task.attempt_count} contact attempt(s)` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------------- Audit ---------------- */}
        <TabsContent value="audit" className="mt-5 space-y-4">
          {!maySeeAudit ? (
            <Card>
              <CardContent className="flex items-start gap-3 py-10">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
                <p className="max-w-2xl text-sm text-text-secondary">
                  Audit history is limited to administrative and public-health roles. The log is
                  append-only and is not editable from this interface.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Changes to this record ({audit.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {audit.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-secondary">
                    No audited changes are recorded against this patient entity.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {audit.map((entry: any) => (
                      <li key={entry.id} className="rounded-md border border-border/60 bg-navy-secondary/30 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-text">{(entry.action || "").replace(/_/g, " ")}</span>
                          <span className="text-xs text-text-secondary">
                            {entry.created_at ? formatDateIN(entry.created_at) : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-text-secondary">
                          {entry.actor_name || "unknown actor"}
                          {entry.actor_role ? ` (${entry.actor_role.replace(/_/g, " ")})` : ""}
                          {entry.ip_address ? ` · ${entry.ip_address}` : ""}
                        </p>
                        {entry.details && (
                          <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-navy/50 p-2 font-mono text-[11px] text-text-secondary/85">
                            {entry.details}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/app/audit-logs" className="mt-3 inline-block text-xs text-cyan hover:underline">
                  Open the full audit log →
                </Link>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default PatientProfilePage;
