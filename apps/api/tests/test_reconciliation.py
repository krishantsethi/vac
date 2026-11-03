"""Reconciliation, terminology and document-workflow tests (workflows C, D, E).

Covers the promise that an incomplete or uncertain record is handled
differently from a genuinely missing dose, that ambiguous input is flagged
rather than silently interpreted, and that nothing is auto-merged or deleted.
"""

from datetime import datetime, timedelta

import pytest

from app import models
from app.reconciliation import (
    date_ambiguity,
    detect_event_issues,
    detect_identity_candidates,
    map_vaccine_name,
    normalize_text,
    parse_date_flexible,
    resolve_vaccine_code,
)
from tests.conftest import auth


# --------------------------------------------------------------------------- #
# Text normalization and controlled terminology
# --------------------------------------------------------------------------- #

def test_normalize_text_strips_punctuation_and_case():
    assert normalize_text("  Measles-Rubella,  Dose 1! ") == "measles-rubella dose 1"
    assert normalize_text(None) == ""


@pytest.mark.parametrize("name,expected", [
    ("BCG", "BCG"),
    ("pentavalent", "PENTA1"),
    ("Pentavalent 3", "PENTA3"),
    ("Hepatitis B", "HEPB0"),
    ("oral polio", "OPV0"),
    ("measles-rubella", "MCV1"),
    ("MR 2", "MCV2"),
    ("pneumococcal", "PCV1"),
    ("rotavirus", "ROTA1"),
    ("dpt booster", "DPT_BOOSTER"),
])
def test_terminology_maps_known_names(name, expected):
    code, method = map_vaccine_name(name)
    assert code == expected
    assert method != "no_confident_match"


@pytest.mark.parametrize("name", ["Banana Injection", "", "   ", "xyzzy", "Vitamin C"])
def test_terminology_refuses_to_guess_unknown_names(name):
    code, method = map_vaccine_name(name)
    assert code is None
    assert method in ("no_confident_match", "empty")


# --------------------------------------------------------------------------- #
# Dose-aware resolution
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("name,dose_label,expected", [
    ("Pentavalent", "Dose 3", "PENTA3"),
    ("Pentavalent", "Dose 1", "PENTA1"),
    ("Pentavalent", "Dose 2", "PENTA2"),
    ("Measles-Rubella", "Dose 2", "MCV2"),
    ("Rotavirus", "Dose 2", "ROTA2"),
    ("BCG", "Birth dose", "BCG"),
    ("Hepatitis B", "Birth dose", "HEPB0"),
    ("OPV", "Birth dose", "OPV0"),
    ("DPT", "Booster", "DPT_BOOSTER"),
    ("PENTA3", "Dose 3", "PENTA3"),
])
def test_resolver_uses_the_dose_label(db, name, dose_label, expected):
    """A substring match would file 'Pentavalent, Dose 3' under PENTA1."""
    vaccine, method = resolve_vaccine_code(db, name, dose_label)
    assert vaccine is not None, f"{name}/{dose_label} did not resolve"
    assert vaccine.code == expected


def test_resolver_returns_none_rather_than_guessing(db):
    vaccine, method = resolve_vaccine_code(db, "Banana Injection", "Dose 1")
    assert vaccine is None
    assert method == "no_confident_match"


