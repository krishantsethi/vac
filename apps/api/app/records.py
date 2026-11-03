"""Digital vaccination record generation.

Produces a printable record plus a QR payload that is:
  * signed with HMAC-SHA256 using a server-side secret,
  * deliberately minimal — no address, no phone number, no full history,
  * verified server-side, so scanning never exposes unrestricted PHI.

An internally generated record is never described as an official government
certificate.
"""

import base64
import hashlib
import hmac
import json
import os
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from . import models

RECORD_SECRET = os.getenv("VAULT_RECORD_SECRET", os.getenv("VAULT_SECRET_KEY", "dev-record-secret-change-me"))
RECORD_ISSUER = os.getenv("RECORD_ISSUER", "VAXBRIDGE AI demonstration instance")

# How long a signed record link stays valid (seconds).
RECORD_TTL_SECONDS = int(os.getenv("RECORD_TTL_SECONDS", str(60 * 60 * 24 * 30)))  # 30 days


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(payload_b64: str) -> str:
    digest = hmac.new(RECORD_SECRET.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64url(digest)[:32]


def build_record_id(patient: models.Patient) -> str:
    """Stable, non-sequential record identifier for a patient."""
    raw = f"{patient.id}:{patient.patient_id}".encode("utf-8")
    return "VBR-" + hashlib.sha256(raw).hexdigest()[:12].upper()


def build_signed_qr_payload(patient: models.Patient, event_count: int, verified_count: int) -> str:
    """Create the compact signed payload encoded into the QR code.

    Contains only: a record reference, the display patient id, a status
    summary, the issuing instance, and an expiry. No name, no date of birth,
    no address, no contact details, no per-dose clinical detail.
    """
    now = datetime.utcnow()
    body = {
        "v": 1,
        "rid": build_record_id(patient),
        "pid": patient.patient_id,
        "sum": {"events": event_count, "verified": verified_count},
        "iss": RECORD_ISSUER,
        "iat": int(now.timestamp()),
        "exp": int(now.timestamp()) + RECORD_TTL_SECONDS,
    }
    payload_b64 = _b64url(json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_signed_qr_payload(token: str) -> tuple[bool, Optional[dict[str, Any]], str]:
    """Verify signature and expiry of a QR payload.

    Returns (is_valid, decoded_body_or_None, reason).
    """
    if not token or "." not in token:
        return False, None, "malformed token"

    payload_b64, _, signature = token.rpartition(".")
    if not payload_b64 or not signature:
        return False, None, "malformed token"

    expected = _sign(payload_b64)
    if not hmac.compare_digest(expected, signature):
        return False, None, "signature mismatch"

    try:
        body = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return False, None, "payload could not be decoded"

    exp = body.get("exp")
    if isinstance(exp, int) and datetime.utcnow().timestamp() > exp:
        return False, body, "record link has expired"

    return True, body, "valid"


def build_digital_record(db: Session, patient: models.Patient) -> dict[str, Any]:
    """Assemble the full printable record for one patient."""
    events = (
        db.query(models.VaccinationEvent)
        .filter_by(patient_id=patient.id)
        .order_by(models.VaccinationEvent.administered_at)
        .all()
    )
    recommendations = (
        db.query(models.Recommendation)
        .filter_by(patient_id=patient.id)
        .order_by(models.Recommendation.due_date)
        .all()
    )
    schedule = (
        db.query(models.ScheduleVersion)
        .filter_by(is_active=True)
        .first()
    )

    verified = [e for e in events if e.is_verified]
    unverified = [e for e in events if not e.is_verified]

    qr_payload = build_signed_qr_payload(patient, len(events), len(verified))

    # Overall record verification status, described neutrally.
    if not events:
        record_status = "no_records"
        record_status_label = "No vaccination records held"
    elif unverified:
        record_status = "partially_verified"
        record_status_label = "Partially verified — some entries await review"
    else:
        record_status = "verified"
        record_status_label = "All recorded events verified"

    return {
        "record_id": build_record_id(patient),
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "issuing_organization": RECORD_ISSUER,
        "official_status": (
            "Internally generated demonstration record. This is NOT an official "
            "government vaccination certificate."
        ),
        "patient": {
            "patient_id": patient.patient_id,
            "name": f"{patient.first_name} {patient.last_name}",
            "date_of_birth": patient.date_of_birth.isoformat() if patient.date_of_birth else None,
            "gender": patient.gender,
            "service_area": patient.service_area,
        },
        "record_status": record_status,
        "record_status_label": record_status_label,
        "schedule_version": (
            {
                "source_name": schedule.source_name,
                "source_version": schedule.source_version,
                "effective_date": schedule.effective_date.isoformat() if schedule.effective_date else None,
                "approval_status": schedule.approval_status,
            }
            if schedule
            else None
        ),
        "events": [
            {
                "vaccine_code": e.vaccine_code,
                "vaccine_name": e.vaccine_name,
                "dose_label": e.dose_label,
                "administered_at": e.administered_at.isoformat() if e.administered_at else None,
                "facility": e.facility,
                "batch_number": e.batch_number,
                "is_verified": e.is_verified,
                "source": e.source,
            }
            for e in events
        ],
        "pending_items": [
            {
                "vaccine_code": r.vaccine_code,
                "rule_id": r.rule_id,
                "status": r.status,
                "due_date": r.due_date.isoformat() if r.due_date else None,
                "explanation": r.explanation,
            }
            for r in recommendations
            if r.status not in ("up_to_date",)
        ],
        "counts": {
            "total_events": len(events),
            "verified_events": len(verified),
            "unverified_events": len(unverified),
        },
        "qr": {
            "payload": qr_payload,
            "verification_path": f"/api/v1/records/verify?token={qr_payload}",
            "contains": [
                "record reference",
                "display patient id",
                "event and verified counts",
                "issuing instance",
                "issued-at and expiry timestamps",
            ],
            "does_not_contain": [
                "patient name",
                "date of birth",
                "address",
                "phone number",
                "per-dose clinical detail",
            ],
        },
        "verification_instructions": (
            "Scan the QR code or open the verification link to confirm this record's signature and "
            "expiry. The code resolves to a verification workflow and returns only a status summary — "
            "it does not disclose the holder's identity or clinical history. Anyone can check validity; "
            "only authorized users can view the underlying record."
        ),
    }
