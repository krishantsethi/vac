"""Offline-first synchronization service.

Field workers capture vaccination events without connectivity. Each event
carries a stable client-generated identifier so a retry after an interruption
cannot create a duplicate clinical record.

Rules enforced here:
  1. Every submitted event is validated on the server, independently of the client.
  2. Submission is idempotent on client_event_id.
  3. Unauthorized changes are rejected.
  4. Conflicting updates are recorded for review, never silently overwritten.
"""

import json
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from . import models
from .reconciliation import _dose_number, map_vaccine_name, parse_date_flexible

MAX_BATCH_SIZE = 100


class SyncError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def _parse_administered_at(raw: Any) -> Optional[datetime]:
    if isinstance(raw, datetime):
        return raw.replace(tzinfo=None) if raw.tzinfo else raw
    if isinstance(raw, str):
        dt, _fmt = parse_date_flexible(raw)
        return dt
    return None


def validate_event_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Server-side validation of one queued event.

    Returns (normalized_payload, errors). Never fabricates a missing value:
    an absent required field is an error, not a default.
    """
    errors: list[str] = []
    normalized: dict[str, Any] = {}

    client_event_id = payload.get("client_event_id")
    if not client_event_id or not isinstance(client_event_id, str):
        errors.append("client_event_id is required and must be a string")
    elif len(client_event_id) > 64:
        errors.append("client_event_id must be at most 64 characters")
    else:
        normalized["client_event_id"] = client_event_id.strip()

    patient_ref = payload.get("patient_id")
    if not patient_ref or not isinstance(patient_ref, str):
        errors.append("patient_id is required")
    else:
        normalized["patient_ref"] = patient_ref.strip()

    # Vaccine: accept either a catalogue code or a free-text name.
    vaccine_code = payload.get("vaccine_code")
    vaccine_name = payload.get("vaccine_name")
    if vaccine_code:
        normalized["vaccine_code"] = str(vaccine_code).strip().upper()
    elif vaccine_name:
        mapped, method = map_vaccine_name(vaccine_name)
        if mapped:
            normalized["vaccine_code"] = mapped
            normalized["terminology_method"] = method
        else:
            errors.append(
                f"vaccine_name '{vaccine_name}' could not be mapped to the controlled terminology; "
                "escalate for review rather than guessing"
            )
    else:
        errors.append("either vaccine_code or vaccine_name is required")

    dose_label = payload.get("dose_label")
    if not dose_label or not isinstance(dose_label, str):
        errors.append("dose_label is required")
    else:
        normalized["dose_label"] = dose_label.strip()

    administered_at = _parse_administered_at(payload.get("administered_at"))
    if administered_at is None:
        errors.append("administered_at is required and must be a parseable date")
    elif administered_at > datetime.utcnow():
        errors.append("administered_at cannot be in the future")
    else:
        normalized["administered_at"] = administered_at

    for optional in ("facility", "batch_number", "source_record_id"):
        value = payload.get(optional)
        if isinstance(value, str) and value.strip():
            normalized[optional] = value.strip()

    recorded_at = _parse_administered_at(payload.get("recorded_at"))
    if recorded_at is not None:
        normalized["recorded_at"] = recorded_at

    return normalized, errors


def resolve_patient(db: Session, ref: str) -> Optional[models.Patient]:
    """Resolve a patient by display id or UUID."""
    patient = db.query(models.Patient).filter_by(patient_id=ref).first()
    if patient is None:
        patient = db.get(models.Patient, ref)
    return patient


def is_authorized_for_patient(db: Session, user: models.User, patient: models.Patient) -> bool:
    """Authorization check for writing an event to a patient record."""
    if user.role in ("system_admin", "clinic_admin", "public_health_admin", "healthcare_worker"):
        return True
    if user.role == "caregiver":
        link = (
            db.query(models.CaregiverRelationship)
            .filter_by(caregiver_user_id=user.id, patient_id=patient.id, authorized=True)
            .first()
        )
        return link is not None
    if user.role == "patient":
        return patient.user_id == user.id
    return False


def _record_conflict(
    db: Session,
    *,
    client_event_id: str,
    patient: models.Patient,
    payload: dict[str, Any],
    conflict_type: str,
    detail: str,
    user: models.User,
) -> models.SyncConflict:
    conflict = models.SyncConflict(
        client_event_id=client_event_id,
        patient_id=patient.id,
        submitted_payload=json.dumps(payload, default=str),
        conflict_type=conflict_type,
        detail=detail,
        status="open",
        submitted_by=user.id,
    )
    db.add(conflict)
    return conflict


def _find_conflicting_existing(
    db: Session, patient: models.Patient, normalized: dict[str, Any]
) -> tuple[Optional[models.VaccinationEvent], str]:
    """Detect a stored record that conflicts with this submission.

    Returns (existing_event_or_None, conflict_type).
    """
    code = normalized["vaccine_code"]
    dose = _dose_number(normalized["dose_label"])
    date = normalized["administered_at"].date()

    same_dose = (
        db.query(models.VaccinationEvent)
        .filter_by(patient_id=patient.id, vaccine_code=code)
        .all()
    )
    same_dose = [e for e in same_dose if _dose_number(e.dose_label) == dose]

    for e in same_dose:
        if e.administered_at and e.administered_at.date() == date:
            return e, "duplicate_dose"

    if same_dose:
        return same_dose[0], "conflicting_date"

    return None, ""


def process_sync_batch(
    db: Session,
    user: models.User,
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    """Process a batch of queued offline events.

    Idempotent: replaying the same batch returns the same outcome and creates
    no new records. Conflicts are stored for review; nothing is overwritten.
    """
    if not isinstance(events, list):
        raise SyncError("events must be a list")
    if not events:
        raise SyncError("events list is empty")
    if len(events) > MAX_BATCH_SIZE:
        raise SyncError(f"batch exceeds the maximum of {MAX_BATCH_SIZE} events")

    results: list[dict[str, Any]] = []
    accepted = 0
    deduplicated = 0
    conflicted = 0
    rejected = 0

    for payload in events:
        if not isinstance(payload, dict):
            rejected += 1
            results.append({"status": "rejected", "reason": "event must be an object"})
            continue

        normalized, errors = validate_event_payload(payload)
        client_event_id = str(payload.get("client_event_id") or "").strip() or None

        if errors:
            rejected += 1
            if client_event_id:
                patient = resolve_patient(db, normalized.get("patient_ref", "")) if normalized.get("patient_ref") else None
                if patient is not None:
                    _record_conflict(
                        db,
                        client_event_id=client_event_id,
                        patient=patient,
                        payload=payload,
                        conflict_type="invalid",
                        detail="; ".join(errors),
                        user=user,
                    )
            results.append({
                "client_event_id": client_event_id,
                "status": "rejected",
                "errors": errors,
            })
            continue

        patient = resolve_patient(db, normalized["patient_ref"])
        if patient is None:
            rejected += 1
            results.append({
                "client_event_id": client_event_id,
                "status": "rejected",
                "errors": [f"patient '{normalized['patient_ref']}' not found"],
            })
            continue

        if not is_authorized_for_patient(db, user, patient):
            rejected += 1
            _record_conflict(
                db,
                client_event_id=client_event_id,
                patient=patient,
                payload=payload,
                conflict_type="unauthorized",
                detail=f"user {user.id} ({user.role}) is not authorized to write to this patient",
                user=user,
            )
            results.append({
                "client_event_id": client_event_id,
                "status": "rejected",
                "errors": ["not authorized for this patient"],
            })
            continue

        # Idempotency: this client_event_id has already been processed.
        existing_by_id = (
            db.query(models.VaccinationEvent)
            .filter_by(client_event_id=client_event_id)
            .first()
        )
        if existing_by_id is not None:
            deduplicated += 1
            results.append({
                "client_event_id": client_event_id,
                "status": "deduplicated",
                "vaccination_event_id": existing_by_id.id,
                "message": "this event was already synchronized; no duplicate was created",
            })
            continue

        # Conflict detection against stored records.
        conflicting, conflict_type = _find_conflicting_existing(db, patient, normalized)
        if conflicting is not None:
            conflicted += 1
            detail = (
                f"a verified record for {normalized['vaccine_code']} dose "
                f"{_dose_number(normalized['dose_label'])} already exists"
            )
            if conflict_type == "conflicting_date":
                detail += (
                    f" dated {conflicting.administered_at.date().isoformat()}, which differs from the "
                    f"submitted {normalized['administered_at'].date().isoformat()}"
                )
            _record_conflict(
                db,
                client_event_id=client_event_id,
                patient=patient,
                payload=payload,
                conflict_type=conflict_type,
                detail=detail,
                user=user,
            )
            results.append({
                "client_event_id": client_event_id,
                "status": "conflict_requires_review",
                "conflict_type": conflict_type,
                "existing_event_id": conflicting.id,
                "message": (
                    "the submitted event conflicts with an existing record and was NOT written. "
                    "It has been routed for human review; the stored record was left unchanged."
                ),
            })
            continue

        vaccine = db.query(models.Vaccine).filter_by(code=normalized["vaccine_code"]).first()
        if vaccine is None:
            rejected += 1
            _record_conflict(
                db,
                client_event_id=client_event_id,
                patient=patient,
                payload=payload,
                conflict_type="invalid",
                detail=f"vaccine code '{normalized['vaccine_code']}' is not in the catalogue",
                user=user,
            )
            results.append({
                "client_event_id": client_event_id,
                "status": "rejected",
                "errors": [f"unknown vaccine code '{normalized['vaccine_code']}'"],
            })
            continue

        event = models.VaccinationEvent(
            patient_id=patient.id,
            vaccine_code=vaccine.code,
            vaccine_name=vaccine.name,
            dose_label=normalized["dose_label"],
            administered_at=normalized["administered_at"],
            facility=normalized.get("facility"),
            batch_number=normalized.get("batch_number"),
            source_record_id=normalized.get("source_record_id"),
            # Offline submissions are never auto-verified: a human must confirm.
            is_verified=False,
            source="offline_sync",
            client_event_id=client_event_id,
            recorded_at=normalized.get("recorded_at"),
            sync_status="synchronized",
        )
        db.add(event)
        db.flush()
        accepted += 1
        results.append({
            "client_event_id": client_event_id,
            "status": "synchronized",
            "vaccination_event_id": event.id,
            "is_verified": False,
            "message": "saved and awaiting verification",
        })

    db.commit()

    return {
        "submitted": len(events),
        "accepted": accepted,
        "deduplicated": deduplicated,
        "conflicts": conflicted,
        "rejected": rejected,
        "results": results,
    }
