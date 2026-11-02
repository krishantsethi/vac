"""VAXBRIDGE AI — FastAPI backend.

Versioned REST API under /api/v1 with server-side role-based authorization,
deterministic scheduling, demo-mode OCR, record reconciliation, outreach,
inventory, appointments, analytics, and audit logging.
"""

import hashlib
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Request, UploadFile, File, Form, Query
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import case, func, or_

from .database import engine, Base, SessionLocal, get_db
from .auth import (
    hash_password,
    verify_password,
    create_access_token,
    decode_token,
    set_session_cookie,
    clear_session_cookie,
    SESSION_COOKIE_NAME,
)
from .deps import require_user, require_roles, require_capability, DbSession
from . import models, schemas
from . import rbac
from .inventory import available_quantity, is_expired, is_expiring_soon, is_low_stock
from .scheduling.engine import calculate_recommendations
from .seed import seed_database
from .prioritization import (
    PriorityFactors,
    build_explanation_payload,
    calculate_priority,
    score_due_date_urgency,
    score_prior_followup,
    score_record_uncertainty,
    score_service_opportunity,
)
from .reconciliation import (
    date_ambiguity,
    detect_event_issues,
    detect_identity_candidates,
    map_vaccine_name,
    parse_date_flexible,
    resolve_vaccine_code,
)
from .records import build_digital_record, verify_signed_qr_payload
from .offline import SyncError, process_sync_batch

# --------------------------------------------------------------------------- #
# App setup
# --------------------------------------------------------------------------- #

logger = logging.getLogger("vaxbridge")

app = FastAPI(
    title="VAXBRIDGE AI",
    description="AI-powered vaccination management, record reconciliation, and public-health analytics (prototype).",
    version="1.0.0",
)

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #

# Simple in-process sliding-window limiter. Suitable for a single-instance
# prototype; a production deployment should use a shared store (e.g. Redis) so
# limits hold across replicas.
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_DEFAULT = int(os.getenv("RATE_LIMIT_DEFAULT", "600"))
#: 60 rather than 20. This service normally sits behind a reverse proxy that
#: presents every request from one loopback address, so an IP-keyed bucket is
#: shared by everyone reaching the app through it. At 20/minute a handful of
#: sign-in retries by one person could lock out every other user of the
#: instance. 60/minute still makes online password guessing impractical while
#: not punishing legitimate use; the per-account protection that would let this
#: be lower again is not implemented here and is listed as a known gap.
RATE_LIMIT_AUTH = int(os.getenv("RATE_LIMIT_AUTH", "60"))
_rate_buckets: dict[str, list[float]] = {}

AUTH_PATHS = ("/api/v1/auth/login", "/api/v1/auth/register")


#: Set when the deployment sits behind a proxy whose addresses should be trusted
#: for client identification. Off by default: honouring X-Forwarded-For from an
#: untrusted peer would let any caller rotate the header and evade the limit.
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "1") not in ("0", "false", "False")


def _client_ip(request: Request) -> str:
    """Best available identification of the calling client.

    Behind a reverse proxy every connection comes from the proxy's loopback
    address, which would collapse all users into a single rate-limit bucket.
    The leftmost X-Forwarded-For entry is the original client. This is only
    honoured when TRUST_PROXY_HEADERS is on, because otherwise a caller could
    invent the header and get a fresh bucket on every request.
    """
    if TRUST_PROXY_HEADERS:
        forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)

    client_ip = _client_ip(request)
    bucket_key = f"{'auth' if path in AUTH_PATHS else 'default'}:{client_ip}"
    limit = RATE_LIMIT_AUTH if path in AUTH_PATHS else RATE_LIMIT_DEFAULT

    now_ts = time.monotonic()
    window = [t for t in _rate_buckets.get(bucket_key, []) if now_ts - t < RATE_LIMIT_WINDOW_SECONDS]
    if len(window) >= limit:
        _rate_buckets[bucket_key] = window
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please retry shortly."},
            headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
        )
    window.append(now_ts)
    _rate_buckets[bucket_key] = window
    return await call_next(request)


@app.middleware("http")
async def no_store_api_middleware(request: Request, call_next):
    """Keep API responses out of every cache between here and the user.

    These responses carry immunisation records, credentials and audit history.
    A browser or intermediary that replays a cached GET would show one person's
    data after another has signed in on the same device, and a cached 401 would
    look like a live authentication failure. `no-store` forbids that outright;
    `private` allows a browser to keep it only for the signed-in user.
    """
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, private, max-age=0, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


@app.middleware("http")
async def audit_middleware(request: Request, call_next):
    request.state.db = SessionLocal()
    try:
        response = await call_next(request)
        return response
    finally:
        request.state.db.close()


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    _ensure_seed_data()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

#: Development diagnostics for the sign-in path. Set AUTH_DIAGNOSTICS=0 to silence.
#:
#: "Invalid credentials" is deliberately identical for an unknown email and a
#: wrong password — telling a caller which one failed lets them enumerate
#: accounts. That is right for the response and useless for debugging, so the
#: distinction is written to the server log instead. Only the email and the
#: failure stage are recorded: never a password, a hash, or a token.
AUTH_DIAGNOSTICS = os.getenv("AUTH_DIAGNOSTICS", "1") not in ("0", "false", "False")


def _diag_login(request: Request, stage: str, email: str = "", user_id: str = "") -> None:
    """Record why a sign-in attempt did not produce a session."""
    if not AUTH_DIAGNOSTICS:
        return
    parts = [f"[auth-diag] login_failed stage={stage}"]
    if email:
        parts.append(f"email={email}")
    if user_id:
        parts.append(f"user_id={user_id}")
    if request is not None:
        ua = request.headers.get("user-agent") or "-"
        parts.append(f"ua={ua[:200]}")
        parts.append(f"origin={request.headers.get('origin') or '-'}")
    print(" ".join(parts), file=sys.stderr, flush=True)


def _parse_audit_details(raw):
    """Decode a stored audit payload into a structured value.

    Returns the parsed JSON when the column holds valid JSON, the original string
    when it does not (older rows or free-text notes), and None when empty. Never
    raises: an unparseable audit entry must not make the whole log unreadable.
    """
    if raw is None or raw == "":
        return None
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return raw


def _audit(db: Session, user: Optional[models.User], action: str, entity_type: str, entity_id: Optional[str], details: Any, request: Optional[Request] = None):
    ip = None
    if request is not None and request.client is not None:
        ip = request.client.host
    ev = models.AuditEvent(
        user_id=user.id if user else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=json.dumps(details) if details is not None else None,
        ip_address=ip,
    )
    db.add(ev)
    db.commit()


def _get_patient_by_display_id(db: Session, patient_id: str) -> Optional[models.Patient]:
    """Resolve a patient from either identifier form.

    Clients legitimately hold both: the display id (``VAX-0001``) appears in the
    UI and in signed records, while the internal UUID appears in list payloads.
    Resolution only decides *which* row is meant — it never grants access. Every
    caller still passes the result through :func:`_check_patient_access`.
    """
    if not patient_id:
        return None
    found = db.query(models.Patient).filter_by(patient_id=patient_id).first()
    if found is not None:
        return found
    try:
        parsed = uuid.UUID(patient_id)
    except (ValueError, AttributeError, TypeError):
        return None
    return db.get(models.Patient, str(parsed))


def _check_patient_access(db: Session, user: models.User, patient: models.Patient) -> models.Patient:
    """Return ``patient`` if ``user`` may access it, otherwise raise 403.

    Authorization is decided by :mod:`app.rbac`. Note that ``system_admin`` is
    deliberately absent from ``rbac.CLINICAL_READ``: administering the platform
    does not grant access to patient health data.
    """
    if user.role in rbac.CLINICAL_READ:
        return patient
    if user.role == "caregiver":
        link = db.query(models.CaregiverRelationship).filter_by(
            caregiver_user_id=user.id, patient_id=patient.id, authorized=True
        ).first()
        if not link:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this patient")
        return patient
    if user.role == "patient":
        if patient.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this patient")
        return patient
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Your role does not have access to individual patient records.",
    )


def _check_clinical_write(db: Session, user: models.User, patient: models.Patient) -> models.Patient:
    """Access check for endpoints that *modify* a patient's clinical record.

    Stricter than read access: population-oversight roles may read but not edit
    individual clinical records (separation of duties).
    """
    _check_patient_access(db, user, patient)
    if user.role not in rbac.CLINICAL_WRITE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role may view this record but not modify clinical data on it.",
        )
    return patient


def _require_patient_access(db: Session, user: models.User, patient_id: str):
    patient = _get_patient_by_display_id(db, patient_id)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return _check_patient_access(db, user, patient)


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _paginate(query, page: int, page_size: int):
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return items, total, page, page_size


def _persist_recommendations(db: Session, patient: models.Patient) -> list:
    """Recalculate and store recommendations for one patient.

    Replaces the previous set so the stored state always reflects the latest
    verified history and the schedule version that produced it.
    """
    recs = calculate_recommendations(db, patient)
    db.query(models.Recommendation).filter_by(patient_id=patient.id).delete()
    db.flush()
    out = []
    for r in recs:
        rec = models.Recommendation(
            patient_id=patient.id,
            vaccine_code=r["vaccine_code"],
            rule_id=r.get("rule_id"),
            status=r["status"],
            explanation=r["explanation"],
            schedule_version_id=r.get("schedule_version_id"),
            due_date=r.get("due_date"),
        )
        db.add(rec)
        db.flush()
        out.append(rec)
    return out

# --------------------------------------------------------------------------- #
# Seed data
# --------------------------------------------------------------------------- #

def _ensure_seed_data():
    """Seed the demonstration database exactly once, deterministically."""
    db = SessionLocal()
    try:
        if db.query(models.User).count() > 0:
            return
        seed_database(db)
        logger.info("Seeded demonstration database (synthetic data only).")
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #

@app.post("/api/v1/auth/register", response_model=schemas.Token)
def register(payload: schemas.UserRegister, response: Response, db: DbSession, request: Request):
    """Public self-registration.

    Only ``patient`` and ``caregiver`` may be claimed here — the two roles whose
    reach is limited to the person's own record or to dependents explicitly
    authorized for them. Every other role carries population-wide clinical or
    administrative access and must be provisioned by an administrator through
    POST /api/v1/users.

    This guard is the server-side control; restricting the options in the
    registration form would not be one. Before it existed, posting
    ``{"role": "clinic_admin"}`` to this endpoint returned a token with
    read/write access to every patient in the database.
    """
    requested_role = (payload.role or "patient").strip()
    if requested_role not in rbac.ALL_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown role '{requested_role}'. Known roles: {', '.join(sorted(rbac.ALL_ROLES))}",
        )
    if requested_role not in rbac.SELF_REGISTRATION_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"The '{requested_role}' role cannot be self-registered because it grants access "
                "beyond your own record. Ask a clinic or system administrator to create the account."
            ),
        )
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = models.User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=requested_role,
        phone=payload.phone,
        language=payload.language,
        is_active=True,
        is_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id)
    set_session_cookie(response, token, request)
    _audit(db, user, "register", "users", user.id, {"email": user.email}, request)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": schemas.UserOut.model_validate(user).model_dump(mode="json"),
    }


@app.post("/api/v1/auth/logout")
def logout(response: Response, db: DbSession, request: Request, user: models.User = Depends(require_user)):
    """End the session.

    Clears the httpOnly cookie. A stateless JWT cannot be revoked server-side
    without a deny-list, so the token itself stays valid until it expires — the
    honest position is to clear the credential the browser will present and to
    say so, rather than to imply the token has been invalidated everywhere.
    """
    clear_session_cookie(response, request)
    _audit(db, user, "logout", "users", user.id, {"email": user.email}, request)
    return {"detail": "Signed out on this browser. The issued token expires on its own schedule."}


