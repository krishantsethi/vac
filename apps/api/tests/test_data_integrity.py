"""Seed and data-integrity invariants.

The demonstration dataset is synthetic, but it still has to be internally
coherent: analytics, scheduling and the UI all read it as though it were real.
These tests assert invariants that must hold for *every* row, so a bad fixture
cannot quietly teach the product to reason about impossible data.

One of them is a regression test: seeding an "unverified entry" for a child
younger than the offset used to produce a vaccination dated in the future.
"""

from datetime import datetime, timedelta

import pytest

from app import models
from app.inventory import available_quantity, is_expired


@pytest.fixture
def seeded_only(db):
    """Exclude synthetic TEST- rows created by other suites."""
    return db.query(models.Patient).filter(~models.Patient.patient_id.like("TEST-%")).all()


def test_no_vaccination_is_dated_in_the_future(db, seeded_only):
    now = datetime.utcnow()
    ids = {p.id for p in seeded_only}
    future = (
        db.query(models.VaccinationEvent)
        .filter(models.VaccinationEvent.patient_id.in_(ids))
        .filter(models.VaccinationEvent.administered_at > now)
        .all()
    )
    assert future == [], [
        f"{e.vaccine_code} {e.dose_label} dated {e.administered_at.date()}" for e in future
    ]


def test_no_vaccination_predates_the_patients_birth(db, seeded_only):
    bad = []
    for p in seeded_only:
        for e in p.vaccination_events:
            if e.administered_at < p.date_of_birth:
                bad.append((p.patient_id, e.vaccine_code, e.administered_at.date(), p.date_of_birth.date()))
    assert bad == []


def test_no_patient_has_a_future_date_of_birth(db, seeded_only):
    now = datetime.utcnow()
    assert [p.patient_id for p in seeded_only if p.date_of_birth > now] == []


def test_dose_ages_are_plausible_for_their_vaccine(db, seeded_only):
    """A birth dose cannot be recorded at 2 years old, nor MCV1 at 1 month."""
    min_age_days = {"BCG": 0, "HEPB0": 0, "OPV0": 0, "PENTA1": 45, "PENTA2": 75,
                    "PENTA3": 105, "ROTA1": 45, "ROTA2": 75, "IPV1": 105,
                    "MCV1": 240, "MCV2": 420, "DPT_BOOSTER": 450, "OPV_BOOSTER": 450}
    violations = []
    for p in seeded_only:
        for e in p.vaccination_events:
            floor = min_age_days.get(e.vaccine_code)
            if floor is None:
                continue
            age_days = (e.administered_at - p.date_of_birth).days
            # Allow a 30-day tolerance for recording lag.
            if age_days < floor - 30:
                violations.append((p.patient_id, e.vaccine_code, age_days, floor))
    assert violations == [], f"doses recorded before the minimum age: {violations[:5]}"


def test_every_event_references_a_catalogued_vaccine(db, seeded_only):
    codes = {v.code for v in db.query(models.Vaccine).all()}
    ids = {p.id for p in seeded_only}
    unknown = (
        db.query(models.VaccinationEvent.vaccine_code)
        .filter(models.VaccinationEvent.patient_id.in_(ids))
        .distinct()
        .all()
    )
    assert {c for (c,) in unknown} <= codes


def test_every_seeded_patient_has_persisted_recommendations(db, seeded_only):
    missing = [p.patient_id for p in seeded_only if not p.recommendations]
    assert missing == [], f"patients without stored recommendations: {missing[:5]}"


def test_recommendation_statuses_are_from_the_engine_vocabulary(db, seeded_only):
    from app.scheduling.engine import RECOMMENDATION_STATUSES
    ids = {p.id for p in seeded_only}
    statuses = {
        s for (s,) in db.query(models.Recommendation.status)
        .filter(models.Recommendation.patient_id.in_(ids)).distinct().all()
    }
    assert statuses <= RECOMMENDATION_STATUSES


def test_inventory_usage_never_exceeds_supply(db):
    over = []
    for b in db.query(models.InventoryBatch).all():
        if is_expired(b):
            continue
        if (b.quantity_used or 0) > (b.quantity_received or 0) + (b.quantity_adjusted or 0):
            over.append((b.batch_number, b.quantity_received, b.quantity_used, b.quantity_adjusted))
    assert over == [], f"batches issued more than they hold: {over}"


def test_available_quantity_is_never_negative(db):
    assert all(available_quantity(b) >= 0 for b in db.query(models.InventoryBatch).all())


def test_expired_batches_contribute_no_usable_stock(db):
    for b in db.query(models.InventoryBatch).all():
        if is_expired(b):
            assert available_quantity(b) == 0


def test_resolved_outreach_tasks_have_a_non_negative_duration(db):
    bad = []
    for t in db.query(models.OutreachTask).filter(models.OutreachTask.resolved_at.isnot(None)).all():
        if t.resolved_at < t.created_at:
            bad.append((t.id, t.created_at, t.resolved_at))
    assert bad == [], f"tasks resolved before they were created: {bad}"


def test_outreach_attempts_fall_inside_the_task_lifetime(db):
    bad = []
    for t in db.query(models.OutreachTask).all():
        for a in t.attempts:
            if a.attempted_at < t.created_at:
                bad.append((t.id, "attempt before creation"))
            elif a.attempted_at > datetime.utcnow():
                bad.append((t.id, "attempt in the future"))
    assert bad == [], bad[:5]


def test_appointments_are_not_before_the_patients_birth(db, seeded_only):
    bad = []
    for p in seeded_only:
        for a in p.appointments:
            if a.scheduled_at < p.date_of_birth:
                bad.append((p.patient_id, a.scheduled_at))
    assert bad == []


def test_caregiver_links_reference_existing_patients_and_users(db):
    for link in db.query(models.CaregiverRelationship).all():
        assert db.get(models.Patient, link.patient_id) is not None
        assert db.get(models.User, link.caregiver_user_id) is not None


def test_display_ids_are_unique(db):
    ids = [p.patient_id for p in db.query(models.Patient).all()]
    assert len(ids) == len(set(ids))


def test_seeded_population_is_large_enough_to_be_meaningful(db, seeded_only):
    """Analytics suppress small counts, so the fixture needs a real population."""
    assert len(seeded_only) >= 30
    assert len({p.service_area for p in seeded_only}) >= 5


def test_analytics_summary_reports_no_negative_durations(client, tokens):
    from tests.conftest import auth
    r = client.get("/api/v1/analytics/summary", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    body = r.json()
    assert body["median_days_to_resolution"] >= 0
    assert body["resolution_rate"] >= 0
    assert body["data_source"] == "demonstration database (synthetic)"


def test_summary_is_labeled_as_synthetic(client, tokens):
    """The dataset must announce that it is not real-world data."""
    from tests.conftest import auth
    body = client.get("/api/v1/analytics/summary", headers=auth(tokens["clinic_admin"])).json()
    assert "synthetic" in body["data_source"].lower()
