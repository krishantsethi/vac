"""Explainable outreach prioritization.

A configurable, deterministic operational scoring system. Factors are
normalized to 0-1, combined with documented weights, and every score carries
the arithmetic that produced it so a reviewer can audit the ranking.

This is operational triage. It is NOT a medical-risk prediction, and caregiver
refusal or migration is never used as a punitive factor.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional

# Documented weights. They sum to 1.0 so the final score reads as 0-100.
DEFAULT_WEIGHTS: dict[str, float] = {
    "due_date_urgency": 0.40,
    "record_uncertainty": 0.25,
    "prior_unsuccessful_followup": 0.20,
    "service_opportunity": 0.15,
}


@dataclass
class PriorityFactors:
    """Normalized factor inputs for one case, each in the range 0.0-1.0."""

    due_date_urgency: float = 0.0
    record_uncertainty: float = 0.0
    prior_unsuccessful_followup: float = 0.0
    service_opportunity: float = 0.0
    notes: dict[str, Any] = field(default_factory=dict)


@dataclass
class PriorityResult:
    score: float
    band: str
    factors: PriorityFactors
    weights: dict[str, float]
    contributions: dict[str, float]
    explanation: str


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def score_due_date_urgency(due_date: Optional[datetime], now: Optional[datetime] = None) -> tuple[float, str]:
    """Urgency rises as a validated due date passes.

    0.0 when there is no due date or it is comfortably in the future;
    1.0 once the date is 60+ days overdue.
    """
    now = now or datetime.utcnow()
    if due_date is None:
        return 0.0, "no validated due date available"
    if due_date.tzinfo is not None:
        due_date = due_date.replace(tzinfo=None)
    days_overdue = (now - due_date).days
    if days_overdue <= 0:
        # Not yet due: urgency grows as the date approaches (within 30 days).
        approaching = _clamp((-days_overdue) / 30.0, 0.0, 1.0)
        return round(0.35 * (1 - approaching), 3), f"due in {-days_overdue} day(s)"
    return round(_clamp(0.4 + 0.6 * (days_overdue / 60.0)), 3), f"{days_overdue} day(s) past the validated due date"


def score_record_uncertainty(
    *,
    has_unverified_entries: bool = False,
    has_conflicting_dates: bool = False,
    has_duplicate_candidates: bool = False,
    is_incomplete_history: bool = False,
) -> tuple[float, str]:
    """How much the record itself cannot be trusted yet."""
    reasons: list[str] = []
    score = 0.0
    if has_conflicting_dates:
        score += 0.40
        reasons.append("conflicting dates for the same dose")
    if has_duplicate_candidates:
        score += 0.20
        reasons.append("duplicate candidate records")
    if has_unverified_entries:
        score += 0.25
        reasons.append("unverified historical entries")
    if is_incomplete_history:
        score += 0.25
        reasons.append("history appears incomplete")
    if not reasons:
        return 0.0, "record is consistent and verified"
    return round(_clamp(score), 3), "; ".join(reasons)


def score_prior_followup(attempt_outcomes: list[str]) -> tuple[float, str]:
    """Weight of previous unsuccessful contact.

    Refusal and migration are treated as context for continuity, not as
    penalties: they contribute less than an unanswered attempt.
    """
    if not attempt_outcomes:
        return 0.0, "no previous contact attempts recorded"

    unsuccessful = [o for o in attempt_outcomes if o in ("unreachable", "attempted")]
    context = [o for o in attempt_outcomes if o in ("refused", "migrated")]
    resolved = [o for o in attempt_outcomes if o == "contacted"]

    if resolved and not unsuccessful:
        return 0.0, "previous contact was successful"

    score = min(len(unsuccessful), 3) * 0.25
    if context:
        score += 0.10  # continuity context only, deliberately small
    parts = []
    if unsuccessful:
        parts.append(f"{len(unsuccessful)} unsuccessful attempt(s)")
    if context:
        parts.append("location/consent context noted (not penalized)")
    return round(_clamp(score), 3), "; ".join(parts) if parts else "no escalating history"


def score_service_opportunity(
    *,
    has_scheduled_appointment: bool = False,
    appointment_within_days: int = 14,
    stock_available: bool = True,
    facility_accessible: bool = True,
) -> tuple[float, str]:
    """Whether an appropriate service opportunity exists to act now.

    Higher is better for acting: an upcoming appointment with stock on hand is
    the strongest opportunity.
    """
    if not facility_accessible:
        return 0.1, "no accessible service point recorded"
    if not stock_available:
        return 0.15, "required vaccine stock is not available"

    score = 0.35
    notes = ["service point accessible", "stock available"]
    if has_scheduled_appointment:
        bonus = 0.45 if appointment_within_days <= 14 else 0.25
        score += bonus
        notes.append(f"appointment scheduled within {appointment_within_days} day(s)")
    return round(_clamp(score), 3), "; ".join(notes)


def calculate_priority(
    factors: PriorityFactors,
    weights: Optional[dict[str, float]] = None,
) -> PriorityResult:
    """Combine normalized factors into a 0-100 score with a readable reason."""
    w = weights or DEFAULT_WEIGHTS
    total_weight = sum(w.values()) or 1.0

    contributions = {
        name: round(getattr(factors, name, 0.0) * w[name] / total_weight * 100, 2)
        for name in w
    }
    score = round(sum(contributions.values()), 2)

    if score >= 70:
        band = "high"
    elif score >= 40:
        band = "medium"
    else:
        band = "low"

    drivers = sorted(contributions.items(), key=lambda kv: kv[1], reverse=True)
    positive = [(k, v) for k, v in drivers if v > 0]

    if not positive:
        explanation = (
            "Priority is low because no factor is currently elevated: there is no overdue validated due date, "
            "the record is consistent, and no previous follow-up failed."
        )
    else:
        top = positive[0]
        label = top[0].replace("_", " ")
        note = factors.notes.get(top[0], "")
        explanation = f"Priority {band} ({score}/100), driven mainly by {label}"
        if note:
            explanation += f" — {note}"
        if len(positive) > 1:
            others = ", ".join(k.replace("_", " ") for k, _ in positive[1:3])
            explanation += f". Also contributing: {others}."
        explanation += (
            " This is an operational triage score, not a medical-risk prediction."
        )

    return PriorityResult(
        score=score,
        band=band,
        factors=factors,
        weights=w,
        contributions=contributions,
        explanation=explanation,
    )


def build_explanation_payload(result: PriorityResult) -> dict[str, Any]:
    """Persistable, auditable representation of how a score was produced."""
    return {
        "score": result.score,
        "band": result.band,
        "weights": result.weights,
        "factors": {
            "due_date_urgency": result.factors.due_date_urgency,
            "record_uncertainty": result.factors.record_uncertainty,
            "prior_unsuccessful_followup": result.factors.prior_unsuccessful_followup,
            "service_opportunity": result.factors.service_opportunity,
        },
        "contributions": result.contributions,
        "factor_notes": result.factors.notes,
        "explanation": result.explanation,
    }
