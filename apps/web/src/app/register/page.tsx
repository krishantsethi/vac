"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API } from "@/lib/api";
import { setToken, setUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", full_name: "", role: "patient", phone: "", language: "en" });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await API.post("/api/v1/auth/register", form);
      setToken(res.access_token);
      const me: any = await API.get("/api/v1/auth/me");
      setUser(me);
      router.push("/app");
    } catch (e: any) {
      toast(e.message || "Registration failed", { variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-navy px-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6">
          <span className="w-2 h-2 rounded-full bg-cyan shadow-[0_0_12px_rgba(56,217,255,0.6)]" />
          <span className="font-display font-bold text-xl tracking-tight text-text">VAXBRIDGE<span className="text-cyan">AI</span></span>
        </div>
        <h2 className="font-display text-xl font-bold text-text mb-2">Create an account</h2>
        <p className="text-text-secondary/90 text-sm mb-6">Prototype registration — roles are illustrative for the demonstration.</p>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Full name</label>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Email</label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Password (min 8 chars)</label>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="block w-full rounded-md border border-border bg-navy-secondary text-text text-sm focus:border-cyan">
              <option value="patient">Patient</option>
              <option value="caregiver">Caregiver</option>
              <option value="healthcare_worker">Healthcare Worker</option>
            </select>
          </div>
          <Button variant="primary" type="submit" disabled={loading} className="w-full">
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-[11px] text-text-secondary/60 text-center">
          Already have an account? <Link href="/login" className="text-cyan hover:underline">Sign in</Link>
        </p>
        <p className="mt-2 text-[11px] text-text-secondary/60 text-center">
          Prototype demonstration. Not a government system.
        </p>
      </div>
    </div>
  );
}
