"""Offline-first synchronization tests (acceptance workflow F).

The contract under test:
  1. Every event is validated server-side, independently of the client.
  2. Submission is idempotent on ``client_event_id`` — a retry after a dropped
     connection must never create a second clinical record.
  3. A submission that conflicts with a stored record is routed for human
     review and the stored record is left untouched.
  4. Offline submissions are never auto-verified.
"""

import uuid
from datetime import datetime, timedelta

import pytest

from app import models
from tests.conftest import DEMO_USERS, auth


SYNC = "/api/v1/vaccinations/sync"


def cid(prefix="evt"):
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


@pytest.fixture
def target_patient(db):
    """A patient with an existing verified event, used for conflict tests."""
    event = (
        db.query(models.VaccinationEvent)
        .filter(models.VaccinationEvent.is_verified == True)  # noqa: E712
        .first()
    )
    assert event is not None, "seed data must contain verified events"
    return db.get(models.Patient, event.patient_id), event


@pytest.fixture
def clean_patient(db):
    """A patient with no recorded events, so a sync cannot conflict."""
    used = {e.patient_id for e in db.query(models.VaccinationEvent).all()}
    patient = db.query(models.Patient).filter(~models.Patient.id.in_(used)).first()
    if patient is None:
        patient = db.query(models.Patient).order_by(models.Patient.patient_id.desc()).first()
    return patient


@pytest.fixture
def vaccine_code(db):
    v = db.query(models.Vaccine).first()
    return v.code


# --------------------------------------------------------------------------- #
# Authorization
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("role", ["patient", "caregiver", "public_health_admin", "system_admin"])
def test_sync_is_closed_to_non_clinical_write_roles(client, tokens, role):
    r = client.post(SYNC, headers=auth(tokens[role]), json={"events": []})
    assert r.status_code == 403


def test_sync_requires_authentication(client):
    assert client.post(SYNC, json={"events": []}).status_code in (401, 403)


def test_worker_may_sync(client, tokens):
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": []})
    # Authorized: the empty-batch rule fires (400), not an authorization error.
    assert r.status_code == 400


def test_clinic_admin_may_sync(client, tokens):
    r = client.post(SYNC, headers=auth(tokens["clinic_admin"]), json={"events": []})
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# Batch-level rules
# --------------------------------------------------------------------------- #

def test_missing_events_key_is_rejected(client, tokens):
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={})
    assert r.status_code == 400


def test_empty_batch_is_rejected(client, tokens):
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": []})
    assert r.status_code == 400


def test_non_list_events_is_rejected(client, tokens):
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": "not-a-list"})
    assert r.status_code == 400


def test_oversized_batch_is_rejected(client, tokens):
    r = client.post(
        SYNC,
        headers=auth(tokens["healthcare_worker"]),
        json={"events": [{"client_event_id": cid()} for _ in range(101)]},
    )
    assert r.status_code == 400
    assert "100" in r.json()["detail"]


# --------------------------------------------------------------------------- #
# Happy path
# --------------------------------------------------------------------------- #

