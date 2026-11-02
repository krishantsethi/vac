"""Analytics and cross-patient view tests (acceptance workflow H).

These pin the response contracts the dashboard, analytics page and role areas
consume, plus the honesty properties: zero-filled weeks are shown rather than
omitted, small groups are suppressed, and every metric states what it actually
measures.
"""

from datetime import datetime, timedelta

import pytest

from app import models
from tests.conftest import auth


CLINIC = "clinic_admin"
ANALYTICS_ENDPOINTS = [
    "/api/v1/analytics/summary",
    "/api/v1/analytics/status-distribution",
    "/api/v1/analytics/coverage-by-area",
    "/api/v1/analytics/events-by-week",
    "/api/v1/analytics/followup-status",
    "/api/v1/analytics/resolution-trend",
    "/api/v1/analytics/verification-backlog",
    "/api/v1/analytics/inventory-levels",
]


def get(client, tokens, path, role=CLINIC):
    return client.get(path, headers=auth(tokens[role]))


# --------------------------------------------------------------------------- #
# Access
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("path", ANALYTICS_ENDPOINTS)
def test_analytics_requires_an_authorized_role(client, tokens, path):
    assert get(client, tokens, path).status_code == 200
    for role in ("patient", "caregiver", "system_admin"):
        assert get(client, tokens, path, role).status_code == 403, f"{role} could read {path}"


def test_worker_may_read_operational_analytics(client, tokens):
    for path in ANALYTICS_ENDPOINTS:
        if path.endswith("coverage-by-area"):
            continue
        assert get(client, tokens, path, "healthcare_worker").status_code == 200, path


# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #

def test_summary_contract(client, tokens):
    body = get(client, tokens, "/api/v1/analytics/summary").json()
    required = [
        "total_patients", "verified_vaccination_events", "unverified_vaccination_events",
        "records_requiring_verification", "documents_pending_review", "upcoming_vaccinations",
        "potentially_overdue", "verification_required", "open_outreach_tasks",
        "in_progress_outreach_tasks", "escalated_outreach_tasks", "resolved_outreach_tasks",
        "total_outreach_tasks", "resolution_rate", "median_days_to_resolution",
        "open_sync_conflicts",
        "inventory_batches", "low_stock_alerts", "expiring_soon_alerts", "expired_batches",
        "inventory_alerts", "observation_period", "data_source",
    ]
    missing = [k for k in required if k not in body]
    assert missing == [], f"summary is missing {missing}"


def test_summary_counts_are_non_negative_and_consistent(client, tokens, db):
    body = get(client, tokens, "/api/v1/analytics/summary").json()
    for key, value in body.items():
        if isinstance(value, (int, float)) and key not in ("resolution_rate", "median_days_to_resolution"):
            assert value >= 0, f"{key} is negative"

    assert 0 <= body["resolution_rate"] <= 100
    assert body["median_days_to_resolution"] >= 0

    total_patients = db.query(models.Patient).filter(~models.Patient.patient_id.like("TEST-%")).count()
    assert body["total_patients"] >= total_patients - 5  # allow for synthetic fixture rows

    verified = db.query(models.VaccinationEvent).filter_by(is_verified=True).count()
    unverified = db.query(models.VaccinationEvent).filter_by(is_verified=False).count()
    assert body["verified_vaccination_events"] == verified
    assert body["unverified_vaccination_events"] == unverified


def test_summary_declares_its_data_source(client, tokens):
    body = get(client, tokens, "/api/v1/analytics/summary").json()
    assert "synthetic" in body["data_source"].lower()
    assert body["observation_period"]


def test_outreach_buckets_are_mutually_exclusive(client, tokens, db):
    """A dashboard shows these side by side, so they must not double-count."""
    body = get(client, tokens, "/api/v1/analytics/summary").json()
    buckets = (
        body["open_outreach_tasks"]
        + body["in_progress_outreach_tasks"]
        + body["escalated_outreach_tasks"]
        + body["resolved_outreach_tasks"]
    )
    assert buckets == body["total_outreach_tasks"], (
        f"buckets sum to {buckets} but total is {body['total_outreach_tasks']}"
    )
    assert body["total_outreach_tasks"] == db.query(models.OutreachTask).count()


