const TOKEN_KEY = "vaxbridge_token";
const USER_KEY = "vaxbridge_user";

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function removeToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function setUser(user: any) {
  if (typeof window === "undefined") return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser(): any {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Decode a base64url segment.
 *
 * JWTs use base64**url** (`-` and `_`, no padding). `Buffer.from(x, "base64")`
 * is also unavailable in some browser builds, so `atob` is preferred and the
 * result is re-decoded as UTF-8 to keep non-ASCII names intact.
 */
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(bytes);
    }
    return binary;
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}

export function decodeJwtPayload(token: string): any {
  try {
    const parts = String(token).split(".");
    if (parts.length < 2 || !parts[1]) return null;
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

/**
 * True when a token is present and has not expired **locally**.
 *
 * This is a rendering hint only — it decides whether to show the app shell
 * instead of a blank screen. It is not authorization: the API re-checks the
 * token and the account's role on every request, and a token can be locally
 * unexpired but rejected by the server (for example after the demonstration
 * database is reset). Callers must still handle a 401.
 */
export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") {
    // An unreadable token is worse than no token: it would render the shell and
    // then fail every request. Drop it so the user lands on the sign-in page.
    removeToken();
    return false;
  }
  if (Date.now() / 1000 >= payload.exp) {
    removeToken();
    return false;
  }
  return true;
}

/** Seconds until the current token expires, or null when there is no session. */
export function tokenExpiresIn(): number | null {
  const token = getToken();
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return null;
  return Math.max(0, Math.round(payload.exp - Date.now() / 1000));
}
