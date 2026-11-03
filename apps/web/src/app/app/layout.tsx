"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OfflineSyncBar } from "@/components/layout/offline-sync-bar";
import { Sidebar } from "@/components/layout/sidebar";
import { TopNav } from "@/components/layout/top-nav";
import { getToken, isAuthenticated, removeToken, setToken, setUser } from "@/lib/auth";
import { consumeHandoff } from "@/lib/session-handoff";
import { reportDiag, tokenFingerprint } from "@/lib/diag";

type SessionState = "checking" | "ready" | "offline" | "rejected";

/**
 * Authenticated application shell.
 *
 * Authorization itself is enforced server-side by the API on every request; this
 * guard exists so a signed-out visitor is not shown an empty dashboard.
 *
 * The token is confirmed against /auth/me rather than trusted on its local
 * expiry claim. A token can be unexpired but no longer recognised — for example
 * after the demonstration database is reset — and trusting it locally would
 * render the shell, fail every subsequent call, and bounce the user back to the
 * sign-in page in a loop.
 *
 * An unreachable API is treated differently from a rejected one: with no network
 * the shell still renders so captures queued on this device stay visible and can
 * be synced later. Being offline must not look like being signed out.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [state, setState] = useState<SessionState>("checking");
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let handoffRetried = false;

    async function confirmSession() {
      // Take the session the sign-in page handed over before consulting storage.
      //
      // In a framed browser that refuses both localStorage and third-party
      // cookies, storage has nothing to give back and the cookie is not replayed,
      // so reading them first would report "no session" for a user who signed in
      // milliseconds ago. The handoff is module state, which a client-side
      // navigation preserves. See lib/session-handoff.ts.
      const handoff = consumeHandoff();
      if (handoff) {
        if (handoff.token) setToken(handoff.token);
        setUser(handoff.user);
        reportDiag("shell.handoff", {
          hasToken: !!handoff.token,
          token: tokenFingerprint(handoff.token),
          role: handoff.user?.role ?? null,
        });
      }

      const token = handoff?.token || getToken();
      reportDiag("shell.confirm_start", {
        fromHandoff: !!handoff,
        storedToken: tokenFingerprint(token),
        locallyAuthenticated: isAuthenticated(),
      });

      // A locally readable token is a convenience, never a precondition.
      //
      // The session may exist only as the httpOnly cookie the API set at sign-in,
      // which JavaScript cannot read by design. Bailing out here on a missing
      // local token would sign out exactly the users whose browser refuses
      // script-accessible storage — and would do so on every page refresh, which
      // empties the in-memory fallback. So the server is always asked.
      try {
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch("/api/v1/auth/me", { headers, credentials: "include" });

        reportDiag("shell.me_response", { status: res.status, hadToken: !!token });

        if (res.ok) {
          const me = await res.json();
          // Refresh the stored profile so a role change is reflected immediately.
          setUser(me);
          if (!cancelled) setState("ready");
          return;
        }

        if (res.status === 401 || res.status === 403) {
          // One retry with the token attached explicitly, before giving up. If the
          // credential came from the handoff it is known-good as of milliseconds
          // ago, so a 401 here is more likely a lost header than a dead session —
          // and bouncing straight to the sign-in page is what turned a recoverable
          // hiccup into "sign-in does not work".
          if (token && !handoffRetried) {
            handoffRetried = true;
            reportDiag("shell.retry_explicit", { token: tokenFingerprint(token) });
            const retry = await fetch("/api/v1/auth/me", {
              headers: { Authorization: `Bearer ${token}` },
              credentials: "include",
            });
            reportDiag("shell.retry_response", { status: retry.status });
            if (retry.ok) {
              setUser(await retry.json());
              if (!cancelled) setState("ready");
              return;
            }
          }

          reportDiag("shell.rejected", { status: res.status });
          removeToken();
          if (!cancelled) setState("rejected");
          // Soft navigation, not `window.location`: a full reload would destroy
          // the in-memory session and any queued offline captures with it.
          if (!cancelled) router.replace("/login?session=expired");
          return;
        }

        // 5xx: the API is up but unhealthy. Show the shell rather than a
        // misleading sign-in redirect; individual pages report their own errors.
        if (!cancelled) setState("ready");
      } catch {
        // Network failure, so the server cannot be asked. With a locally valid
        // token, render in offline mode so captures queued on this device stay
        // visible and can be synced later — being offline must not look like
        // being signed out. With no token there is nothing to show offline.
        if (isAuthenticated()) {
          if (!cancelled) setState("offline");
        } else if (!cancelled) {
          router.replace("/login");
        }
      }
    }

    confirmSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-cyan/30 border-t-cyan" />
          <p className="text-sm text-text-secondary">Restoring session…</p>
        </div>
      </div>
    );
  }

  // A rejected session must NOT render the app. It used to fall through to the
  // shell below, so the dashboard and its pages mounted during the moment before
  // `router.replace` took effect. Every one of those requests was unauthenticated
  // and came back 401, and each 401 triggered the API client's own hard redirect
  // — a full page reload that raced the shell's soft navigation and destroyed the
  // in-memory session. The user saw a login page that "would not sign in".
  if (state === "rejected") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy p-6">
        <div className="max-w-sm space-y-3 text-center">
          <p className="font-display text-base font-semibold text-text">Session not recognised</p>
          <p className="text-xs leading-relaxed text-text-secondary">
            The server did not accept this session, so nothing was loaded. Taking you back to sign in.
          </p>
          <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-cyan/30 border-t-cyan" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-h-screen flex-col md:pl-64">
        <TopNav onMenu={() => setSidebarOpen((o) => !o)} />
        <main id="main-content" className="flex-1 space-y-4 p-4 md:p-6">
          <OfflineSyncBar />
          {state === "offline" && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-xs leading-relaxed text-text-secondary">
              <span className="font-medium text-text">Working offline.</span> Pages that need the
              server will show an error until the connection returns. Doses you capture are stored
              on this device and sync automatically when you are back online — your session was not
              signed out.
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
