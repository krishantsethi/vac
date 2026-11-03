"""Scheduling engine tests (acceptance workflows B and D).

The engine is a deterministic rules evaluator. These tests pin down the
behaviour the rest of the product depends on, and in particular the central
honesty rule: **a missing database row is never treated as proof that a dose
was not given.**
"""

from datetime import datetime, timedelta

import pytest

from app import models
from app.scheduling.engine import (
    MISSING_RECORD_CAVEAT,
    RECOMMENDATION_STATUSES,
    _dose_number,
    calculate_recommendations,
)
from tests.conftest import auth


def by_code(recs, code):
    return next(r for r in recs if r["vaccine_code"] == code)


# --------------------------------------------------------------------------- #
# Dose label parsing
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("label,expected", [
    ("Birth dose", 1),
    ("birth dose", 1),
    ("Dose 1", 1),
    ("Dose 2", 2),
    ("Dose 3", 3),
    ("Booster", 1),
    ("booster dose", 1),
    ("", 0),
])
def test_dose_number_parsing(label, expected):
    assert _dose_number(label) == expected


# --------------------------------------------------------------------------- #
# Core status logic
# --------------------------------------------------------------------------- #

def test_every_active_rule_produces_a_recommendation(db, make_patient):
    patient = make_patient(age_days=90)
    recs = calculate_recommendations(db, patient)
    active_rules = db.query(models.ScheduleRule).count()
    assert len(recs) == active_rules
    assert len({r["rule_id"] for r in recs}) == active_rules


def test_statuses_come_from_a_fixed_vocabulary(db, make_patient):
    for age in (1, 60, 200, 400, 1000, 5000):
        recs = calculate_recommendations(db, make_patient(age_days=age, suffix=f"vocab-{age}"))
        for r in recs:
            assert r["status"] in RECOMMENDATION_STATUSES, f"unexpected status {r['status']}"


def test_verified_dose_is_up_to_date(db, make_patient):
    patient = make_patient(age_days=120, events=[
        {"vaccine_code": "BCG", "dose_label": "Birth dose", "days_ago": 118},
    ])
    recs = calculate_recommendations(db, patient)
    assert by_code(recs, "BCG")["status"] == "up_to_date"


def test_dose_not_yet_eligible_is_upcoming(db, make_patient):
    # MCV1 is eligible from 9 months; a 3-month-old is not yet due.
    patient = make_patient(age_days=90)
    rec = by_code(calculate_recommendations(db, patient), "MCV1")
    assert rec["status"] == "upcoming"
    assert rec["due_date"] > datetime.utcnow()


def test_eligible_dose_with_no_record_is_due(db, make_patient):
    # BCG is eligible from birth, so at 4 months with no record it is due.
    patient = make_patient(age_days=120)
    assert by_code(calculate_recommendations(db, patient), "BCG")["status"] == "due"


def test_past_window_becomes_potentially_overdue(db, make_patient):
    # DPT_BOOSTER: eligible 16 months, window max 24 months, grace 84 days.
    patient = make_patient(age_days=30 * 40)  # ~40 months
    assert by_code(calculate_recommendations(db, patient), "DPT_BOOSTER")["status"] == "potentially_overdue"


def test_due_date_is_derived_from_date_of_birth(db, make_patient):
    patient = make_patient(age_days=30)
    rec = by_code(calculate_recommendations(db, patient), "MCV1")  # min 9 months
    expected = patient.date_of_birth + timedelta(days=30.4375 * 9)
    assert abs((rec["due_date"] - expected).total_seconds()) < 60


# --------------------------------------------------------------------------- #
# The central honesty rule
# --------------------------------------------------------------------------- #

def test_missing_record_is_never_reported_as_a_confirmed_missed_dose(db, make_patient):
    patient = make_patient(age_days=120)
    recs = calculate_recommendations(db, patient)
    for rec in recs:
        if rec["status"] == "up_to_date":
            continue
        text = rec["explanation"]
        assert "no verified record" in text.lower(), (
            f"{rec['vaccine_code']} explanation does not state that the finding is a record gap"
        )
        # The caveat itself legitimately says "is not proof the dose was not
        # given"; strip it before scanning for overclaiming language.
        claim = text.replace(MISSING_RECORD_CAVEAT, "").lower()
        for forbidden in ("was not administered", "was not given", "never received", "did not receive"):
            assert forbidden not in claim, (
                f"{rec['vaccine_code']} explanation asserts non-administration from a missing row"
            )