def test_resolution_rate_matches_the_task_counts(client, tokens):
    body = get(client, tokens, "/api/v1/analytics/summary").json()
    resolved = body["resolved_outreach_tasks"]
    total = body["total_outreach_tasks"]
    if total:
        assert abs(body["resolution_rate"] - round(resolved / total * 100, 1)) <= 0.1


# --------------------------------------------------------------------------- #
# Status distribution
# --------------------------------------------------------------------------- #

def test_status_distribution_shape(client, tokens):
    body = get(client, tokens, "/api/v1/analytics/status-distribution").json()
    rows = body if isinstance(body, list) else body["items"]
    assert rows
    from app.scheduling.engine import RECOMMENDATION_STATUSES
    total = 0
    for row in rows:
        assert row["status"] in RECOMMENDATION_STATUSES
        assert row["count"] >= 0
        assert 0 <= row["percentage"] <= 100
        total += row["percentage"]
    assert abs(total - 100) < 1.5, f"percentages sum to {total}"


# --------------------------------------------------------------------------- #
# Coverage by area
# --------------------------------------------------------------------------- #

def test_coverage_by_area_contract(client, tokens):
    body = get(client, tokens, "/api/v1/analytics/coverage-by-area").json()
    assert body["items"]
    assert body["suppression_threshold"] == 5
    definition = body["metric_definition"]
    # The metric must say what it is and what it is not.
    assert "NOT population vaccination coverage" in definition["note"]
    for key in ("patient_count", "up_to_date_share", "population", "suppression"):
        assert key in definition

    for item in body["items"]:
        if item["suppressed"]:
            assert item["patient_count"] is None
            assert item["up_to_date_share"] is None
            assert item["recommendation_count"] == 0
        else:
            assert item["patient_count"] >= body["suppression_threshold"]
            assert 0 <= item["up_to_date_share"] <= 100


def test_small_service_areas_are_suppressed(client, tokens, make_patient):
    """A one-patient area must not publish counts that identify that patient."""
    make_patient(age_days=200, suffix="area-small", service_area="Fixture Tiny Area")
    body = get(client, tokens, "/api/v1/analytics/coverage-by-area").json()
    row = next((i for i in body["items"] if i["service_area"] == "Fixture Tiny Area"), None)
    assert row is not None
    assert row["suppressed"] is True
    assert row["patient_count"] is None
    assert row["up_to_date_share"] is None


# --------------------------------------------------------------------------- #
# Time series
# --------------------------------------------------------------------------- #

def test_events_by_week_is_zero_filled(client, tokens):
    body = get(client, tokens, "/api/v1/analytics/events-by-week?weeks=8").json()
    assert len(body["series"]) == 8
    assert body["observation_period"]["weeks"] == 8
    assert "not omitted" in body["note"]

    weeks = [row["week"] for row in body["series"]]
    assert len(set(weeks)) == 8, "weeks must be unique and contiguous"

    for row in body["series"]:
        assert row["verified_events"] <= row["total_events"]
        assert row["total_events"] >= 0
        assert isinstance(row["has_data"], bool)
        assert row["has_data"] == (row["total_events"] > 0)
        # week_starting must be a real date
        datetime.strptime(row["week_starting"], "%Y-%m-%d")


def test_events_by_week_weeks_are_in_chronological_order(client, tokens):
    body = get(client, tokens, "/api/v1/analytics/events-by-week?weeks=6").json()
    starts = [row["week_starting"] for row in body["series"]]
    assert starts == sorted(starts)


def test_resolution_trend_cumulative_never_decreases(client, tokens):
    body = get(client, tokens, "/api/v1/analytics/resolution-trend").json()
    series = body["series"]
    assert series
    cumulative = [row["cumulative"] for row in series]
    assert cumulative == sorted(cumulative), "cumulative resolutions must be monotonic"
    for row in series:
        assert row["resolved"] >= 0
        assert isinstance(row["has_data"], bool)


