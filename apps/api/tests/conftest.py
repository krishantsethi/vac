"""Test configuration.

Environment variables must be set *before* importing the application, because
``app.database`` and the rate-limit middleware read them at import time.

Each test session gets its own throwaway SQLite file so the demonstration
database is never mutated by tests.
"""

import os
import pathlib
import tempfile
from datetime import datetime, timedelta

_TEST_DIR = pathlib.Path(tempfile.mkdtemp(prefix="vaxbridge-tests-"))
_TEST_DB = _TEST_DIR / "test_vaxbridge.db"

os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB}"
os.environ["VAULT_SECRET_KEY"] = "test-signing-key-not-a-real-secret"
os.environ["VAULT_RECORD_SECRET"] = "test-record-signing-key"
os.environ["OCR_DEMO_MODE"] = "true"
os.environ["UPLOAD_DIR"] = str(_TEST_DIR / "uploads")
# Tests make far more requests per minute than a human would; disable the
# sliding-window limiter so it cannot cause spurious 429 failures.
os.environ["RATE_LIMIT_DEFAULT"] = "1000000"
os.environ["RATE_LIMIT_AUTH"] = "1000000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app import models  # noqa: E402


# Demo credentials created by app.seed.seed_database (synthetic data only).
DEMO_USERS = {
    "system_admin": ("admin@vaxbridge.demo", "Admin@12345"),
    "clinic_admin": ("clinic@vaxbridge.demo", "Clinic@12345"),
    "public_health_admin": ("ph@vaxbridge.demo", "PH@12345"),
    "healthcare_worker": ("worker1@vaxbridge.demo", "Worker@12345"),
    "worker2": ("worker2@vaxbridge.demo", "Worker@12345"),
    "caregiver": ("caregiver1@vaxbridge.demo", "Caregiver@12345"),
    "caregiver2": ("caregiver2@vaxbridge.demo", "Caregiver@12345"),
    "patient": ("patient1@vaxbridge.demo", "Patient@12345"),
    "patient2": ("patient2@vaxbridge.demo", "Patient@12345"),
}


@pytest.fixture(scope="session")
def client():
    """TestClient whose startup event creates and seeds the schema."""
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def tokens(client):
    """Bearer tokens for every seeded demo role, fetched once per session."""
    out = {}
    for key, (email, password) in DEMO_USERS.items():
        r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, f"login failed for {key}: {r.status_code} {r.text}"
        out[key] = r.json()["access_token"]
    return out


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def db(client):
    """A raw session for inspecting/creating rows.

    Depends on ``client`` so the application startup event (which creates the
    schema and seeds it) has definitely run before any test touches the DB.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(scope="session")
def seeded_patient_ids(client, tokens):
    """Display ids (VAX-####) of the patients caregiver1 is authorized for."""
    r = client.get("/api/v1/patients?page_size=100", headers=auth(tokens["caregiver"]))
    assert r.status_code == 200
    return [p["patient_id"] for p in r.json()["items"]]


@pytest.fixture(scope="session")
def first_patient_id(client, tokens):
    r = client.get("/api/v1/patients?page_size=1", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    items = r.json()["items"]
    assert items, "seed data must create at least one patient"
    return items[0]["patient_id"]


@pytest.fixture
def patient_record(db, first_patient_id):
    return db.query(models.Patient).filter_by(patient_id=first_patient_id).one()

@pytest.fixture
def make_patient(db):
    """Create a synthetic patient (plus optional events), cleaned up afterwards.

    Synthetic rows are tagged with a ``TEST-`` display id and a dedicated
    service area so they are easy to recognise and never mistaken for the
    seeded demonstration population.
    """
    created = []

    def _make(age_days, events=(), suffix=None, service_area="Test Fixture Area"):
        suffix = suffix or f"{len(created)}-{age_days}"
        patient = models.Patient(
            patient_id=f"TEST-{suffix}",
            first_name="Synthetic",
            last_name=f"Test{suffix}",
            date_of_birth=datetime.utcnow() - timedelta(days=age_days),
            gender="female",
            service_area=service_area,
        )
        db.add(patient)
        db.flush()
        for ev in events:
            db.add(models.VaccinationEvent(
                patient_id=patient.id,
                vaccine_code=ev["vaccine_code"],
                vaccine_name=ev.get("vaccine_name", ev["vaccine_code"]),
                dose_label=ev["dose_label"],
                administered_at=datetime.utcnow() - timedelta(days=ev.get("days_ago", 30)),
                facility="Fixture Clinic",
                batch_number=ev.get("batch_number"),
                is_verified=ev.get("is_verified", True),
                source=ev.get("source", "manual"),
            ))
        db.commit()
        db.refresh(patient)
        created.append(patient)
        return patient

    yield _make

    for patient in created:
        db.query(models.Recommendation).filter_by(patient_id=patient.id).delete()
        db.query(models.Document).filter_by(patient_id=patient.id).delete()
        db.delete(patient)
    db.commit()
