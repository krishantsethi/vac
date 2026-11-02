"""Security and RBAC tests.

These exist because authorization has to be enforced on the server. Several of
them are regression tests for real holes found while building the app:

* ``GET /api/v1/outreach`` used to fall through unfiltered for the ``patient``
  role, exposing every follow-up task in the system.
* ``PATCH /api/v1/outreach/{id}`` blocked caregivers but not patients, so a
  patient could close a task about their own family.
* ``system_admin`` was accepted by every clinical role gate, which made
  "system administrator" an unrestricted clinical superuser.
"""

import pytest

from app import models
from tests.conftest import DEMO_USERS, auth


CLINICAL_ENDPOINTS = [
    "/api/v1/patients?page_size=5",
    "/api/v1/vaccinations?page_size=5",
    "/api/v1/documents?page_size=5",
    "/api/v1/outreach?page_size=5",
    "/api/v1/inventory/batches",
    "/api/v1/inventory/summary",
    "/api/v1/analytics/summary",
]


# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #

def test_protected_endpoints_reject_anonymous(client):
    for path in CLINICAL_ENDPOINTS:
        r = client.get(path)
        assert r.status_code in (401, 403), f"{path} returned {r.status_code} for an anonymous caller"


def test_login_rejects_wrong_password(client):
    r = client.post("/api/v1/auth/login", json={"email": DEMO_USERS["clinic_admin"][0], "password": "wrong-password"})
    assert r.status_code == 401


def test_login_rejects_unknown_email(client):
    r = client.post("/api/v1/auth/login", json={"email": "nobody@vaxbridge.demo", "password": "Clinic@12345"})
    assert r.status_code == 401


def test_login_rejects_malformed_body(client):
    r = client.post("/api/v1/auth/login", json={"email": "clinic@vaxbridge.demo"})
    assert r.status_code == 422


def test_tampered_token_is_rejected(client, tokens):
    good = tokens["clinic_admin"]
    # Flip a character in the signature segment.
    head, payload, sig = good.split(".")
    tampered = ".".join([head, payload, ("A" if sig[0] != "A" else "B") + sig[1:]])
    r = client.get("/api/v1/patients?page_size=1", headers=auth(tampered))
    assert r.status_code == 401


def test_token_for_wrong_scheme_is_rejected(client, tokens):
    r = client.get("/api/v1/patients?page_size=1", headers={"Authorization": tokens["clinic_admin"]})
    assert r.status_code == 401


def test_auth_me_returns_caller_identity(client, tokens):
    r = client.get("/api/v1/auth/me", headers=auth(tokens["healthcare_worker"]))
    assert r.status_code == 200
    assert r.json()["role"] == "healthcare_worker"


# --------------------------------------------------------------------------- #
# system_admin is not a clinical superuser
# --------------------------------------------------------------------------- #

def test_system_admin_cannot_list_patients(client, tokens):
    r = client.get("/api/v1/patients?page_size=100", headers=auth(tokens["system_admin"]))
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 0
    assert body["items"] == []


def test_system_admin_cannot_read_a_patient_record(client, tokens, first_patient_id):
    r = client.get(f"/api/v1/patients/{first_patient_id}", headers=auth(tokens["system_admin"]))
    assert r.status_code == 403


def test_system_admin_gets_no_rows_from_clinical_list_views(client, tokens):
    """List views fail *closed* to an empty set rather than erroring.

    A system administrator scoping into these endpoints receives zero rows, so
    nothing is disclosed even if a client ignores the UI and calls them directly.
    """
    for path in ("/api/v1/vaccinations?page_size=50", "/api/v1/documents?page_size=50"):
        r = client.get(path, headers=auth(tokens["system_admin"]))
        assert r.status_code == 200, f"{path} returned {r.status_code}"
        body = r.json()
        assert body["total"] == 0, f"{path} disclosed {body['total']} clinical rows to system_admin"
        assert body["items"] == []


def test_system_admin_cannot_see_analytics(client, tokens):
    for path in ("/api/v1/analytics/summary", "/api/v1/analytics/coverage-by-area", "/api/v1/analytics/inventory-levels"):
        r = client.get(path, headers=auth(tokens["system_admin"]))
        assert r.status_code == 403, f"{path} should be closed to system_admin"


def test_system_admin_cannot_record_a_vaccination(client, tokens, first_patient_id):
    r = client.post(
        f"/api/v1/patients/{first_patient_id}/vaccinations",
        headers=auth(tokens["system_admin"]),
        json={
            "vaccine_code": "OPV1",
            "vaccine_name": "Oral Polio Vaccine",
            "dose_label": "Dose 1",
            "administered_at": "2026-01-15",
            "facility": "Test Clinic",
        },
    )
    assert r.status_code == 403