def test_terminology_endpoint_exposes_dose_aware_resolution(client, tokens):
    r = client.get(
        "/api/v1/terminology/map",
        headers=auth(tokens["healthcare_worker"]),
        params={"name": "Pentavalent", "dose_label": "Dose 3"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["vaccine_code"] == "PENTA1"          # name-only mapping
    assert body["resolved_vaccine_code"] == "PENTA3"  # dose-aware resolution
    assert body["resolved_vaccine_name"]


def test_terminology_endpoint_reports_unmapped_input_honestly(client, tokens):
    r = client.get(
        "/api/v1/terminology/map",
        headers=auth(tokens["healthcare_worker"]),
        params={"name": "Banana Injection"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["mapped"] is False
    assert body["vaccine_code"] is None
    assert body["resolved_vaccine_code"] is None


# --------------------------------------------------------------------------- #
# Date parsing and ambiguity
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("value,expected", [
    ("2024-03-15", "2024-03-15"),
    ("15/03/2024", "2024-03-15"),
    ("15-03-2024", "2024-03-15"),
    ("15.03.2024", "2024-03-15"),
    ("15 March 2024", "2024-03-15"),
    ("March 15, 2024", "2024-03-15"),
    ("2024-03-15T10:30:00Z", "2024-03-15"),
])
def test_flexible_date_parsing(value, expected):
    parsed, fmt = parse_date_flexible(value)
    assert parsed is not None, f"{value} should parse"
    assert parsed.date().isoformat() == expected
    assert fmt


@pytest.mark.parametrize("value", ["not-a-date", "", None, "32/13/2024", "yesterday"])
def test_unparseable_dates_are_reported_not_guessed(value):
    parsed, fmt = parse_date_flexible(value)
    assert parsed is None


def test_day_first_reading_is_used_for_slash_dates():
    """Indian clinical records are day-first; 13/04 can only be 13 April."""
    parsed, fmt = parse_date_flexible("13/04/2026")
    assert parsed.date().isoformat() == "2026-04-13"


def test_ambiguous_dates_are_flagged():
    result = date_ambiguity("03/04/2026")
    assert result["ambiguous"] is True
    assert result["chosen"] == "2026-04-03"
    assert result["note"]
    assert len(set(result["alternatives"].values())) > 1


def test_unambiguous_dates_are_not_flagged():
    assert date_ambiguity("2026-04-03")["ambiguous"] is False
    assert date_ambiguity("13/04/2026")["ambiguous"] is False


def test_unparseable_date_reports_no_chosen_value():
    result = date_ambiguity("garbage")
    assert result["chosen"] is None
    assert result["ambiguous"] is False


# --------------------------------------------------------------------------- #
# Record issue detection
# --------------------------------------------------------------------------- #

def test_duplicate_same_day_events_are_detected(db, make_patient):
    patient = make_patient(age_days=200, suffix="rec-dup", events=[
        {"vaccine_code": "PENTA1", "dose_label": "Dose 1", "days_ago": 150},
        {"vaccine_code": "PENTA1", "dose_label": "Dose 1", "days_ago": 150, "batch_number": "OTHER"},
    ])
    issues = detect_event_issues(db, patient.id)
    kinds = {i["type"] for i in issues}
    assert "duplicate_event" in kinds
    dup = next(i for i in issues if i["type"] == "duplicate_event")
    assert len(dup["event_ids"]) == 2
    assert dup["recommended_action"]
    assert "Do not delete" in dup["recommended_action"]


def test_conflicting_dates_are_detected(db, make_patient):
    patient = make_patient(age_days=300, suffix="rec-conflict", events=[
        {"vaccine_code": "MCV1", "dose_label": "Dose 1", "days_ago": 200},
        {"vaccine_code": "MCV1", "dose_label": "Dose 1", "days_ago": 150},
    ])
    issues = detect_event_issues(db, patient.id)
    conflict = next((i for i in issues if i["type"] == "conflicting_dates"), None)
    assert conflict is not None
    assert conflict["severity"] == "high"
    assert len(conflict["dates"]) == 2
    assert "requires a human decision" in conflict["recommended_action"]


def test_unverified_dose_is_flagged_as_uncertain_not_missing(db, make_patient):
    patient = make_patient(age_days=200, suffix="rec-unverified", events=[
        {"vaccine_code": "ROTA1", "dose_label": "Dose 1", "days_ago": 120, "is_verified": False},
    ])
    issues = detect_event_issues(db, patient.id)
    unverified = next((i for i in issues if i["type"] == "unverified_dose"), None)
    assert unverified is not None
    assert "not evidence that a dose was given" in unverified["recommended_action"]


def test_clean_history_produces_no_issues(db, make_patient):
    patient = make_patient(age_days=300, suffix="rec-clean", events=[
        {"vaccine_code": "BCG", "dose_label": "Birth dose", "days_ago": 295},
        {"vaccine_code": "PENTA1", "dose_label": "Dose 1", "days_ago": 240},
        {"vaccine_code": "PENTA2", "dose_label": "Dose 2", "days_ago": 210},
    ])
    issues = detect_event_issues(db, patient.id)
    assert [i for i in issues if i["severity"] in ("high", "medium")] == []


def test_detection_never_modifies_or_deletes_records(db, make_patient):
    patient = make_patient(age_days=300, suffix="rec-readonly", events=[
        {"vaccine_code": "MCV1", "dose_label": "Dose 1", "days_ago": 200},
        {"vaccine_code": "MCV1", "dose_label": "Dose 1", "days_ago": 200},
    ])
    before = db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).count()
    detect_event_issues(db, patient.id)
    detect_event_issues(db, patient.id)
    db.expire_all()
    after = db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).count()
    assert before == after == 2


# --------------------------------------------------------------------------- #
# Identity matching — never auto-merge
# --------------------------------------------------------------------------- #

def test_identity_candidates_require_name_similarity_and_exact_dob(db, make_patient):
    dob = datetime.utcnow() - timedelta(days=400)
    a = make_patient(age_days=400, suffix="ident-a")
    b = make_patient(age_days=400, suffix="ident-b")
    # Force an exact DOB match and near-identical names.
    a.date_of_birth = dob
    a.first_name, a.last_name = "Aarav", "Sharma"
    b.date_of_birth = dob
    b.first_name, b.last_name = "Aarav", "Sharmaa"
    db.commit()

    candidates = detect_identity_candidates(db)
    ids = {
        tuple(sorted((c["patient_id"], c["candidate_patient_id"])))
        for c in candidates
    }
    assert tuple(sorted((a.id, b.id))) in ids, f"expected a match candidate, got {len(candidates)}"

    pair = next(
        c for c in candidates
        if tuple(sorted((c["patient_id"], c["candidate_patient_id"]))) == tuple(sorted((a.id, b.id)))
    )
    assert pair["evidence"]["name_similarity"] >= 0.82
    assert "date_of_birth" in pair["evidence"]["matched"]
    assert "never merged automatically" in pair["recommended_action"]


def test_same_name_different_dob_is_not_a_candidate(db, make_patient):
    a = make_patient(age_days=400, suffix="dob-a")
    b = make_patient(age_days=900, suffix="dob-b")
    a.first_name, a.last_name = "Identical", "Names"
    b.first_name, b.last_name = "Identical", "Names"
    db.commit()
    candidates = detect_identity_candidates(db)
    ids = set()
    for c in candidates:
        ids.add(c["patient_id"])
        ids.add(c["candidate_patient_id"])
    assert not ({a.id, b.id} <= ids), "different dates of birth must not produce a match"


def test_detecting_identities_does_not_merge_anything(client, tokens, db, make_patient):
    a = make_patient(age_days=400, suffix="nomerge-a")
    b = make_patient(age_days=400, suffix="nomerge-b")
    before = db.query(models.Patient).count()
    r = client.post("/api/v1/record-matches/detect-identities", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    db.expire_all()
    assert db.query(models.Patient).count() == before, "detection must never merge or delete patients"
    assert db.get(models.Patient, a.id) is not None
    assert db.get(models.Patient, b.id) is not None


def test_confirming_a_match_does_not_delete_history(client, tokens, db, make_patient):
    a = make_patient(age_days=400, suffix="confirm-a", events=[
        {"vaccine_code": "BCG", "dose_label": "Birth dose", "days_ago": 395},
    ])
    b = make_patient(age_days=400, suffix="confirm-b", events=[
        {"vaccine_code": "PENTA1", "dose_label": "Dose 1", "days_ago": 300},
    ])
    client.post("/api/v1/record-matches/detect-identities", headers=auth(tokens["clinic_admin"]))
    db.expire_all()

    events_before = db.query(models.VaccinationEvent).count()
    patients_before = db.query(models.Patient).count()

    candidate = db.query(models.RecordMatchCandidate).filter(
        models.RecordMatchCandidate.status == "pending"
    ).first()
    if candidate is None:
        pytest.skip("no pending candidate produced by the seeded/synthetic data")

    r = client.patch(
        f"/api/v1/record-matches/{candidate.id}",
        headers=auth(tokens["clinic_admin"]),
        json={"candidate_id": candidate.id, "decision": "confirmed", "reason": "Same child, two cards."},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"

    db.expire_all()
    # Confirming a duplicate never destroys records: both patients and all
    # events must still exist for a human to reconcile.
    assert db.query(models.Patient).count() == patients_before
    assert db.query(models.VaccinationEvent).count() == events_before
    assert db.get(models.Patient, a.id) is not None
    assert db.get(models.Patient, b.id) is not None


def test_invalid_match_decision_is_rejected(client, tokens, db):
    candidate = db.query(models.RecordMatchCandidate).first()
    if candidate is None:
        pytest.skip("no match candidate in the fixture data")
    r = client.patch(
        f"/api/v1/record-matches/{candidate.id}",
        headers=auth(tokens["clinic_admin"]),
        json={"candidate_id": candidate.id, "decision": "merge_and_delete"},
    )
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# Document workflow (C): upload -> review -> finalize
# --------------------------------------------------------------------------- #

def upload_card(client, token, patient_id, filename="card_aarav.png"):
    return client.post(
        "/api/v1/documents/upload",
        headers=auth(token),
        data={"patient_id": patient_id},
        files={"file": (filename, b"\x89PNG\r\n\x1a\n fake image bytes", "image/png")},
    )


def test_upload_is_labeled_as_demo_ocr(client, tokens, make_patient):
    patient = make_patient(age_days=200, suffix="doc-demo")
    r = upload_card(client, tokens["healthcare_worker"], patient.patient_id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["demo_mode"] is True

    doc = client.get(f"/api/v1/patients/{patient.patient_id}/documents", headers=auth(tokens["healthcare_worker"])).json()
    entry = next(d for d in doc if d["id"] == body["document_id"])
    assert entry["ocr_provider"] == "demo-ocr"


def test_demo_ocr_does_not_fabricate_a_confidence_score(client, tokens, make_patient):
    patient = make_patient(age_days=200, suffix="doc-conf")
    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    assert body["extracted_fields"]
    for field in body["extracted_fields"]:
        assert field["confidence"] is None, (
            "demo OCR supplies no confidence measure, so none may be reported"
        )


def test_upload_rejects_unsupported_file_types(client, tokens, make_patient):
    patient = make_patient(age_days=200, suffix="doc-type")
    r = client.post(
        "/api/v1/documents/upload",
        headers=auth(tokens["healthcare_worker"]),
        data={"patient_id": patient.patient_id},
        files={"file": ("payload.exe", b"MZ", "application/x-msdownload")},
    )
    assert r.status_code == 400


def test_upload_for_an_inaccessible_patient_is_refused(client, tokens, make_patient):
    patient = make_patient(age_days=200, suffix="doc-authz")
    r = upload_card(client, tokens["patient"], patient.patient_id)
    assert r.status_code == 403


def test_ambiguous_extracted_date_is_flagged_for_review(client, tokens, db, make_patient, monkeypatch):
    """An OCR date readable two ways must be surfaced, not silently chosen."""
    import app.main as main

    patient = make_patient(age_days=200, suffix="doc-ambiguous")
    monkeypatch.setattr(main, "_demo_ocr", lambda filename: {
        "vaccination_date": "03/04/2024",
        "vaccine_name": "Pentavalent",
        "dose_label": "Dose 3",
    })
    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    date_field = next(f for f in body["extracted_fields"] if f["field_name"] == "vaccination_date")
    assert date_field["requires_review"] is True
    assert date_field["review_note"]
    assert "03/04/2024" in date_field["review_note"]

    other = next(f for f in body["extracted_fields"] if f["field_name"] == "vaccine_name")
    assert other["requires_review"] is False


def test_unparseable_extracted_date_is_flagged(client, tokens, make_patient, monkeypatch):
    import app.main as main

    patient = make_patient(age_days=200, suffix="doc-baddate")
    monkeypatch.setattr(main, "_demo_ocr", lambda filename: {
        "vaccination_date": "sometime last year",
        "vaccine_name": "BCG",
        "dose_label": "Birth dose",
    })
    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    date_field = next(f for f in body["extracted_fields"] if f["field_name"] == "vaccination_date")
    assert date_field["requires_review"] is True
    assert "could not be parsed" in date_field["review_note"]


def approve_all_fields(client, token, document_id, approved=True):
    fields = client.get(f"/api/v1/documents/{document_id}/fields", headers=auth(token)).json()
    items = fields if isinstance(fields, list) else fields.get("items", [])
    for f in items:
        r = client.post(
            f"/api/v1/extracted-fields/{f['id']}/review",
            headers=auth(token),
            json={"field_id": f["id"], "approved": approved},
        )
        assert r.status_code == 200, r.text
    return items


def test_reviewing_fields_does_not_create_a_vaccination_event(client, tokens, db, make_patient):
    """Approving a field records a decision; it must not write clinical data."""
    patient = make_patient(age_days=200, suffix="doc-reviewonly")
    before = db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).count()

    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    approve_all_fields(client, tokens["healthcare_worker"], body["document_id"])

    db.expire_all()
    after = db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).count()
    assert after == before, "reviewing fields created a clinical record"


def test_finalize_requires_every_field_to_be_reviewed(client, tokens, db, make_patient):
    patient = make_patient(age_days=200, suffix="doc-partial")
    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    doc_id = body["document_id"]

    # Review exactly one field, then try to finalize.
    fields = client.get(f"/api/v1/documents/{doc_id}/fields", headers=auth(tokens["healthcare_worker"])).json()
    items = fields if isinstance(fields, list) else fields.get("items", [])
    client.post(
        f"/api/v1/extracted-fields/{items[0]['id']}/review",
        headers=auth(tokens["healthcare_worker"]),
        json={"field_id": items[0]["id"], "approved": True},
    )
    r = client.post(f"/api/v1/documents/{doc_id}/finalize", headers=auth(tokens["healthcare_worker"]))
    assert r.status_code == 400
    assert "awaiting review" in r.json()["detail"]


def test_finalize_requires_the_mandatory_fields_to_be_approved(client, tokens, db, make_patient):
    patient = make_patient(age_days=200, suffix="doc-reject")
    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    doc_id = body["document_id"]

    fields = client.get(f"/api/v1/documents/{doc_id}/fields", headers=auth(tokens["healthcare_worker"])).json()
    items = fields if isinstance(fields, list) else fields.get("items", [])
    for f in items:
        approved = f["field_name"] != "vaccine_name"  # reject the mandatory one
        client.post(
            f"/api/v1/extracted-fields/{f['id']}/review",
            headers=auth(tokens["healthcare_worker"]),
            json={"field_id": f["id"], "approved": approved},
        )
    r = client.post(f"/api/v1/documents/{doc_id}/finalize", headers=auth(tokens["healthcare_worker"]))
    assert r.status_code == 400
    assert "vaccine_name" in r.json()["detail"]


def test_full_document_workflow_creates_one_verified_event(client, tokens, db, make_patient):
    """Workflow C end to end: upload -> review -> finalize -> event + schedule."""
    patient = make_patient(age_days=400, suffix="doc-e2e")
    before = db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).count()

    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id, filename="card_aarav.png").json()
    doc_id = body["document_id"]
    approve_all_fields(client, tokens["healthcare_worker"], doc_id)

    r = client.post(f"/api/v1/documents/{doc_id}/finalize", headers=auth(tokens["healthcare_worker"]))
    assert r.status_code == 200, r.text
    event = r.json()
    # The card says "Pentavalent, Dose 3" — it must land on PENTA3, not PENTA1.
    assert event["vaccine_code"] == "PENTA3"
    assert event["dose_label"] == "Dose 3"
    assert event["is_verified"] is True
    assert event["source"] == "ocr"
    assert event["source_document_id"] == doc_id

    db.expire_all()
    assert db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).count() == before + 1

    # Finalization refreshes the stored schedule so downstream views agree.
    recs = client.get(
        f"/api/v1/patients/{patient.patient_id}/recommendations", headers=auth(tokens["healthcare_worker"])
    ).json()
    items = recs if isinstance(recs, list) else recs.get("items", [])
    penta3 = next(x for x in items if x["vaccine_code"] == "PENTA3")
    assert penta3["status"] == "up_to_date"


