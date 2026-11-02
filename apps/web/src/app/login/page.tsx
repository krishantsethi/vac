"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Lock, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "@/components/ui/toast";

import { API } from "@/lib/api";
import { getToken, getUser, isSessionEphemeral, removeToken, setToken, setUser } from "@/lib/auth";
import { SceneBoundary } from "@/components/hero/scene-boundary";
import { reportDiag, tokenFingerprint } from "@/lib/diag";
import { handoffSession } from "@/lib/session-handoff";
import { LoginSceneFallback } from "@/components/hero/LoginSceneFallback";

const LoginScene3D = dynamic(() => import("@/components/hero/LoginScene3D").then((m) => m.LoginScene3D), {
  ssr: false,
  loading: () => <LoginSceneFallback className="absolute inset-0" />,
});

/**
 * Build stamp, rendered on the card and logged to the console.
 *
 * This settles one specific argument: when sign-in fails, is the browser running
 * the code on disk, or a bundle loaded before a fix? A long-lived tab keeps
 * executing the JavaScript it already has, and no server-side change can reach
 * it — so the screen itself is the only reliable witness. Bump on auth changes.
 */
const AUTH_BUILD = "auth-fix-4";

if (typeof window !== "undefined") {
  // Read by the diagnostics reporter so a log line can be tied to the bundle that
  // produced it — the question that could not be answered from the server side.
  (window as any).__VAXBRIDGE_BUILD__ = AUTH_BUILD;
}

/**
 * The six demonstration accounts, seeded by the API.
 *
 * Every one of these is a real row in the demonstration database with a real
 * bcrypt password hash; the credentials below are the same ones the seeder
 * writes. Nothing here bypasses authentication — submitting them performs a
 * normal credential check against the API.
 */
const DEMO_ACCOUNTS = [
  { email: "clinic@vaxbridge.demo", password: "Clinic@12345", role: "Clinic Administrator", blurb: "Full clinic view: patients, verification, stock, analytics." },
  { email: "worker1@vaxbridge.demo", password: "Worker@12345", role: "Healthcare Worker", blurb: "Field view: assigned follow-ups and offline capture." },
  { email: "ph@vaxbridge.demo", password: "PH@12345", role: "Public-Health Administrator", blurb: "Population oversight and analytics; read-only on clinical records." },
  { email: "patient1@vaxbridge.demo", password: "Patient@12345", role: "Patient", blurb: "Own record only: doses, schedule and appointments." },
  { email: "caregiver1@vaxbridge.demo", password: "Caregiver@12345", role: "Caregiver", blurb: "Only the children this caregiver is authorized for." },
  { email: "admin@vaxbridge.demo", password: "Admin@12345", role: "System Administrator", blurb: "Accounts, roles and audit logs — deliberately no clinical access." },
];

type ApiState =
  | { kind: "checking" }
  | { kind: "ok"; demoMode: boolean; seededUsers: number | null }
  | { kind: "degraded"; detail: string }
  | { kind: "unreachable"; detail: string };

