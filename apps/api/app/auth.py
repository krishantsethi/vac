"""Authentication helpers: password hashing, JWT creation/validation."""

import os
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

SECRET_KEY = os.getenv("VAULT_SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "43200"))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode = {"sub": subject, "iat": int(now.timestamp()), "exp": int(expire.timestamp())}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


# --------------------------------------------------------------------------- #
# Session cookie
#
# The bearer token in localStorage is the primary session mechanism, but it has
# a failure mode that is invisible and total: browsers partition or block
# localStorage in cross-site frames, in private mode, and under third-party
# storage restrictions. When that happens a write can succeed while the next
# read returns null, so the client holds a valid token it cannot send.
#
# An httpOnly cookie removes the dependency on script-accessible storage. The
# browser attaches it automatically, it survives a page refresh, and JavaScript
# cannot read it — which makes it strictly harder to exfiltrate than a token in
# localStorage. The server accepts either credential, bearer first, so existing
# API clients and the whole test suite keep working unchanged.
# --------------------------------------------------------------------------- #

SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "vaxbridge_session")
SESSION_COOKIE_MAX_AGE = ACCESS_TOKEN_EXPIRE_MINUTES * 60

#: Default "none", not "lax".
#:
#: This app is normally opened inside an iframe on a different registrable domain
#: from the one serving the preview. Requests the page makes to its own API are
#: then *cross-site* in the SameSite sense, because the site that matters is the
#: top-level document's, not the iframe's. `Lax` cookies are sent only on
#: top-level navigations, so a `Lax` session cookie would be silently dropped
#: from every fetch and the user would appear to be signed out immediately after
#: a successful sign-in. `None` sends it in that context.
#:
#: `None` is only honoured by browsers together with `Secure`, hence the default
#: below. Set SESSION_COOKIE_SAMESITE=lax and SESSION_COOKIE_SECURE=0 for a plain
#: HTTP deployment that is not framed by another site.
SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "none").strip().lower()

#: Default true, because SameSite=None requires it and because a session cookie
#: should never be readable over a plaintext connection. Browsers also treat
#: http://localhost as trustworthy, so local development keeps working.
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "true")


def _truthy(setting: str) -> bool:
    return setting.strip().lower() in ("1", "true", "yes", "on")


def cookie_secure_flag(request=None) -> bool:
    """Decide whether the session cookie should be marked Secure.

    Honours an explicit setting, and otherwise prefers the forwarding headers a
    reverse proxy sets over `request.url.scheme`, which reports the
    proxy-to-API hop rather than the browser-to-proxy hop. Note that the Next.js
    rewrite proxy used here does *not* forward X-Forwarded-Proto, so auto
    detection cannot see the browser's real scheme; the default is therefore
    explicit rather than derived.
    """
    setting = SESSION_COOKIE_SECURE.strip().lower()
    if setting in ("1", "true", "yes", "on"):
        return True
    if setting in ("0", "false", "no", "off"):
        return False
    if request is None:
        return False
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if proto:
        return proto == "https"
    return getattr(request.url, "scheme", "") == "https"


def set_session_cookie(response, token: str, request=None) -> None:
    """Attach the session cookie to an outgoing response."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_COOKIE_MAX_AGE,
        path="/",
        httponly=True,
        secure=cookie_secure_flag(request),
        samesite=SESSION_COOKIE_SAMESITE,
    )


def clear_session_cookie(response, request=None) -> None:
    """Expire the session cookie. Max-age 0 removes it rather than blanking it."""
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=cookie_secure_flag(request),
        samesite=SESSION_COOKIE_SAMESITE,
    )


def read_session_cookie(request) -> str | None:
    """Read the session token from the request cookie, if present."""
    try:
        value = request.cookies.get(SESSION_COOKIE_NAME)
    except Exception:
        return None
    return value or None
