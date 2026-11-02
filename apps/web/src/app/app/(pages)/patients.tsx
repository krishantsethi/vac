"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Search, UserPlus, X } from "lucide-react";
import { API } from "@/lib/api";
import { ageLabel, formatDateIN, isValidIndianPhone, normalizeIndianPhone } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ROUTES } from "@/lib/routes";
import { PATIENT_MANAGEMENT, can } from "@/lib/capabilities";

const STATUS_META: Record<string, { label: string; variant: any }> = {
  verification_required: { label: "Record needs verification", variant: "conflict" },
  potentially_overdue: { label: "Potentially overdue", variant: "critical" },
  due: { label: "Due now", variant: "overdue" },
  upcoming: { label: "Upcoming", variant: "pending" },
  up_to_date: { label: "Up to date", variant: "verified" },
  no_recommendations: { label: "Not yet assessed", variant: "insufficient" },
};

const EMPTY_FORM = {
  first_name: "",
  last_name: "",
  date_of_birth: "",
  gender: "",
  phone: "",
  address: "",
  service_area: "",
};

export function PatientsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [areas, setAreas] = useState<{ service_area: string; patient_count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [canCreate, setCanCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        include_status: "true",
      });
      if (search) params.set("search", search);
      if (serviceArea) params.set("service_area", serviceArea);
      const res = await API.get(`/api/v1/patients?${params.toString()}`);
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      // A system administrator has no clinical record access; the server returns
      // an empty scoped list rather than an error, so this path is a real failure.
      toast(err?.message || "Failed to load patients", { variant: "destructive" });
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, serviceArea]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/api/v1/patients/meta/service-areas");
        setAreas(res.items || []);
      } catch {
        setAreas([]);
      }
      // Display only: the server re-checks this capability on every request.
      setCanCreate(can(PATIENT_MANAGEMENT));
    })();
  }, []);

  async function submitPatient(event: React.FormEvent) {
    event.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast("First and last name are required", { variant: "destructive" });
      return;
    }
    if (!form.date_of_birth) {
      toast("Date of birth is required — the schedule is calculated from it", { variant: "destructive" });
      return;
    }
    const dob = new Date(form.date_of_birth);
    if (isNaN(dob.getTime())) {
      toast("Enter a valid date of birth", { variant: "destructive" });
      return;
    }
    if (dob > new Date()) {
      toast("Date of birth cannot be in the future", { variant: "destructive" });
      return;
    }
    if (form.phone && !isValidIndianPhone(form.phone)) {
      toast("Enter a valid Indian phone number (10 digits, optionally with +91)", { variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        date_of_birth: form.date_of_birth,
      };
      if (form.gender) payload.gender = form.gender;
      if (form.phone) payload.phone = normalizeIndianPhone(form.phone);
      if (form.address.trim()) payload.address = form.address.trim();
      if (form.service_area.trim()) payload.service_area = form.service_area.trim();

      const created = await API.post("/api/v1/patients", payload);
      toast(`${created.patient_id} created. No doses are recorded yet — the schedule has been assessed against an empty history.`);
      setShowForm(false);
      setForm(EMPTY_FORM);
      setPage(1);
      await load();
    } catch (err: any) {
      toast(err?.message || "Could not create the patient", { variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-text">Patients</h1>
          <p className="text-sm text-text-secondary/90">
            Registered patients you are authorized to see, with the most urgent item on each
            schedule. Status comes from stored recommendations, not from a guess.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? <X className="mr-2 h-4 w-4" /> : <UserPlus className="mr-2 h-4 w-4" />}
            {showForm ? "Close" : "Add patient"}
          </Button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={submitPatient}
          className="space-y-4 rounded-lg border border-border bg-surface p-5"
          aria-label="Register a new patient"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="pf-first" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                First name *
              </label>
              <Input
                id="pf-first"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="pf-last" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                Last name *
              </label>
              <Input
                id="pf-last"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="pf-dob" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                Date of birth *
              </label>
              <Input
                id="pf-dob"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={form.date_of_birth}
                onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="pf-gender" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                Gender
              </label>
              <select
                id="pf-gender"
                className="input h-10 w-full"
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
              >
                <option value="">Not recorded</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="pf-phone" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                Phone (India)
              </label>
              <Input
                id="pf-phone"
                inputMode="tel"
                placeholder="98765 43210"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              {form.phone && !isValidIndianPhone(form.phone) && (
                <p className="text-xs text-amber-400">Does not look like a valid Indian number.</p>
              )}
            </div>
            <div className="space-y-1">
              <label htmlFor="pf-area" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                Service area
              </label>
              <Input
                id="pf-area"
                list="service-areas"
                value={form.service_area}
                onChange={(e) => setForm({ ...form, service_area: e.target.value })}
                placeholder="Delhi Central"
              />
              <datalist id="service-areas">
                {areas.map((a) => (
                  <option key={a.service_area} value={a.service_area} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1 md:col-span-3">
              <label htmlFor="pf-address" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                Address
              </label>
              <Input
                id="pf-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-text-secondary/80">
            A new patient starts with no vaccination history. The engine reports what is due against
            an empty record — it does not assume any dose was or was not given.
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              <Plus className="mr-2 h-4 w-4" />
              {saving ? "Saving…" : "Register patient"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
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
            placeholder="Search by name or patient ID…"
            className="pl-9"
            aria-label="Search patients"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="area-filter" className="sr-only">
            Service area
          </label>
          <select
            id="area-filter"
            className="input h-10 w-auto min-w-[11rem]"
            value={serviceArea}
            onChange={(e) => {
              setPage(1);
              setServiceArea(e.target.value);
            }}
          >
            <option value="">All service areas</option>
            {areas.map((a) => (
              <option key={a.service_area} value={a.service_area}>
                {a.service_area} ({a.patient_count})
              </option>
            ))}
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

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-navy-secondary/50">
              {["Patient", "ID", "Date of birth", "Age", "Service area", "Schedule status", "Actionable", ""].map(
                (h, i) => (
                  <th key={i} className="px-4 py-3 text-left font-medium text-text-secondary">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text-secondary/60">
                  Loading patients…
                </td>
              </tr>
            )}
            {!loading &&
              items.map((p: any) => {
                const summary = p.status_summary || {};
                const meta = STATUS_META[summary.record_status] || {
                  label: summary.record_status || "Unknown",
                  variant: "insufficient",
                };
                return (
                  <tr key={p.id} className="transition-colors hover:bg-navy-secondary/30">
                    <td className="px-4 py-3">
                      <Link href={ROUTES.patient(p.patient_id)} className="font-medium text-text hover:text-cyan">
                        {p.first_name} {p.last_name}
                      </Link>
                      {p.phone && <span className="block text-xs text-text-secondary/70">{p.phone}</span>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{p.patient_id}</td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{formatDateIN(p.date_of_birth)}</td>
                    <td className="px-4 py-3 text-text-secondary">{ageLabel(p.date_of_birth)}</td>
                    <td className="px-4 py-3 text-text-secondary">{p.service_area || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {summary.unverified_entries > 0 && (
                        <span className="mt-1 block text-xs text-amber-400">
                          {summary.unverified_entries} unverified {summary.unverified_entries === 1 ? "entry" : "entries"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">
                      {summary.actionable_count ?? 0}
                      <span className="block text-xs text-text-secondary/60">
                        of {summary.recommendation_total ?? 0} rules
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={ROUTES.patient(p.patient_id)}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text-secondary/60">
                  No patients match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary/80">
        <span>
          Showing {items.length} of {total} patient{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
