"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { API } from "@/lib/api";
import { getToken, isSessionEphemeral, removeToken, setToken, setUser } from "@/lib/auth";

/**
 * Build stamp, rendered on the page and logged to the console.
 *
 * This exists to settle one specific argument: when sign-in fails, is the browser
 * running the code that is on disk, or a cached bundle from before a fix? The
 * served file can be verified from the server side, but only the screen can prove
 * what the browser actually executed. Bump this whenever the auth path changes.
 */
const AUTH_BUILD = "auth-fix-2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

type ApiState =
  | { kind: "checking" }
  | { kind: "ok"; demoMode: boolean; seededUsers: number | null }
  | { kind: "degraded"; detail: string }
  | { kind: "unreachable"; detail: string };

const DEMO_ACCOUNTS = [
  { email: "clinic@vaxbridge.demo", password: "Clinic@12345", role: "Clinic Administrator", blurb: "Full clinic view: patients, verification, stock, analytics." },
  { email: "worker1@vaxbridge.demo", password: "Worker@12345", role: "Healthcare Worker", blurb: "Field view: assigned follow-ups and offline capture." },
  { email: "ph@vaxbridge.demo", password: "PH@12345", role: "Public-Health Administrator", blurb: "Population oversight and analytics, read-only on clinical records." },
  { email: "patient1@vaxbridge.demo", password: "Patient@12345", role: "Patient", blurb: "Own record only: doses, schedule and appointments." },
  { email: "caregiver1@vaxbridge.demo", password: "Caregiver@12345", role: "Caregiver", blurb: "Only the children this caregiver is authorized for." },
  { email: "admin@vaxbridge.demo", password: "Admin@12345", role: "System Administrator", blurb: "Accounts, roles and audit logs — deliberately no clinical access." },
];

