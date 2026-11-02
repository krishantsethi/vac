/**
 * Session storage.
 *
 * This app is routinely served inside an iframe on a preview host, and browsers
 * increasingly partition or outright block `localStorage` in cross-site frames.
 * Under those restrictions a write can succeed while the following read returns
 * `null`, or the accessor can throw a SecurityError.
 *
 * That failure mode is invisible and total: the sign-in POST succeeds, the token
 * cannot be read back, the next request goes out with no Authorization header,
 * and the server answers "Not authenticated" — so the user is told sign-in
 * failed even though their credentials were accepted.
 *
 * Every access here is therefore wrapped, and a write is verified by reading it
 * back. If storage is unavailable or unreliable, an in-memory fallback keeps the
 * session alive for the lifetime of the tab. The cost is honest and stated:
 * without localStorage the session does not survive a page reload, which is far
 * better than never being able to sign in at all.
 */

const TOKEN_KEY = "vaxbridge_token";
const USER_KEY = "vaxbridge_user";

/** In-memory fallback, used when localStorage is blocked or unreliable. */
const memoryStore = new Map<string, string>();

/** Set once we know localStorage cannot be trusted, so we stop retrying it. */
let persistentStorageBroken = false;

function localStorageUsable(): boolean {
  if (persistentStorageBroken) return false;
  if (typeof window === "undefined") return false;
  try {
    // Some browsers expose the object but throw on any access.
    const probe = "__vaxbridge_probe__";
    window.localStorage.setItem(probe, "1");
    const readBack = window.localStorage.getItem(probe);
    window.localStorage.removeItem(probe);
    if (readBack !== "1") {
      persistentStorageBroken = true;
      return false;
    }
    return true;
  } catch {
    persistentStorageBroken = true;
    return false;
  }
}

function storeSet(key: string, value: string) {
  // Always keep the in-memory copy: it is what the current tab reads from if
  // persistence turns out to be unreliable mid-session.
  memoryStore.set(key, value);
  if (!localStorageUsable()) return;
  try {
    window.localStorage.setItem(key, value);
    if (window.localStorage.getItem(key) !== value) {
      // Write appeared to succeed but did not stick. Trust memory from here on.
      persistentStorageBroken = true;
    }
  } catch {
    persistentStorageBroken = true;
  }
}

function storeGet(key: string): string | null {
  if (localStorageUsable()) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) return value;
    } catch {
      persistentStorageBroken = true;
    }
  }
  return memoryStore.get(key) ?? null;
}

function storeRemove(key: string) {
  memoryStore.delete(key);
  if (!localStorageUsable()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    persistentStorageBroken = true;
  }
}

/**
 * True when the session will not survive a reload. Surfaced in the UI so the
 * limitation is stated rather than discovered by losing work.
 */
export function isSessionEphemeral(): boolean {
  return !localStorageUsable();
}

export function setToken(token: string) {
  storeSet(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return storeGet(TOKEN_KEY);
}

export function removeToken() {
  storeRemove(TOKEN_KEY);
  storeRemove(USER_KEY);
}

export function setUser(user: any) {
  storeSet(USER_KEY, JSON.stringify(user));
}

export function getUser(): any {
  const raw = storeGet(USER_KEY);
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
 * JWTs use base64**url** (`-` and `_`, no padding). `Buffer` is not guaranteed
 * in every browser build, so `atob` is preferred and the result re-decoded as
 * UTF-8 to keep non-ASCII names intact.
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
 * A rendering hint only — it decides whether to show the app shell instead of a
 * blank screen. It is not authorization: the API re-checks the token and the
 * account's role on every request, and a token can be locally unexpired but
 * rejected by the server (for example after the demonstration database is
 * reset). Callers must still handle a 401.
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