def test_recommendations_derived_from_absence_carry_the_caveat(db, make_patient):
    patient = make_patient(age_days=120)
    recs = calculate_recommendations(db, patient)
    absent = [r for r in recs if r["status"] in ("due", "potentially_overdue", "upcoming")]
    assert absent, "fixture should produce recommendations based on absent records"
    for rec in absent:
        assert MISSING_RECORD_CAVEAT in rec["explanation"]


def test_unverified_record_is_distinguished_from_a_missing_dose(db, make_patient):
    """An incomplete record must not be reported the same way as no record.

    This is the distinction the whole product turns on: 'we have an entry we
    cannot confirm' is a different clinical situation from 'we have no entry'.
    """
    with_unverified = make_patient(age_days=120, suffix="unverified", events=[
        {"vaccine_code": "BCG", "dose_label": "Birth dose", "days_ago": 118, "is_verified": False},
    ])
    without_record = make_patient(age_days=120, suffix="norecord")

    flagged = by_code(calculate_recommendations(db, with_unverified), "BCG")
    plain = by_code(calculate_recommendations(db, without_record), "BCG")

    assert flagged["status"] == "verification_required"
    assert plain["status"] == "due"
    assert flagged["status"] != plain["status"]


def test_verified_record_wins_over_unverified_noise(db, make_patient):
    patient = make_patient(age_days=120, suffix="both", events=[
        {"vaccine_code": "BCG", "dose_label": "Birth dose", "days_ago": 118, "is_verified": True},
        {"vaccine_code": "BCG", "dose_label": "Birth dose", "days_ago": 100, "is_verified": False},
    ])
    assert by_code(calculate_recommendations(db, patient), "BCG")["status"] == "up_to_date"


# --------------------------------------------------------------------------- #
# Determinism and explainability
# --------------------------------------------------------------------------- #

def test_engine_is_deterministic(db, make_patient):
    patient = make_patient(age_days=200, suffix="determinism")
    first = calculate_recommendations(db, patient)
    second = calculate_recommendations(db, patient)
    key = lambda recs: sorted(
        (r["vaccine_code"], r["status"], r["rule_id"], r["explanation"]) for r in recs
    )
    assert key(first) == key(second)


def test_every_recommendation_cites_its_rule(db, make_patient):
    patient = make_patient(age_days=150, suffix="explain")
    for rec in calculate_recommendations(db, patient):
        assert rec["rule_id"], "recommendation must be traceable to a schedule rule"
        assert rec["rule_id"] in rec["explanation"]
        assert rec["schedule_version_id"]


# --------------------------------------------------------------------------- #
# API surface
# --------------------------------------------------------------------------- #

def test_recommendations_endpoint_returns_stored_recommendations(client, tokens, first_patient_id):
    r = client.get(f"/api/v1/patients/{first_patient_id}/recommendations", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    assert len(items) > 0
    for item in items:
        assert item["status"] in RECOMMENDATION_STATUSES
        assert item["explanation"]


def test_recalculate_is_restricted_to_clinical_write_roles(client, tokens, first_patient_id):
    url = f"/api/v1/patients/{first_patient_id}/recommendations/recalculate"
    assert client.post(url, headers=auth(tokens["healthcare_worker"])).status_code == 200
    assert client.post(url, headers=auth(tokens["clinic_admin"])).status_code == 200
    for role in ("public_health_admin", "system_admin", "patient", "caregiver"):
        assert client.post(url, headers=auth(tokens[role])).status_code == 403, role


def test_record_issues_endpoint_flags_uncertain_records(client, tokens, db):
    """The record-issues view is where 'incomplete record' is surfaced."""
    event = db.query(models.VaccinationEvent).filter_by(is_verified=False).first()
    assert event is not None, "seed data must contain unverified events"
    patient = db.get(models.Patient, event.patient_id)
    r = client.get(f"/api/v1/patients/{patient.patient_id}/record-issues", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    body = r.json()
    issues = body.get("issues", body if isinstance(body, list) else [])
    kinds = {i.get("issue_type") or i.get("type") for i in issues}
    assert kinds, f"expected at least one record issue, got {body}"


def test_record_issues_denied_to_unauthorized_roles(client, tokens, db):
    event = db.query(models.VaccinationEvent).filter_by(is_verified=False).first()
    patient = db.get(models.Patient, event.patient_id)
    assert client.get(
        f"/api/v1/patients/{patient.patient_id}/record-issues", headers=auth(tokens["system_admin"])
    ).status_code == 403
