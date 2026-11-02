"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CloudOff,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
} from "lucide-react";
import { API } from "@/lib/api";
import { can, CLINICAL_WRITE } from "@/lib/capabilities";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import {
  cachePatientOptions,
  cacheVaccineOptions,
  enqueueEvent,
  readCachedPatients,
  readCachedVaccines,
  referenceCacheAge,
} from "@/lib/offline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatDateIN } from "@/lib/utils";

/**
 * Field capture for a dose that has just been administered.
 *
 * This is the entry point for low-connectivity work: the capture is validated
 * and written to the device immediately, then replayed. A worker standing in a
 * village with no signal still records the dose while they are with the family,
 * which is the only reliable way to keep the record honest.
 */
export function OfflineCapture() {
  const { online, pending, needsAttention, syncing, refresh, sync } = useOfflineQueue();
  const [open, setOpen] = useState(false);

  const [livePatients, setLivePatients] = useState<{ id: string; patient_id: string; first_name: string; last_name: string; service_area?: string | null }[]>([]);
  const [liveVaccines, setLiveVaccines] = useState<{ code: string; name: string }[]>([]);
  const [cachedPatients] = useState(() => readCachedPatients());
  const [cachedVaccines] = useState(() => readCachedVaccines());
  const [cacheAge] = useState(() => referenceCacheAge());

  const [form, setForm] = useState({
    patient_id: "",
    vaccine_code: "",
    custom_vaccine: "",
    dose_label: "",
    administered_at: "",
    facility: "",
    batch_number: "",
  });
  const [saving, setSaving] = useState(false);

  const mayWrite = can(CLINICAL_WRITE);

  useEffect(() => {
    if (!mayWrite) return;
    API.get("/api/v1/patients?page_size=100")
      .then((data) => {
        const items = data?.items || [];
        setLivePatients(items);
        cachePatientOptions(items);
      })
      .catch(() => {
        /* offline: the cached list below is used instead */
      });
    API.get("/api/v1/vaccines")
      .then((data) => {
        const items = Array.isArray(data) ? data : [];
        setLiveVaccines(items);
        cacheVaccineOptions(items.map((v: any) => ({ code: v.code, name: v.name })));
      })
      .catch(() => {
        /* offline: the cached list below is used instead */
      });
  }, [mayWrite]);

  const patients = livePatients.length ? livePatients : cachedPatients;
  const vaccines = liveVaccines.length ? liveVaccines : cachedVaccines;
  const usingCache = livePatients.length === 0 && cachedPatients.length > 0;

  const selectedPatient = useMemo(
    () => patients.find((p) => p.id === form.patient_id),
    [patients, form.patient_id]
  );

  if (!mayWrite) return null;

  async function saveCapture(e: React.FormEvent) {
    e.preventDefault();
    const vaccineCode = form.vaccine_code.trim();
    const customName = form.custom_vaccine.trim();
    if (!vaccineCode && !customName) {
      toast("Choose a vaccine from the catalogue, or enter the name printed on the card", {
        variant: "error",
      });
      return;
    }

    setSaving(true);
    const result = enqueueEvent({
      patient_id: form.patient_id,
      patient_label: selectedPatient
        ? `${selectedPatient.first_name} ${selectedPatient.last_name} (${selectedPatient.patient_id})`
        : form.patient_id,
      vaccine_code: vaccineCode || undefined,
      vaccine_name: vaccineCode ? undefined : customName,
      dose_label: form.dose_label,
      administered_at: form.administered_at,
      facility: form.facility.trim() || null,
      batch_number: form.batch_number.trim() || null,
    });
    setSaving(false);

    if (result.error) {
      toast(result.error, { variant: "error" });
      return;
    }

    toast(
      online
        ? "Capture saved on this device. Syncing now."
        : "Capture saved on this device. It will sync when you are back online.",
      { variant: "success" }
    );
    setForm({ ...form, dose_label: "", batch_number: "", administered_at: "" });
    refresh();

    if (online) {
      const summary = await sync();
      if (summary.rejected > 0) {
        toast(summary.message, { variant: "error" });
      } else if (summary.attempted > 0 && !summary.skipped) {
        toast(summary.message, { variant: "success" });
      }
      refresh();
    }
  }

  return (
    <Card className={online ? undefined : "border-amber-500/30"}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {online ? <Plus className="h-4 w-4 text-cyan" aria-hidden /> : <CloudOff className="h-4 w-4 text-amber-400" aria-hidden />}
          Record a dose
          {!online && <Badge variant="warn">offline — saves to this device</Badge>}
        </CardTitle>
        <div className="flex items-center gap-2">
          {(pending > 0 || needsAttention > 0) && (
            <span className="text-xs text-text-secondary">
              {pending} queued{needsAttention ? ` · ${needsAttention} need attention` : ""}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Close form" : "New capture"}
          </Button>
          {pending > 0 && (
            <Button variant="primary" size="sm" onClick={sync} disabled={syncing || !online}>
              {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
              Sync {pending}
            </Button>
          )}
        </div>
      </CardHeader>

      {open && (
        <CardContent>
          <form onSubmit={saveCapture} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="cap-patient" className="mb-1.5 block text-xs text-text-secondary">
                  Patient
                </label>
                <select
                  id="cap-patient"
                  value={form.patient_id}
                  onChange={(e) => setForm({ ...form, patient_id: e.target.value })}
                  className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
                  required
                >
                  <option value="">Select a patient…</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} — {p.patient_id}
                    </option>
                  ))}
                </select>
                {usingCache && (
                  <p className="mt-1 text-[11px] text-amber-400/90">
                    Showing the list cached on this device
                    {cacheAge ? ` (${formatDateIN(cacheAge)})` : ""}. The server re-checks access on
                    sync.
                  </p>
                )}
                {patients.length === 0 && (
                  <p className="mt-1 text-[11px] text-text-secondary/80">
                    No patient list is available offline yet. Load this page once while connected to
                    cache it.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="cap-vaccine" className="mb-1.5 block text-xs text-text-secondary">
                  Vaccine (catalogue)
                </label>
                <select
                  id="cap-vaccine"
                  value={form.vaccine_code}
                  onChange={(e) => setForm({ ...form, vaccine_code: e.target.value })}
                  className="h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
                >
                  <option value="">Not in the catalogue…</option>
                  {vaccines.map((v) => (
                    <option key={v.code} value={v.code}>
                      {v.name} ({v.code})
                    </option>
                  ))}
                </select>
              </div>

              {!form.vaccine_code && (
                <div>
                  <label htmlFor="cap-custom" className="mb-1.5 block text-xs text-text-secondary">
                    Vaccine name as printed
                  </label>
                  <Input
                    id="cap-custom"
                    value={form.custom_vaccine}
                    onChange={(e) => setForm({ ...form, custom_vaccine: e.target.value })}
                    placeholder="e.g. Pentavalent"
                  />
                  <p className="mt-1 text-[11px] text-text-secondary/80">
                    Mapped to the controlled terminology on sync. If it cannot be mapped confidently
                    it is escalated for review — never guessed.
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="cap-dose" className="mb-1.5 block text-xs text-text-secondary">
                  Dose
                </label>
                <Input
                  id="cap-dose"
                  value={form.dose_label}
                  onChange={(e) => setForm({ ...form, dose_label: e.target.value })}
                  placeholder="Dose 1 / Birth dose / Booster"
                  required
                />
              </div>

              <div>
                <label htmlFor="cap-date" className="mb-1.5 block text-xs text-text-secondary">
                  Date administered
                </label>
                <Input
                  id="cap-date"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={form.administered_at}
                  onChange={(e) => setForm({ ...form, administered_at: e.target.value })}
                  required
                />
              </div>

              <div>
                <label htmlFor="cap-facility" className="mb-1.5 block text-xs text-text-secondary">
                  Facility
                </label>
                <Input
                  id="cap-facility"
                  value={form.facility}
                  onChange={(e) => setForm({ ...form, facility: e.target.value })}
                  placeholder="Where it was given"
                />
              </div>

              <div>
                <label htmlFor="cap-batch" className="mb-1.5 block text-xs text-text-secondary">
                  Batch number
                </label>
                <Input
                  id="cap-batch"
                  value={form.batch_number}
                  onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm" type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {saving ? "Saving…" : online ? "Save and sync" : "Save to this device"}
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={refresh}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh queue
              </Button>
            </div>

            <div className="flex items-start gap-3 rounded-md border border-border/60 bg-navy-secondary/30 p-3 text-[11px] leading-relaxed text-text-secondary">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" aria-hidden />
              <p>
                Captures sync as <span className="text-text">unverified</span> entries, so a dose
                recorded offline never silently overwrites a stored record and is never treated as
                confirmed until it is verified. Replaying the same capture cannot create a duplicate,
                and a capture that disagrees with an existing record is routed to conflict review
                instead of replacing it.
              </p>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