@app.post("/api/v1/auth/login", response_model=schemas.Token)
def login(payload: schemas.UserLogin, response: Response, db: DbSession, request: Request):
    """Verify credentials and establish a session.

    Returns the token *and* the authenticated user, and also sets an httpOnly
    session cookie. Either credential is accepted on subsequent requests, so the
    session does not depend on the client being able to store and replay the
    token in JavaScript-accessible storage.

    The same 401 is returned for an unknown email and a wrong password: which of
    the two failed is useful to an attacker enumerating accounts and is therefore
    recorded in the server log rather than in the response.
    """
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user:
        _diag_login(request, "account_not_found", email=payload.email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not verify_password(payload.password, user.password_hash):
        _diag_login(request, "invalid_password", email=payload.email, user_id=user.id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        _diag_login(request, "account_disabled", email=payload.email, user_id=user.id)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    token = create_access_token(user.id)
    if not token:
        _diag_login(request, "token_generation_failed", email=payload.email, user_id=user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Credentials were accepted but a session could not be created.",
        )
    set_session_cookie(response, token, request)
    _audit(db, user, "login", "users", user.id, {"email": user.email}, request)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": schemas.UserOut.model_validate(user).model_dump(mode="json"),
    }


@app.get("/api/v1/auth/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(require_user)):
    return user


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #

@app.post("/api/v1/users", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: schemas.UserCreate, db: DbSession, user: models.User = Depends(require_capability(rbac.USER_MANAGE, "provision user accounts")), request: Request = None):
    """Create an account, including staff and administrative roles.

    This is the only path to a clinical or administrative account. Public
    self-registration is limited to patient and caregiver, so the ability to
    grant population-wide access stays with roles that already hold USER_MANAGE.
    """
    role = (payload.role or "").strip()
    if role not in rbac.ALL_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown role '{role}'. Known roles: {', '.join(sorted(rbac.ALL_ROLES))}",
        )
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    created = models.User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=role,
        phone=payload.phone,
        language=payload.language,
        is_active=True,
        is_verified=True,
    )
    db.add(created)
    db.commit()
    db.refresh(created)
    _audit(db, user, "create", "users", created.id,
           {"email": created.email, "role": role, "provisioned_by": user.email}, request)
    return created


@app.get("/api/v1/users/caregivers", response_model=List[dict])
def list_caregiver_accounts(db: DbSession, user: models.User = Depends(require_capability(rbac.CAREGIVER_MANAGE, "list caregiver accounts"))):
    """Caregiver accounts only, with the minimum fields needed to authorize one.

    Deliberately narrower than GET /api/v1/users: a role that may authorize a
    dependent must be able to name the caregiver, without being handed the whole
    account directory.
    """
    rows = (
        db.query(models.User)
        .filter(models.User.role == "caregiver", models.User.is_active.is_(True))
        .order_by(models.User.full_name)
        .all()
    )
    return [
        {
            "id": row.id,
            "full_name": row.full_name,
            "email": row.email,
            "phone": row.phone,
            "language": getattr(row, "language", None),
        }
        for row in rows
    ]


@app.get("/api/v1/users", response_model=List[schemas.UserOut])
def list_users(db: DbSession, user: models.User = Depends(require_capability(rbac.USER_MANAGE, "list user accounts")), request: Request = None):
    q = db.query(models.User)
    items, total, page, page_size = _paginate(q, 1, 100)
    _audit(db, user, "list", "users", None, {"count": len(items)}, request)
    return items


@app.get("/api/v1/users/{user_id}", response_model=schemas.UserOut)
def get_user(user_id: str, db: DbSession, user: models.User = Depends(require_user)):
    # A user may always read their own account; anything else needs user management.
    if user.id != user_id and user.role not in rbac.USER_MANAGE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return u


# Fields a user may change on their own account. Account status is not one of
# them: if a deactivated user could re-activate themselves, deactivation would
# not be a real control.
SELF_SERVICE_FIELDS = frozenset({"full_name", "phone", "language"})

# Appointment statuses a patient or authorized caregiver may set on their own
# appointment. "confirmed" and "completed" are clinic attestations and are
# deliberately excluded.
SELF_SERVICE_APPOINTMENT_STATUSES = frozenset({"cancelled", "requested"})


@app.patch("/api/v1/users/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: str, payload: schemas.UserUpdate, db: DbSession, user: models.User = Depends(require_user), request: Request = None):
    updates = payload.model_dump(exclude_unset=True)
    is_self = user.id == user_id
    if not is_self and user.role not in rbac.USER_MANAGE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if is_self:
        disallowed = set(updates) - SELF_SERVICE_FIELDS
        if disallowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You cannot change your own: {', '.join(sorted(disallowed))}. "
                       "Ask an administrator.",
            )
    elif "is_active" in updates and u.role == "system_admin" and user.role != "system_admin":
        # A clinic administrator must not be able to disable a system administrator.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a system administrator can change another system administrator's status.",
        )

    for field, value in updates.items():
        setattr(u, field, value)
    db.commit()
    db.refresh(u)
    _audit(db, user, "update", "users", user_id, updates, request)
    return u


# --------------------------------------------------------------------------- #
# Roles
# --------------------------------------------------------------------------- #

@app.get("/api/v1/roles", response_model=List[schemas.RoleOut])
def list_roles(db: DbSession, user: models.User = Depends(require_capability(rbac.USER_MANAGE, "view role definitions"))):
    return db.query(models.Role).all()

# --------------------------------------------------------------------------- #
# Patients
# --------------------------------------------------------------------------- #

#: Ordering used to collapse a patient's many recommendations into one status.
#: An uncertain record outranks everything else: until it is resolved the rest
#: of the schedule cannot be trusted, so it is the first thing to act on.
STATUS_PRIORITY = (
    "verification_required",
    "potentially_overdue",
    "due",
    "upcoming",
    "up_to_date",
)

#: Statuses that mean "somebody should do something about this patient".
ACTIONABLE_STATUSES = ("verification_required", "potentially_overdue", "due")

# Outreach lifecycle. Kept explicit so PATCH cannot introduce a status the
# analytics buckets do not recognise.
OUTREACH_STATUSES = frozenset({"open", "in_progress", "escalated", "resolved"})

# Outcomes a worker can record for a contact attempt. "refused" and "migrated"
# are legitimate outcomes, never penalties: they change how follow-up happens,
# not whether care is offered.
OUTREACH_OUTCOMES = frozenset({
    "contacted",
    "attempted",
    "unreachable",
    "appointment_scheduled",
    "dose_administered",
    "refused",
    "migrated",
    "deceased",
})


def _patient_status_summaries(db: Session, patient_ids: list) -> dict:
    """Per-patient rollup of stored recommendations.

    Two grouped queries for the whole page rather than one per patient, so the
    list endpoint stays cheap as the registry grows.
    """
    if not patient_ids:
        return {}
    rows = (
        db.query(
            models.Recommendation.patient_id,
            models.Recommendation.status,
            func.count(models.Recommendation.id),
        )
        .filter(models.Recommendation.patient_id.in_(patient_ids))
        .group_by(models.Recommendation.patient_id, models.Recommendation.status)
        .all()
    )
    per_patient: dict[str, dict[str, int]] = {}
    for pid, rec_status, count in rows:
        per_patient.setdefault(pid, {})[rec_status] = count

    unverified_rows = (
        db.query(models.VaccinationEvent.patient_id, func.count(models.VaccinationEvent.id))
        .filter(
            models.VaccinationEvent.patient_id.in_(patient_ids),
            models.VaccinationEvent.is_verified == False,  # noqa: E712
        )
        .group_by(models.VaccinationEvent.patient_id)
        .all()
    )
    unverified = {pid: count for pid, count in unverified_rows}

    out = {}
    for pid in patient_ids:
        counts = per_patient.get(pid, {})
        present = [s for s in STATUS_PRIORITY if counts.get(s)]
        out[pid] = {
            "record_status": present[0] if present else "no_recommendations",
            "actionable_count": sum(counts.get(s, 0) for s in ACTIONABLE_STATUSES),
            "upcoming_count": counts.get("upcoming", 0),
            "up_to_date_count": counts.get("up_to_date", 0),
            "unverified_entries": unverified.get(pid, 0),
            "recommendation_total": sum(counts.values()),
        }
    return out


@app.get("/api/v1/patients", response_model=dict)
def list_patients(
    db: DbSession,
    user: models.User = Depends(require_user),
    request: Request = None,
    search: Optional[str] = None,
    service_area: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    include_status: bool = False,
):
    """List patients the caller is authorized for.

    ``include_status`` adds a per-patient rollup of stored recommendations so a
    list view can show real status instead of asking for every patient's
    schedule separately.
    """
    q = _scope_to_authorized_patients(db.query(models.Patient), user)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(models.Patient.first_name.ilike(like), models.Patient.last_name.ilike(like), models.Patient.patient_id.ilike(like)))
    if service_area:
        q = q.filter(models.Patient.service_area == service_area)
    q = q.order_by(models.Patient.created_at.desc())
    items, total, page, page_size = _paginate(q, page, page_size)
    _audit(db, user, "list", "patients", None, {"count": len(items)}, request)
    items_out = [schemas.PatientOut.model_validate(i).model_dump(mode="json") for i in items]
    if include_status:
        summaries = _patient_status_summaries(db, [i.id for i in items])
        for row in items_out:
            row["status_summary"] = summaries.get(row["id"], {
                "record_status": "no_recommendations",
                "actionable_count": 0,
                "upcoming_count": 0,
                "up_to_date_count": 0,
                "unverified_entries": 0,
                "recommendation_total": 0,
            })
    return {"items": items_out, "total": total, "page": page, "page_size": page_size}


@app.get("/api/v1/patients/meta/service-areas", response_model=dict)
def list_service_areas(db: DbSession, user: models.User = Depends(require_user)):
    """Distinct service areas visible to the caller, for filter dropdowns.

    Scoped the same way as the patient list, so the filter cannot be used to
    enumerate areas the caller has no patients in.
    """
    q = _scope_to_authorized_patients(
        db.query(models.Patient.service_area, func.count(models.Patient.id)), user
    ).group_by(models.Patient.service_area)
    rows = q.all()
    areas = sorted(
        [{"service_area": area or "Unspecified", "patient_count": count} for area, count in rows if area],
        key=lambda r: r["service_area"],
    )
    return {"items": areas, "total": len(areas)}


@app.get("/api/v1/patients/{patient_id}", response_model=schemas.PatientOut)
def get_patient(patient_id: str, db: DbSession, user: models.User = Depends(require_user), request: Request = None):
    p = _require_patient_access(db, user, patient_id)
    _audit(db, user, "get", "patients", patient_id, None, request)
    return p


