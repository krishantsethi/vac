"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { API } from "@/lib/api";
import { getToken, isSessionEphemeral, setToken, setUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatIndianPhone, isValidIndianPhone, normalizeIndianPhone } from "@/lib/utils";

/**
 * Only the two roles whose reach is scoped to the person's own record or to
 * dependents they are explicitly authorized for. The server enforces the same
 * restriction — this list exists so the form does not offer a choice that will
 * be refused, never as the control itself.
 */
const SELF_SERVICE_ROLES = [
  {
    value: "patient",
    label: "Patient",
    blurb: "Your own immunisation record, schedule and appointments.",
  },
  {
    value: "caregiver",
    label: "Parent / Caregiver",
    blurb: "Children you care for, once a clinic authorizes each link.",
  },
];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "patient",
    phone: "",
    language: "en",
  });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);

  useEffect(() => {
    if (isSessionEphemeral()) setStorageBlocked(true);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFailure(null);

    if (!form.full_name.trim()) {
      setFailure("Please enter your full name.");
      return;
    }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setFailure("Please enter a valid email address.");
      return;
    }
    if (form.password.length < 8) {
      setFailure("Your password must be at least 8 characters.");
      return;
    }
    if (form.phone.trim() && !isValidIndianPhone(form.phone)) {
      setFailure("Enter a valid Indian phone number — 10 digits, optionally prefixed with +91.");
      return;
    }

    setLoading(true);
    try {
      const res = await API.post("/api/v1/auth/register", {
        ...form,
        email: form.email.trim().toLowerCase(),
        full_name: form.full_name.trim(),
        phone: form.phone.trim() ? normalizeIndianPhone(form.phone) : null,
      });

      if (!res?.access_token) {
        throw new Error("The API did not return an access token.");
      }
      const accessToken: string = res.access_token;

      // The register response carries the new account, so this completes in one
      // round-trip. Falling back to /auth/me only if it does not keeps the page
      // working against an older API. The token is passed explicitly there rather
      // than read back from storage, which can return null in a browser that
      // partitions or blocks it.
      const me: any = res.user ?? (await API.getWithToken("/api/v1/auth/me", accessToken));
      if (!me?.id) {
        throw new Error("Your account was created, but the session could not be confirmed.");
      }

      // Best-effort local copy. The httpOnly cookie the API set is what actually
      // carries the session, so a browser that refuses this write still works.
      setToken(accessToken);
      setUser(me);

      if (getToken() !== accessToken) {
        setStorageBlocked(true);
      }
      toast(`Account created — welcome, ${me.full_name || me.email}`, { variant: "success" });
      router.push("/app");
      router.refresh();
    } catch (err: any) {
      const message = err?.message || "Registration failed";
      setFailure(message);
      toast(message, { variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  const selectedRole = SELF_SERVICE_ROLES.find((r) => r.value === form.role);

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_12px_rgba(56,217,255,0.6)]" aria-hidden />
          <Link href="/" className="font-display text-xl font-bold tracking-tight text-text">
            VAXBRIDGE<span className="text-cyan">AI</span>
          </Link>
        </div>

        <div>
          <h1 className="font-display text-2xl font-bold text-text">Create an account</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Self-registration is limited to patient and caregiver accounts, because those are the
            only roles whose access is confined to your own record or your own dependents.
          </p>
        </div>

        {storageBlocked && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/8 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium text-text">This browser blocks script-accessible storage</p>
              <p className="text-xs leading-relaxed text-text-secondary">
                Registration still works and the session is kept in memory for this tab, but it will
                not survive a reload. This usually happens when the app is embedded in a frame or
                site data is blocked.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-surface p-5" noValidate>
          <div className="space-y-1">
            <label htmlFor="reg-name" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              Full name
            </label>
            <Input
              id="reg-name"
              autoComplete="name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="reg-email" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              Email
            </label>
            <Input
              id="reg-email"
              type="email"
              autoComplete="username"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="reg-password" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              Password
            </label>
            <Input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength={8}
              required
            />
            <p className="text-[11px] text-text-secondary/70">At least 8 characters.</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="reg-phone" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              Phone (optional)
            </label>
            <Input
              id="reg-phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+91 98XXXXXXXX"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <p className="text-[11px] text-text-secondary/70">
              Indian mobile numbers{form.phone && isValidIndianPhone(form.phone)
                ? ` — will be stored as ${formatIndianPhone(normalizeIndianPhone(form.phone))}`
                : " — 10 digits, optionally prefixed with +91."}
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="reg-role" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              I am registering as
            </label>
            <select
              id="reg-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="block h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
            >
              {SELF_SERVICE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {selectedRole && (
              <p className="text-[11px] text-text-secondary/80">{selectedRole.blurb}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="reg-language" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              Language preference
            </label>
            <select
              id="reg-language"
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
              className="block h-10 w-full rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none focus:border-cyan"
            >
              <option value="en">English</option>
              <option value="hi">Hindi (preference stored — interface not yet translated)</option>
            </select>
          </div>

          {failure && (
            <div
              className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm"
              role="alert"
            >
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
              <p className="break-words text-text-secondary">{failure}</p>
            </div>
          )}

          <Button variant="primary" type="submit" disabled={loading} className="w-full">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loading ? "Creating account…" : "Create account"}
          </Button>

          <p className="text-center text-xs text-text-secondary/70">
            Already have an account?{" "}
            <Link href="/login" className="text-cyan hover:underline">
              Sign in
            </Link>
          </p>
        </form>

        <div className="flex items-start gap-3 rounded-lg border border-border bg-navy-secondary/40 p-4 text-xs leading-relaxed text-text-secondary">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" aria-hidden />
          <div className="space-y-1.5">
            <p className="font-medium text-text">Healthcare worker or administrator?</p>
            <p>
              Staff and administrative accounts are created by a clinic or system administrator from
              the admin workspace. They cannot be self-registered, because those roles reach records
              belonging to other people. The API refuses the request even if the form is bypassed.
            </p>
            <p>
              A new caregiver account starts with no dependents. Each link must be authorized
              individually by a clinic before any record becomes visible.
            </p>
          </div>
        </div>

        <p className="text-center text-[11px] leading-relaxed text-text-secondary/60">
          Prototype demonstration with synthetic data. Not a government system, and not connected to
          or endorsed by CoWIN, U-WIN, ABDM or any official immunisation registry. Accounts are not
          verified by email in this build, so do not reuse a password you use elsewhere.
        </p>
      </div>
    </div>
  );
}