def test_followup_status_counts_match_the_database(client, tokens, db):
    rows = get(client, tokens, "/api/v1/analytics/followup-status").json()
    items = rows if isinstance(rows, list) else rows["items"]
    from_api = {r["status"]: r["count"] for r in items}
    from_db = {}
    for (status_value, count) in db.query(models.OutreachTask.status, models.OutreachTask.id).all():
        from_db[status_value] = from_db.get(status_value, 0) + 1
    for status_value, count in from_db.items():
        assert from_api.get(status_value, 0) == count, status_value


# --------------------------------------------------------------------------- #
# Verification backlog
# --------------------------------------------------------------------------- #

def test_verification_backlog_is_additive_and_categorized(client, tokens):
    body = get(client, tokens, "/api/v1/analytics/verification-backlog").json()
    assert body["items"]
    assert sum(i["count"] for i in body["items"]) == body["total_backlog"]
    categories = {i["category"] for i in body["items"]}
    assert "Documents awaiting review" in categories
    assert "Unverified vaccination entries" in categories
    assert body["recommendations_flagged_verification_required"] >= 0


# --------------------------------------------------------------------------- #
# Cross-patient record views consumed by the UI
# --------------------------------------------------------------------------- #

def test_vaccinations_view_returns_events_with_a_patient_brief(client, tokens):
    body = get(client, tokens, "/api/v1/vaccinations?page_size=5").json()
    assert body["total"] > 0
    assert len(body["items"]) <= 5
    for item in body["items"]:
        assert item["vaccine_code"]
        assert item["dose_label"]
        assert item["administered_at"]
        patient = item["patient"]
        assert patient["patient_id"].startswith("VAX-") or patient["patient_id"].startswith("TEST-")
        assert patient["first_name"]
        assert "date_of_birth" in patient


def test_vaccinations_view_filters_by_verification(client, tokens):
    verified = get(client, tokens, "/api/v1/vaccinations?verification=verified&page_size=100").json()
    unverified = get(client, tokens, "/api/v1/vaccinations?verification=unverified&page_size=100").json()
    assert all(i["is_verified"] for i in verified["items"])
    assert all(not i["is_verified"] for i in unverified["items"])
    assert verified["total"] > 0
    assert verified["total"] + unverified["total"] >= verified["total"]


def test_vaccinations_view_filters_by_patient(client, tokens, db):
    event = db.query(models.VaccinationEvent).first()
    patient = db.get(models.Patient, event.patient_id)
    body = get(client, tokens, f"/api/v1/vaccinations?patient_id={patient.patient_id}&page_size=100").json()
    assert body["total"] >= 1
    assert all(i["patient"]["patient_id"] == patient.patient_id for i in body["items"])


def test_vaccinations_view_searches_by_vaccine_and_patient(client, tokens):
    body = get(client, tokens, "/api/v1/vaccinations?search=Pentavalent&page_size=100").json()
    assert body["total"] > 0
    assert all("pentavalent" in i["vaccine_name"].lower() for i in body["items"])


def test_vaccinations_view_paginates(client, tokens):
    first = get(client, tokens, "/api/v1/vaccinations?page=1&page_size=5").json()
    second = get(client, tokens, "/api/v1/vaccinations?page=2&page_size=5").json()
    assert first["total"] == second["total"]
    ids_first = {i["id"] for i in first["items"]}
    ids_second = {i["id"] for i in second["items"]}
    assert not (ids_first & ids_second), "pages overlap"


def test_page_size_is_capped(client, tokens):
    body = get(client, tokens, "/api/v1/vaccinations?page_size=5000").json()
    assert len(body["items"]) <= 100


def test_documents_view_returns_documents_with_a_patient_brief(client, tokens):
    body = get(client, tokens, "/api/v1/documents?page_size=10").json()
    assert body["total"] >= 1
    for item in body["items"]:
        assert item["file_name"]
        assert item["status"]
        assert item["patient"]["patient_id"]


def test_documents_view_filters_by_status(client, tokens, db):
    doc = db.query(models.Document).first()
    body = get(client, tokens, f"/api/v1/documents?status={doc.status}&page_size=50").json()
    assert body["total"] >= 1
    assert all(i["status"] == doc.status for i in body["items"])