def test_finalize_twice_is_refused(client, tokens, db, make_patient):
    patient = make_patient(age_days=400, suffix="doc-twice")
    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    doc_id = body["document_id"]
    approve_all_fields(client, tokens["healthcare_worker"], doc_id)

    first = client.post(f"/api/v1/documents/{doc_id}/finalize", headers=auth(tokens["healthcare_worker"]))
    assert first.status_code == 200
    second = client.post(f"/api/v1/documents/{doc_id}/finalize", headers=auth(tokens["healthcare_worker"]))
    assert second.status_code == 409

    db.expire_all()
    assert db.query(models.VaccinationEvent).filter_by(patient_id=patient.id).count() == 1


def test_finalize_rejects_a_future_vaccination_date(client, tokens, make_patient, monkeypatch):
    import app.main as main

    patient = make_patient(age_days=400, suffix="doc-future")
    future = (datetime.utcnow() + timedelta(days=20)).date().isoformat()
    monkeypatch.setattr(main, "_demo_ocr", lambda filename: {
        "vaccination_date": future,
        "vaccine_name": "BCG",
        "dose_label": "Birth dose",
    })
    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    doc_id = body["document_id"]
    approve_all_fields(client, tokens["healthcare_worker"], doc_id)

    r = client.post(f"/api/v1/documents/{doc_id}/finalize", headers=auth(tokens["healthcare_worker"]))
    assert r.status_code == 400
    assert "future" in r.json()["detail"]


