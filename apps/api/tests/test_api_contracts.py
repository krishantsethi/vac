"""Contract tests for the endpoints the web client depends on.

These pin the wire shape the front end is written against, plus the guards that
were added specifically so a bad value cannot silently corrupt the analytics
buckets or the audit trail.
"""

import pytest

from app import models
from tests.conftest import auth


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #

def test_health_is_available_under_the_proxied_prefix(client):
    """The web app proxies only /api/v1, so a browser-side check must live there."""
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("ok", "degraded")
    assert body["database_connected"] is True
    assert isinstance(body["seeded_users"], int) and body["seeded_users"] > 0
    # Honest about what is and is not connected.
    assert body["external_integrations"] == "none"
    assert "not a government system" in body["disclaimer"].lower() or "not connected" in body["disclaimer"].lower()


def test_health_declares_the_ocr_provider(client):
    body = client.get("/api/v1/health").json()
    assert body["demo_mode"] is True
    assert "demo" in body["ocr_provider"].lower()


def test_health_needs_no_authentication(client):
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/health").status_code == 200


# --------------------------------------------------------------------------- #
# Outreach lifecycle guards
# --------------------------------------------------------------------------- #

def _first_task(client, tokens, role="clinic_admin", status_filter=None):
    url = "/api/v1/outreach?page_size=50"
    if status_filter:
        url += f"&status={status_filter}"
    items = client.get(url, headers=auth(tokens[role])).json()["items"]
    assert items, "seed data must create outreach tasks"
    return items[0]


@pytest.mark.parametrize("bad_status", ["done", "closed", "OPEN", "", "resolved "])
def test_unknown_outreach_status_is_refused(client, tokens, db, bad_status):
    """A status outside the lifecycle would corrupt the analytics buckets."""
    task = _first_task(client, tokens)
    r = client.patch(
        f"/api/v1/outreach/{task['id']}", headers=auth(tokens["clinic_admin"]), json={"status": bad_status}
    )
    assert r.status_code == 400
    assert "Unknown outreach status" in r.json()["detail"]


