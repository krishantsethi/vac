"""FastAPI dependencies: database session, current user, role authorization."""

import hashlib
import os
import sys
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import SessionLocal, get_db
from .auth import decode_token, read_session_cookie, SESSION_COOKIE_NAME
from .models import User

security = HTTPBearer(auto_error=False)

#: Set AUTH_DIAGNOSTICS=1 to log *why* a request was treated as unauthenticated.
#:
#: "Not authenticated" is raised by require_user for four distinct causes, and
#: the response deliberately does not distinguish them (telling a caller which
#: part of a credential failed is useful to an attacker). That is right for the
#: wire and useless for debugging, so the distinction is written to the server
#: log instead. No secret material is logged: the token is represented only by
#: its length and a SHA-256 prefix, which cannot be reversed or replayed.
AUTH_DIAGNOSTICS = os.getenv("AUTH_DIAGNOSTICS", "1") not in ("0", "false", "False")


def _diag(reason: str, request: Request | None, token: str | None = None, extra: str = "") -> None:
    if not AUTH_DIAGNOSTICS:
        return
    parts = [f"[auth-diag] {reason}"]
    if token:
        digest = hashlib.sha256(token.encode("utf-8", "replace")).hexdigest()[:12]
        parts.append(f"token_len={len(token)} token_sha256_12={digest}")
    else:
        parts.append("token=absent")
    if request is not None:
        parts.append(f"path={request.url.path}")
        # Truncated at 200, not the ~110 a real Chrome UA needs: this suite's own
        # verification script appends a marker to a browser-like UA so its
        # deliberate 401 cases can be told apart from a genuine browser failing to
        # sign in. A shorter cut removed the marker and made the two
        # indistinguishable, which defeats the purpose of logging the UA at all.
        ua = request.headers.get("user-agent") or "-"
        parts.append(f"ua={ua[:200]}")
        parts.append(f"has_auth_header={'authorization' in request.headers}")
        parts.append(f"origin={request.headers.get('origin') or '-'}")
    if extra:
        parts.append(extra)
    print(" ".join(parts), file=sys.stderr, flush=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DbSession = Annotated[Session, Depends(get_db)]


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
    db: Session = Depends(get_db),
) -> User | None:
    """Resolve the calling identity from a bearer token or the session cookie.

    Credentials are tried in order of explicitness — a bearer header first, then
    the httpOnly session cookie — and a credential that fails to decode does not
    end the search. Two reasons:

    * A client that cannot read its own storage may still present a stale token
      it cached earlier while holding a perfectly valid cookie. Treating the
      stale header as authoritative would sign that user out for a bug they
      cannot see or fix.
    * The cookie is a credential the server itself issued. Falling back to it
      grants nothing the caller does not already legitimately hold.

    Every attempt is logged with the branch that rejected it, so the fallback is
    observable rather than silent. The response stays a single opaque 401: which
    credential failed, and why, is useful to an attacker and not to a client.
    """
    raw_header = request.headers.get("authorization")
    cookie_token = read_session_cookie(request)

    candidates: list[tuple[str, str]] = []
    if credentials is not None and credentials.credentials:
        candidates.append(("bearer", credentials.credentials))
    if cookie_token:
        candidates.append(("cookie", cookie_token))

    if not candidates:
        _diag("no_credentials", request,
              extra=(f"raw_auth_header={'yes' if raw_header else 'no'} "
                     f"session_cookie={'yes' if request.cookies.get(SESSION_COOKIE_NAME) else 'no'}"))
        return None

    for source, token in candidates:
        user_id = decode_token(token)
        if not user_id:
            _diag("token_decode_failed", request, token,
                  extra=f"source={source} cause=bad_signature|expired|malformed")
            continue

        user = db.get(User, user_id)
        if user is None:
            _diag("user_row_not_found", request, token, extra=f"source={source} sub={user_id}")
            continue
        if not user.is_active:
            _diag("user_inactive", request, token, extra=f"source={source} sub={user_id}")
            continue

        request.state.credential_source = source
        if source != "bearer" and len(candidates) > 1:
            # Worth knowing during development: an explicit header was present but
            # unusable, and the session was carried by the cookie instead.
            _diag("authenticated_via_fallback", request, token,
                  extra=f"source={source} rejected_first=bearer")
        return user

    return None


def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


def require_roles(*allowed_roles: str):
    def checker(user: User = Depends(require_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user
    return checker


def require_capability(capability, label: str = "this resource"):
    """Deny unless the caller's role holds the named capability.

    Capabilities are the frozen sets defined in :mod:`app.rbac`. Prefer this
    over an inline ``require_roles(...)`` list so authorization is expressed as
    an intent ("may write clinical records") and defined in exactly one place.

    The 403 explains what was refused without enumerating the roles that are
    allowed, so the response cannot be used to map the authorization matrix.
    """
    allowed = frozenset(capability)

    def checker(user: User = Depends(require_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your role is not authorized to access {label}.",
            )
        return user

    return checker
