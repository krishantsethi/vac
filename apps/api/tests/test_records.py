"""Digital record / signed QR verification, and the offline sync contract.

These tests pin two promises the product makes explicitly:

1. A scanned record code proves *signature and expiry* and nothing more. It
   never discloses the holder's identity or their per-dose clinical history, and
   it is never described as an official government certificate.
2. A dose captured offline is never lost, never duplicated on replay, and never
   silently overwrites a stored record. Anything the server cannot accept stays
   visible as a conflict or a rejection rather than disappearing.
"""

import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta

import pytest

from app import models, records
from tests.conftest import auth

VERIFY = "/api/v1/records/verify"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _b64url_decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _repack(body: dict, signature: str) -> str:
    """Re-encode a decoded body under an existing (now stale) signature."""
    payload = _b64url_encode(json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
    return f"{payload}.{signature}"


def digital_record(client, tokens, display_id, role="clinic_admin"):
    return client.get(f"/api/v1/patients/{display_id}/digital-record", headers=auth(tokens[role]))


# --------------------------------------------------------------------------- #
# Digital record contents
# --------------------------------------------------------------------------- #

def test_digital_record_reports_its_own_counts_consistently(client, tokens, first_patient_id):
    r = digital_record(client, tokens, first_patient_id)
    assert r.status_code == 200
    body = r.json()

    counts = body["counts"]
    assert counts["total_events"] == len(body["events"])
    assert counts["verified_events"] == sum(1 for e in body["events"] if e["is_verified"])
    assert counts["unverified_events"] == sum(1 for e in body["events"] if not e["is_verified"])
    assert counts["verified_events"] + counts["unverified_events"] == counts["total_events"]


def test_record_status_label_matches_the_underlying_events(client, tokens, first_patient_id):
    body = digital_record(client, tokens, first_patient_id).json()
    counts = body["counts"]
    if counts["total_events"] == 0:
        assert body["record_status"] == "no_records"
    elif counts["unverified_events"]:
        assert body["record_status"] == "partially_verified"
    else:
        assert body["record_status"] == "verified"


def test_record_never_claims_to_be_an_official_certificate(client, tokens, first_patient_id):
    body = digital_record(client, tokens, first_patient_id).json()
    statement = body["official_status"].lower()
    assert "not an official" in statement
    assert "demonstration" in statement
    # No implied endorsement or government linkage anywhere in the document.
    blob = json.dumps(body).lower()
    for claim in ("cowin", "u-win", "abdm", "government-issued", "ministry of health"):
        assert claim not in blob


def test_record_declares_what_the_qr_excludes(client, tokens, first_patient_id):
    qr = digital_record(client, tokens, first_patient_id).json()["qr"]
    excluded = " ".join(qr["does_not_contain"]).lower()
    for term in ("patient name", "date of birth", "address", "phone number"):
        assert term in excluded


# --------------------------------------------------------------------------- #
# Signed QR verification
# --------------------------------------------------------------------------- #

def test_qr_payload_verifies_through_the_public_endpoint(client, tokens, first_patient_id):
    payload = digital_record(client, tokens, first_patient_id).json()["qr"]["payload"]
    r = client.get(VERIFY, params={"token": payload})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is True
    assert body["record_found_in_registry"] is True
    assert body["summary"]["events"] >= 0


def test_verification_needs_no_authentication(client, tokens, first_patient_id):
    """Anyone scanning the code can check validity — that is the point of it."""
    payload = digital_record(client, tokens, first_patient_id).json()["qr"]["payload"]
    unauthenticated = client.get(VERIFY, params={"token": payload})
    authenticated = client.get(VERIFY, params={"token": payload}, headers=auth(tokens["clinic_admin"]))
    assert unauthenticated.status_code == 200
    assert unauthenticated.json()["valid"] is True
    assert unauthenticated.json()["valid"] == authenticated.json()["valid"]


def test_verification_discloses_no_identity_and_no_clinical_detail(client, tokens, first_patient_id):
    record = digital_record(client, tokens, first_patient_id).json()
    payload = record["qr"]["payload"]
    response = client.get(VERIFY, params={"token": payload})
    assert response.status_code == 200

    blob = json.dumps(response.json()).lower()
    patient = record["patient"]

    # Identity must not leak through the public check.
    assert patient["name"].lower() not in blob
    for part in patient["name"].lower().split():
        if len(part) > 3:
            assert part not in blob
    if patient.get("date_of_birth"):
        assert patient["date_of_birth"][:10] not in blob

    # Neither may any per-dose clinical detail.
    for event in record["events"]:
        assert event["vaccine_code"].lower() not in blob
        if event.get("facility"):
            assert event["facility"].lower() not in blob


def test_tampered_payload_is_rejected(client, tokens, first_patient_id):
    """Editing the summary without the secret must not produce a valid code."""
    payload = digital_record(client, tokens, first_patient_id).json()["qr"]["payload"]
    body_b64, _, signature = payload.rpartition(".")
    body = json.loads(_b64url_decode(body_b64).decode())

    body["sum"]["verified"] = body["sum"]["verified"] + 500  # inflate the record
    forged = _repack(body, signature)

    response = client.get(VERIFY, params={"token": forged})
    assert response.status_code == 200
    assert response.json()["valid"] is False
    assert "signature" in response.json()["reason"].lower()


def test_swapped_signature_is_rejected(client, tokens, first_patient_id):
    """A signature from a different patient cannot be reused."""
    patients = client.get("/api/v1/patients?page_size=2", headers=auth(tokens["clinic_admin"])).json()["items"]
    assert len(patients) >= 2
    first = digital_record(client, tokens, patients[0]["patient_id"]).json()["qr"]["payload"]
    second = digital_record(client, tokens, patients[1]["patient_id"]).json()["qr"]["payload"]

    first_body, _, _ = first.rpartition(".")
    _, _, second_signature = second.rpartition(".")
    assert first_body != second.rpartition(".")[0]

    mixed = f"{first_body}.{second_signature}"
    response = client.get(VERIFY, params={"token": mixed})
    assert response.json()["valid"] is False


def test_expired_payload_is_rejected(client, tokens, first_patient_id):
    payload = digital_record(client, tokens, first_patient_id).json()["qr"]["payload"]
    body_b64, _, _ = payload.rpartition(".")
    body = json.loads(_b64url_decode(body_b64).decode())

    # Re-sign with the real secret so only the expiry differs; this isolates the
    # expiry check from the signature check.
    body["exp"] = int(datetime.utcnow().timestamp()) - 60
    expired_payload = _sign_with_secret(body)

    response = client.get(VERIFY, params={"token": expired_payload})
    assert response.status_code == 200
    assert response.json()["valid"] is False
    assert "expired" in response.json()["reason"].lower()


def _sign_with_secret(body: dict) -> str:
    """Sign a body exactly as the server does, using the configured secret."""
    payload = _b64url_encode(json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
    digest = hmac.new(
        records.RECORD_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256
    ).digest()
    return f"{payload}.{_b64url_encode(digest)[:32]}"


@pytest.mark.parametrize("token", ["", "nodothere", ".", "a.", ".b", "!!!.%%%"])
def test_malformed_tokens_are_rejected_without_a_500(client, token):
    response = client.get(VERIFY, params={"token": token})
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body.get("reason")


def test_record_id_is_stable_across_generations(client, tokens, first_patient_id):
    first = digital_record(client, tokens, first_patient_id).json()["record_id"]
    second = digital_record(client, tokens, first_patient_id).json()["record_id"]
    assert first == second
    assert first.startswith("VBR-")


# --------------------------------------------------------------------------- #
# Who may generate a record
# --------------------------------------------------------------------------- #

def test_patient_may_generate_their_own_record_but_not_another(client, tokens):
    own = client.get("/api/v1/patients?page_size=100", headers=auth(tokens["patient"])).json()["items"]
    assert own, "the seeded patient must see their own record"
    mine = own[0]["patient_id"]

    assert digital_record(client, tokens, mine, role="patient").status_code == 200

    others = client.get("/api/v1/patients?page_size=100", headers=auth(tokens["clinic_admin"])).json()["items"]
    foreign = next(p["patient_id"] for p in others if p["patient_id"] != mine)
    assert digital_record(client, tokens, foreign, role="patient").status_code == 403


def test_caregiver_is_limited_to_authorized_children(client, tokens, seeded_patient_ids):
    for display_id in seeded_patient_ids:
        assert digital_record(client, tokens, display_id, role="caregiver").status_code == 200

    all_patients = client.get(
        "/api/v1/patients?page_size=100", headers=auth(tokens["clinic_admin"])
    ).json()["items"]
    unauthorized = next(
        p["patient_id"] for p in all_patients if p["patient_id"] not in seeded_patient_ids
    )
    assert digital_record(client, tokens, unauthorized, role="caregiver").status_code == 403


def test_system_admin_has_no_clinical_record_access(client, tokens, first_patient_id):
    """Administering the platform must not grant access to patient health data."""
    r = digital_record(client, tokens, first_patient_id, role="system_admin")
    assert r.status_code == 403


def test_unauthenticated_record_generation_is_refused(client, first_patient_id):
    r = client.get(f"/api/v1/patients/{first_patient_id}/digital-record")
    assert r.status_code in (401, 403)


# --------------------------------------------------------------------------- #
# Offline sync — the exact payload the web client sends
# --------------------------------------------------------------------------- #

def _capture(display_id: str, *, client_event_id: str, vaccine_code="PENTA1",
             dose_label="Dose 1", days_ago=20, **extra) -> dict:
    """One queued capture, shaped exactly like apps/web/src/lib/offline.ts sends it."""
    payload = {
        "client_event_id": client_event_id,
        "patient_id": display_id,
        "vaccine_code": vaccine_code,
        "dose_label": dose_label,
        "administered_at": (datetime.utcnow() - timedelta(days=days_ago)).isoformat(),
        "facility": "Field Camp",
        "batch_number": None,
        "recorded_at": datetime.utcnow().isoformat(),
    }
    payload.update(extra)
    return payload


def test_sync_accepts_the_client_payload_shape(client, tokens, make_patient):
    patient = make_patient(400)
    r = client.post(
        "/api/v1/vaccinations/sync",
        headers=auth(tokens["healthcare_worker"]),
        json={"events": [_capture(patient.patient_id, client_event_id="ce-shape-1")]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["submitted"] == 1
    assert body["accepted"] == 1
    assert body["results"][0]["status"] == "synchronized"

    stored = client.get(
        f"/api/v1/patients/{patient.patient_id}/vaccinations", headers=auth(tokens["clinic_admin"])
    ).json()
    assert any(e["vaccine_code"] == "PENTA1" for e in stored)


def test_synced_doses_arrive_unverified(client, tokens, make_patient):
    """A field capture is never treated as confirmed until a human verifies it."""
    patient = make_patient(400)
    client.post(
        "/api/v1/vaccinations/sync",
        headers=auth(tokens["healthcare_worker"]),
        json={"events": [_capture(patient.patient_id, client_event_id="ce-unverified-1")]},
    )
    stored = client.get(
        f"/api/v1/patients/{patient.patient_id}/vaccinations", headers=auth(tokens["clinic_admin"])
    ).json()
    synced = [e for e in stored if e["source"] in ("offline_sync", "sync")]
    assert synced, "the synced event should be stored"
    assert all(e["is_verified"] is False for e in synced)


def test_replaying_the_same_batch_creates_no_duplicates(client, tokens, make_patient):
    patient = make_patient(400)
    batch = {"events": [_capture(patient.patient_id, client_event_id="ce-replay-1")]}

    first = client.post("/api/v1/vaccinations/sync", headers=auth(tokens["healthcare_worker"]), json=batch)
    second = client.post("/api/v1/vaccinations/sync", headers=auth(tokens["healthcare_worker"]), json=batch)
    third = client.post("/api/v1/vaccinations/sync", headers=auth(tokens["healthcare_worker"]), json=batch)
    assert first.status_code == second.status_code == third.status_code == 200

    assert first.json()["accepted"] == 1
    assert second.json()["accepted"] == 0
    assert second.json()["deduplicated"] == 1
    assert third.json()["deduplicated"] == 1

    stored = client.get(
        f"/api/v1/patients/{patient.patient_id}/vaccinations", headers=auth(tokens["clinic_admin"])
    ).json()
    penta = [e for e in stored if e["vaccine_code"] == "PENTA1" and e["dose_label"] == "Dose 1"]
    assert len(penta) == 1, f"replay created duplicates: {len(penta)}"


def test_result_counts_always_sum_to_the_submitted_total(client, tokens, make_patient):
    patient = make_patient(400)
    events = [
        _capture(patient.patient_id, client_event_id="ce-mix-1"),                       # accepted
        _capture(patient.patient_id, client_event_id="ce-mix-1"),                       # duplicate in batch
        _capture(patient.patient_id, client_event_id="ce-mix-2", days_ago=-5),          # future date
        _capture(patient.patient_id, client_event_id="ce-mix-3", vaccine_code="NOPE1"), # unknown code
    ]
    r = client.post(
        "/api/v1/vaccinations/sync", headers=auth(tokens["healthcare_worker"]), json={"events": events}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["submitted"] == len(events)
    assert len(body["results"]) == len(events)
    assert (
        body["accepted"] + body["deduplicated"] + body["conflicts"] + body["rejected"]
        == body["submitted"]
    )


def test_future_dated_capture_is_rejected_not_stored(client, tokens, make_patient):
    patient = make_patient(400)
    r = client.post(
        "/api/v1/vaccinations/sync",
        headers=auth(tokens["healthcare_worker"]),
        json={"events": [_capture(patient.patient_id, client_event_id="ce-future-1", days_ago=-30)]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["accepted"] == 0
    assert body["results"][0]["status"] == "rejected"

    stored = client.get(
        f"/api/v1/patients/{patient.patient_id}/vaccinations", headers=auth(tokens["clinic_admin"])
    ).json()
    assert stored == [], "a rejected capture must not be stored"


def test_missing_required_fields_are_rejected_with_a_reason(client, tokens, make_patient):
    patient = make_patient(400)
    incomplete = {"client_event_id": "ce-missing-1", "patient_id": patient.patient_id}
    r = client.post(
        "/api/v1/vaccinations/sync", headers=auth(tokens["healthcare_worker"]), json={"events": [incomplete]}
    )
    assert r.status_code == 200
    result = r.json()["results"][0]
    assert result["status"] == "rejected"
    # The server reports either a single `reason` or an `errors` list; either way
    # the worker must be told what was missing rather than getting a bare reject.
    explanation = result.get("reason") or " ".join(result.get("errors") or [])
    assert explanation, "the worker must be told what was missing"
    assert "dose_label" in explanation
    assert "administered_at" in explanation


def test_unmappable_vaccine_name_is_escalated_rather_than_guessed(client, tokens, make_patient):
    """A name that cannot be mapped confidently must never become some other vaccine."""
    patient = make_patient(400)
    r = client.post(
        "/api/v1/vaccinations/sync",
        headers=auth(tokens["healthcare_worker"]),
        json={
            "events": [
                {
                    "client_event_id": "ce-vague-1",
                    "patient_id": patient.patient_id,
                    "vaccine_name": "some injection given at camp",
                    "dose_label": "Dose 1",
                    "administered_at": (datetime.utcnow() - timedelta(days=10)).isoformat(),
                }
            ]
        },
    )
    assert r.status_code == 200
    assert r.json()["accepted"] == 0

    stored = client.get(
        f"/api/v1/patients/{patient.patient_id}/vaccinations", headers=auth(tokens["clinic_admin"])
    ).json()
    assert stored == [], "nothing should be recorded under a guessed vaccine"


def test_recognised_free_text_name_maps_to_the_catalogue(client, tokens, make_patient):
    patient = make_patient(400)
    r = client.post(
        "/api/v1/vaccinations/sync",
        headers=auth(tokens["healthcare_worker"]),
        json={
            "events": [
                {
                    "client_event_id": "ce-name-1",
                    "patient_id": patient.patient_id,
                    "vaccine_name": "BCG",
                    "dose_label": "Birth dose",
                    "administered_at": (datetime.utcnow() - timedelta(days=390)).isoformat(),
                }
            ]
        },
    )
    assert r.status_code == 200
    assert r.json()["accepted"] == 1
    stored = client.get(
        f"/api/v1/patients/{patient.patient_id}/vaccinations", headers=auth(tokens["clinic_admin"])
    ).json()
    assert any(e["vaccine_code"] == "BCG" for e in stored)


def test_conflicting_capture_leaves_the_stored_record_untouched(client, tokens, db, make_patient):
    """A disagreement is routed for review; the existing record is never overwritten."""
    patient = make_patient(400, events=[
        {"vaccine_code": "PENTA1", "dose_label": "Dose 1", "days_ago": 100, "is_verified": True},
    ])
    before = db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).first()
    original_date = before.administered_at

    r = client.post(
        "/api/v1/vaccinations/sync",
        headers=auth(tokens["healthcare_worker"]),
        json={
            "events": [
                _capture(patient.patient_id, client_event_id="ce-conflict-1",
                         vaccine_code="PENTA1", dose_label="Dose 1", days_ago=10)
            ]
        },
    )
    assert r.status_code == 200

    db.expire_all()
    after = db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).first()
    assert after.administered_at == original_date, "the stored dose must not be overwritten"

    response = client.get(
        "/api/v1/vaccinations/conflicts?page_size=50", headers=auth(tokens["clinic_admin"])
    )
    assert response.status_code == 200
    payload = response.json()
    items = payload if isinstance(payload, list) else payload.get("items", [])
    assert any(c.get("client_event_id") == "ce-conflict-1" for c in items), (
        "the disagreement should be waiting for a human decision"
    )


def test_sync_requires_clinical_write(client, tokens, make_patient):
    patient = make_patient(400)
    for role in ("patient", "caregiver", "system_admin", "public_health_admin"):
        r = client.post(
            "/api/v1/vaccinations/sync",
            headers=auth(tokens[role]),
            json={"events": [_capture(patient.patient_id, client_event_id=f"ce-deny-{role}")]},
        )
        assert r.status_code == 403, f"{role} should not be able to sync events"


def test_sync_refuses_an_empty_or_oversized_batch(client, tokens, make_patient):
    patient = make_patient(400)
    empty = client.post(
        "/api/v1/vaccinations/sync", headers=auth(tokens["healthcare_worker"]), json={"events": []}
    )
    assert empty.status_code in (400, 422)

    oversized = {
        "events": [
            _capture(patient.patient_id, client_event_id=f"ce-bulk-{i}") for i in range(101)
        ]
    }
    too_big = client.post(
        "/api/v1/vaccinations/sync", headers=auth(tokens["healthcare_worker"]), json=oversized
    )
    assert too_big.status_code in (400, 422)


def test_sync_without_an_events_key_is_refused(client, tokens):
    r = client.post(
        "/api/v1/vaccinations/sync", headers=auth(tokens["healthcare_worker"]), json={}
    )
    assert r.status_code in (400, 422)


def test_sync_rejects_a_capture_for_a_patient_id_that_does_not_exist(client, tokens):
    r = client.post(
        "/api/v1/vaccinations/sync",
        headers=auth(tokens["healthcare_worker"]),
        json={"events": [_capture("VAX-DOES-NOT-EXIST", client_event_id="ce-ghost-1")]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["accepted"] == 0
    assert body["results"][0]["status"] in ("rejected", "conflict_requires_review")
