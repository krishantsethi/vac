"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { getUser } from "@/lib/auth";

export function SettingsPage() {
  const user = getUser();
  const [form, setForm] = useState({ full_name: user?.full_name || "", phone: user?.phone || "", language: user?.language || "en" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) setForm({ full_name: user.full_name || "", phone: user.phone || "", language: user.language || "en" });
  }, [user]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await API.patch(`/api/v1/users/${user?.id}`, form);
      if (typeof window !== "undefined") {
        const u = { ...getUser(), ...form };
        localStorage.setItem("vaxbridge_user", JSON.stringify(u));
      }
      toast("Settings saved", { variant: "success" });
    } catch (e: any) { toast(e.message || "Save failed", { variant: "error" }); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold text-text">Settings</h1>
      <p className="text-text-secondary/90 text-sm">Language preferences, communication settings, and account details.</p>

      <div className="rounded-lg border border-border bg-surface p-5 max-w-md">
        <form onSubmit={save} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Full name</label>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Phone (India format, e.g. +91-98765-00000)</label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Language</label>
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className="block w-full rounded-md border border-border bg-navy-secondary text-text text-sm focus:border-cyan">
              <option value="en">English</option>
              <option value="hi">Hindi (preference stored — interface not yet translated)</option>
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-text-secondary/75">
              Your preference is saved to your account and would drive future translations. This
              build ships English strings only, so choosing Hindi does not change the interface yet.
            </p>
          </div>
          <Button variant="primary" type="submit" disabled={loading}>{loading ? "Saving..." : "Save changes"}</Button>
        </form>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5 max-w-md">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">Integrations</h3>
        <p className="text-xs text-text-secondary/80 leading-relaxed mb-3">
          No external messaging provider (SMS/WhatsApp) credentials are configured. Reminders are delivered through the
          in-app notification center in simulation mode. Configure provider credentials in production deployment.
        </p>
        <Button variant="outline" size="sm">Configure notification adapter</Button>
      </div>
    </div>
  );
}
