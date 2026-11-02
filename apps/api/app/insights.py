"""Deterministic operational insights computed from the registry itself.

This is not AI and is never labelled as AI. Every number here is arithmetic
over rows that exist in the database, produced by ordinary code, available with
no network access and no key. It exists so that the "insights" surface of the
product is genuinely useful in core mode, and so that the optional generative
layer adds explanation rather than being the only source of substance.

Three honesty constraints shape the output:

* A missing row is never reported as a dose that was not given. Coverage is
  computed against *recorded* events for *registered* patients, and the
  denominator is stated every time.
* Every metric carries a `definition` string, so a reader can see exactly what
  was counted rather than trusting a label.
* Counts that would identify an individual are suppressed, matching the
  analytics module's existing threshold behaviour.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models

# Below this many patients a breakdown could identify someone in a small
# service area, so it is reported as suppressed rather than shown.
SUPPRESSION_THRESHOLD = 5

EXPIRY_WARNING_DAYS = 30
OVERDUE_GRACE_DAYS = 7


def _ratio(numerator: int, denominator: int) -> Optional[float]:
    return round(numerator / denominator * 100, 1) if denominator else None


def coverage_summary(db: Session) -> Dict[str, Any]:
    """Recorded coverage among registered patients. Not population coverage."""
    total_patients = db.query(func.count(models.Patient.id)).scalar() or 0
    patients_with_events = (
        db.query(func.count(func.distinct(models.VaccinationEvent.patient_id))).scalar() or 0
    )
    events = db.query(func.count(models.VaccinationEvent.id)).scalar() or 0
    verified = (
        db.query(func.count(models.VaccinationEvent.id))
        .filter(models.VaccinationEvent.is_verified.is_(True))
        .scalar() or 0
    )
    return {
        "metric": "recorded_coverage",
        "definition": (
            "Share of *registered* patients with at least one recorded vaccination "
            "event. This is completeness of the registry, not population coverage: "
            "patients who were never registered are absent from both numerator and "
            "denominator."
        ),
        "registered_patients": total_patients,
        "patients_with_recorded_events": patients_with_events,
        "coverage_percent": _ratio(patients_with_events, total_patients),
        "total_events": events,
        "verified_events": verified,
        "unverified_events": events - verified,
        "verification_percent": _ratio(verified, events),
    }


def gap_summary(db: Session) -> Dict[str, Any]:
    """Recommendations the rules engine has raised, split by why."""
    rows = (
        db.query(models.Recommendation.status, func.count(models.Recommendation.id))
        .group_by(models.Recommendation.status)
        .all()
    )
    by_status = {status: count for status, count in rows}
    now = datetime.utcnow()
    overdue = (
        db.query(func.count(models.Recommendation.id))
        .filter(
            models.Recommendation.due_date.isnot(None),
            models.Recommendation.due_date < now - timedelta(days=OVERDUE_GRACE_DAYS),
            models.Recommendation.status.in_(["due", "overdue", "pending", "missed"]),
        )
        .scalar() or 0
    )
    due_soon = (
        db.query(func.count(models.Recommendation.id))
        .filter(
            models.Recommendation.due_date.isnot(None),
            models.Recommendation.due_date >= now - timedelta(days=OVERDUE_GRACE_DAYS),
            models.Recommendation.due_date <= now + timedelta(days=30),
            models.Recommendation.status.in_(["due", "pending", "upcoming"]),
        )
        .scalar() or 0
    )
    return {
        "metric": "open_gaps",
        "definition": (
            "Recommendations produced by the deterministic rules engine. A gap is a "
            "dose the schedule expects and the registry does not record; an "
            "incomplete record is reported separately and is never treated as proof "
            "that a dose was not administered."
        ),
        "by_status": by_status,
        "total_recommendations": sum(by_status.values()),
        "overdue_beyond_grace": overdue,
        "due_within_30_days": due_soon,
        "grace_days": OVERDUE_GRACE_DAYS,
    }


def inventory_summary(db: Session) -> Dict[str, Any]:
    """Stock, and what is about to expire."""
    now = datetime.utcnow()
    horizon = now + timedelta(days=EXPIRY_WARNING_DAYS)
    batches = db.query(models.InventoryBatch).all()
    total_received = sum(b.quantity_received or 0 for b in batches)
    total_used = sum((b.quantity_used or 0) + (b.quantity_adjusted or 0) for b in batches)
    on_hand = max(total_received - total_used, 0)
    expiring = [b for b in batches if b.expiry_date and now <= b.expiry_date <= horizon]
    expired = [b for b in batches if b.expiry_date and b.expiry_date < now]
    expiring_units = sum(
        max((b.quantity_received or 0) - (b.quantity_used or 0) - (b.quantity_adjusted or 0), 0)
        for b in expiring
    )
    return {
        "metric": "inventory_position",
        "definition": (
            "Units on hand across all batches, computed as received minus used minus "
            "adjusted. Expiry figures count only remaining units in batches whose "
            "expiry date falls inside the warning window."
        ),
        "batches": len(batches),
        "units_received": total_received,
        "units_consumed": total_used,
        "units_on_hand": on_hand,
        "expiring_within_days": EXPIRY_WARNING_DAYS,
        "batches_expiring": len(expiring),
        "units_expiring": expiring_units,
        "batches_already_expired": len(expired),
    }


def review_backlog(db: Session) -> Dict[str, Any]:
    """Work that needs a human: conflicts, match candidates, unreviewed fields."""
    conflicts_open = (
        db.query(func.count(models.SyncConflict.id))
        .filter(models.SyncConflict.status.in_(["open", "pending", "unresolved"]))
        .scalar() or 0
    )
    matches_pending = (
        db.query(func.count(models.RecordMatchCandidate.id))
        .filter(models.RecordMatchCandidate.status.in_(["pending", "open", "unreviewed"]))
        .scalar() or 0
    )
    fields_pending = (
        db.query(func.count(models.ExtractedField.id))
        .filter(models.ExtractedField.requires_review.is_(True))
        .filter(models.ExtractedField.reviewed_by.is_(None))
        .scalar() or 0
    )
    return {
        "metric": "human_review_backlog",
        "definition": (
            "Items the system has deliberately refused to resolve on its own: "
            "sync conflicts, possible duplicate identities, and extracted document "
            "fields below the confidence threshold. Ambiguous identities are never "
            "auto-merged and history is never deleted on suspicion of a duplicate."
        ),
        "open_sync_conflicts": conflicts_open,
        "pending_match_candidates": matches_pending,
        "extracted_fields_awaiting_review": fields_pending,
        "total": conflicts_open + matches_pending + fields_pending,
    }


def outreach_summary(db: Session) -> Dict[str, Any]:
    rows = (
        db.query(models.OutreachTask.status, func.count(models.OutreachTask.id))
        .group_by(models.OutreachTask.status)
        .all()
    )
    by_status = {status: count for status, count in rows}
    return {
        "metric": "outreach_workload",
        "definition": (
            "Outreach tasks by status. A task is a suggested next step, not an "
            "obligation on the family; refusal and migration are recorded without "
            "penalty and never reduce a patient's standing in the registry."
        ),
        "by_status": by_status,
        "total": sum(by_status.values()),
    }


def service_area_breakdown(db: Session) -> List[Dict[str, Any]]:
    """Per-area counts, suppressing any area small enough to identify a patient."""
    rows = (
        db.query(
            models.Patient.service_area,
            func.count(models.Patient.id),
        )
        .group_by(models.Patient.service_area)
        .all()
    )
    out = []
    for area, count in rows:
        label = area or "unspecified"
        if count < SUPPRESSION_THRESHOLD:
            out.append({
                "service_area": label,
                "patients": None,
                "suppressed": True,
                "reason": f"fewer than {SUPPRESSION_THRESHOLD} patients; withheld to avoid re-identification",
            })
        else:
            out.append({"service_area": label, "patients": count, "suppressed": False})
    out.sort(key=lambda r: (r["suppressed"], -(r["patients"] or 0)))
    return out


def operational_insights(db: Session) -> Dict[str, Any]:
    """The complete deterministic picture, with provenance for every figure."""
    return {
        "generated_at_utc": datetime.utcnow().isoformat() + "Z",
        "source": "database",
        "engine": "deterministic",
        "note": (
            "Computed directly from registry rows by ordinary code. No model, no "
            "external service and no API key is involved, and none is required for "
            "this response to be complete."
        ),
        "coverage": coverage_summary(db),
        "gaps": gap_summary(db),
        "inventory": inventory_summary(db),
        "review_backlog": review_backlog(db),
        "outreach": outreach_summary(db),
        "service_areas": service_area_breakdown(db),
        "suppression_threshold": SUPPRESSION_THRESHOLD,
    }