function isNetworkFailure(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  return /failed to fetch|networkerror|load failed|network request failed|econnrefused/i.test(
    String((err as Error)?.message || err)
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

function StatusPill({ state }: { state: ApiState }) {
  // Narrowed per branch rather than built eagerly from a map: the variants carry
  // different fields, so a shared lookup object cannot be type-checked.
  let dot = "bg-amber-400/80";
  let text = "Checking the API connection…";

  if (state.kind === "ok") {
    dot = "bg-mint";
    const accounts = state.seededUsers ? ` · ${state.seededUsers} demo accounts` : "";
    const ocr = state.demoMode ? " · OCR in labeled demo mode" : "";
    text = `API connected${accounts}${ocr}`;
  } else if (state.kind === "degraded") {
    dot = "bg-amber-400";
    text = `API reachable but degraded — ${state.detail}`;
  } else if (state.kind === "unreachable") {
    dot = "bg-red-400";
    text = `API unreachable — ${state.detail}`;
  }

  return (
    <div className="flex items-start gap-2 text-[11px] leading-relaxed text-text-secondary/80">
      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span>{text}</span>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/app";
  const expired = searchParams.get("session") === "expired";
  const reducedMotion = usePrefersReducedMotion();

  const [form, setForm] = useState({ email: DEMO_ACCOUNTS[0].email, password: DEMO_ACCOUNTS[0].password });
  const [submitting, setSubmitting] = useState(false);
  const [apiState, setApiState] = useState<ApiState>({ kind: "checking" });
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);

  const activeDemo = useMemo(
    () => DEMO_ACCOUNTS.find((a) => a.email === form.email.trim().toLowerCase()) ?? null,
    [form.email]
  );

  const checkApi = useCallback(async () => {
    setApiState({ kind: "checking" });
    try {
      // Unauthenticated on purpose: this is a reachability check, not a session check.
      const res = await fetch("/api/v1/health", { credentials: "include" });
      if (!res.ok) {
        setApiState({ kind: "degraded", detail: `The API responded with HTTP ${res.status}.` });
        return;
      }
      const body = await res.json();
      if (!body.database_connected) {
        setApiState({ kind: "degraded", detail: body.database_error || "The API is up but cannot reach its database." });
        return;
      }
      setApiState({ kind: "ok", demoMode: !!body.demo_mode, seededUsers: body.seeded_users ?? null });
    } catch (err) {
      setApiState({
        kind: "unreachable",
        detail: isNetworkFailure(err)
          ? "The browser could not reach the API. It may still be starting, or the proxy is not forwarding /api/v1."
          : String((err as Error)?.message || err),
      });
    }
  }, []);

  useEffect(() => {
    checkApi();
    if (isSessionEphemeral()) setStorageBlocked(true);
    // eslint-disable-next-line no-console
    console.info(
      `[VAXBRIDGE] login bundle ${AUTH_BUILD} | session storage ${
        isSessionEphemeral() ? "BLOCKED (cookie + in-memory session)" : "available"
      }`
    );
  }, [checkApi]);

  function pickDemo(email: string) {
    const account = DEMO_ACCOUNTS.find((a) => a.email === email);
    if (!account) return;
    setFailure(null);
    setForm({ email: account.email, password: account.password });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);

    // Stage 1: the handler ran at all. Distinguishes "the click did nothing" from
    // "the click did something that failed later".
    reportDiag("login.click", {
      build: AUTH_BUILD,
      emailLen: form.email.trim().length,
      passwordLen: form.password.length,
      submitting,
      defaultPrevented: e.defaultPrevented,
    });

    if (!form.email.trim() || !form.password) {
      reportDiag("login.blocked_client_validation", {
        emailEmpty: !form.email.trim(),
        passwordEmpty: !form.password,
      });
      setFailure({ title: "Enter both fields", detail: "An email address and password are required." });
      return;
    }

    setSubmitting(true);
    reportDiag("login.submitting", { apiState: apiState.kind });
    try {
      const res = await API.post("/api/v1/auth/login", {
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });

      // Stage 2: what the API actually returned. Never the token itself.
      reportDiag("login.response", {
        hasRes: !!res,
        keys: res ? Object.keys(res).join(",") : "none",
        hasAccessToken: !!res?.access_token,
        hasUser: !!res?.user,
        userRole: res?.user?.role ?? null,
        token: tokenFingerprint(res?.access_token),
      });

      // The login response carries the authenticated user, so sign-in completes
      // in a single round-trip. The second authenticated call this replaced was
      // where sign-in used to break: it was the first request to depend on the
      // client having stored and replayed the token, and in a browser that
      // refuses script-accessible storage it went out with no credential at all,
      // turning an accepted password into "Not authenticated".
      const me =
        res?.user ??
        (res?.access_token ? await API.getWithToken("/api/v1/auth/me", res.access_token) : null);

      if (!me?.id) {
        throw new Error("Signed in, but the session could not be confirmed.");
      }

      // Best-effort local copy. The httpOnly cookie the API set is what actually
      // carries the session, so a browser that refuses this write still works.
      if (res?.access_token) setToken(res.access_token);
      setUser(me);

      // Hand the session directly to the shell. In a browser that refuses both
      // localStorage and third-party cookies, this is the only channel that
      // survives the client-side navigation to /app — see lib/session-handoff.ts.
      handoffSession(res?.access_token, me);
      reportDiag("login.handoff", { hasToken: !!res?.access_token, role: me.role });

      // Stage 3: can the token be read back in THIS tab? This is the exact
      // question the whole investigation turns on.
      const readBack = getToken();
      reportDiag("login.storage", {
        readBackMatches: readBack === res?.access_token,
        readBack: tokenFingerprint(readBack),
        sessionEphemeral: isSessionEphemeral(),
        userReadable: !!getUser(),
      });

      if (res?.access_token && readBack !== res.access_token) {
        setStorageBlocked(true);
      }

      toast(`Signed in as ${me.full_name || me.email}`, {
        variant: "success",
        description: String(me.role || "").replace(/_/g, " "),
      });
      // Stage 4: navigation is being attempted. If the next line in the log is a
      // 401 from the app shell, the problem is after this point, not here.
      reportDiag("login.navigate", { from, method: "router.push+refresh" });
      router.push(from);
      router.refresh();
    } catch (err) {
      reportDiag("login.error", {
        message: String((err as Error)?.message || err).slice(0, 200),
        isNetworkFailure: isNetworkFailure(err),
      });
      removeToken();
      if (isNetworkFailure(err)) {
        setFailure({
          title: "Cannot reach the sign-in service",
          detail: "The request never reached the API. Check that the API is running and that /api/v1 is proxied, then try again.",
        });
        await checkApi();
      } else {
        setFailure({
          title: "Sign-in failed",
          detail: String((err as Error)?.message || err || "Unexpected error"),
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col bg-navy lg:h-[100dvh] lg:flex-row lg:overflow-hidden">
      {/* ---------------- Left: brand + 3D ---------------- */}
      <section className="relative hidden min-h-0 flex-1 overflow-hidden lg:flex lg:flex-col">
        <div className="absolute inset-0" aria-hidden="true">
          <SceneBoundary fallback={<LoginSceneFallback className="absolute inset-0" />} label="Sign-in 3D scene">
            <LoginScene3D className="absolute inset-0" reducedMotion={reducedMotion} />
          </SceneBoundary>
        </div>
        {/* Legibility gradient behind the text */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(105deg, rgba(7,17,31,0.94) 0%, rgba(7,17,31,0.62) 38%, rgba(7,17,31,0.10) 68%, rgba(7,17,31,0.55) 100%)",
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14">
          <div className="flex items-center gap-2.5">
            <span
              className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_14px_rgba(56,217,255,0.85)]"
              aria-hidden="true"
            />
            <span className="font-display text-lg font-bold tracking-tight text-text">
              VAXBRIDGE<span className="text-cyan">AI</span>
            </span>
          </div>

          <div className="max-w-lg space-y-5">
            <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight text-text xl:text-5xl">
              Every missed dose becomes an{" "}
              <span className="bg-gradient-to-r from-cyan via-ice to-mint bg-clip-text text-transparent">
                actionable next step
              </span>
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-text-secondary">
              A closed-loop gap-resolution engine that discovers incomplete immunisation records,
              distinguishes a genuinely missing dose from an uncertain one, and turns the difference
              into a prioritised task.
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-text-secondary/75">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-cyan" aria-hidden /> Server-enforced roles
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-mint" aria-hidden /> Signed digital record
              </span>
            </div>
          </div>

          <p className="max-w-md text-[10.5px] leading-relaxed text-text-secondary/55">
            Prototype demonstration with synthetic data. Not a government system, and not connected to
            or endorsed by CoWIN, U-WIN, ABDM or any official immunisation registry.
          </p>
        </div>
      </section>

      {/* ---------------- Right: sign-in card ---------------- */}
      <section className="flex w-full items-center justify-center px-5 py-8 lg:w-[30rem] lg:shrink-0 lg:border-l lg:border-border/60 lg:bg-navy-secondary/25 lg:px-8 xl:w-[33rem]">
        <div className="w-full max-w-sm space-y-4">
          {/* Compact brand for small screens, where the left panel is hidden */}
          <div className="flex items-center justify-between gap-3 lg:hidden">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_12px_rgba(56,217,255,0.8)]" aria-hidden />
              <span className="font-display text-base font-bold tracking-tight text-text">
                VAXBRIDGE<span className="text-cyan">AI</span>
              </span>
            </div>
            <Link href="/" className="text-[11px] text-text-secondary/70 transition-colors hover:text-cyan">
              Overview
            </Link>
          </div>

          <div className="space-y-1">
            <h2 className="font-display text-xl font-bold tracking-tight text-text">Sign in</h2>
            <p className="text-xs text-text-secondary">
              Use a demonstration account below, or your own credentials.
            </p>
          </div>

          {expired && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3 text-[11.5px] leading-relaxed text-amber-100/85">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
              <span>Your previous session ended. Sign in again to continue.</span>
            </div>
          )}

          {storageBlocked && (
            <div className="flex items-start gap-2.5 rounded-lg border border-cyan/25 bg-cyan/8 p-3 text-[11.5px] leading-relaxed text-text-secondary">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan" aria-hidden />
              <span>
                This browser blocks script-accessible storage, so the session is carried by a secure
                httpOnly cookie instead. Sign-in works normally.
              </span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-3" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="h-11 w-full rounded-lg border border-border bg-navy/70 px-3.5 text-sm text-text outline-none transition-all placeholder:text-text-secondary/45 focus:border-cyan/70 focus:bg-navy focus:ring-2 focus:ring-cyan/18"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
                  Password
                </label>
                <Link href="/contact" className="text-[11px] text-text-secondary/70 transition-colors hover:text-cyan">
                  Need access?
                </Link>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="h-11 w-full rounded-lg border border-border bg-navy/70 px-3.5 text-sm text-text outline-none transition-all placeholder:text-text-secondary/45 focus:border-cyan/70 focus:bg-navy focus:ring-2 focus:ring-cyan/18"
                placeholder="••••••••"
              />
            </div>

            {/* Demonstration accounts: a select, so all six are reachable without
                scrolling and the card stays within one viewport. */}
            <div className="space-y-1.5 rounded-lg border border-border/70 bg-navy/45 p-3">
              <label htmlFor="demo" className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
                Demonstration account
              </label>
              <select
                id="demo"
                value={activeDemo?.email ?? ""}
                onChange={(e) => pickDemo(e.target.value)}
                className="h-10 w-full cursor-pointer rounded-md border border-border bg-navy-secondary px-3 text-sm text-text outline-none transition-colors focus:border-cyan/70"
              >
                <option value="" disabled>
                  Choose a role to fill the form…
                </option>
                {DEMO_ACCOUNTS.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.role} — {a.email}
                  </option>
                ))}
              </select>
              <p className="min-h-[2.1rem] text-[11px] leading-relaxed text-text-secondary/75">
                {activeDemo ? activeDemo.blurb : "Selecting an account fills both fields with its real seeded credentials."}
              </p>
            </div>

            {failure && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-semibold text-text">{failure.title}</p>
                  <p className="break-words text-[11.5px] leading-relaxed text-text-secondary">{failure.detail}</p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-cyan to-mint text-sm font-semibold text-navy transition-all hover:shadow-[0_0_28px_rgba(56,217,255,0.35)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:ring-offset-2 focus:ring-offset-navy disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              )}
              {submitting ? "Signing in…" : "Sign in"}
            </button>

            <div className="flex items-center justify-between pt-0.5">
              <StatusPill state={apiState} />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3 text-[11px]">
              <Link href="/register" className="text-cyan transition-colors hover:underline">
                Create an account
              </Link>
              <span className="text-text-secondary/45" title="Build identifier for support">
                <CheckCircle2 className="mr-1 inline h-3 w-3 text-mint/60" aria-hidden />
                bundle {AUTH_BUILD}
              </span>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-navy">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-cyan/30 border-t-cyan" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
