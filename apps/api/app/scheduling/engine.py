"""Deterministic vaccination scheduling engine.

Evaluates a patient's verified vaccination history against a versioned,
validated schedule ruleset and produces explainable recommendations.

This is a rules-based engine. No LLM is used as the authoritative scheduler.
"""

from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session

from .. import models


# The engine reasons about *records*, not about what did or did not happen
# clinically. A missing row is evidence that the record is incomplete; it is
# never proof that a dose was not given. Every recommendation derived from an
# absent record carries this caveat so downstream UI and exports cannot drop it.
MISSING_RECORD_CAVEAT = (
    "The absence of a record is not proof the dose was not given; "
    "verify with the family or the previous provider before treating this as a missed dose."
)

#: The complete status vocabulary this engine can emit.
RECOMMENDATION_STATUSES = frozenset({
    "up_to_date",
    "upcoming",
    "due",
    "potentially_overdue",
    "verification_required",
})


def _age_months(dob: datetime, reference: datetime) -> float:
    return (reference - dob).days / 30.4375


def _dose_number(label: str) -> int:
    """Parse a dose label into an integer dose number.

    Handles "Birth dose", "Dose 1", "Dose 2", "Booster", etc.
    """
    label = (label or "").lower().strip()
    if not label:
        return 0
    if "birth" in label:
        return 1
    if "booster" in label:
        return 1
    digits = "".join(ch for ch in label if ch.isdigit())
    return int(digits) if digits else 0


def calculate_recommendations(db: Session, patient: models.Patient) -> list:
    """Calculate schedule recommendations for a patient.

    Returns a list of recommendation dicts.
    """
    now = datetime.utcnow()
    dob = patient.date_of_birth
    if dob.tzinfo is not None:
        dob = dob.replace(tzinfo=None)
    age_months = _age_months(dob, now)

    # Active schedule version
    schedule = (
        db.query(models.ScheduleVersion)
        .filter(models.ScheduleVersion.is_active == True)  # noqa: E712
        .order_by(models.ScheduleVersion.created_at.desc())
        .first()
    )
    if schedule is None:
        schedule = (
            db.query(models.ScheduleVersion)
            .order_by(models.ScheduleVersion.created_at.desc())
            .first()
        )

    rules = []
    if schedule is not None:
        rules = (
            db.query(models.ScheduleRule)
            .filter_by(schedule_version_id=schedule.id)
            .order_by(models.ScheduleRule.rule_id)
            .all()
        )

    verified_events = (
        db.query(models.VaccinationEvent)
        .filter_by(patient_id=patient.id, is_verified=True)
        .all()
    )

    unverified_events = (
        db.query(models.VaccinationEvent)
        .filter_by(patient_id=patient.id, is_verified=False)
        .all()
    )

    recommendations = []
    for rule in rules:
        vcode = rule.vaccine_code
        dose_number = rule.dose_number
        matching = [e for e in verified_events if e.vaccine_code == vcode]
        administered_dose_numbers = {_dose_number(e.dose_label) for e in matching}

        min_months = rule.target_age_min_months
        max_months = rule.target_age_max_months

        eligible_min = age_months >= min_months

        due_date = None
        if dob is not None:
            due_date = dob + timedelta(days=30.4375 * min_months)

        if dose_number in administered_dose_numbers:
            status = "up_to_date"
            explanation = (
                f"{vcode} dose {dose_number} verified as administered "
                f"per rule {rule.rule_id}."
            )
        elif not eligible_min:
            status = "upcoming"
            explanation = (
                f"No verified record exists for {vcode} dose {dose_number}. "
                f"Eligible from {min_months} months of age (rule {rule.rule_id}). "
                f"Current age: {age_months:.1f} months, so this dose is not yet due. "
                + MISSING_RECORD_CAVEAT
            )
            due_date = dob + timedelta(days=30.4375 * min_months)
        elif max_months is not None and age_months > max_months:
            grace_days = rule.recommended_window_max_days or 28
            overdue_date = dob + timedelta(days=30.4375 * min_months + grace_days)
            if now > overdue_date:
                status = "potentially_overdue"
            else:
                status = "due"
            explanation = (
                f"{vcode} dose {dose_number} was due at {min_months} months "
                f"(rule {rule.rule_id}) and no verified record exists. "
                f"Window max age {max_months} months has been reached. "
                + MISSING_RECORD_CAVEAT
            )
        else:
            status = "due"
            explanation = (
                f"{vcode} dose {dose_number} is due now per rule {rule.rule_id} "
                f"(eligible from {min_months} months; current age {age_months:.1f} months). "
                f"No verified record exists. "
                + MISSING_RECORD_CAVEAT
            )

        # Conflicting/unverified events for same vaccine raise verification flag
        if unverified_events and any(e.vaccine_code == vcode for e in unverified_events):
            if status != "up_to_date":
                status = "verification_required"
                explanation += " Unverified record(s) exist for this vaccine; clinical review required before acting."

        recommendations.append({
            "vaccine_code": vcode,
            "rule_id": rule.rule_id,
            "status": status,
            "explanation": explanation,
            "schedule_version_id": schedule.id if schedule else None,
            "due_date": due_date,
        })

    return recommendations
