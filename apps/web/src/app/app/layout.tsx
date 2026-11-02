"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OfflineSyncBar } from "@/components/layout/offline-sync-bar";
import { Sidebar } from "@/components/layout/sidebar";
import { TopNav } from "@/components/layout/top-nav";
import { getToken, isAuthenticated, removeToken, setUser } from "@/lib/auth";

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

    async function confirmSession() {
      const token = getToken();

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

        if (res.ok) {
          const me = await res.json();
          // Refresh the stored profile so a role change is reflected immediately.
          setUser(me);
          if (!cancelled) setState("ready");
          return;
        }

        if (res.status === 401 || res.status === 403) {
          removeToken();
          if (!cancelled) setState("rejected");
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