def test_valid_event_is_saved_and_left_unverified(client, tokens, db, clean_patient, vaccine_code):
    event_id = cid("valid")
    r = client.post(
        SYNC,
        headers=auth(tokens["healthcare_worker"]),
        json={"events": [{
            "client_event_id": event_id,
            "patient_id": clean_patient.patient_id,
            "vaccine_code": vaccine_code,
            "dose_label": "Dose 1",
            "administered_at": (datetime.utcnow() - timedelta(days=10)).date().isoformat(),
            "facility": "Field Camp 4",
            "batch_number": "B-77812",
            "recorded_at": (datetime.utcnow() - timedelta(days=9)).isoformat(),
        }]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["submitted"] == 1
    assert body["accepted"] == 1
    assert body["results"][0]["status"] == "synchronized"
    assert body["results"][0]["is_verified"] is False

    db.expire_all()
    stored = db.query(models.VaccinationEvent).filter_by(client_event_id=event_id).one()
    # An offline capture is never auto-verified: a human must confirm it.
    assert stored.is_verified is False
    assert stored.source == "offline_sync"
    assert stored.sync_status == "synchronized"


def test_vaccine_name_is_mapped_to_controlled_terminology(client, tokens, db, clean_patient):
    event_id = cid("named")
    r = client.post(
        SYNC,
        headers=auth(tokens["healthcare_worker"]),
        json={"events": [{
            "client_event_id": event_id,
            "patient_id": clean_patient.patient_id,
            "vaccine_name": "BCG",
            "dose_label": "Birth dose",
            "administered_at": (datetime.utcnow() - timedelta(days=30)).date().isoformat(),
        }]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 1
    db.expire_all()
    stored = db.query(models.VaccinationEvent).filter_by(client_event_id=event_id).one()
    assert stored.vaccine_code == "BCG"


# --------------------------------------------------------------------------- #
# Idempotency
# --------------------------------------------------------------------------- #

def test_replaying_the_same_batch_creates_no_duplicate(client, tokens, db, clean_patient, vaccine_code):
    event = {
        "client_event_id": cid("replay"),
        "patient_id": clean_patient.patient_id,
        "vaccine_code": vaccine_code,
        "dose_label": "Dose 2",
        "administered_at": (datetime.utcnow() - timedelta(days=5)).date().isoformat(),
    }
    first = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [event]})
    assert first.status_code == 200
    assert first.json()["accepted"] == 1

    before = db.query(models.VaccinationEvent).filter_by(patient_id=clean_patient.id).count()

    second = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [event]})
    assert second.status_code == 200
    body = second.json()
    assert body["accepted"] == 0
    assert body["deduplicated"] == 1
    assert body["results"][0]["status"] == "deduplicated"

    db.expire_all()
    after = db.query(models.VaccinationEvent).filter_by(patient_id=clean_patient.id).count()
    assert after == before, "a replay created a duplicate clinical record"

    # And the same event id still resolves to exactly one row.
    assert db.query(models.VaccinationEvent).filter_by(client_event_id=event["client_event_id"]).count() == 1


def test_mixed_batch_reports_per_event_outcomes(client, tokens, db, clean_patient, vaccine_code):
    good = cid("mix-good")
    dupe = cid("mix-dupe")
    # Pre-create the duplicate so the batch has something to dedupe against.
    client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": dupe,
        "patient_id": clean_patient.patient_id,
        "vaccine_code": vaccine_code,
        "dose_label": "Dose 3",
        "administered_at": (datetime.utcnow() - timedelta(days=2)).date().isoformat(),
    }]})

    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [
        {
            "client_event_id": good,
            "patient_id": clean_patient.patient_id,
            "vaccine_code": vaccine_code,
            "dose_label": "Dose 4",
            "administered_at": (datetime.utcnow() - timedelta(days=1)).date().isoformat(),
        },
        {
            "client_event_id": dupe,
            "patient_id": clean_patient.patient_id,
            "vaccine_code": vaccine_code,
            "dose_label": "Dose 3",
            "administered_at": (datetime.utcnow() - timedelta(days=2)).date().isoformat(),
        },
        {"client_event_id": cid("mix-bad")},  # invalid: no patient/vaccine/date
    ]})
    assert r.status_code == 200
    body = r.json()
    assert body["submitted"] == 3
    assert body["accepted"] == 1
    assert body["deduplicated"] == 1
    assert body["rejected"] == 1
    assert body["accepted"] + body["deduplicated"] + body["rejected"] + body["conflicts"] == 3


# --------------------------------------------------------------------------- #
# Conflicts are never silently overwritten
# --------------------------------------------------------------------------- #

def test_conflicting_date_is_routed_for_review_and_not_written(client, tokens, db, target_patient):
    patient, existing = target_patient
    original_date = existing.administered_at
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("conflict"),
        "patient_id": patient.patient_id,
        "vaccine_code": existing.vaccine_code,
        "dose_label": existing.dose_label,
        "administered_at": (original_date - timedelta(days=21)).date().isoformat(),
    }]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["conflicts"] == 1
    assert body["accepted"] == 0
    result = body["results"][0]
    assert result["status"] == "conflict_requires_review"
    assert result["conflict_type"] == "conflicting_date"
    assert result["existing_event_id"] == existing.id

    # The stored record must be untouched.
    db.expire_all()
    still = db.get(models.VaccinationEvent, existing.id)
    assert still.administered_at == original_date


def test_exact_duplicate_dose_is_flagged(client, tokens, db, target_patient):
    patient, existing = target_patient
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("dupdose"),
        "patient_id": patient.patient_id,
        "vaccine_code": existing.vaccine_code,
        "dose_label": existing.dose_label,
        "administered_at": existing.administered_at.date().isoformat(),
    }]})
    assert r.status_code == 200
    body = r.json()
    assert body["conflicts"] == 1
    assert body["results"][0]["conflict_type"] == "duplicate_dose"