def test_system_admin_can_administer_the_platform(client, tokens):
    assert client.get("/api/v1/users", headers=auth(tokens["system_admin"])).status_code == 200
    assert client.get("/api/v1/roles", headers=auth(tokens["system_admin"])).status_code == 200
    assert client.get("/api/v1/audit?page_size=5", headers=auth(tokens["system_admin"])).status_code == 200


# --------------------------------------------------------------------------- #
# Separation of duties: oversight roles read but do not write clinical records
# --------------------------------------------------------------------------- #

def test_public_health_admin_can_read_patients(client, tokens):
    r = client.get("/api/v1/patients?page_size=5", headers=auth(tokens["public_health_admin"]))
    assert r.status_code == 200
    assert r.json()["total"] > 0


def test_public_health_admin_cannot_write_a_vaccination_event(client, tokens, first_patient_id):
    r = client.post(
        f"/api/v1/patients/{first_patient_id}/vaccinations",
        headers=auth(tokens["public_health_admin"]),
        json={
            "vaccine_code": "OPV1",
            "vaccine_name": "Oral Polio Vaccine",
            "dose_label": "Dose 1",
            "administered_at": "2026-01-15",
            "facility": "Test Clinic",
        },
    )
    assert r.status_code == 403


def test_healthcare_worker_can_write_a_vaccination_event(client, tokens, db):
    # Use a patient that is not part of another test's assertions.
    patient = db.query(models.Patient).order_by(models.Patient.patient_id.desc()).first()
    r = client.post(
        f"/api/v1/patients/{patient.patient_id}/vaccinations",
        headers=auth(tokens["healthcare_worker"]),
        json={
            "vaccine_code": "OPV0",
            "vaccine_name": "Oral Polio Vaccine",
            "dose_label": "Birth dose",
            "administered_at": "2026-02-01",
            "facility": "Security Test Clinic",
            "batch_number": "TEST-OPV0-1",
        },
    )
    assert r.status_code in (200, 201), r.text


# --------------------------------------------------------------------------- #
# Patient and caregiver scoping
# --------------------------------------------------------------------------- #

def test_patient_sees_only_their_own_record(client, tokens, db):
    r = client.get("/api/v1/patients?page_size=100", headers=auth(tokens["patient"]))
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    account = db.query(models.User).filter_by(email=DEMO_USERS["patient"][0]).one()
    assert items[0]["user_id"] == account.id


def test_patient_cannot_read_another_patients_record(client, tokens, db):
    account = db.query(models.User).filter_by(email=DEMO_USERS["patient"][0]).one()
    other = db.query(models.Patient).filter(models.Patient.user_id != account.id).first()
    r = client.get(f"/api/v1/patients/{other.patient_id}", headers=auth(tokens["patient"]))
    assert r.status_code == 403


def test_patient_cannot_see_the_outreach_queue(client, tokens):
    """Regression: this endpoint used to return every task in the system."""
    r = client.get("/api/v1/outreach?page_size=50", headers=auth(tokens["patient"]))
    assert r.status_code == 403


def test_patient_cannot_modify_an_outreach_task(client, tokens, db):
    """Regression: patients were not blocked from PATCHing tasks."""
    task = db.query(models.OutreachTask).first()
    r = client.patch(f"/api/v1/outreach/{task.id}", headers=auth(tokens["patient"]), json={"status": "resolved"})
    assert r.status_code == 403
    db.refresh(task)
    assert task.status != "resolved" or task.resolved_at is None


def test_caregiver_cannot_see_the_outreach_queue(client, tokens):
    r = client.get("/api/v1/outreach?page_size=50", headers=auth(tokens["caregiver"]))
    assert r.status_code == 403


def test_patient_and_caregiver_cannot_see_inventory(client, tokens):
    for key in ("patient", "caregiver"):
        for path in ("/api/v1/inventory/batches", "/api/v1/inventory/summary"):
            r = client.get(path, headers=auth(tokens[key]))
            assert r.status_code == 403, f"{key} could read {path}"


def test_patient_and_caregiver_cannot_see_analytics(client, tokens):
    for key in ("patient", "caregiver"):
        r = client.get("/api/v1/analytics/summary", headers=auth(tokens[key]))
        assert r.status_code == 403


def test_caregiver_is_limited_to_authorized_patients(client, tokens, db):
    caregiver = db.query(models.User).filter_by(email=DEMO_USERS["caregiver"][0]).one()
    links = db.query(models.CaregiverRelationship).filter_by(caregiver_user_id=caregiver.id).all()
    authorized = {l.patient_id for l in links if l.authorized}
    unauthorized = {l.patient_id for l in links if not l.authorized}

    r = client.get("/api/v1/patients?page_size=100", headers=auth(tokens["caregiver"]))
    assert r.status_code == 200
    visible = {p["id"] for p in r.json()["items"]}
    assert visible == authorized
    assert not (visible & unauthorized), "caregiver can see a patient they are not authorized for"


