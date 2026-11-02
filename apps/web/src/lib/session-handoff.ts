/**
 * In-tab session handoff from the sign-in page to the application shell.
 *
 * Why this exists
 * ---------------
 * The app is normally opened inside an iframe on a preview host. In that context
 * a browser may refuse *both* credential channels at once:
 *
 *   - `localStorage` is partitioned or blocked, so a token written by the sign-in
 *     page cannot be read back;
 *   - the httpOnly session cookie is a third-party cookie, so it is not stored or
 *     replayed either.
 *
 * Server logs confirmed exactly that combination: `POST /auth/login` returned
 * 200, and the very next request arrived with `has_auth_header=False` *and*
 * `session_cookie=no`. Credentials had been accepted and then could not be
 * presented by any persistent mechanism.
 *
 * What still works in that situation is module state in the current JavaScript
 * realm, which a client-side navigation preserves. So the sign-in page hands the
 * freshly issued token and user directly to the shell, which reads it
 * synchronously on mount instead of trying to recover a session from storage.
 *
 * Limits, stated plainly: this survives client-side navigation, not a full page
 * reload. It is a fallback for a restricted browser, not the primary mechanism —
 * `localStorage` and the cookie are both still used, and either one alone is
 * sufficient in an ordinary browser.
 */

interface Handoff {
  token: string;
  user: any;
  at: number;
}

let pending: Handoff | null = null;

/**
 * When the last successful sign-in completed. Survives `consumeHandoff`, because
 * its purpose is different: it lets the API client tell "this session is dead"
 * apart from "a request raced the sign-in that just established it".
 */
let lastSignInAt = 0;

/** How long a handoff stays valid. Sign-in to shell mount is milliseconds. */
const HANDOFF_TTL_MS = 60_000;

/** Offer the session to the shell. Called immediately after a successful sign-in. */
export function handoffSession(token: string | null | undefined, user: any): void {
  if (!user) return;
  lastSignInAt = Date.now();
  pending = { token: token || "", user, at: Date.now() };
}

/**
 * Take the offered session, if there is one.
 *
 * Consuming it is deliberate: a handoff is a one-shot transfer, and leaving it
 * around would let a later mount silently adopt credentials from a sign-in that
 * has already been superseded (including by a sign-out).
 */
export function consumeHandoff(): Handoff | null {
  if (!pending) return null;
  const taken = pending;
  pending = null;
  if (Date.now() - taken.at > HANDOFF_TTL_MS) return null;
  return taken;
}

/** Peek without consuming — used for diagnostics only. */
export function hasHandoff(): boolean {
  return !!pending && Date.now() - pending.at <= HANDOFF_TTL_MS;
}

/** Discard any pending handoff. Called on sign-out so it cannot be reused. */
export function clearHandoff(): void {
  pending = null;
}


/**
 * Seconds since the last successful sign-in, or null if there has not been one
 * in this page load.
 *
 * Used to suppress the API client's session-expired redirect during the moment a
 * session is being established. Without it, a request that left the page before
 * the token was stored can come back 401 and tear down a session that is in fact
 * perfectly valid — which presents to the user as "sign-in does nothing".
 */
export function secondsSinceSignIn(): number | null {
  if (!lastSignInAt) return null;
  return (Date.now() - lastSignInAt) / 1000;
}