def test_finalize_refuses_an_unmappable_vaccine_name(client, tokens, make_patient, monkeypatch):
    import app.main as main

    patient = make_patient(age_days=400, suffix="doc-unmappable")
    monkeypatch.setattr(main, "_demo_ocr", lambda filename: {
        "vaccination_date": "2024-03-15",
        "vaccine_name": "Banana Injection",
        "dose_label": "Dose 1",
    })
    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    doc_id = body["document_id"]
    approve_all_fields(client, tokens["healthcare_worker"], doc_id)

    r = client.post(f"/api/v1/documents/{doc_id}/finalize", headers=auth(tokens["healthcare_worker"]))
    assert r.status_code == 422
    assert "not" in r.json()["detail"].lower()


def test_finalize_is_closed_to_oversight_and_admin_roles(client, tokens, db, make_patient):
    patient = make_patient(age_days=400, suffix="doc-rbac")
    body = upload_card(client, tokens["healthcare_worker"], patient.patient_id).json()
    doc_id = body["document_id"]
    approve_all_fields(client, tokens["healthcare_worker"], doc_id)

    for role in ("public_health_admin", "system_admin", "patient", "caregiver"):
        r = client.post(f"/api/v1/documents/{doc_id}/finalize", headers=auth(tokens[role]))
        assert r.status_code == 403, role
