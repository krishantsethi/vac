/**
 * Development diagnostics for the sign-in flow.
 *
 * The failure this exists to find could only be observed from inside the
 * browser, and the browser console is not visible from the server. So each stage
 * of the flow is reported to `POST /api/v1/_diag/client`, which writes one line
 * to the API log. That turns "it stays on the login page" into a readable
 * sequence of what actually happened and where it stopped.
 *
 * Rules this module holds itself to:
 *
 *   - It never throws and never blocks. Every call is fire-and-forget; a
 *     diagnostic that fails must not become a new reason sign-in fails.
 *   - It never sends a credential. Values are reported as lengths and booleans.
 *     The intake endpoint scrubs the obvious keys as a second line of defence,
 *     but the client is where the obligation actually sits.
 *   - It is silent in production builds unless explicitly enabled, so it cannot
 *     become a channel for leaking session details about real users.
 */

const ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_AUTH_DIAG === "1";

const ENDPOINT = "/api/v1/_diag/client";

/** Environment facts, sent once so every line can be read in context. */
let contextSent = false;

function environment(): Record<string, unknown> {
  if (typeof window === "undefined") return { ssr: true };

  let storageState = "unknown";
  try {
    const probe = "__vaxbridge_diag_probe__";
    window.localStorage.setItem(probe, "1");
    const readBack = window.localStorage.getItem(probe);
    window.localStorage.removeItem(probe);
    storageState = readBack === "1" ? "working" : "write-did-not-stick";
  } catch (err) {
    storageState = `throws:${(err as Error)?.name || "Error"}`;
  }

  let cookieEnabled: boolean | string = "unknown";
  try {
    cookieEnabled = navigator.cookieEnabled;
  } catch {
    /* leave as unknown */
  }

  return {
    href: window.location.href.slice(0, 160),
    inIframe: typeof window.self !== "undefined" && window.self !== window.top,
    localStorage: storageState,
    cookieEnabled,
    onLine: navigator.onLine,
    build: (window as any).__VAXBRIDGE_BUILD__ || "unset",
  };
}

/**
 * Report one stage of the flow.
 *
 * @param stage  short identifier, e.g. "login.click", "login.response"
 * @param data   booleans, numbers and short strings only — never a credential
 */
export function reportDiag(stage: string, data: Record<string, unknown> = {}): void {
  if (!ENABLED) return;
  if (typeof window === "undefined") return;

  try {
    const payload: Record<string, unknown> = { stage, ...data };
    if (!contextSent) {
      contextSent = true;
      payload.env = environment();
    }
    // keepalive so the report still lands if it races a navigation — which is
    // exactly when the most interesting ones happen.
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload).slice(0, 3800),
      credentials: "include",
      keepalive: true,
    }).catch(() => {
      /* a failed diagnostic must never surface to the user */
    });
  } catch {
    /* never let diagnostics break the flow they are observing */
  }
}

/**
 * Describe a token without revealing it: length plus a short non-reversible
 * fingerprint, enough to tell two tokens apart across log lines.
 */
export function tokenFingerprint(token: string | null | undefined): Record<string, unknown> {
  if (!token) return { present: false };
  let sum = 0;
  for (let i = 0; i < token.length; i += 1) sum = (sum * 31 + token.charCodeAt(i)) >>> 0;
  return { present: true, length: token.length, fp: sum.toString(36).slice(0, 8) };
}
