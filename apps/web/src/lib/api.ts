import { getToken, removeToken } from "./auth";
import { reportDiag, tokenFingerprint } from "./diag";
import { secondsSinceSignIn } from "./session-handoff";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * How long after a successful sign-in a 401 is treated as a race rather than as
 * a dead session. Long enough to cover parallel first-paint requests, short
 * enough that a genuinely expired session still redirects promptly.
 */
const SIGN_IN_GRACE_SECONDS = 10;

/** Set once a session-expired redirect starts, so concurrent 401s do not each fire one. */
let redirecting = false;

async function request(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) || {} };

  // An explicitly supplied Authorization header always wins. The sign-in flow
  // uses this to confirm a freshly issued token without depending on a storage
  // round-trip, which can fail when the browser partitions or blocks
  // localStorage (common when the app is served inside an iframe).
  const hasExplicitAuth = Object.keys(headers).some(
    (key) => key.toLowerCase() === "authorization"
  );
  if (!hasExplicitAuth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  // `include` so the httpOnly session cookie rides along. It is what keeps a
  // session alive in a browser that refuses script-accessible storage, and it
  // matters on a cross-origin API_BASE too (the API allows credentials for the
  // configured front-end origins). For the usual same-origin proxy path this is
  // identical to the fetch default, so nothing else changes.
  // Report the credential actually attached to this request. The server can only
  // say whether a header arrived; this says what the client believed it was
  // sending, which is the half of the story that was missing.
  const diagPath = typeof input === "string" ? input.slice(0, 120) : "non-string-input";
  reportDiag("api.request", {
    path: diagPath,
    method: init.method || "GET",
    explicitAuth: hasExplicitAuth,
    storedToken: tokenFingerprint(headers.Authorization ? headers.Authorization.slice(7) : null),
    willSendAuthHeader: !!headers.Authorization,
  });

  const res = await fetch(input, { credentials: "include", ...init, headers });

  reportDiag("api.response", {
    path: diagPath,
    status: res.status,
    ok: res.ok,
  });

  if (res.status === 401) {
    const sinceSignIn = secondsSinceSignIn();
    const onAppPath = typeof window !== "undefined" && window.location.pathname.startsWith("/app");
    reportDiag("api.401", {
      path: diagPath,
      hadAuthHeader: !!headers.Authorization,
      explicitAuth: hasExplicitAuth,
      onAppPath,
      secondsSinceSignIn: sinceSignIn === null ? null : Math.round(sinceSignIn * 10) / 10,
      redirectSuppressed: sinceSignIn !== null && sinceSignIn < SIGN_IN_GRACE_SECONDS,
    });

    const withinGrace = sinceSignIn !== null && sinceSignIn < SIGN_IN_GRACE_SECONDS;

    // Only clear the stored session when we are not mid-sign-in: a 401 on the
    // verification call is handled by the caller, which still holds the token.
    if (!hasExplicitAuth && !withinGrace) {
      removeToken();
    }

    // Session-expired redirect, with two guards that were missing and mattered:
    //
    //  * Not during the grace window after a successful sign-in. A request that
    //    was already in flight can return 401 for want of a token that now
    //    exists; tearing the session down over it bounced the user back to the
    //    sign-in page immediately after they had signed in.
    //  * Only once. Several pages fetch in parallel, so several 401s arrive
    //    together and each used to trigger its own navigation.
    //
    // The app shell owns the authoritative check and redirects on its own; this
    // is the backstop for a session that dies while the app is in use.
    if (onAppPath && !withinGrace && !redirecting) {
      redirecting = true;
      // `replace` rather than `href =`, so the sign-in page does not become a
      // history entry the back button would return to mid-redirect.
      window.location.replace("/login?session=expired");
    }
  }
  return res;
}

export async function api<T>(input: RequestInfo, init: RequestInit = {}): Promise<T> {
  const res = await request(input, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail || `Request failed ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export const API = {
  get: (path: string) => api<any>(`${API_BASE}${path}`),
  /**
   * GET with an explicitly supplied bearer token.
   *
   * Used by the sign-in flow to verify a token it has just received, before
   * relying on storage to carry it. This removes a whole class of failure where
   * the credentials are accepted but the session cannot be read back.
   */
  getWithToken: (path: string, token: string) =>
    api<any>(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }),
  post: (path: string, body?: any) =>
    api<any>(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: (path: string, body?: any) =>
    api<any>(`${API_BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: (path: string, body?: any) =>
    api<any>(`${API_BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: (path: string) => api<any>(`${API_BASE}${path}`, { method: "DELETE" }),
  /**
   * End the session server-side (clears the httpOnly cookie) and locally.
   *
   * The API call is best-effort: if it fails, the local credential is still
   * dropped, because leaving a token behind on sign-out is worse than a cookie
   * that expires on its own schedule.
   */
  logout: async () => {
    try {
      await api<any>(`${API_BASE}/api/v1/auth/logout`, { method: "POST" });
    } catch {
      // Ignored deliberately — local sign-out below still happens.
    }
  },
  postForm: async (path: string, formData: FormData) => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await request(`${API_BASE}${path}`, { method: "POST", headers, body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Upload failed ${res.status}`);
    }
    return res.json();
  },
};