def test_conflicts_are_listed_for_review(client, tokens, db, target_patient):
    patient, existing = target_patient
    client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("listme"),
        "patient_id": patient.patient_id,
        "vaccine_code": existing.vaccine_code,
        "dose_label": existing.dose_label,
        "administered_at": (existing.administered_at - timedelta(days=9)).date().isoformat(),
    }]})
    r = client.get("/api/v1/vaccinations/conflicts", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    body = r.json()
    items = body["items"] if isinstance(body, dict) else body
    assert len(items) >= 1
    assert any(i.get("conflict_type") in ("conflicting_date", "duplicate_dose") for i in items)


def test_conflict_resolution_is_recorded(client, tokens, db, target_patient):
    patient, existing = target_patient
    client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("resolve"),
        "patient_id": patient.patient_id,
        "vaccine_code": existing.vaccine_code,
        "dose_label": existing.dose_label,
        "administered_at": (existing.administered_at - timedelta(days=11)).date().isoformat(),
    }]})
    listing = client.get("/api/v1/vaccinations/conflicts", headers=auth(tokens["clinic_admin"])).json()
    items = listing["items"] if isinstance(listing, dict) else listing
    open_conflict = next((i for i in items if i.get("status") == "open"), None)
    assert open_conflict is not None, "expected an unresolved conflict to review"

    r = client.patch(
        f"/api/v1/vaccinations/conflicts/{open_conflict['id']}",
        headers=auth(tokens["clinic_admin"]),
        json={"resolution": "keep_existing"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resolution"] == "keep_existing"
    assert body["status"] == "resolved"
    # Keeping the stored record must not create a new one.
    assert body["created_vaccination_event_id"] is None

    # The stored record is still exactly as it was.
    db.expire_all()
    still = db.get(models.VaccinationEvent, existing.id)
    assert still.administered_at == existing.administered_at


def test_invalid_resolution_value_is_rejected(client, tokens, db, target_patient):
    patient, existing = target_patient
    client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("badres"),
        "patient_id": patient.patient_id,
        "vaccine_code": existing.vaccine_code,
        "dose_label": existing.dose_label,
        "administered_at": (existing.administered_at - timedelta(days=13)).date().isoformat(),
    }]})
    listing = client.get("/api/v1/vaccinations/conflicts", headers=auth(tokens["clinic_admin"])).json()
    items = listing["items"] if isinstance(listing, dict) else listing
    open_conflict = next((i for i in items if i.get("status") == "open"), None)
    assert open_conflict is not None

    r = client.patch(
        f"/api/v1/vaccinations/conflicts/{open_conflict['id']}",
        headers=auth(tokens["clinic_admin"]),
        json={"resolution": "just_pick_one"},
    )
    assert r.status_code == 400
    assert "accept_submitted" in r.json()["detail"]