@app.post("/api/v1/patients", response_model=schemas.PatientOut)
def create_patient(payload: schemas.PatientCreate, db: DbSession, user: models.User = Depends(require_capability(rbac.PATIENT_MANAGEMENT, "create patient records")), request: Request = None):
    pid = payload.patient_id or f"VAX-{int(datetime.now().timestamp())}"
    p = models.Patient(
        patient_id=pid,
        first_name=payload.first_name,
        last_name=payload.last_name,
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        phone=payload.phone,
        address=payload.address,
        service_area=payload.service_area,
        created_by=user.id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    _audit(db, user, "create", "patients", p.id, {"patient_id": p.patient_id}, request)
    return p


@app.patch("/api/v1/patients/{patient_id}", response_model=schemas.PatientOut)
def update_patient(patient_id: str, payload: schemas.PatientUpdate, db: DbSession, user: models.User = Depends(require_capability(rbac.PATIENT_MANAGEMENT, "edit patient records")), request: Request = None):
    p = _require_patient_access(db, user, patient_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    _audit(db, user, "update", "patients", patient_id, payload.model_dump(exclude_unset=True), request)
    return p


# --------------------------------------------------------------------------- #
# Cross-patient record views
#
# These are scoped *server-side* using exactly the same rule as the patient
# list, so a caller can never widen their own reach by asking for events or
# documents directly. Hiding a link in the UI is not access control.
# --------------------------------------------------------------------------- #

def _scope_to_authorized_patients(q, user: models.User):
    """Restrict a query that joins ``patients`` to rows the caller may access.

    Delegates to :func:`app.rbac.scope_patient_query`, which fails closed for
    roles that have no patient access at all.
    """
    return rbac.scope_patient_query(q, user, models.Patient, models.CaregiverRelationship)


def _patient_brief(p: models.Patient) -> dict:
    return {
        "patient_id": p.patient_id,
        "first_name": p.first_name,
        "last_name": p.last_name,
        "date_of_birth": p.date_of_birth.isoformat() if p.date_of_birth else None,
        "service_area": p.service_area,
    }


@app.get("/api/v1/vaccinations", response_model=dict)
def list_vaccination_events(
    db: DbSession,
    user: models.User = Depends(require_user),
    request: Request = None,
    patient_id: Optional[str] = None,
    verification: Optional[str] = None,
    vaccine_code: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
):
    """Vaccination events across every patient the caller is authorized for."""
    q = _scope_to_authorized_patients(
        db.query(models.VaccinationEvent, models.Patient).join(
            models.Patient, models.Patient.id == models.VaccinationEvent.patient_id
        ),
        user,
    )
    if patient_id:
        q = q.filter(models.Patient.patient_id == patient_id)
    if verification == "verified":
        q = q.filter(models.VaccinationEvent.is_verified == True)  # noqa: E712
    elif verification == "unverified":
        q = q.filter(models.VaccinationEvent.is_verified == False)  # noqa: E712
    if vaccine_code:
        q = q.filter(models.VaccinationEvent.vaccine_code == vaccine_code)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.Patient.first_name.ilike(like),
            models.Patient.last_name.ilike(like),
            models.Patient.patient_id.ilike(like),
            models.VaccinationEvent.vaccine_name.ilike(like),
            models.VaccinationEvent.batch_number.ilike(like),
        ))
    q = q.order_by(models.VaccinationEvent.administered_at.desc(), models.VaccinationEvent.created_at.desc())
    rows, total, page, page_size = _paginate(q, page, page_size)
    items = []
    for event, patient in rows:
        row = schemas.VaccinationEventOut.model_validate(event).model_dump(mode="json")
        row["patient"] = _patient_brief(patient)
        items.append(row)
    _audit(db, user, "list", "vaccinations", None, {"count": len(items), "total": total}, request)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@app.get("/api/v1/documents", response_model=dict)
def list_documents(
    db: DbSession,
    user: models.User = Depends(require_user),
    request: Request = None,
    patient_id: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
):
    """Uploaded documents across every patient the caller is authorized for."""
    q = _scope_to_authorized_patients(
        db.query(models.Document, models.Patient).join(
            models.Patient, models.Patient.id == models.Document.patient_id
        ),
        user,
    )
    if patient_id:
        q = q.filter(models.Patient.patient_id == patient_id)
    if status_filter:
        q = q.filter(models.Document.status == status_filter)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.Patient.first_name.ilike(like),
            models.Patient.last_name.ilike(like),
            models.Patient.patient_id.ilike(like),
            models.Document.file_name.ilike(like),
        ))
    q = q.order_by(models.Document.created_at.desc())
    rows, total, page, page_size = _paginate(q, page, page_size)
    items = []
    for doc, patient in rows:
        row = schemas.DocumentOut.model_validate(doc).model_dump(mode="json")
        row["patient"] = _patient_brief(patient)
        items.append(row)
    _audit(db, user, "list", "documents", None, {"count": len(items), "total": total}, request)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


# --------------------------------------------------------------------------- #
# Caregiver relationships
# --------------------------------------------------------------------------- #

def _caregiver_link_payload(db, link: models.CaregiverRelationship, viewer: models.User) -> dict:
    """Serialize a caregiver link, resolving the names the viewer is allowed to see.

    A patient is told who may access their record — that is their right — but the
    caregiver's email address is withheld unless the viewer manages these links.
    """
    caregiver = db.get(models.User, link.caregiver_user_id)
    patient = db.get(models.Patient, link.patient_id)
    manages = viewer.role in rbac.CAREGIVER_MANAGE
    return {
        "id": link.id,
        "caregiver_user_id": link.caregiver_user_id,
        "patient_id": link.patient_id,
        "relationship_type": link.relationship_type,
        "authorized": link.authorized,
        "created_at": link.created_at,
        "caregiver_name": caregiver.full_name if caregiver else None,
        "caregiver_email": caregiver.email if (caregiver and manages) else None,
        "patient_display_id": patient.patient_id if patient else None,
        "patient_name": f"{patient.first_name} {patient.last_name}".strip() if patient else None,
    }