function isNetworkFailure(err: any): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const message = String(err.message || err);
  return /failed to fetch|networkerror|load failed|network request failed|econnrefused/i.test(message);
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/app";
  const expired = searchParams.get("session") === "expired";

  const [form, setForm] = useState({ email: DEMO_ACCOUNTS[0].email, password: DEMO_ACCOUNTS[0].password });
  const [submitting, setSubmitting] = useState(false);
  const [apiState, setApiState] = useState<ApiState>({ kind: "checking" });
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);
  const [sessionWarning, setSessionWarning] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);

  const checkApi = useCallback(async () => {
    setApiState({ kind: "checking" });
    try {
      // Unauthenticated on purpose: this is a reachability check, not a session check.
      const res = await fetch("/api/v1/health");
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
    } catch (err: any) {
      setApiState({
        kind: "unreachable",
        detail: isNetworkFailure(err)
          ? "The browser could not reach the API. The service may still be starting, or the proxy is not forwarding /api/v1."
          : String(err?.message || err),
      });
    }
  }, []);

  useEffect(() => {
    checkApi();
    // Detect a browser that will not carry a stored session (third-party frame
    // restrictions, blocked site data, private mode) and say so up front.
    if (isSessionEphemeral()) setStorageBlocked(true);
    // eslint-disable-next-line no-console
    console.info(
      `[VAXBRIDGE] login bundle ${AUTH_BUILD} | session storage ${isSessionEphemeral() ? "BLOCKED (in-memory only)" : "available"}`
    );
  }, [checkApi]);

  // A token left over from an earlier database can look valid locally while the
  // server no longer recognises the account it names. Drop it once, before the
  // first sign-in attempt.
  //
  // Guarded by a ref: this component sits under a Suspense boundary and can be
  // re-mounted, and an unguarded effect would delete the token that the in-flight
  // submit has just stored — turning a successful login into "Not authenticated".
  const clearedRef = useRef(false);
  useEffect(() => {
    if (clearedRef.current) return;
    clearedRef.current = true;
    if (getToken()) removeToken();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);

    if (!form.email.trim() || !form.password) {
      setFailure({ title: "Enter both fields", detail: "An email address and password are required." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await API.post("/api/v1/auth/login", {
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });
      if (!res?.access_token) {
        throw new Error("The API did not return an access token.");
      }
      const accessToken: string = res.access_token;
      setToken(accessToken);

      // Confirm the session works before navigating, so the user is not sent to a
      // shell that immediately bounces them back here.
      //
      // The token is passed explicitly rather than read back from storage: when
      // the browser partitions or blocks localStorage (common inside an iframe)
      // the read can return null, and the request would go out unauthenticated
      // even though the credentials were just accepted.
      const me = await API.getWithToken("/api/v1/auth/me", accessToken);
      if (!me?.id) {
        removeToken();
        throw new Error("Signed in, but the session could not be confirmed.");
      }
      setUser(me);

      if (getToken() !== accessToken) {
        // Storage is not carrying the session. The tab still works from the
        // in-memory fallback, but say so instead of letting a reload look like
        // an unexplained sign-out.
        setSessionWarning(true);
        toast("Signed in for this tab. This browser is blocking stored sessions, so you will need to sign in again after a reload.", {
          variant: "warning",
        });
      } else {
        toast(`Signed in as ${me.full_name || me.email} (${me.role})`, { variant: "success" });
      }
      router.push(from);
      router.refresh();
    } catch (err: any) {
      removeToken();
      if (isNetworkFailure(err)) {
        setFailure({
          title: "Cannot reach the sign-in service",
          detail:
            "The request never reached the API. Check that the API is running and that /api/v1 is being proxied, then try again.",
        });
        await checkApi();
      } else {
        setFailure({
          title: "Sign-in failed",
          detail: String(err?.message || err || "Unexpected error"),
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function useAccount(account: (typeof DEMO_ACCOUNTS)[number]) {
    setForm({ email: account.email, password: account.password });
    setFailure(null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_12px_rgba(56,217,255,0.6)]" aria-hidden />
          <Link href="/" className="font-display text-xl font-bold tracking-tight text-text">
            VAXBRIDGE<span className="text-cyan">AI</span>
          </Link>
        </div>

        <div>
          <h1 className="font-display text-2xl font-bold text-text">Sign in</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Use one of the demonstration accounts below. Every record in this system is synthetic.
          </p>
        </div>

        {expired && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
            <p className="text-text-secondary">
              <span className="font-medium text-text">Your session ended.</span> Sign in again to
              continue.
            </p>
          </div>
        )}

        {apiState.kind === "checking" && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin text-cyan" aria-hidden />
            Checking the API connection…
          </div>
        )}

        {apiState.kind === "ok" && (
          <div className="flex items-start gap-3 rounded-lg border border-mint/25 bg-mint/5 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint" aria-hidden />
            <p className="text-text-secondary">
              <span className="font-medium text-text">API connected.</span>{" "}
              {apiState.seededUsers !== null && `${apiState.seededUsers} demo accounts available. `}
              {apiState.demoMode && "Document extraction runs in labeled demonstration mode."}
            </p>
          </div>
        )}

        {(apiState.kind === "unreachable" || apiState.kind === "degraded") && (
          <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
              <div>
                <p className="font-medium text-text">
                  {apiState.kind === "unreachable" ? "API unreachable" : "API degraded"}
                </p>
                <p className="mt-1 text-text-secondary">{apiState.detail}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={checkApi}>
              Retry connection
            </Button>
          </div>
        )}

        {(storageBlocked || sessionWarning) && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/8 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium text-text">
                This browser is blocking stored sessions
              </p>
              <p className="text-xs leading-relaxed text-text-secondary">
                Sign-in still works, and the session is kept in memory for this
                tab. It will not survive a page reload, because the browser is
                refusing to store it — this usually happens when the app is
                embedded in a frame or site data is blocked. Nothing is wrong
                with your credentials.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-surface p-5" noValidate>
          <div className="space-y-1">
            <label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              Email
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-text-secondary">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>

          {failure && (
            <div
              className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm"
              role="alert"
            >
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
              <div>
                <p className="font-medium text-text">{failure.title}</p>
                <p className="mt-0.5 break-words text-text-secondary">{failure.detail}</p>
              </div>
            </div>
          )}

          <Button variant="primary" type="submit" disabled={submitting} className="w-full">
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>

          <p className="text-center text-xs text-text-secondary/70">
            New here?{" "}
            <Link href="/register" className="text-cyan hover:underline">
              Create an account
            </Link>
          </p>
        </form>

        <div className="rounded-lg border border-border bg-surface/60 p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-text-secondary">
            Demonstration accounts — select to fill the form
          </p>
          <ul className="space-y-2">
            {DEMO_ACCOUNTS.map((account) => {
              const active = form.email === account.email;
              return (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => useAccount(account)}
                    aria-pressed={active}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      active
                        ? "border-cyan/50 bg-cyan/5"
                        : "border-border/60 bg-navy-secondary/30 hover:border-cyan/30"
                    }`}
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-sm font-medium text-text">{account.role}</span>
                      <span className="font-mono text-[11px] text-cyan">{account.email}</span>
                    </span>
                    <span className="mt-1 block text-xs text-text-secondary/85">{account.blurb}</span>
                    <span className="mt-1 block font-mono text-[11px] text-text-secondary/60">
                      password: {account.password}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border bg-navy-secondary/40 p-4 text-xs leading-relaxed text-text-secondary">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          <p>
            Prototype demonstration with synthetic data only. Not a government system, and not
            connected to or endorsed by CoWIN, U-WIN, ABDM or any official immunisation registry.
            These passwords exist only for this demo — never reuse them.
          </p>
        </div>
        <p className="mt-4 text-center text-[10px] tracking-wide text-text-secondary/45" title="Build identifier for support">
          bundle {AUTH_BUILD}
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    // useSearchParams needs a Suspense boundary so the route can render without
    // bailing the whole page out to client-side rendering.
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-navy">
          <Loader2 className="h-6 w-6 animate-spin text-cyan" aria-label="Loading sign-in" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