def test_caregiver_cannot_open_an_unauthorized_patient(client, tokens, db):
    """The seed data deliberately contains a revoked/unauthorized link."""
    link = db.query(models.CaregiverRelationship).filter_by(authorized=False).first()
    assert link is not None, "seed data must include an unauthorized caregiver link"
    caregiver = db.get(models.User, link.caregiver_user_id)
    token = next(
        (t for key, t in tokens.items() if DEMO_USERS.get(key, (None,))[0] == caregiver.email),
        None,
    )
    assert token, f"no demo login seeded for caregiver {caregiver.email}"
    patient = db.get(models.Patient, link.patient_id)
    r = client.get(f"/api/v1/patients/{patient.patient_id}", headers=auth(token))
    assert r.status_code == 403


def test_caregiver_cannot_access_aggregate_record_views(client, tokens):
    """Cross-patient views must be scoped, not merely hidden."""
    r = client.get("/api/v1/vaccinations?page_size=100", headers=auth(tokens["caregiver"]))
    assert r.status_code == 200
    items = r.json()["items"]
    allowed = set()
    r2 = client.get("/api/v1/patients?page_size=100", headers=auth(tokens["caregiver"]))
    allowed = {p["patient_id"] for p in r2.json()["items"]}
    for ev in items:
        assert ev["patient"]["patient_id"] in allowed


# --------------------------------------------------------------------------- #
# Account self-service limits
# --------------------------------------------------------------------------- #

def test_user_cannot_reactivate_their_own_account(client, tokens, db):
    account = db.query(models.User).filter_by(email=DEMO_USERS["patient"][0]).one()
    r = client.patch(f"/api/v1/users/{account.id}", headers=auth(tokens["patient"]), json={"is_active": False})
    assert r.status_code == 403


def test_user_can_update_their_own_contact_details(client, tokens, db):
    account = db.query(models.User).filter_by(email=DEMO_USERS["patient"][0]).one()
    r = client.patch(f"/api/v1/users/{account.id}", headers=auth(tokens["patient"]), json={"language": "hi"})
    assert r.status_code == 200
    assert r.json()["language"] == "hi"


def test_worker_cannot_read_another_users_account(client, tokens, db):
    other = db.query(models.User).filter_by(email=DEMO_USERS["clinic_admin"][0]).one()
    r = client.get(f"/api/v1/users/{other.id}", headers=auth(tokens["healthcare_worker"]))
    assert r.status_code == 403


def test_worker_cannot_list_users(client, tokens):
    assert client.get("/api/v1/users", headers=auth(tokens["healthcare_worker"])).status_code == 403


def test_clinic_admin_cannot_disable_a_system_admin(client, tokens, db):
    admin = db.query(models.User).filter_by(email=DEMO_USERS["system_admin"][0]).one()
    r = client.patch(f"/api/v1/users/{admin.id}", headers=auth(tokens["clinic_admin"]), json={"is_active": False})
    assert r.status_code == 403
    db.refresh(admin)
    assert admin.is_active is True


# --------------------------------------------------------------------------- #
# Worker outreach assignment
# --------------------------------------------------------------------------- #

def test_worker_cannot_modify_an_unassigned_task(client, tokens, db):
    worker = db.query(models.User).filter_by(email=DEMO_USERS["healthcare_worker"][0]).one()
    task = db.query(models.OutreachTask).filter(
        models.OutreachTask.assigned_worker_id != worker.id
    ).first()
    assert task is not None, "seed data must contain a task assigned to another worker"
    r = client.patch(f"/api/v1/outreach/{task.id}", headers=auth(tokens["healthcare_worker"]), json={"status": "resolved"})
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# Signed QR records
# --------------------------------------------------------------------------- #

def test_digital_record_qr_verifies_without_leaking_the_name(client, tokens, first_patient_id):
    r = client.get(f"/api/v1/patients/{first_patient_id}/digital-record", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    payload = r.json()["qr"]["payload"]

    public = client.get(f"/api/v1/records/verify?token={payload}")
    assert public.status_code == 200
    body = public.json()
    assert body.get("valid") is True
    # The public verification endpoint must not disclose who the record belongs to.
    assert "first_name" not in body and "last_name" not in body and "name" not in body


def test_tampered_qr_payload_is_rejected(client, tokens, first_patient_id):
    r = client.get(f"/api/v1/patients/{first_patient_id}/digital-record", headers=auth(tokens["clinic_admin"]))
    payload = r.json()["qr"]["payload"]
    tampered = payload[:-4] + ("AAAA" if not payload.endswith("AAAA") else "BBBB")
    public = client.get(f"/api/v1/records/verify?token={tampered}")
    assert public.status_code in (200, 400)
    if public.status_code == 200:
        assert public.json().get("valid") is False