def test_accepting_a_submitted_conflict_creates_one_verified_false_event(client, tokens, db, target_patient):
    patient, existing = target_patient
    event_id = cid("accept")
    client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": event_id,
        "patient_id": patient.patient_id,
        "vaccine_code": existing.vaccine_code,
        "dose_label": existing.dose_label,
        "administered_at": (existing.administered_at - timedelta(days=17)).date().isoformat(),
    }]})
    listing = client.get("/api/v1/vaccinations/conflicts", headers=auth(tokens["clinic_admin"])).json()
    items = listing["items"] if isinstance(listing, dict) else listing
    conflict = next((i for i in items if i.get("client_event_id") == event_id), None)
    assert conflict is not None

    r = client.patch(
        f"/api/v1/vaccinations/conflicts/{conflict['id']}",
        headers=auth(tokens["clinic_admin"]),
        json={"resolution": "accept_submitted"},
    )
    assert r.status_code == 200, r.text
    created = r.json()["created_vaccination_event_id"]
    assert created

    db.expire_all()
    stored = db.query(models.VaccinationEvent).filter_by(client_event_id=event_id).all()
    # Resolving twice must not duplicate either.
    assert len(stored) == 1
    assert stored[0].is_verified is False

    r2 = client.patch(
        f"/api/v1/vaccinations/conflicts/{conflict['id']}",
        headers=auth(tokens["clinic_admin"]),
        json={"resolution": "accept_submitted"},
    )
    assert r2.status_code == 200
    db.expire_all()
    assert db.query(models.VaccinationEvent).filter_by(client_event_id=event_id).count() == 1


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("payload,expected_fragment", [
    ({"patient_id": "VAX-0001", "vaccine_code": "OPV1", "dose_label": "Dose 1",
      "administered_at": "2026-01-01"}, "client_event_id"),
    ({"client_event_id": "x", "vaccine_code": "OPV1", "dose_label": "Dose 1",
      "administered_at": "2026-01-01"}, "patient_id"),
    ({"client_event_id": "x", "patient_id": "VAX-0001", "dose_label": "Dose 1",
      "administered_at": "2026-01-01"}, "vaccine"),
    ({"client_event_id": "x", "patient_id": "VAX-0001", "vaccine_code": "OPV1",
      "administered_at": "2026-01-01"}, "dose_label"),
    ({"client_event_id": "x", "patient_id": "VAX-0001", "vaccine_code": "OPV1",
      "dose_label": "Dose 1"}, "administered_at"),
    ({"client_event_id": "x", "patient_id": "VAX-0001", "vaccine_code": "OPV1",
      "dose_label": "Dose 1", "administered_at": "not-a-date"}, "administered_at"),
])
def test_invalid_payloads_are_rejected_with_a_reason(client, tokens, payload, expected_fragment):
    body = dict(payload)
    if "client_event_id" in body and body["client_event_id"] == "x":
        body["client_event_id"] = cid("invalid")
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [body]})
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["rejected"] == 1
    assert result["accepted"] == 0
    errors = " ".join(result["results"][0].get("errors", []))
    assert expected_fragment in errors


def test_future_administered_date_is_rejected(client, tokens, clean_patient, vaccine_code):
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("future"),
        "patient_id": clean_patient.patient_id,
        "vaccine_code": vaccine_code,
        "dose_label": "Dose 1",
        "administered_at": (datetime.utcnow() + timedelta(days=30)).date().isoformat(),
    }]})
    assert r.status_code == 200
    assert r.json()["rejected"] == 1
    assert "future" in " ".join(r.json()["results"][0]["errors"])


def test_unmappable_vaccine_name_is_rejected_not_guessed(client, tokens, clean_patient):
    """An unknown free-text name must escalate, never be silently coerced."""
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("banana"),
        "patient_id": clean_patient.patient_id,
        "vaccine_name": "Banana Injection",
        "dose_label": "Dose 1",
        "administered_at": (datetime.utcnow() - timedelta(days=4)).date().isoformat(),
    }]})
    assert r.status_code == 200
    assert r.json()["rejected"] == 1


def test_unknown_patient_reference_is_rejected(client, tokens, vaccine_code):
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("ghost"),
        "patient_id": "VAX-DOES-NOT-EXIST",
        "vaccine_code": vaccine_code,
        "dose_label": "Dose 1",
        "administered_at": (datetime.utcnow() - timedelta(days=4)).date().isoformat(),
    }]})
    assert r.status_code == 200
    body = r.json()
    assert body["rejected"] == 1
    assert "not found" in " ".join(body["results"][0]["errors"])


def test_unknown_vaccine_code_is_rejected(client, tokens, clean_patient):
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("badcode"),
        "patient_id": clean_patient.patient_id,
        "vaccine_code": "NOT_A_VACCINE",
        "dose_label": "Dose 1",
        "administered_at": (datetime.utcnow() - timedelta(days=4)).date().isoformat(),
    }]})
    assert r.status_code == 200
    assert r.json()["rejected"] == 1


def test_non_object_event_is_rejected(client, tokens):
    r = client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": ["just-a-string"]})
    assert r.status_code == 200
    assert r.json()["rejected"] == 1


def test_sync_is_audited(client, tokens, clean_patient, vaccine_code):
    client.post(SYNC, headers=auth(tokens["healthcare_worker"]), json={"events": [{
        "client_event_id": cid("audited"),
        "patient_id": clean_patient.patient_id,
        "vaccine_code": vaccine_code,
        "dose_label": "Dose 1",
        "administered_at": (datetime.utcnow() - timedelta(days=3)).date().isoformat(),
    }]})
    r = client.get("/api/v1/audit?page_size=50", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    body = r.json()
    items = body["items"] if isinstance(body, dict) else body
    assert any(i.get("action") == "sync" for i in items)