@app.post("/api/v1/caregivers", response_model=schemas.CaregiverLinkOut)
def create_caregiver_link(payload: schemas.CaregiverLinkCreate, db: DbSession, user: models.User = Depends(require_capability(rbac.CAREGIVER_MANAGE, "create caregiver links")), request: Request = None):
    patient = db.get(models.Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    caregiver = db.get(models.User, payload.caregiver_user_id)
    if not caregiver:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caregiver account not found")
    if caregiver.role != "caregiver":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account {caregiver.email} has role '{caregiver.role}', not 'caregiver'",
        )
    existing = (
        db.query(models.CaregiverRelationship)
        .filter_by(caregiver_user_id=payload.caregiver_user_id, patient_id=payload.patient_id)
        .first()
    )
    if existing:
        # Never silently overwrite an existing authorization decision.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This caregiver is already linked to this patient "
                f"({'authorized' if existing.authorized else 'not authorized'}). "
                "Update the existing link instead of creating a second one."
            ),
        )
    link = models.CaregiverRelationship(
        caregiver_user_id=payload.caregiver_user_id,
        patient_id=payload.patient_id,
        relationship_type=payload.relationship_type,
        authorized=payload.authorized,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    _audit(
        db, user, "create", "caregiver_relationships", link.id,
        {"patient_id": payload.patient_id, "caregiver_user_id": payload.caregiver_user_id,
         "relationship_type": payload.relationship_type, "authorized": payload.authorized},
        request,
    )
    return _caregiver_link_payload(db, link, user)


@app.get("/api/v1/caregivers", response_model=List[schemas.CaregiverLinkOut])
def list_caregiver_links(db: DbSession, user: models.User = Depends(require_user)):
    """Caregiver links visible to the caller.

    Managers see all links. A caregiver sees their own. A patient sees the links
    that point at their record, so they always know who can access it. Everyone
    else sees nothing — this fails closed rather than returning the full table.
    """
    if user.role in rbac.CAREGIVER_MANAGE:
        links = db.query(models.CaregiverRelationship).all()
    elif user.role == "caregiver":
        links = db.query(models.CaregiverRelationship).filter_by(caregiver_user_id=user.id).all()
    elif user.role == "patient":
        p = db.query(models.Patient).filter_by(user_id=user.id).first()
        links = (
            db.query(models.CaregiverRelationship).filter_by(patient_id=p.id).all() if p else []
        )
    else:
        links = []
    return [_caregiver_link_payload(db, link, user) for link in links]


@app.patch("/api/v1/caregivers/{link_id}", response_model=schemas.CaregiverLinkOut)
def update_caregiver_link(link_id: str, payload: schemas.CaregiverLinkCreate, db: DbSession, user: models.User = Depends(require_capability(rbac.CAREGIVER_MANAGE, "update caregiver links")), request: Request = None):
    link = db.get(models.CaregiverRelationship, link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    if not db.get(models.Patient, payload.patient_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    caregiver = db.get(models.User, payload.caregiver_user_id)
    if not caregiver:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caregiver account not found")
    if caregiver.role != "caregiver":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account {caregiver.email} has role '{caregiver.role}', not 'caregiver'",
        )
    before = {"authorized": link.authorized, "relationship_type": link.relationship_type,
              "caregiver_user_id": link.caregiver_user_id, "patient_id": link.patient_id}
    link.caregiver_user_id = payload.caregiver_user_id
    link.patient_id = payload.patient_id
    link.relationship_type = payload.relationship_type
    link.authorized = payload.authorized
    db.commit()
    db.refresh(link)
    _audit(db, user, "update", "caregiver_relationships", link_id,
           {"before": before, "after": payload.model_dump()}, request)
    return _caregiver_link_payload(db, link, user)


# --------------------------------------------------------------------------- #
# Vaccines
# --------------------------------------------------------------------------- #

@app.get("/api/v1/vaccines", response_model=List[schemas.VaccineOut])
def list_vaccines(db: DbSession, user: models.User = Depends(require_user)):
    return db.query(models.Vaccine).order_by(models.Vaccine.code).all()


# --------------------------------------------------------------------------- #
# Schedule
# --------------------------------------------------------------------------- #

@app.get("/api/v1/schedules", response_model=List[schemas.ScheduleVersionOut])
def list_schedules(db: DbSession, user: models.User = Depends(require_user)):
    return db.query(models.ScheduleVersion).order_by(models.ScheduleVersion.created_at.desc()).all()


@app.get("/api/v1/schedules/{schedule_id}/rules", response_model=List[schemas.ScheduleRuleOut])
def list_schedule_rules(schedule_id: str, db: DbSession, user: models.User = Depends(require_user)):
    return db.query(models.ScheduleRule).filter_by(schedule_version_id=schedule_id).order_by(models.ScheduleRule.rule_id).all()

# --------------------------------------------------------------------------- #
# Vaccination events
# --------------------------------------------------------------------------- #

@app.get("/api/v1/patients/{patient_id}/vaccinations", response_model=List[schemas.VaccinationEventOut])
def list_vaccinations(patient_id: str, db: DbSession, user: models.User = Depends(require_user)):
    patient = _require_patient_access(db, user, patient_id)
    return db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).order_by(models.VaccinationEvent.administered_at).all()


@app.post("/api/v1/patients/{patient_id}/vaccinations", response_model=schemas.VaccinationEventOut)
def create_vaccination(patient_id: str, payload: schemas.VaccinationEventCreate, db: DbSession, user: models.User = Depends(require_capability(rbac.CLINICAL_WRITE, "record vaccinations")), request: Request = None):
    patient = _require_patient_access(db, user, patient_id)
    ev = models.VaccinationEvent(
        patient_id=patient.id,
        vaccine_code=payload.vaccine_code,
        vaccine_name=payload.vaccine_name,
        dose_label=payload.dose_label,
        administered_at=payload.administered_at,
        facility=payload.facility,
        batch_number=payload.batch_number,
        source_record_id=payload.source_record_id,
        is_verified=False,
        source="manual",
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    _audit(db, user, "create", "vaccination_events", ev.id, {"patient_id": patient_id, "vaccine_code": payload.vaccine_code}, request)
    return ev


# --------------------------------------------------------------------------- #
# Recommendations / scheduling engine
# --------------------------------------------------------------------------- #

@app.post("/api/v1/patients/{patient_id}/recommendations/recalculate", response_model=List[schemas.RecommendationOut])
def recalculate(patient_id: str, db: DbSession, user: models.User = Depends(require_capability(rbac.CLINICAL_WRITE, "recalculate clinical recommendations")), request: Request = None):
    patient = _require_patient_access(db, user, patient_id)
    out = _persist_recommendations(db, patient)
    db.commit()
    _audit(db, user, "recalculate", "recommendations", patient_id, {"count": len(out)}, request)
    return out


@app.get("/api/v1/patients/{patient_id}/recommendations", response_model=List[schemas.RecommendationOut])
def list_recommendations(patient_id: str, db: DbSession, user: models.User = Depends(require_user)):
    _require_patient_access(db, user, patient_id)
    patient = _get_patient_by_display_id(db, patient_id)
    return db.query(models.Recommendation).filter_by(patient_id=patient.id).order_by(models.Recommendation.created_at.desc()).all()

# --------------------------------------------------------------------------- #
# Documents / OCR (demo mode)
# --------------------------------------------------------------------------- #

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
DEMO_MODE = os.getenv("OCR_DEMO_MODE", "true").lower() == "true"


def _demo_ocr(filename: str):
    """Deterministic, clearly-labeled demonstration OCR fixture."""
    name = filename.lower()
    fixtures = {
        "card_aarav": {
            "vaccination_date": "2024-03-15",
            "vaccine_name": "Pentavalent",
            "dose_label": "Dose 3",
            "facility": "Delhi Urban PHC",
            "batch_number": "PNT-2024-003",
            "record_id": "REC-1001",
        },
        "card_diya": {
            "vaccination_date": "2024-06-10",
            "vaccine_name": "Measles-Rubella",
            "dose_label": "Dose 1",
            "facility": "Mumbai East Centre",
            "batch_number": "MR-2024-005",
            "record_id": "REC-1002",
        },
        "card_ananya": {
            "vaccination_date": "2024-09-01",
            "vaccine_name": "Pentavalent",
            "dose_label": "Dose 1",
            "facility": "Chennai PHC",
            "batch_number": "PNT-2024-015",
            "record_id": "REC-1003",
        },
    }
    key = None
    for k in fixtures:
        if k in name:
            key = k
            break
    if key is None:
        # A stable digest, not builtin hash(): str hashing is salted per process,
        # so the same filename could return different values after a restart.
        # This function promises determinism, and the README relies on it.
        digest = hashlib.md5(name.encode("utf-8")).hexdigest()
        key = list(fixtures.keys())[int(digest, 16) % len(fixtures)]
    return fixtures[key]


@app.post("/api/v1/documents/upload", response_model=schemas.DocumentUploadResponse)
async def upload_document(
    db: DbSession,
    patient_id: str = Form(...),
    file: UploadFile = File(...),
    user: models.User = Depends(require_user),
    request: Request = None,
):
    content = await file.read()
    max_size = 10 * 1024 * 1024  # 10 MB
    if len(content) > max_size:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")
    allowed = {"image/jpeg", "image/png", "image/jpg", "application/pdf", "image/webp"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")
    # Authorize *before* touching the filesystem, so a caller who has no access
    # to this patient cannot leave orphaned files behind.
    patient = _require_patient_access(db, user, patient_id)
    safe_name = f"{int(datetime.now().timestamp())}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)
    with open(file_path, "wb") as f:
        f.write(content)

    doc = models.Document(
        patient_id=patient.id,
        uploaded_by=user.id,
        file_name=file.filename,
        file_path=file_path,
        file_type=file.content_type,
        file_size=len(content),
        status="completed" if DEMO_MODE else "processing",
        ocr_provider="demo-ocr" if DEMO_MODE else "pending",
        ocr_status="completed" if DEMO_MODE else "pending",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    extracted = []
    if DEMO_MODE:
        fixture = _demo_ocr(file.filename)
        for field_name, field_value in fixture.items():
            requires_review = False
            review_note = None
            if "date" in field_name.lower():
                ambiguity = date_ambiguity(field_value)
                if ambiguity["ambiguous"]:
                    requires_review = True
                    review_note = ambiguity["note"]
                elif ambiguity["chosen"] is None:
                    requires_review = True
                    review_note = (
                        f"'{field_value}' could not be parsed as a date. Enter the correct "
                        "value from the source document rather than guessing."
                    )
            ef = models.ExtractedField(
                document_id=doc.id,
                field_name=field_name,
                field_value=field_value,
                # The demonstration OCR fixture supplies no confidence measure,
                # so none is reported. Inventing a number here would imply a
                # certainty the provider never gave us.
                confidence=None,
                is_approved=False,
                requires_review=requires_review,
                review_note=review_note,
            )
            db.add(ef)
            db.flush()
            extracted.append({
                "id": ef.id,
                "field_name": ef.field_name,
                "field_value": ef.field_value,
                "confidence": None,
                "is_approved": ef.is_approved,
                "requires_review": ef.requires_review,
                "review_note": ef.review_note,
            })
        db.commit()
        doc.ocr_status = "completed"
        db.commit()

    _audit(db, user, "upload", "documents", doc.id, {"file_name": file.filename, "demo_mode": DEMO_MODE}, request)
    return {
        "document_id": doc.id,
        "status": doc.status,
        "demo_mode": DEMO_MODE,
        "extracted_fields": extracted,
    }


@app.get("/api/v1/patients/{patient_id}/documents", response_model=List[schemas.DocumentOut])
def list_documents(patient_id: str, db: DbSession, user: models.User = Depends(require_user)):
    patient = _require_patient_access(db, user, patient_id)
    return db.query(models.Document).filter_by(patient_id=patient.id).order_by(models.Document.created_at.desc()).all()


@app.get("/api/v1/documents/{document_id}/fields", response_model=List[schemas.ExtractedFieldOut])
def list_extracted_fields(document_id: str, db: DbSession, user: models.User = Depends(require_user)):
    doc = db.get(models.Document, document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    patient = db.get(models.Patient, doc.patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    _check_patient_access(db, user, patient)
    return db.query(models.ExtractedField).filter_by(document_id=document_id).order_by(models.ExtractedField.created_at).all()


@app.post("/api/v1/extracted-fields/{field_id}/review", response_model=schemas.VerificationDecisionOut)
def review_extracted_field(field_id: str, payload: schemas.FieldReview, db: DbSession, user: models.User = Depends(require_capability(rbac.RECORD_REVIEW, "review extracted document fields")), request: Request = None):
    """Record a human review decision on one extracted field.

    Marking a field approved does NOT create a vaccination event. The document
    must be finalized explicitly, and finalization validates that the required
    fields were approved. Nothing is fabricated.
    """
    ef = db.get(models.ExtractedField, field_id)
    if not ef:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
    doc = db.get(models.Document, ef.document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    patient = db.get(models.Patient, doc.patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    _check_patient_access(db, user, patient)

    decision = "approved" if payload.approved else "rejected"
    vd = models.VerificationDecision(
        extracted_field_id=field_id,
        decision=decision,
        reviewer_id=user.id,
        reason=payload.reason,
    )
    db.add(vd)
    ef.is_approved = payload.approved
    ef.reviewed_by = user.id
    ef.reviewed_at = datetime.utcnow()

    # Document moves to review_required until every field has a decision.
    fields = db.query(models.ExtractedField).filter_by(document_id=doc.id).all()
    reviewed = [f for f in fields if f.reviewed_by is not None]
    if reviewed and len(reviewed) < len(fields):
        doc.status = "review_required"
    elif reviewed and len(reviewed) == len(fields):
        doc.status = "review_complete"
    db.commit()
    db.refresh(vd)
    _audit(db, user, "review", "extracted_fields", field_id, {"decision": decision, "document_id": doc.id}, request)
    return vd


REQUIRED_FINALIZE_FIELDS = ("vaccination_date", "vaccine_name", "dose_label")


@app.post("/api/v1/documents/{document_id}/finalize", response_model=schemas.VaccinationEventOut)
def finalize_document(document_id: str, db: DbSession, user: models.User = Depends(require_capability(rbac.CLINICAL_WRITE, "finalize documents into clinical records")), request: Request = None):
    """Assemble a verified vaccination event from APPROVED extracted fields only.

    Rejects finalization when required fields are missing or unapproved, so the
    system never invents a vaccine name or a vaccination date.
    """
    doc = db.get(models.Document, document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    patient = db.get(models.Patient, doc.patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    _check_patient_access(db, user, patient)

    fields = db.query(models.ExtractedField).filter_by(document_id=document_id).all()
    if not fields:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No extracted fields to finalize")

    approved = {f.field_name: f.field_value for f in fields if f.is_approved}
    unreviewed = [f.field_name for f in fields if f.reviewed_by is None]
    if unreviewed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fields awaiting review: {', '.join(sorted(unreviewed))}",
        )
    missing = [name for name in REQUIRED_FINALIZE_FIELDS if name not in approved]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Required fields not approved: {', '.join(missing)}",
        )

    administered_at = _parse_iso(approved["vaccination_date"])
    if administered_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vaccination date could not be parsed")
    if administered_at > datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vaccination date is in the future")

    vaccine_name = approved["vaccine_name"]
    vaccine, method = resolve_vaccine_code(db, vaccine_name, dose_label=approved.get("dose_label"))
    if vaccine is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Vaccine name '{vaccine_name}' could not be mapped to the controlled terminology "
                f"({method}). Map it explicitly before saving; the system will not guess a vaccine."
            ),
        )

    dose_label = approved["dose_label"]

    # Duplicate guard: same patient + vaccine + dose + date is not re-inserted.
    existing = (
        db.query(models.VaccinationEvent)
        .filter_by(patient_id=patient.id, vaccine_code=vaccine.code, dose_label=dose_label)
        .all()
    )
    for e in existing:
        if e.administered_at and e.administered_at.date() == administered_at.date():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A matching verified vaccination event already exists for this dose and date",
            )

    ev = models.VaccinationEvent(
        patient_id=patient.id,
        vaccine_code=vaccine.code,
        vaccine_name=vaccine.name,
        dose_label=dose_label,
        administered_at=administered_at,
        facility=approved.get("facility"),
        batch_number=approved.get("batch_number"),
        source_record_id=approved.get("record_id"),
        is_verified=True,
        verified_by=user.id,
        verified_at=datetime.utcnow(),
        source="ocr",
        source_document_id=doc.id,
    )
    db.add(ev)
    doc.status = "completed"
    db.commit()
    db.refresh(ev)

    # Recalculate and persist the schedule so downstream status and analytics
    # stay consistent with the newly verified event.
    _persist_recommendations(db, patient)
    db.commit()

    _audit(db, user, "finalize_document", "documents", document_id, {"vaccination_event_id": ev.id, "vaccine_code": vaccine.code}, request)
    return ev


# --------------------------------------------------------------------------- #
# Record match candidates
# --------------------------------------------------------------------------- #

@app.get("/api/v1/record-matches", response_model=List[schemas.RecordMatchCandidateOut])
def list_record_matches(db: DbSession, user: models.User = Depends(require_capability(rbac.RECORD_REVIEW, "review identity match candidates")), request: Request = None):
    q = db.query(models.RecordMatchCandidate)
    items, total, page, page_size = _paginate(q, 1, 50)
    return items


@app.patch("/api/v1/record-matches/{candidate_id}", response_model=schemas.RecordMatchCandidateOut)
def decide_record_match(candidate_id: str, payload: schemas.MatchDecision, db: DbSession, user: models.User = Depends(require_capability(rbac.RECORD_REVIEW, "resolve identity match candidates")), request: Request = None):
    cand = db.get(models.RecordMatchCandidate, candidate_id)
    if not cand:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    if payload.decision not in ("confirmed", "rejected", "unresolved"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid decision")
    cand.status = payload.decision
    cand.reviewed_by = user.id
    cand.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(cand)
    _audit(db, user, "decide", "record_match_candidates", candidate_id, {"decision": payload.decision}, request)
    return cand

# --------------------------------------------------------------------------- #
# Outreach
# --------------------------------------------------------------------------- #

@app.get("/api/v1/outreach", response_model=dict)
def list_outreach(
    db: DbSession,
    user: models.User = Depends(require_user),
    page: int = 1,
    page_size: int = 20,
    # Aliased so the query parameter stays "status" on the wire while the Python
    # name does not shadow fastapi.status inside this function.
    status_filter: Optional[str] = Query(None, alias="status"),
    assigned_worker_id: Optional[str] = None,
    patient_id: Optional[str] = None,
):
    # The outreach queue contains follow-up reasoning about named families, so
    # it is restricted to roles that actually work the queue. Previously this
    # endpoint fell through unfiltered for the "patient" role, which exposed
    # every task in the system; access now fails closed.
    if user.role not in rbac.OUTREACH_VIEW:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role is not authorized to view the outreach queue.",
        )
    q = db.query(models.OutreachTask).options(joinedload(models.OutreachTask.patient), joinedload(models.OutreachTask.assigned_worker_user))
    if user.role == "healthcare_worker":
        # A worker sees the tasks assigned to them, not the whole queue, so one
        # worker cannot browse or close another worker's follow-ups.
        q = q.filter(models.OutreachTask.assigned_worker_id == user.id)
    if status_filter:
        q = q.filter(models.OutreachTask.status == status_filter)
    if assigned_worker_id:
        q = q.filter(models.OutreachTask.assigned_worker_id == assigned_worker_id)
    if patient_id:
        # Accepts either the internal UUID or the display id (VAX-0001), and
        # still fails closed for a patient this caller may not see.
        patient = _get_patient_by_display_id(db, patient_id)
        if patient is None:
            # An identifier that resolves to nothing yields nothing. Guessing a
            # nearby match would be worse than an empty result.
            q = q.filter(models.OutreachTask.id == "__no_access__")
        else:
            # Raises 403 when this caller may not see the patient, so the queue
            # can never be used to probe another family's follow-up history.
            _check_patient_access(db, user, patient)
            q = q.filter(models.OutreachTask.patient_id == patient.id)
    q = q.order_by(models.OutreachTask.priority_score.desc().nullslast(), models.OutreachTask.created_at.desc())
    items, total, page, page_size = _paginate(q, page, page_size)
    items_out = []
    for task in items:
        row = schemas.OutreachTaskOut.model_validate(task).model_dump(mode="json")
        row["patient"] = _patient_brief(task.patient) if task.patient else None
        row["assigned_worker_name"] = task.assigned_worker_user.full_name if task.assigned_worker_user else None
        row["attempt_count"] = len(task.attempts or [])
        items_out.append(row)
    return {"items": items_out, "total": total, "page": page, "page_size": page_size}


@app.post("/api/v1/outreach", response_model=schemas.OutreachTaskOut)
def create_outreach(payload: schemas.OutreachTaskCreate, db: DbSession, user: models.User = Depends(require_capability(rbac.OUTREACH_MANAGE, "create outreach tasks")), request: Request = None):
    patient = _require_patient_access(db, user, payload.patient_id)
    task = models.OutreachTask(
        patient_id=patient.id,
        title=payload.title,
        reason=payload.reason,
        priority_score=payload.priority_score or 0,
        priority_explanation=payload.priority_explanation,
        status=payload.status,
        assigned_worker_id=payload.assigned_worker_id,
        due_date=payload.due_date,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    _audit(db, user, "create", "outreach_tasks", task.id, {"patient_id": payload.patient_id}, request)
    return task


@app.patch("/api/v1/outreach/{task_id}", response_model=schemas.OutreachTaskOut)
def update_outreach(task_id: str, payload: schemas.OutreachTaskUpdate, db: DbSession, user: models.User = Depends(require_capability(rbac.OUTREACH_MANAGE, "modify outreach tasks")), request: Request = None):
    task = db.get(models.OutreachTask, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if user.role == "healthcare_worker" and task.assigned_worker_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this task")
    updates = payload.model_dump(exclude_unset=True)
    new_status = updates.get("status")
    if new_status is not None and new_status not in OUTREACH_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown outreach status '{new_status}'. Allowed: {', '.join(sorted(OUTREACH_STATUSES))}",
        )
    for field, value in updates.items():
        setattr(task, field, value)
    if new_status == "resolved" and task.resolved_at is None:
        task.resolved_at = datetime.utcnow()
    elif new_status is not None and new_status != "resolved":
        # Reopening a task clears the resolution timestamp so analytics never
        # count it as resolved while it is still open.
        task.resolved_at = None
    db.commit()
    db.refresh(task)
    _audit(db, user, "update", "outreach_tasks", task_id, payload.model_dump(exclude_unset=True), request)
    return task


@app.post("/api/v1/outreach/{task_id}/attempts", response_model=schemas.OutreachAttemptOut)
def add_outreach_attempt(task_id: str, payload: schemas.OutreachAttemptCreate, db: DbSession, user: models.User = Depends(require_capability(rbac.OUTREACH_MANAGE, "log outreach attempts")), request: Request = None):
    task = db.get(models.OutreachTask, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if payload.outcome not in OUTREACH_OUTCOMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown attempt outcome '{payload.outcome}'. Allowed: {', '.join(sorted(OUTREACH_OUTCOMES))}",
        )
    attempt = models.OutreachAttempt(
        task_id=task_id,
        worker_id=payload.worker_id or user.id,
        attempt_type=payload.attempt_type,
        outcome=payload.outcome,
        notes=payload.notes,
        attempted_at=payload.attempted_at or datetime.utcnow(),
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    _audit(db, user, "create", "outreach_attempts", attempt.id, {"task_id": task_id, "outcome": payload.outcome}, request)
    return attempt


@app.get("/api/v1/outreach/{task_id}/attempts", response_model=List[schemas.OutreachAttemptOut])
def list_outreach_attempts(task_id: str, db: DbSession, user: models.User = Depends(require_capability(rbac.OUTREACH_VIEW, "view outreach attempts"))):
    """Contact history for one task, oldest first.

    Workers see only tasks assigned to them; the list endpoint applies the same
    scoping, so this cannot be used to enumerate another worker's contacts.
    """
    task = db.get(models.OutreachTask, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if user.role == "healthcare_worker" and task.assigned_worker_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this task")
    return (
        db.query(models.OutreachAttempt)
        .filter_by(task_id=task_id)
        .order_by(models.OutreachAttempt.attempted_at.asc())
        .all()
    )


# --------------------------------------------------------------------------- #
# Appointments
# --------------------------------------------------------------------------- #

@app.get("/api/v1/appointments", response_model=List[schemas.AppointmentOut])
def list_appointments(db: DbSession, user: models.User = Depends(require_user), patient_id: Optional[str] = None):
    q = db.query(models.Appointment)
    if patient_id:
        patient = _require_patient_access(db, user, patient_id)
        q = q.filter_by(patient_id=patient.id)
    elif user.role == "patient":
        p = db.query(models.Patient).filter_by(user_id=user.id).first()
        q = q.filter_by(patient_id=p.id) if p else q.filter(models.Appointment.id == "__none__")
    elif user.role == "caregiver":
        patient_ids = [r.patient_id for r in db.query(models.CaregiverRelationship).filter_by(caregiver_user_id=user.id, authorized=True).all()]
        q = q.filter(models.Appointment.patient_id.in_(patient_ids)) if patient_ids else q.filter(models.Appointment.id == "__none__")
    return q.order_by(models.Appointment.scheduled_at).all()


@app.post("/api/v1/appointments", response_model=schemas.AppointmentOut)
def create_appointment(payload: schemas.AppointmentCreate, db: DbSession, user: models.User = Depends(require_user), request: Request = None):
    patient = _require_patient_access(db, user, payload.patient_id)
    appt_status = payload.status
    if user.role not in rbac.CLINICAL_READ:
        # A patient or caregiver can only *request* an appointment; confirming
        # it is a clinic decision.
        appt_status = "requested"
    ap = models.Appointment(
        patient_id=patient.id,
        facility_id=payload.facility_id,
        vaccine_code=payload.vaccine_code,
        scheduled_at=payload.scheduled_at,
        status=appt_status,
        created_by=user.id,
    )
    db.add(ap)
    db.commit()
    db.refresh(ap)
    _audit(db, user, "create", "appointments", ap.id, {"patient_id": payload.patient_id}, request)
    return ap


@app.patch("/api/v1/appointments/{appt_id}", response_model=schemas.AppointmentOut)
def update_appointment(appt_id: str, payload: schemas.AppointmentUpdate, db: DbSession, user: models.User = Depends(require_user), request: Request = None):
    ap = db.get(models.Appointment, appt_id)
    if not ap:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found")
    patient = db.get(models.Patient, ap.patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    _check_patient_access(db, user, patient)
    updates = payload.model_dump(exclude_unset=True)
    if user.role not in rbac.CLINICAL_READ:
        # Patients and authorized caregivers may cancel their *own* appointment
        # or move it back to "requested" (a reschedule ask that clinic staff
        # still have to confirm). Self-confirming or self-completing an
        # appointment would let a clinical attestation be written by the person
        # it attests to, so those stay with staff.
        disallowed = set(updates) - {"status", "scheduled_at"}
        if disallowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Not authorized to change: {', '.join(sorted(disallowed))}",
            )
        if updates.get("status") not in SELF_SERVICE_APPOINTMENT_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can cancel or request a new time; clinic staff confirm appointments.",
            )
    for field, value in updates.items():
        setattr(ap, field, value)
    db.commit()
    db.refresh(ap)
    return ap


# --------------------------------------------------------------------------- #
# Inventory
# --------------------------------------------------------------------------- #

@app.get("/api/v1/inventory/batches", response_model=List[schemas.InventoryBatchOut])
def list_inventory(db: DbSession, user: models.User = Depends(require_capability(rbac.INVENTORY_VIEW, "view vaccine inventory")), facility_id: Optional[str] = None, vaccine_id: Optional[str] = None):
    q = db.query(models.InventoryBatch)
    if facility_id:
        q = q.filter_by(facility_id=facility_id)
    if vaccine_id:
        q = q.filter_by(vaccine_id=vaccine_id)
    return q.order_by(models.InventoryBatch.created_at.desc()).all()


@app.get("/api/v1/inventory/summary")
def inventory_summary(db: DbSession, user: models.User = Depends(require_capability(rbac.INVENTORY_VIEW, "view vaccine inventory"))):
    batches = db.query(models.InventoryBatch).all()
    return {
        "total_batches": len(batches),
        "active_batches": sum(1 for b in batches if b.status == "active" and not is_expired(b)),
        "low_stock_count": sum(1 for b in batches if is_low_stock(b)),
        "expiring_soon_count": sum(1 for b in batches if is_expiring_soon(b)),
        "expired_count": sum(1 for b in batches if is_expired(b)),
        "usable_doses": sum(available_quantity(b) for b in batches),
        "thresholds": {
            "low_stock_at_or_below": 10,
            "expiring_within_days": 60,
        },
    }


@app.post("/api/v1/inventory/batches", response_model=schemas.InventoryBatchOut)
def create_inventory_batch(payload: schemas.InventoryBatchCreate, db: DbSession, user: models.User = Depends(require_capability(rbac.INVENTORY_MANAGE, "receive vaccine stock")), request: Request = None):
    batch = models.InventoryBatch(
        vaccine_id=payload.vaccine_id,
        facility_id=payload.facility_id,
        batch_number=payload.batch_number,
        quantity_received=payload.quantity_received,
        quantity_used=0,
        quantity_adjusted=0,
        expiry_date=payload.expiry_date,
        status="active",
    )
    db.add(batch)
    db.flush()
    db.add(models.InventoryTransaction(batch_id=batch.id, transaction_type="receipt", quantity=payload.quantity_received, reference="Initial receipt", recorded_by=user.id))
    db.commit()
    db.refresh(batch)
    _audit(db, user, "create", "inventory_batches", batch.id, {"batch_number": payload.batch_number, "quantity": payload.quantity_received}, request)
    return batch


@app.post("/api/v1/inventory/transactions", response_model=schemas.InventoryTransactionOut)
def record_inventory_transaction(payload: schemas.InventoryTransactionCreate, db: DbSession, user: models.User = Depends(require_capability(rbac.INVENTORY_MANAGE, "record inventory transactions")), request: Request = None):
    batch = db.get(models.InventoryBatch, payload.batch_id)
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    delta = payload.quantity
    available_before = available_quantity(batch)
    if payload.transaction_type == "usage":
        amount = abs(payload.quantity)
        # Checked against real usable stock, which honours negative adjustments
        # (wastage) and excludes expired batches.
        if amount > available_before:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient stock: {available_before} usable doses remain in this batch",
            )
        delta = -amount
        batch.quantity_used += amount
    elif payload.transaction_type == "receipt":
        amount = abs(payload.quantity)
        if is_expired(batch):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot receive stock into an expired batch; record a new batch instead",
            )
        delta = amount
        batch.quantity_received += amount
    elif payload.transaction_type == "adjustment":
        # A negative adjustment is a write-off and may not exceed usable stock,
        # otherwise the batch would report a negative balance.
        if payload.quantity < 0 and abs(payload.quantity) > available_before:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Adjustment exceeds usable stock ({available_before} doses remain)",
            )
        batch.quantity_adjusted += payload.quantity
    elif payload.transaction_type == "expiry":
        batch.status = "expired"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid transaction type")
    batch.updated_at = datetime.utcnow()
    tx = models.InventoryTransaction(
        batch_id=payload.batch_id,
        transaction_type=payload.transaction_type,
        quantity=delta,
        reference=payload.reference,
        recorded_by=user.id,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)
    _audit(db, user, "record", "inventory_transactions", tx.id, {"batch_id": payload.batch_id, "type": payload.transaction_type, "quantity": payload.quantity}, request)
    return tx


# --------------------------------------------------------------------------- #
# Notifications
# --------------------------------------------------------------------------- #

@app.get("/api/v1/notifications", response_model=List[schemas.NotificationOut])
def list_notifications(db: DbSession, user: models.User = Depends(require_user)):
    return db.query(models.Notification).filter_by(user_id=user.id).order_by(models.Notification.created_at.desc()).limit(50).all()


@app.patch("/api/v1/notifications/{notif_id}/read")
def mark_notification_read(notif_id: str, db: DbSession, user: models.User = Depends(require_user)):
    n = db.get(models.Notification, notif_id)
    if not n or n.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    n.is_read = True
    n.read_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Analytics (aggregate, privacy-preserving)
# --------------------------------------------------------------------------- #
#
# Every figure here is derived from database records or explicitly labeled
# sample data. Nothing is hardcoded per page, so metrics stay consistent
# across the dashboard, analytics view, and role areas.

SUPPRESSION_THRESHOLD = 5


@app.get("/api/v1/analytics/summary")
def analytics_summary(db: DbSession, user: models.User = Depends(require_capability(rbac.ANALYTICS_VIEW, "view analytics"))):
    """Headline operational metrics for the dashboard."""
    total_patients = db.query(models.Patient).count()
    verified_events = db.query(models.VaccinationEvent).filter_by(is_verified=True).count()
    unverified_events = db.query(models.VaccinationEvent).filter_by(is_verified=False).count()

    records_requiring_verification = (
        db.query(models.Document).filter(models.Document.status.in_(["review_required", "processing"])).count()
        + unverified_events
    )

    now = datetime.utcnow()
    upcoming_window = now + timedelta(days=60)
    upcoming = (
        db.query(models.Recommendation)
        .filter(
            models.Recommendation.status.in_(["upcoming", "due"]),
            models.Recommendation.due_date.isnot(None),
            models.Recommendation.due_date <= upcoming_window,
        )
        .count()
    )
    potentially_overdue = (
        db.query(models.Recommendation).filter_by(status="potentially_overdue").count()
    )
    verification_required = (
        db.query(models.Recommendation).filter_by(status="verification_required").count()
    )

    # Outreach buckets are mutually exclusive so a dashboard showing them side
    # by side cannot double-count: "open" means not yet started, and a task that
    # is in progress appears only under in_progress.
    open_tasks = db.query(models.OutreachTask).filter_by(status="open").count()
    in_progress_tasks = db.query(models.OutreachTask).filter_by(status="in_progress").count()
    resolved_tasks = db.query(models.OutreachTask).filter(models.OutreachTask.status.in_(["resolved", "closed"])).count()
    escalated_tasks = db.query(models.OutreachTask).filter_by(status="escalated").count()
    total_tasks = db.query(models.OutreachTask).count()

    batches = db.query(models.InventoryBatch).all()
    # Same arithmetic as /inventory/summary and /analytics/inventory-levels, so
    # the three views cannot disagree about what "usable" means.
    low_stock = [b for b in batches if is_low_stock(b)]
    expiring = [b for b in batches if is_expiring_soon(b)]
    expired = [b for b in batches if is_expired(b)]

    open_conflicts = db.query(models.SyncConflict).filter_by(status="open").count()

    # Median time to resolution, computed from actual timestamps.
    durations = [
        (t.resolved_at - t.created_at).total_seconds() / 86400.0
        for t in db.query(models.OutreachTask).filter(models.OutreachTask.resolved_at.isnot(None)).all()
        if t.created_at
    ]
    durations.sort()
    median_days = round(durations[len(durations) // 2], 1) if durations else None

    denominator = total_tasks
    return {
        "total_patients": total_patients,
        "verified_vaccination_events": verified_events,
        "unverified_vaccination_events": unverified_events,
        "records_requiring_verification": records_requiring_verification,
        "documents_pending_review": db.query(models.Document).filter_by(status="review_required").count(),
        "upcoming_vaccinations": upcoming,
        "potentially_overdue": potentially_overdue,
        "verification_required": verification_required,
        "total_outreach_tasks": total_tasks,
        "open_outreach_tasks": open_tasks,
        "in_progress_outreach_tasks": in_progress_tasks,
        "escalated_outreach_tasks": escalated_tasks,
        "resolved_outreach_tasks": resolved_tasks,
        "resolution_rate": round(resolved_tasks / denominator * 100, 1) if denominator else 0.0,
        "median_days_to_resolution": median_days,
        "open_sync_conflicts": open_conflicts,
        "inventory_batches": len(batches),
        "low_stock_alerts": len(low_stock),
        "expiring_soon_alerts": len(expiring),
        "expired_batches": len(expired),
        "inventory_alerts": len(low_stock) + len(expiring) + len(expired),
        "observation_period": "all seeded demonstration records to date",
        "data_source": "demonstration database (synthetic)",
    }


@app.get("/api/v1/analytics/status-distribution")
def status_distribution(db: DbSession, user: models.User = Depends(require_capability(rbac.ANALYTICS_VIEW, "view analytics"))):
    """Distribution of scheduling statuses across all recommendations."""
    rows = (
        db.query(models.Recommendation.status, func.count(models.Recommendation.id))
        .group_by(models.Recommendation.status)
        .all()
    )
    total = sum(c for _, c in rows) or 1
    return [
        {"status": st or "unknown", "count": c, "percentage": round(c / total * 100, 1)}
        for st, c in sorted(rows, key=lambda r: r[1], reverse=True)
    ]


@app.get("/api/v1/analytics/coverage-by-area")
def coverage_by_area(db: DbSession, user: models.User = Depends(require_capability(rbac.ANALYTICS_VIEW, "view analytics"))):
    """Registered patients per service area, with small-group suppression.

    This is registry completeness, NOT population vaccination coverage: the
    denominator is registered patients, not the resident population.
    """
    rows = (
        db.query(models.Patient.service_area, func.count(models.Patient.id))
        .group_by(models.Patient.service_area)
        .order_by(func.count(models.Patient.id).desc())
        .all()
    )
    out = []
    for area, count in rows:
        suppressed = count < SUPPRESSION_THRESHOLD
        # Up-to-date share among recommendations for patients in this area.
        patient_ids = [
            pid for (pid,) in db.query(models.Patient.id).filter(
                models.Patient.service_area == area
            ).all()
        ]
        recs = (
            db.query(models.Recommendation.status)
            .filter(models.Recommendation.patient_id.in_(patient_ids))
            .all() if patient_ids else []
        )
        statuses = [r[0] for r in recs]
        up_to_date = statuses.count("up_to_date")
        out.append({
            "service_area": area or "Unknown",
            "patient_count": None if suppressed else count,
            "suppressed": suppressed,
            "recommendation_count": 0 if suppressed else len(statuses),
            "up_to_date_count": 0 if suppressed else up_to_date,
            "up_to_date_share": (
                None if suppressed or not statuses
                else round(up_to_date / len(statuses) * 100, 1)
            ),
        })
    return {
        "items": out,
        "suppression_threshold": SUPPRESSION_THRESHOLD,
        "metric_definition": {
            "patient_count": "registered patients whose recorded service area matches",
            "recommendation_count": (
                "stored schedule recommendations for those patients (one per schedule rule "
                "per patient), not a count of doses"
            ),
            "up_to_date_share": (
                "percentage of those recommendations currently marked up_to_date. It measures "
                "completeness of the recorded schedule for registered patients."
            ),
            "population": "registered demonstration patients only",
            "suppression": (
                f"areas with fewer than {SUPPRESSION_THRESHOLD} registered patients report no "
                "counts, so a small group cannot be re-identified"
            ),
            "note": (
                "This is NOT population vaccination coverage. The denominator is patients "
                "registered in this system, not the resident population, so a high share here "
                "says nothing about unregistered children."
            ),
        },
    }


@app.get("/api/v1/analytics/events-by-week")
def events_by_week(db: DbSession, user: models.User = Depends(require_capability(rbac.ANALYTICS_VIEW, "view analytics")), weeks: int = 12):
    """Verified vaccination events per week for the trailing period.

    Weeks with no events are included and shown as zero rather than omitted, so
    the absence of data is visible rather than silently smoothed away.
    """
    weeks = min(max(weeks, 1), 52)
    now = datetime.utcnow()
    start = now - timedelta(weeks=weeks)

    rows = (
        db.query(
            func.strftime("%Y-%W", models.VaccinationEvent.administered_at),
            func.count(models.VaccinationEvent.id),
            func.sum(case((models.VaccinationEvent.is_verified == True, 1), else_=0)),  # noqa: E712
        )
        .filter(models.VaccinationEvent.administered_at >= start)
        .group_by(func.strftime("%Y-%W", models.VaccinationEvent.administered_at))
        .all()
    )
    by_week = {r[0]: {"total": r[1], "verified": int(r[2] or 0)} for r in rows}

    series = []
    for i in range(weeks):
        week_start = start + timedelta(weeks=i)
        key = week_start.strftime("%Y-%W")
        entry = by_week.get(key, {"total": 0, "verified": 0})
        series.append({
            "week": key,
            "week_starting": week_start.date().isoformat(),
            "total_events": entry["total"],
            "verified_events": entry["verified"],
            "has_data": key in by_week,
        })
    return {
        "series": series,
        "observation_period": {
            "start": start.date().isoformat(),
            "end": now.date().isoformat(),
            "weeks": weeks,
        },
        "note": "Weeks with no recorded events are shown as zero, not omitted.",
    }


@app.get("/api/v1/analytics/followup-status")
def followup_status(db: DbSession, user: models.User = Depends(require_capability(rbac.ANALYTICS_VIEW, "view analytics"))):
    """Follow-up case status distribution."""
    rows = (
        db.query(models.OutreachTask.status, func.count(models.OutreachTask.id))
        .group_by(models.OutreachTask.status)
        .all()
    )
    return [{"status": st or "unknown", "count": c} for st, c in sorted(rows, key=lambda r: r[1], reverse=True)]


@app.get("/api/v1/analytics/resolution-trend")
def resolution_trend(db: DbSession, user: models.User = Depends(require_capability(rbac.ANALYTICS_VIEW, "view analytics")), weeks: int = 12):
    """Follow-up resolutions per week, measuring whether gaps actually closed."""
    weeks = min(max(weeks, 1), 52)
    now = datetime.utcnow()
    start = now - timedelta(weeks=weeks)
    tasks = (
        db.query(models.OutreachTask)
        .filter(models.OutreachTask.resolved_at.isnot(None), models.OutreachTask.resolved_at >= start)
        .all()
    )
    buckets: dict[str, int] = {}
    for t in tasks:
        key = t.resolved_at.strftime("%Y-%W")
        buckets[key] = buckets.get(key, 0) + 1

    series = []
    cumulative = 0
    for i in range(weeks):
        week_start = start + timedelta(weeks=i)
        key = week_start.strftime("%Y-%W")
        resolved = buckets.get(key, 0)
        cumulative += resolved
        series.append({
            "week": key,
            "week_starting": week_start.date().isoformat(),
            "resolved": resolved,
            "cumulative": cumulative,
            "has_data": key in buckets,
        })
    return {
        "series": series,
        "total_resolved_in_period": sum(buckets.values()),
        "note": "Counts tasks whose outcome was recorded and verified as resolved.",
    }


@app.get("/api/v1/analytics/verification-backlog")
def verification_backlog(db: DbSession, user: models.User = Depends(require_capability(rbac.ANALYTICS_VIEW, "view analytics"))):
    """Record-verification backlog: what is waiting on a human decision."""
    docs_pending = db.query(models.Document).filter_by(status="review_required").count()
    fields_pending = (
        db.query(models.ExtractedField).filter_by(is_approved=False, reviewed_by=None).count()
    )
    unverified_events = db.query(models.VaccinationEvent).filter_by(is_verified=False).count()
    pending_matches = db.query(models.RecordMatchCandidate).filter_by(status="pending").count()
    open_conflicts = db.query(models.SyncConflict).filter_by(status="open").count()
    verification_required_recs = (
        db.query(models.Recommendation).filter_by(status="verification_required").count()
    )
    total = docs_pending + fields_pending + unverified_events + pending_matches + open_conflicts
    return {
        "items": [
            {"category": "Documents awaiting review", "count": docs_pending},
            {"category": "Extracted fields awaiting decision", "count": fields_pending},
            {"category": "Unverified vaccination entries", "count": unverified_events},
            {"category": "Pending identity match candidates", "count": pending_matches},
            {"category": "Open sync conflicts", "count": open_conflicts},
        ],
        "total_backlog": total,
        "recommendations_flagged_verification_required": verification_required_recs,
    }


@app.get("/api/v1/analytics/inventory-levels")
def inventory_levels(db: DbSession, user: models.User = Depends(require_capability(rbac.ANALYTICS_VIEW, "view analytics"))):
    """Usable stock per vaccine, with deterministic demand comparison.

    A projected mismatch is labeled as requiring verification — it is not
    reported as a confirmed stock-out.
    """
    now = datetime.utcnow()
    batches = (
        db.query(models.InventoryBatch, models.Vaccine)
        .join(models.Vaccine, models.Vaccine.id == models.InventoryBatch.vaccine_id)
        .all()
    )

    per_vaccine: dict[str, dict[str, Any]] = {}
    for b, v in batches:
        entry = per_vaccine.setdefault(v.code, {
            "vaccine_code": v.code,
            "vaccine_name": v.name,
            "usable_stock": 0,
            "total_received": 0,
            "total_used": 0,
            "batches": 0,
            "expiring_soon": 0,
            "expired": 0,
            "total_adjusted": 0,
        })
        entry["batches"] += 1
        entry["total_received"] += b.quantity_received
        entry["total_used"] += b.quantity_used
        entry["total_adjusted"] += (b.quantity_adjusted or 0)
        if is_expired(b, now):
            entry["expired"] += 1
            continue
        if is_expiring_soon(b, now):
            entry["expiring_soon"] += 1
        if b.status == "active":
            entry["usable_stock"] += available_quantity(b, now)

    # Deterministic expected demand: count actionable recommendations per vaccine.
    recs = (
        db.query(models.Recommendation.vaccine_code, func.count(models.Recommendation.id))
        .filter(models.Recommendation.status.in_(["due", "upcoming", "potentially_overdue"]))
        .group_by(models.Recommendation.vaccine_code)
        .all()
    )
    demand_by_code = {code: count for code, count in recs}

    items = []
    for code, entry in per_vaccine.items():
        expected_demand = demand_by_code.get(code, 0)
        shortage = max(expected_demand - entry["usable_stock"], 0)
        items.append({
            **entry,
            "expected_demand": expected_demand,
            "projected_shortage": shortage,
            "stock_status": (
                "shortage_projected" if shortage > 0
                else "low_stock" if entry["usable_stock"] <= 10
                else "adequate"
            ),
        })

    items.sort(key=lambda x: (-x["projected_shortage"], x["usable_stock"]))
    return {
        "items": items,
        "method": {
            "expected_demand": "count of actionable recommendations (due, upcoming, potentially overdue) per vaccine",
            "usable_stock": "received plus signed adjustments minus used, excluding expired batches",
            "note": (
                "A projected mismatch requires verification. It is not reported as a confirmed stock-out."
            ),
        },
    }


# --------------------------------------------------------------------------- #
# Audit logs
# --------------------------------------------------------------------------- #

@app.get("/api/v1/audit", response_model=dict)
def list_audit(
    db: DbSession,
    user: models.User = Depends(require_capability(rbac.AUDIT_VIEW, "view audit logs")),
    page: int = 1,
    page_size: int = 50,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
):
    """Audit trail, filterable so a single record's history can be shown.

    Filters narrow the result; they never widen access. The AUDIT_VIEW gate
    above still applies to every call.
    """
    q = db.query(models.AuditEvent).options(joinedload(models.AuditEvent.user))
    if entity_type:
        q = q.filter(models.AuditEvent.entity_type == entity_type)
    if entity_id:
        q = q.filter(models.AuditEvent.entity_id == entity_id)
    if action:
        q = q.filter(models.AuditEvent.action == action)
    if actor_id:
        q = q.filter(models.AuditEvent.user_id == actor_id)
    q = q.order_by(models.AuditEvent.created_at.desc())
    items, total, page, page_size = _paginate(q, page, page_size)
    items_out = []
    for event in items:
        row = schemas.AuditEventOut.model_validate(event).model_dump(mode="json")
        # `details` is persisted as JSON text. Hand it back as a structured object
        # rather than an escaped string: an audit trail is meant to be read and
        # filtered by people and tools, and a string payload forces every consumer
        # to re-parse it (and to guess that it is JSON at all).
        row["details"] = _parse_audit_details(event.details)
        row["actor_name"] = event.user.full_name if event.user else None
        row["actor_email"] = event.user.email if event.user else None
        row["actor_role"] = event.user.role if event.user else None
        items_out.append(row)
    return {"items": items_out, "total": total, "page": page, "page_size": page_size}


# --------------------------------------------------------------------------- #
# Offline synchronization
# --------------------------------------------------------------------------- #

@app.post("/api/v1/vaccinations/sync")
def sync_offline_events(
    payload: dict,
    db: DbSession,
    user: models.User = Depends(require_capability(rbac.CLINICAL_WRITE, "synchronize vaccination records")),
    request: Request = None,
):
    """Accept a batch of queued offline events.

    Idempotent on client_event_id: replaying the same batch creates no
    duplicates. Conflicting submissions are routed for review and the stored
    record is left untouched.
    """
    events = payload.get("events")
    if events is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="events list is required")
    try:
        result = process_sync_batch(db, user, events)
    except SyncError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    _audit(db, user, "sync", "vaccination_events", None, {
        "submitted": result["submitted"],
        "accepted": result["accepted"],
        "deduplicated": result["deduplicated"],
        "conflicts": result["conflicts"],
        "rejected": result["rejected"],
    }, request)
    return result


@app.get("/api/v1/vaccinations/conflicts")
def list_sync_conflicts(
    db: DbSession,
    user: models.User = Depends(require_capability(rbac.RECORD_REVIEW, "review sync conflicts")),
    conflict_status: Optional[str] = None,
):
    q = db.query(models.SyncConflict)
    if conflict_status:
        q = q.filter_by(status=conflict_status)
    items = q.order_by(models.SyncConflict.created_at.desc()).limit(100).all()
    out = []
    for c in items:
        patient = db.get(models.Patient, c.patient_id)
        out.append({
            "id": c.id,
            "client_event_id": c.client_event_id,
            "patient_display_id": patient.patient_id if patient else None,
            "patient_name": f"{patient.first_name} {patient.last_name}" if patient else None,
            "conflict_type": c.conflict_type,
            "detail": c.detail,
            "status": c.status,
            "submitted_payload": json.loads(c.submitted_payload) if c.submitted_payload else None,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })
    return out


@app.patch("/api/v1/vaccinations/conflicts/{conflict_id}")
def resolve_sync_conflict(
    conflict_id: str,
    payload: dict,
    db: DbSession,
    user: models.User = Depends(require_capability(rbac.RECORD_REVIEW, "resolve sync conflicts")),
    request: Request = None,
):
    """Resolve a conflict explicitly. Never overwrites silently."""
    conflict = db.get(models.SyncConflict, conflict_id)
    if not conflict:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conflict not found")
    resolution = payload.get("resolution")
    if resolution not in ("accept_submitted", "keep_existing", "reject"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="resolution must be one of: accept_submitted, keep_existing, reject",
        )

    created_event_id = None
    if resolution == "accept_submitted":
        patient = db.get(models.Patient, conflict.patient_id)
        if patient is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
        submitted = json.loads(conflict.submitted_payload)
        # Still guarded by the idempotency key, so a double resolution cannot duplicate.
        already = (
            db.query(models.VaccinationEvent)
            .filter_by(client_event_id=conflict.client_event_id)
            .first()
        )
        if already is not None:
            created_event_id = already.id
        else:
            from .offline import validate_event_payload
            normalized, errors = validate_event_payload(submitted)
            if errors:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="; ".join(errors))
            vaccine = db.query(models.Vaccine).filter_by(code=normalized["vaccine_code"]).first()
            if vaccine is None:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown vaccine code")
            event = models.VaccinationEvent(
                patient_id=patient.id,
                vaccine_code=vaccine.code,
                vaccine_name=vaccine.name,
                dose_label=normalized["dose_label"],
                administered_at=normalized["administered_at"],
                facility=normalized.get("facility"),
                batch_number=normalized.get("batch_number"),
                source_record_id=normalized.get("source_record_id"),
                is_verified=False,
                source="offline_sync",
                client_event_id=conflict.client_event_id,
                recorded_at=normalized.get("recorded_at"),
                sync_status="synchronized",
            )
            db.add(event)
            db.flush()
            created_event_id = event.id
            _persist_recommendations(db, patient)

    conflict.status = "resolved" if resolution != "reject" else "rejected"
    conflict.resolved_by = user.id
    conflict.resolved_at = datetime.utcnow()
    db.commit()
    _audit(db, user, "resolve_conflict", "sync_conflicts", conflict_id,
           {"resolution": resolution, "created_event_id": created_event_id}, request)
    return {"id": conflict.id, "status": conflict.status, "resolution": resolution,
            "created_vaccination_event_id": created_event_id}


# --------------------------------------------------------------------------- #
# Record reconciliation (event level)
# --------------------------------------------------------------------------- #

@app.get("/api/v1/patients/{patient_id}/record-issues")
def list_record_issues(patient_id: str, db: DbSession, user: models.User = Depends(require_user)):
    """Duplicate and conflicting vaccination events for one patient.

    Detection only: no event is merged, modified, or deleted here.
    """
    patient = _require_patient_access(db, user, patient_id)
    issues = detect_event_issues(db, patient.id)
    return {
        "patient_id": patient.patient_id,
        "issue_count": len(issues),
        "issues": issues,
        "note": (
            "Detection only. Ambiguous identities are never merged automatically and no "
            "historical record is deleted because a duplicate is suspected."
        ),
    }


@app.post("/api/v1/record-matches/detect-identities")
def detect_identities(db: DbSession, user: models.User = Depends(require_capability(rbac.RECORD_REVIEW, "run identity match detection")), request: Request = None):
    """Detect patient-identity near-duplicate candidates and persist new ones."""
    candidates = detect_identity_candidates(db)
    created = []
    for c in candidates:
        exists = (
            db.query(models.RecordMatchCandidate)
            .filter(
                or_(
                    (models.RecordMatchCandidate.patient_id == c["patient_id"])
                    & (models.RecordMatchCandidate.candidate_patient_id == c["candidate_patient_id"]),
                    (models.RecordMatchCandidate.patient_id == c["candidate_patient_id"])
                    & (models.RecordMatchCandidate.candidate_patient_id == c["patient_id"]),
                )
            )
            .first()
        )
        if exists:
            continue
        rec = models.RecordMatchCandidate(
            patient_id=c["patient_id"],
            candidate_patient_id=c["candidate_patient_id"],
            match_score=c["match_score"],
            evidence=json.dumps(c["evidence"]),
            conflicting_fields=json.dumps(c["conflicting_fields"]),
            status="pending",
        )
        db.add(rec)
        db.flush()
        created.append({**c, "candidate_record_id": rec.id})
    db.commit()
    _audit(db, user, "detect_identities", "record_match_candidates", None,
           {"candidates_found": len(candidates), "new_records": len(created)}, request)
    return {
        "candidates_found": len(candidates),
        "new_candidates_persisted": len(created),
        "candidates": created,
        "note": "Candidates are surfaced for review. Identities are never merged automatically.",
    }


@app.get("/api/v1/terminology/map")
def map_terminology(
    name: str,
    db: DbSession,
    user: models.User = Depends(require_user),
    dose_label: Optional[str] = None,
):
    """Map a free-text vaccine name to the controlled terminology.

    Returns no code when nothing matches confidently, rather than guessing.
    Pass ``dose_label`` to resolve dose-specific catalogue entries, so that
    "Pentavalent" + "Dose 3" yields PENTA3 rather than PENTA1.
    """
    code, method = map_vaccine_name(name)
    vaccine, resolved_method = resolve_vaccine_code(db, name, dose_label=dose_label)
    return {
        "input": name,
        "dose_label": dose_label,
        "vaccine_code": code,
        "method": method,
        "mapped": code is not None,
        # The dose-aware resolution is what document finalization actually uses.
        "resolved_vaccine_code": vaccine.code if vaccine else None,
        "resolved_vaccine_name": vaccine.name if vaccine else None,
        "resolution_method": resolved_method,
        "note": (
            "A language model may assist with normalization but must not invent a vaccine name or date."
            if code is None else "Mapped from the controlled terminology table."
        ),
    }


# --------------------------------------------------------------------------- #
# Outreach prioritization (explainable scoring)
# --------------------------------------------------------------------------- #

@app.post("/api/v1/outreach/{task_id}/prioritize")
def prioritize_task(task_id: str, db: DbSession, user: models.User = Depends(require_capability(rbac.OUTREACH_MANAGE, "prioritize outreach tasks")), request: Request = None):
    """Recompute a task's priority from its current evidence.

    Stores the factors and weights that produced the score so the ranking is
    auditable. This is operational triage, not medical-risk prediction.
    """
    task = db.get(models.OutreachTask, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    patient = db.get(models.Patient, task.patient_id)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    now = datetime.utcnow()

    # Due-date urgency from the earliest non-up-to-date recommendation.
    recs = db.query(models.Recommendation).filter_by(patient_id=patient.id).all()
    actionable = [r for r in recs if r.status in ("due", "potentially_overdue", "verification_required")]
    due_dates = [r.due_date for r in actionable if r.due_date]
    urgency, urgency_note = score_due_date_urgency(min(due_dates) if due_dates else task.due_date, now)

    # Record uncertainty from detected reconciliation issues.
    issues = detect_event_issues(db, patient.id)
    uncertainty, uncertainty_note = score_record_uncertainty(
        has_unverified_entries=any(i["type"] == "unverified_dose" for i in issues),
        has_conflicting_dates=any(i["type"] == "conflicting_dates" for i in issues),
        has_duplicate_candidates=any(i["type"] == "duplicate_event" for i in issues),
        is_incomplete_history=bool(actionable) and len(recs) > 0
        and sum(1 for r in recs if r.status == "up_to_date") <= max(1, len(recs) // 4),
    )

    # Previous unsuccessful follow-up.
    outcomes = [a.outcome for a in task.attempts if a.outcome]
    followup, followup_note = score_prior_followup(outcomes)

    # Service opportunity: an upcoming appointment and usable stock.
    upcoming_appt = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.patient_id == patient.id,
            models.Appointment.scheduled_at >= now,
            models.Appointment.status.in_(["requested", "confirmed"]),
        )
        .order_by(models.Appointment.scheduled_at)
        .first()
    )
    days_until = (upcoming_appt.scheduled_at - now).days if upcoming_appt else 999

    stock_available = True
    if actionable:
        code = actionable[0].vaccine_code
        vaccine = db.query(models.Vaccine).filter_by(code=code).first()
        if vaccine:
            usable = (
                db.query(models.InventoryBatch)
                .filter(
                    models.InventoryBatch.vaccine_id == vaccine.id,
                    models.InventoryBatch.status == "active",
                    models.InventoryBatch.expiry_date > now,
                )
                .all()
            )
            stock_available = any((b.quantity_received - b.quantity_used) > 0 for b in usable)

    opportunity, opportunity_note = score_service_opportunity(
        has_scheduled_appointment=upcoming_appt is not None,
        appointment_within_days=days_until,
        stock_available=stock_available,
    )

    factors = PriorityFactors(
        due_date_urgency=urgency,
        record_uncertainty=uncertainty,
        prior_unsuccessful_followup=followup,
        service_opportunity=opportunity,
        notes={
            "due_date_urgency": urgency_note,
            "record_uncertainty": uncertainty_note,
            "prior_unsuccessful_followup": followup_note,
            "service_opportunity": opportunity_note,
        },
    )
    result = calculate_priority(factors)

    task.priority_score = result.score
    task.priority_explanation = result.explanation
    db.commit()

    _audit(db, user, "prioritize", "outreach_tasks", task_id,
           {"score": result.score, "band": result.band}, request)

    return {
        "task_id": task.id,
        "score": result.score,
        "band": result.band,
        "explanation": result.explanation,
        "detail": build_explanation_payload(result),
        "disclaimer": "Operational triage score. Not a medical-risk prediction.",
    }


# --------------------------------------------------------------------------- #
# Digital vaccination record
# --------------------------------------------------------------------------- #

@app.get("/api/v1/patients/{patient_id}/digital-record")
def digital_record(patient_id: str, db: DbSession, user: models.User = Depends(require_user), request: Request = None):
    """Printable digital vaccination record with a signed, limited QR payload."""
    patient = _require_patient_access(db, user, patient_id)
    _audit(db, user, "generate_digital_record", "patients", patient.id, None, request)
    return build_digital_record(db, patient)


@app.get("/api/v1/records/verify")
def verify_record(token: str, db: DbSession):
    """Public verification endpoint for a signed record QR payload.

    Returns only a status summary. It never discloses the holder's identity or
    clinical history, so a scanned code cannot leak unrestricted PHI.
    """
    valid, body, reason = verify_signed_qr_payload(token)
    if not valid or body is None:
        return {"valid": False, "reason": reason}

    patient = db.query(models.Patient).filter_by(patient_id=body.get("pid")).first()
    return {
        "valid": True,
        "reason": reason,
        "record_reference": body.get("rid"),
        "issuing_instance": body.get("iss"),
        "issued_at": datetime.utcfromtimestamp(body["iat"]).isoformat() + "Z" if body.get("iat") else None,
        "expires_at": datetime.utcfromtimestamp(body["exp"]).isoformat() + "Z" if body.get("exp") else None,
        "summary": body.get("sum"),
        "record_found_in_registry": patient is not None,
        "official_status": (
            "Internally generated demonstration record. This is NOT an official government "
            "vaccination certificate."
        ),
        "note": (
            "Identity and clinical detail are deliberately withheld from this response. "
            "Authorized users must sign in to view the underlying record."
        ),
    }


# --------------------------------------------------------------------------- #
# Root
# --------------------------------------------------------------------------- #

@app.get("/")
def root():
    return {
        "name": "VAXBRIDGE AI",
        "status": "running",
        "demo_mode": DEMO_MODE,
        "database": "sqlite (demo)" if str(engine.url).startswith("sqlite") else str(engine.url),
        "docs": "/docs",
        "disclaimer": "Prototype demonstration. Not a government system. Not a substitute for CoWIN, U-WIN, ABDM, or any official immunisation registry.",
    }


def _request_context(request) -> dict:
    """Describe how this request reached the service, for proxy diagnostics.

    Cookie attributes depend on the scheme and site the *browser* used, which is
    not the scheme of the proxy-to-API hop. Reporting what the forwarding headers
    say makes a SameSite/Secure misconfiguration visible instead of letting it
    present as an inexplicable sign-out.
    """
    if request is None:
        return {"client_scheme": None, "forwarded_proto": None, "forwarded_host": None}
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip() or None
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or None
    return {
        "client_scheme": proto or getattr(request.url, "scheme", None),
        "forwarded_proto": proto,
        "forwarded_host": host,
        "forwarded_for": (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or None,
        "peer": request.client.host if request.client else None,
    }


def _health_payload(request=None) -> dict:
    """Liveness plus a real database round-trip.

    Reported under /api/v1 as well as /health because the web front end proxies
    only the /api/v1 prefix, so a browser-side health check has to live there.
    """
    database_ok = False
    database_error = None
    user_count = None
    db = SessionLocal()
    try:
        user_count = db.query(models.User).count()
        database_ok = True
    except Exception as exc:  # noqa: BLE001 - surfaced, never swallowed
        database_error = str(exc)
    finally:
        db.close()
    return {
        "status": "ok" if database_ok else "degraded",
        "database_connected": database_ok,
        "database_error": database_error,
        "seeded_users": user_count,
        "demo_mode": DEMO_MODE,
        "ocr_provider": "demo-ocr-fixture" if DEMO_MODE else "not configured",
        "server_time_utc": datetime.utcnow().isoformat() + "Z",
        "external_integrations": "none",
        "request_context": _request_context(request),
        "disclaimer": (
            "Prototype demonstration. Not a government system and not connected to CoWIN, "
            "U-WIN, ABDM or any official immunisation registry."
        ),
    }


@app.get("/health")
def health(request: Request):
    return _health_payload(request)


@app.get("/api/v1/health")
def api_health(request: Request):
    return _health_payload(request)