@pytest.mark.parametrize("good_status", ["open", "in_progress", "escalated", "resolved"])
def test_known_outreach_statuses_are_accepted_and_reversible(client, tokens, db, good_status):
    task = _first_task(client, tokens)
    r = client.patch(
        f"/api/v1/outreach/{task['id']}", headers=auth(tokens["clinic_admin"]), json={"status": good_status}
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == good_status

    # Reopening a resolved task must clear the resolution timestamp, otherwise
    # analytics keep counting it as resolved while it is still open.
    back = client.patch(
        f"/api/v1/outreach/{task['id']}", headers=auth(tokens["clinic_admin"]), json={"status": "open"}
    )
    assert back.status_code == 200
    assert back.json()["status"] == "open"
    assert back.json()["resolved_at"] is None

    # Restore the seeded status so later tests see the data they expect.
    client.patch(
        f"/api/v1/outreach/{task['id']}", headers=auth(tokens["clinic_admin"]), json={"status": task["status"]}
    )


def test_resolving_stamps_a_resolution_time(client, tokens, db):
    task = _first_task(client, tokens, status_filter="open")
    r = client.patch(
        f"/api/v1/outreach/{task['id']}", headers=auth(tokens["clinic_admin"]), json={"status": "resolved"}
    )
    assert r.status_code == 200
    assert r.json()["resolved_at"] is not None
    client.patch(
        f"/api/v1/outreach/{task['id']}", headers=auth(tokens["clinic_admin"]), json={"status": task["status"]}
    )


def test_outreach_items_carry_a_patient_brief_and_attempt_count(client, tokens):
    items = client.get("/api/v1/outreach?page_size=10", headers=auth(tokens["clinic_admin"])).json()["items"]
    for item in items:
        assert "attempt_count" in item
        assert isinstance(item["attempt_count"], int)
        assert "patient" in item
        if item["patient"]:
            brief = item["patient"]
            assert set(brief) >= {"patient_id", "first_name", "last_name"}
            # A brief is a label, not a clinical record.
            assert "diagnosis" not in brief


def test_outreach_accepts_either_identifier_form(client, tokens, db):
    items = client.get("/api/v1/outreach?page_size=50", headers=auth(tokens["clinic_admin"])).json()["items"]
    assert items
    task = items[0]
    patient = db.get(models.Patient, task["patient_id"])

    by_display = client.get(
        f"/api/v1/outreach?patient_id={patient.patient_id}", headers=auth(tokens["clinic_admin"])
    ).json()
    by_uuid = client.get(
        f"/api/v1/outreach?patient_id={patient.id}", headers=auth(tokens["clinic_admin"])
    ).json()
    assert by_display["total"] == by_uuid["total"] >= 1
    assert all(i["id"] == task["id"] for i in by_display["items"])


def test_outreach_filter_on_an_unknown_patient_returns_nothing(client, tokens):
    """An identifier that resolves to nothing yields nothing — never a guess."""
    for bogus in ("VAX-9999", "not-a-uuid", "00000000-0000-0000-0000-000000000000"):
        r = client.get(
            f"/api/v1/outreach?patient_id={bogus}", headers=auth(tokens["clinic_admin"])
        )
        assert r.status_code == 200
        assert r.json()["total"] == 0


def test_empty_outreach_patient_filter_means_unfiltered(client, tokens):
    """An empty parameter is no filter at all, and role scoping still applies."""
    unfiltered = client.get("/api/v1/outreach?page_size=100", headers=auth(tokens["clinic_admin"])).json()
    empty = client.get(
        "/api/v1/outreach?patient_id=&page_size=100", headers=auth(tokens["clinic_admin"])
    ).json()
    assert empty["total"] == unfiltered["total"]

    # A patient-role caller is still refused outright rather than shown the queue.
    assert client.get("/api/v1/outreach?patient_id=", headers=auth(tokens["patient"])).status_code == 403


# --------------------------------------------------------------------------- #
# Outreach attempts
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("outcome", ["contacted", "attempted", "unreachable", "refused", "migrated",
                                     "appointment_scheduled", "dose_administered", "deceased"])
def test_every_legitimate_outcome_can_be_recorded(client, tokens, outcome):
    """Refusal, migration and death are factual outcomes, never penalties."""
    task = _first_task(client, tokens)
    r = client.post(
        f"/api/v1/outreach/{task['id']}/attempts",
        headers=auth(tokens["clinic_admin"]),
        json={"attempt_type": "phone", "outcome": outcome, "notes": "contract test"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["outcome"] == outcome


@pytest.mark.parametrize("outcome", ["ignored_us", "non_compliant", "penalised", "", "CONTACTED"])
def test_judgemental_or_unknown_outcomes_are_refused(client, tokens, outcome):
    task = _first_task(client, tokens)
    r = client.post(
        f"/api/v1/outreach/{task['id']}/attempts",
        headers=auth(tokens["clinic_admin"]),
        json={"attempt_type": "phone", "outcome": outcome},
    )
    assert r.status_code == 400
    assert "Unknown attempt outcome" in r.json()["detail"]


def test_attempt_history_is_readable_and_ordered(client, tokens):
    task = _first_task(client, tokens)
    r = client.get(f"/api/v1/outreach/{task['id']}/attempts", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    attempts = r.json()
    assert isinstance(attempts, list)
    stamps = [a["attempted_at"] for a in attempts]
    assert stamps == sorted(stamps), "history should read oldest first"


def test_attempt_history_for_an_unknown_task_is_404(client, tokens):
    r = client.get(
        "/api/v1/outreach/00000000-0000-0000-0000-000000000000/attempts",
        headers=auth(tokens["clinic_admin"]),
    )
    assert r.status_code == 404


def test_attempt_history_requires_the_outreach_capability(client, tokens):
    task = _first_task(client, tokens)
    for role in ("patient", "caregiver", "system_admin"):
        r = client.get(f"/api/v1/outreach/{task['id']}/attempts", headers=auth(tokens[role]))
        assert r.status_code == 403, f"{role} must not read the outreach queue"


def test_worker_cannot_read_another_workers_task_history(client, tokens, db):
    """One worker must not be able to browse another's contact history."""
    worker2_id = db.query(models.User).filter_by(email="worker2@vaxbridge.demo").one().id
    task = db.query(models.OutreachTask).filter(
        models.OutreachTask.assigned_worker_id != worker2_id
    ).first()
    assert task is not None
    r = client.get(f"/api/v1/outreach/{task.id}/attempts", headers=auth(tokens["worker2"]))
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# Caregiver directory and link privacy
# --------------------------------------------------------------------------- #

def test_caregiver_directory_is_available_to_roles_that_manage_links(client, tokens):
    for role in ("clinic_admin", "public_health_admin"):
        r = client.get("/api/v1/users/caregivers", headers=auth(tokens[role]))
        assert r.status_code == 200
        accounts = r.json()
        assert accounts, "seed data must create caregiver accounts"
        assert all(a["id"] for a in accounts)
        assert all("full_name" in a and "email" in a for a in accounts)


def test_caregiver_directory_is_not_the_user_directory(client, tokens):
    """A role that may authorize a dependent must not be handed every account."""
    accounts = client.get("/api/v1/users/caregivers", headers=auth(tokens["public_health_admin"])).json()
    all_users = client.get("/api/v1/users", headers=auth(tokens["clinic_admin"])).json()
    assert len(accounts) < len(all_users)
    assert {a["id"] for a in accounts} < {u["id"] for u in all_users}


def test_public_health_admin_may_list_caregivers_but_not_all_users(client, tokens):
    assert client.get("/api/v1/users/caregivers", headers=auth(tokens["public_health_admin"])).status_code == 200
    assert client.get("/api/v1/users", headers=auth(tokens["public_health_admin"])).status_code == 403


@pytest.mark.parametrize("role", ["system_admin", "healthcare_worker", "patient", "caregiver"])
def test_caregiver_directory_is_refused_to_other_roles(client, tokens, role):
    assert client.get("/api/v1/users/caregivers", headers=auth(tokens[role])).status_code == 403


def test_caregiver_directory_path_is_not_swallowed_by_the_id_route(client, tokens):
    """/users/{user_id} is registered later, so the literal path must win."""
    r = client.get("/api/v1/users/caregivers", headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_patient_sees_who_may_access_their_record_but_not_their_email(client, tokens):
    links = client.get("/api/v1/caregivers", headers=auth(tokens["patient"])).json()
    assert links, "the seeded patient has an authorized caregiver"
    for link in links:
        assert link["caregiver_name"], "a patient has a right to know who can see their record"
        assert link["caregiver_email"] is None, "contact details are withheld from the patient view"
        assert link["patient_display_id"]


def test_managers_see_caregiver_contact_details(client, tokens):
    links = client.get("/api/v1/caregivers", headers=auth(tokens["clinic_admin"])).json()
    assert links
    assert any(link["caregiver_email"] for link in links)


def test_healthcare_worker_sees_no_caregiver_links(client, tokens):
    """Fails closed rather than returning the full table."""
    assert client.get("/api/v1/caregivers", headers=auth(tokens["healthcare_worker"])).json() == []


def test_system_admin_sees_no_caregiver_links(client, tokens):
    assert client.get("/api/v1/caregivers", headers=auth(tokens["system_admin"])).json() == []


def test_duplicate_caregiver_link_is_refused_not_overwritten(client, tokens):
    existing = client.get("/api/v1/caregivers", headers=auth(tokens["clinic_admin"])).json()[0]
    r = client.post(
        "/api/v1/caregivers",
        headers=auth(tokens["clinic_admin"]),
        json={
            "caregiver_user_id": existing["caregiver_user_id"],
            "patient_id": existing["patient_id"],
            "relationship_type": "guardian",
            "authorized": not existing["authorized"],
        },
    )
    assert r.status_code == 409
    assert "already linked" in r.json()["detail"]

    # The original authorization decision is unchanged.
    after = client.get("/api/v1/caregivers", headers=auth(tokens["clinic_admin"])).json()
    same = next(l for l in after if l["id"] == existing["id"])
    assert same["authorized"] == existing["authorized"]
    assert same["relationship_type"] == existing["relationship_type"]


def test_non_caregiver_account_cannot_be_authorized_as_a_caregiver(client, tokens, db):
    admin = db.query(models.User).filter_by(email="admin@vaxbridge.demo").one()
    patient = db.query(models.Patient).first()
    r = client.post(
        "/api/v1/caregivers",
        headers=auth(tokens["clinic_admin"]),
        json={
            "caregiver_user_id": admin.id,
            "patient_id": patient.id,
            "relationship_type": "parent",
            "authorized": True,
        },
    )
    assert r.status_code == 400
    assert "not 'caregiver'" in r.json()["detail"]


def test_caregiver_link_to_an_unknown_account_or_patient_is_404(client, tokens, db):
    patient = db.query(models.Patient).first()
    caregiver = db.query(models.User).filter_by(role="caregiver").first()
    ghost = "00000000-0000-0000-0000-000000000000"

    assert client.post(
        "/api/v1/caregivers", headers=auth(tokens["clinic_admin"]),
        json={"caregiver_user_id": ghost, "patient_id": patient.id, "relationship_type": "parent"},
    ).status_code == 404

    assert client.post(
        "/api/v1/caregivers", headers=auth(tokens["clinic_admin"]),
        json={"caregiver_user_id": caregiver.id, "patient_id": ghost, "relationship_type": "parent"},
    ).status_code == 404


def test_unauthorized_link_grants_no_record_access(client, tokens, db):
    """Recording a relationship is not the same as authorizing it."""
    unauthorized = (
        db.query(models.CaregiverRelationship).filter_by(authorized=False).first()
    )
    assert unauthorized is not None, "seed data must include an unauthorized link"
    patient = db.get(models.Patient, unauthorized.patient_id)
    caregiver = db.get(models.User, unauthorized.caregiver_user_id)

    token = client.post(
        "/api/v1/auth/login",
        json={"email": caregiver.email, "password": "Caregiver@12345"},
    ).json()["access_token"]

    r = client.get(f"/api/v1/patients/{patient.patient_id}", headers=auth(token))
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# Audit trail
# --------------------------------------------------------------------------- #

def test_audit_entries_name_the_actor(client, tokens):
    client.get("/api/v1/patients?page_size=1", headers=auth(tokens["clinic_admin"]))
    body = client.get("/api/v1/audit?page_size=20", headers=auth(tokens["system_admin"])).json()
    assert body["total"] > 0
    named = [i for i in body["items"] if i.get("actor_name")]
    assert named, "audit entries should identify who acted"
    for entry in named:
        assert entry["actor_role"]
        assert set(entry) >= {"action", "entity_type", "created_at", "actor_name", "actor_role"}


def test_audit_filters_narrow_the_result(client, tokens):
    client.get("/api/v1/patients?page_size=1", headers=auth(tokens["clinic_admin"]))
    unfiltered = client.get("/api/v1/audit?page_size=100", headers=auth(tokens["system_admin"])).json()
    filtered = client.get(
        "/api/v1/audit?entity_type=patients&page_size=100", headers=auth(tokens["system_admin"])
    ).json()
    assert filtered["total"] <= unfiltered["total"]
    assert all(i["entity_type"] == "patients" for i in filtered["items"])


def test_audit_entity_id_filter_isolates_one_record(client, tokens, db):
    patient = db.query(models.Patient).first()
    client.get(f"/api/v1/patients/{patient.patient_id}", headers=auth(tokens["clinic_admin"]))
    body = client.get(
        f"/api/v1/audit?entity_id={patient.id}&page_size=100", headers=auth(tokens["system_admin"])
    ).json()
    assert all(i["entity_id"] == str(patient.id) for i in body["items"])


def test_audit_action_filter_is_exact(client, tokens):
    body = client.get(
        "/api/v1/audit?action=login&page_size=100", headers=auth(tokens["system_admin"])
    ).json()
    assert all(i["action"] == "login" for i in body["items"])


def test_audit_requires_the_audit_capability(client, tokens):
    for role in ("healthcare_worker", "patient", "caregiver"):
        assert client.get("/api/v1/audit", headers=auth(tokens[role])).status_code == 403


# --------------------------------------------------------------------------- #
# Patient list contract
# --------------------------------------------------------------------------- #

def test_patient_list_status_summary_shape(client, tokens):
    body = client.get(
        "/api/v1/patients?page_size=5&include_status=true", headers=auth(tokens["clinic_admin"])
    ).json()
    assert set(body) >= {"items", "total", "page", "page_size"}
    for item in body["items"]:
        summary = item["status_summary"]
        assert set(summary) >= {
            "record_status", "actionable_count", "upcoming_count",
            "up_to_date_count", "unverified_entries", "recommendation_total",
        }
        assert summary["recommendation_total"] == (
            summary["actionable_count"] + summary["up_to_date_count"] + summary["upcoming_count"]
        ) or summary["recommendation_total"] >= summary["actionable_count"]


def test_patient_list_omits_status_summaries_unless_asked(client, tokens):
    body = client.get("/api/v1/patients?page_size=5", headers=auth(tokens["clinic_admin"])).json()
    assert all(item.get("status_summary") is None for item in body["items"])


def test_service_area_metadata_lists_areas_with_counts(client, tokens):
    """`total` counts distinct areas (it feeds a filter dropdown), not patients."""
    body = client.get("/api/v1/patients/meta/service-areas", headers=auth(tokens["clinic_admin"])).json()
    assert set(body) >= {"items", "total"}
    assert body["items"], "seed data spans several service areas"
    for item in body["items"]:
        assert item["service_area"]
        assert isinstance(item["patient_count"], int) and item["patient_count"] > 0
    assert body["total"] == len(body["items"])
    names = [i["service_area"] for i in body["items"]]
    assert names == sorted(names), "areas should come back in a stable order"
    assert len(set(names)) == len(names), "each area appears once"


def test_service_area_filter_matches_the_metadata(client, tokens):
    meta = client.get("/api/v1/patients/meta/service-areas", headers=auth(tokens["clinic_admin"])).json()
    area = meta["items"][0]["service_area"]
    filtered = client.get(
        f"/api/v1/patients?service_area={area}&page_size=100", headers=auth(tokens["clinic_admin"])
    ).json()
    assert filtered["total"] == meta["items"][0]["patient_count"]
    assert all(p["service_area"] == area for p in filtered["items"])


def test_patient_list_pagination_caps_page_size(client, tokens):
    body = client.get("/api/v1/patients?page_size=5000", headers=auth(tokens["clinic_admin"])).json()
    assert body["page_size"] <= 100
    assert len(body["items"]) <= 100


# --------------------------------------------------------------------------- #
# Demonstration OCR fixture
# --------------------------------------------------------------------------- #

def test_demo_ocr_fixture_is_deterministic_for_unrecognised_filenames():
    """The fallback must not depend on Python's per-process salted str hash.

    Two runs of the same server must extract the same values from the same
    filename, otherwise a document uploaded before a restart would reconcile
    differently from one uploaded after it.
    """
    from app.main import _demo_ocr

    for filename in ("random_scan_12345.png", "unknown_doc.pdf", "IMG_0001.jpg"):
        first = _demo_ocr(filename)
        for _ in range(5):
            assert _demo_ocr(filename) == first, f"unstable extraction for {filename}"


def test_demo_ocr_named_fixtures_map_to_their_own_values():
    from app.main import _demo_ocr

    assert _demo_ocr("card_aarav_penta3.png")["dose_label"] == "Dose 3"
    assert _demo_ocr("card_diya.png")["vaccine_name"] == "Measles-Rubella"
    assert _demo_ocr("card_ananya_penta1.png")["record_id"] == "REC-1003"


def test_demo_ocr_supplies_no_confidence_value():
    """No calibrated measure exists, so none may be reported."""
    from app.main import _demo_ocr

    fixture = _demo_ocr("card_aarav_penta3.png")
    assert "confidence" not in fixture
    assert not any("confidence" in key for key in fixture)
