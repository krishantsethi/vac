"""Tests for the production-readiness layer.

Covers the modules added to make this deployable: the storage abstraction, the
OCR provider seam, the optional AI layer, and the deterministic insights. The
theme running through all of them is the same — when something is unavailable,
the code must say so rather than substitute a plausible-looking fiction.
"""

import json

import pytest

from tests.conftest import DEMO_USERS, auth


# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #

def test_object_key_cannot_escape_its_prefix():
    """A filename is attacker-controlled and must never become a path."""
    from app.storage import safe_object_key

    key = safe_object_key("VAX-0001", "doc-1", "../../../../etc/passwd")
    assert ".." not in key
    assert key.startswith("VAX-0001/doc-1")
    assert not key.startswith("/")


def test_object_key_keeps_only_a_safe_extension():
    from app.storage import safe_object_key

    assert safe_object_key("VAX-1", "d1", "card.png").endswith(".png")
    # Whatever the caller calls the file, the key stays inside its two-segment
    # prefix: no traversal, no extra path depth, no shell metacharacters.
    for hostile in ("card.pngexe", "a/b.sh", "..%2f..%2fetc", "card.png\n\r", "a" * 400):
        key = safe_object_key("VAX-1", "d1", hostile)
        assert key.count("/") == 1, key
        assert ".." not in key, key
        assert "\n" not in key and "\r" not in key, key


def test_object_key_survives_missing_inputs():
    """Empty identifiers degrade to named placeholders rather than an empty key.

    An empty object key would resolve to the bucket root, so the fallback is
    deliberate and the segments stay non-empty.
    """
    from app.storage import safe_object_key

    assert safe_object_key("", "", "") == "unassigned/unknown"
    assert safe_object_key("VAX-9", "d", "") == "VAX-9/d"


def test_local_storage_round_trips_a_document(tmp_path, monkeypatch):
    from app import storage as storage_mod

    monkeypatch.setattr(storage_mod, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(storage_mod, "_backend", None)
    monkeypatch.setattr(storage_mod, "STORAGE_BACKEND", "local")
    store = storage_mod.LocalStorage()
    ok, _ = store.available()
    assert ok

    stored = store.put("VAX-1/d1.png", b"fake-image-bytes", "image/png", "card.png")
    assert stored.backend == "local"
    assert stored.durable is False, "a local file must not claim to be durable"
    assert store.get("VAX-1/d1.png") == b"fake-image-bytes"
    assert store.url("VAX-1/d1.png") is None, "a filesystem path is not a URL"
    assert store.delete("VAX-1/d1.png") is True
    assert store.get("VAX-1/d1.png") is None


def test_storage_rejects_an_oversize_or_wrong_type_upload(tmp_path, monkeypatch):
    from app import storage as storage_mod

    monkeypatch.setattr(storage_mod, "UPLOAD_DIR", str(tmp_path))
    store = storage_mod.LocalStorage()

    with pytest.raises(storage_mod.StorageError):
        store.put("k", b"x", "application/x-msdownload", "payload.exe")
    with pytest.raises(storage_mod.StorageError):
        store.put("k", b"", "image/png", "empty.png")
    with pytest.raises(storage_mod.StorageError):
        store.put("k", b"x" * (storage_mod.MAX_UPLOAD_BYTES + 1), "image/png", "huge.png")


def test_a_storage_error_never_leaks_a_key_or_url():
    """The message is what reaches an HTTP response, so it must stay abstract."""
    from app.storage import StorageError

    err = StorageError("upload_rejected", "http=403")
    text = str(err)
    assert "supabase" not in text.lower()
    assert "bearer" not in text.lower()
    assert "eyJ" not in text


def test_supabase_backend_reports_unavailable_without_credentials(monkeypatch):
    from app import storage as storage_mod

    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    backend = storage_mod.SupabaseStorage()
    ok, detail = backend.available()
    assert ok is False
    assert "not configured" in detail


# --------------------------------------------------------------------------- #
# OCR providers
# --------------------------------------------------------------------------- #

def test_demo_ocr_is_deterministic_across_calls():
    from app.ocr import demo_extract

    first = demo_extract("random_scan_999.png")
    for _ in range(5):
        again = demo_extract("random_scan_999.png")
        assert [ (f.field_name, f.field_value) for f in again.fields ] == \
               [ (f.field_name, f.field_value) for f in first.fields ]


def test_demo_ocr_always_declares_itself_a_demo():
    """The single most important honesty property of the extractor."""
    from app.ocr import demo_extract

    result = demo_extract("card_aarav.png")
    assert result.is_demo is True
    assert result.provider == "demo-ocr"
    assert "Demonstration fixture" in result.detail


def test_demo_ocr_supplies_no_confidence_because_it_measures_nothing():
    from app.ocr import demo_extract

    assert all(f.confidence is None for f in demo_extract("card_diya.png").fields)


def test_tesseract_provider_refuses_to_substitute_fixtures(monkeypatch):
    """With no engine installed, a tesseract request must fail, not fake it."""
    from app import ocr as ocr_mod

    monkeypatch.setattr(ocr_mod, "tesseract_available", lambda: False)
    result = ocr_mod.tesseract_extract(b"not-an-image", "x.png", "image/png")
    assert result.status == "unavailable"
    assert result.is_demo is False
    assert result.fields == []


def test_auto_mode_falls_back_to_demo_and_says_so(monkeypatch):
    from app import ocr as ocr_mod

    monkeypatch.setattr(ocr_mod, "OCR_PROVIDER", "auto")
    monkeypatch.setattr(ocr_mod, "tesseract_available", lambda: False)
    result = ocr_mod.extract(b"x", "card_aarav.png", "image/png")
    assert result.is_demo is True
    assert "Tesseract is not installed" in result.detail


def test_disabled_ocr_does_not_pretend_to_have_read_anything(monkeypatch):
    from app import ocr as ocr_mod

    monkeypatch.setattr(ocr_mod, "OCR_PROVIDER", "none")
    result = ocr_mod.extract(b"x", "card.png", "image/png")
    assert result.status == "unavailable"
    assert result.fields == []
    assert result.is_demo is False


def test_ocr_status_reports_what_will_actually_happen(monkeypatch):
    from app import ocr as ocr_mod

    monkeypatch.setattr(ocr_mod, "OCR_PROVIDER", "auto")
    monkeypatch.setattr(ocr_mod, "tesseract_available", lambda: False)
    status = ocr_mod.ocr_status()
    assert status["effective"] == "demo-ocr"
    assert status["returns_demo_values"] is True
    assert status["supplies_confidence"] is False


# --------------------------------------------------------------------------- #
# Optional AI
# --------------------------------------------------------------------------- #

def test_ai_is_not_configured_without_a_key(monkeypatch):
    from app import ai

    monkeypatch.setattr(ai, "AI_PROVIDER", "none")
    monkeypatch.setattr(ai, "AI_API_KEY", "")
    assert ai.ai_configured() is False
    status = ai.ai_status()
    assert status["configured"] is False
    assert status["api_key_present"] is False


def test_a_provider_without_a_key_is_reported_as_unconfigured(monkeypatch):
    """Naming a provider is not the same as being able to call it."""
    from app import ai

    monkeypatch.setattr(ai, "AI_PROVIDER", "openai")
    monkeypatch.setattr(ai, "AI_API_KEY", "")
    assert ai.ai_configured() is False
    assert "AI_API_KEY is not set" in ai.ai_status()["reason_unavailable"]


def test_an_unknown_provider_is_rejected(monkeypatch):
    from app import ai

    monkeypatch.setattr(ai, "AI_PROVIDER", "skynet")
    monkeypatch.setattr(ai, "AI_API_KEY", "anything")
    assert ai.ai_configured() is False
    assert "not one of" in ai.ai_status()["reason_unavailable"]


def test_generate_never_fabricates_a_response_when_unavailable(monkeypatch):
    from app import ai

    monkeypatch.setattr(ai, "AI_PROVIDER", "none")
    monkeypatch.setattr(ai, "AI_API_KEY", "")
    result = ai.generate([{"role": "user", "content": "hello"}])
    assert result.available is False
    assert result.text == ""
    assert result.reason


def test_ai_status_never_echoes_the_key(monkeypatch):
    from app import ai

    secret = "sk-super-secret-value-that-must-not-leak"
    monkeypatch.setattr(ai, "AI_PROVIDER", "openai")
    monkeypatch.setattr(ai, "AI_API_KEY", secret)
    blob = json.dumps(ai.ai_status())
    assert secret not in blob
    assert ai.ai_status()["api_key_present"] is True


def test_a_provider_http_failure_is_reported_not_retried_into_a_fake_answer(monkeypatch):
    from app import ai

    monkeypatch.setattr(ai, "AI_PROVIDER", "openai")
    monkeypatch.setattr(ai, "AI_API_KEY", "k")
    monkeypatch.setattr(ai, "AI_BASE_URL", "https://api.openai.com/v1")

    def boom(*args, **kwargs):
        import urllib.error
        raise urllib.error.HTTPError("https://api.openai.com/v1", 401, "Unauthorized", {}, None)

    # `_CALLERS` captures the function objects at import time, so patching the
    # module attribute would not intercept dispatch. Patch the table itself.
    monkeypatch.setitem(ai._CALLERS, "openai", boom)
    result = ai.generate([{"role": "user", "content": "q"}])
    assert result.available is False
    assert "401" in (result.reason + result.error_stage)
    assert result.text == ""


def test_grounded_prompt_contains_only_the_supplied_rows():
    from app.ai import grounded_prompt

    rows = [{"vaccine_code": "BCG", "status": "given"}]
    messages = grounded_prompt("What is missing?", rows)
    blob = json.dumps(messages)
    assert "BCG" in blob
    assert "never invent" in blob.lower() or "Never invent" in blob
    # The system prompt must forbid inferring an unrecorded dose as not given.
    assert "missing record is not evidence" in blob.lower() or "not evidence" in blob.lower()


def test_context_is_capped(monkeypatch):
    from app import ai

    monkeypatch.setattr(ai, "AI_MAX_CONTEXT_ROWS", 3)
    monkeypatch.setattr(ai, "AI_PROVIDER", "none")
    monkeypatch.setattr(ai, "AI_API_KEY", "")
    result = ai.ask("q", [{"i": i} for i in range(50)])
    assert len(result.grounded_on) == 3


# --------------------------------------------------------------------------- #
# Deterministic insights
# --------------------------------------------------------------------------- #

def test_insights_require_the_analytics_capability(client, tokens):
    """Population figures are clinical data; a patient must not read them."""
    r = client.get("/api/v1/insights", headers=auth(tokens["healthcare_worker"]))
    assert r.status_code == 200
    for role in ("patient", "caregiver", "system_admin"):
        r = client.get("/api/v1/insights", headers=auth(tokens[role]))
        assert r.status_code == 403, f"{role} should not read population insights"


def test_insights_are_anonymous(client):
    assert client.get("/api/v1/insights").status_code == 401


def test_every_insight_metric_carries_its_own_definition(client, tokens):
    """A number without a stated denominator is how coverage gets overstated."""
    body = client.get("/api/v1/insights", headers=auth(tokens["clinic_admin"])).json()
    for key in ("coverage", "gaps", "inventory", "review_backlog", "outreach"):
        assert key in body
        assert body[key].get("definition"), f"{key} has no definition"
    assert body["engine"] == "deterministic"
    assert body["source"] == "database"


def test_coverage_is_labelled_as_registry_completeness_not_population(client, tokens):
    body = client.get("/api/v1/insights", headers=auth(tokens["clinic_admin"])).json()
    definition = body["coverage"]["definition"].lower()
    assert "not population coverage" in definition
    assert "registered" in definition


def test_insight_counts_match_the_database(client, tokens, db):
    """The figures must come from rows, not from constants."""
    from app import models

    body = client.get("/api/v1/insights", headers=auth(tokens["clinic_admin"])).json()
    assert body["coverage"]["registered_patients"] == db.query(models.Patient).count()
    assert body["coverage"]["total_events"] == db.query(models.VaccinationEvent).count()
    verified = (
        db.query(models.VaccinationEvent)
        .filter(models.VaccinationEvent.is_verified.is_(True))
        .count()
    )
    assert body["coverage"]["verified_events"] == verified


def test_small_service_areas_are_suppressed(client, tokens, db, monkeypatch):
    from app import insights

    monkeypatch.setattr(insights, "SUPPRESSION_THRESHOLD", 10 ** 6)
    body = client.get("/api/v1/insights", headers=auth(tokens["clinic_admin"])).json()
    rows = body["service_areas"]
    assert rows, "expected at least one service area"
    for row in rows:
        assert row["suppressed"] is True
        assert row["patients"] is None, "a suppressed count must not be disclosed"
        assert "re-identification" in row["reason"]


def test_ai_status_endpoint_reports_the_key_presence_not_the_key(client, tokens):
    body = client.get("/api/v1/ai/status", headers=auth(tokens["clinic_admin"])).json()
    assert body["configured"] is False
    assert body["api_key_present"] is False
    assert body["reason_unavailable"]
    assert client.get("/api/v1/ai/status").status_code == 401


def test_ai_ask_returns_real_records_and_refuses_to_invent_an_answer(client, tokens, seeded_patient_ids):
    """The core promise of Mode A: no key, still substantive, still honest."""
    patient_id = seeded_patient_ids[0]
    body = client.post(
        "/api/v1/ai/ask",
        headers=auth(tokens["healthcare_worker"]),
        json={"question": "Which doses are missing?", "patient_id": patient_id},
    ).json()
    assert body["ai_available"] is False
    assert body["text"] is None, "no model ran, so no text may be produced"
    assert body["unavailable_reason"]
    assert isinstance(body["records"], list)
    assert body["guidance"]
    # The scope note must restate that an absent row is not an absent dose.
    assert "not evidence" in body["scope_note"].lower()


def test_ai_ask_without_a_patient_returns_aggregates_only(client, tokens):
    body = client.post(
        "/api/v1/ai/ask",
        headers=auth(tokens["clinic_admin"]),
        json={"question": "How is coverage trending?"},
    ).json()
    assert body["ai_available"] is False
    assert "aggregate" in body["scope_note"].lower()
    assert all(r.get("kind") in {"coverage", "gaps", "inventory", "review_backlog"}
               for r in body["records"])


def test_ai_ask_requires_a_question(client, tokens):
    r = client.post("/api/v1/ai/ask", headers=auth(tokens["clinic_admin"]),
                    json={"question": "   "})
    assert r.status_code == 422


def test_ai_ask_respects_patient_scoping(client, tokens):
    """Grounded Q&A must not become a way around the access rules."""
    body = client.post(
        "/api/v1/ai/ask",
        headers=auth(tokens["patient"]),
        json={"question": "x", "patient_id": "VAX-0001"},
    )
    # patient1 owns VAX-0001, but has no CLINICAL_READ capability at all.
    assert body.status_code == 403


def test_ai_ask_is_anonymous_rejected(client):
    assert client.post("/api/v1/ai/ask", json={"question": "x"}).status_code == 401


# --------------------------------------------------------------------------- #
# Health endpoint disclosure
# --------------------------------------------------------------------------- #

def test_health_does_not_disclose_connection_details(client):
    """Unauthenticated endpoint: it must not name a host, user or password."""
    body = client.get("/api/v1/health").json()
    blob = json.dumps(body).lower()
    for needle in ("supabase.co", "postgres@", "postgresql://", "password"):
        assert needle not in blob, f"health leaked {needle!r}"
    assert body["database_backend"] in {"sqlite", "postgresql", "postgresql (pooled)"}
    assert "database_persistent" in body


def test_health_declares_whether_the_database_survives_a_restart(client):
    body = client.get("/api/v1/health").json()
    # Under the test configuration the backend is a SQLite file.
    assert body["database_backend"] == "sqlite"
    assert body["database_persistent"] is False


def test_health_reports_storage_durability(client):
    body = client.get("/api/v1/health").json()
    assert "storage" in body
    assert body["storage"]["backend"] in {"local", "supabase"}
    assert isinstance(body["storage"]["durable"], bool)


def test_health_reports_the_ocr_provider_that_will_run(client):
    body = client.get("/api/v1/health").json()
    assert body["ocr"]["configured"] in {"demo", "auto", "tesseract", "none"}
    assert isinstance(body["ocr"]["returns_demo_values"], bool)
    # Whatever it says, it must agree with the top-level demo_mode flag.
    assert body["demo_mode"] == body["ocr"]["returns_demo_values"]


def test_a_database_failure_is_reported_without_the_driver_message(client, monkeypatch):
    """Driver error strings embed host, port and sometimes the user name."""
    from app import main

    class BrokenQuery:
        def count(self):
            raise RuntimeError("could not connect to postgres://user:pw@db.internal:5432/app")

    class BrokenSession:
        def query(self, *a, **k):
            return BrokenQuery()

        def close(self):
            return None

    monkeypatch.setattr(main, "SessionLocal", lambda: BrokenSession())
    body = client.get("/api/v1/health").json()
    assert body["database_connected"] is False
    assert body["status"] == "degraded"
    blob = json.dumps(body)
    assert "db.internal" not in blob
    assert "postgres://" not in blob
    assert "RuntimeError" in body["database_error"]


# --------------------------------------------------------------------------- #
# Document retrieval
# --------------------------------------------------------------------------- #

def test_document_content_endpoint_requires_authentication(client):
    assert client.get("/api/v1/documents/does-not-exist/content").status_code == 401


def test_document_content_404s_for_an_unknown_id(client, tokens):
    r = client.get("/api/v1/documents/no-such-document/content",
                   headers=auth(tokens["clinic_admin"]))
    assert r.status_code == 404


def test_uploaded_document_can_be_downloaded_again(client, tokens, make_patient):
    """Upload then retrieve: the pair that was previously impossible."""
    patient = make_patient(age_days=400)
    upload = client.post(
        "/api/v1/documents/upload",
        headers=auth(tokens["healthcare_worker"]),
        files={"file": ("card_aarav_test.png", b"fake-png-bytes", "image/png")},
        data={"patient_id": patient.patient_id},
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    doc_id = body["document_id"]
    assert body["ocr_provider"] == "demo-ocr"
    assert body["demo_mode"] is True
    assert body["storage_backend"] in {"local", "supabase"}

    got = client.get(f"/api/v1/documents/{doc_id}/content",
                     headers=auth(tokens["healthcare_worker"]))
    assert got.status_code == 200, got.text
    assert got.content == b"fake-png-bytes"
    assert got.headers["cache-control"].startswith("no-store")
    assert got.headers["x-content-type-options"] == "nosniff"
    assert "attachment" in got.headers["content-disposition"]


def test_document_download_is_denied_across_patients(client, tokens, make_patient):
    """Possessing a document id must not confer access to it."""
    patient = make_patient(age_days=400, suffix="doc-owner")
    upload = client.post(
        "/api/v1/documents/upload",
        headers=auth(tokens["healthcare_worker"]),
        files={"file": ("card_diya.png", b"bytes", "image/png")},
        data={"patient_id": patient.patient_id},
    )
    doc_id = upload.json()["document_id"]

    r = client.get(f"/api/v1/documents/{doc_id}/content", headers=auth(tokens["patient2"]))
    assert r.status_code == 403


def test_a_filename_cannot_inject_response_headers(client, tokens, make_patient):
    from app import storage as storage_mod

    patient = make_patient(age_days=400, suffix="doc-hdr")
    evil = 'card.png"; x-injected: yes'
    upload = client.post(
        "/api/v1/documents/upload",
        headers=auth(tokens["healthcare_worker"]),
        files={"file": (evil, b"bytes", "image/png")},
        data={"patient_id": patient.patient_id},
    )
    assert upload.status_code == 200
    doc_id = upload.json()["document_id"]
    got = client.get(f"/api/v1/documents/{doc_id}/content",
                     headers=auth(tokens["healthcare_worker"]))
    assert got.status_code == 200
    assert "x-injected" not in {k.lower() for k in got.headers.keys()}
    assert "\r" not in got.headers["content-disposition"]
    assert "\n" not in got.headers["content-disposition"]


# --------------------------------------------------------------------------- #
# Serverless startup semantics
# --------------------------------------------------------------------------- #

def test_startup_does_not_run_ddl_against_a_managed_database(monkeypatch):
    """The application role has no DDL right, and migrations own the schema."""
    from app import main

    calls = []
    monkeypatch.setattr(main, "is_production_database", lambda: True)
    monkeypatch.setattr(main, "_ensure_seed_data", lambda: calls.append("seed"))
    monkeypatch.setattr(main.Base.metadata, "create_all",
                        lambda *a, **k: calls.append("create_all"))
    monkeypatch.delenv("RUN_CREATE_ALL", raising=False)
    monkeypatch.delenv("SEED_DEMO_DATA", raising=False)

    main.on_startup()
    assert "create_all" not in calls
    assert "seed" not in calls


def test_startup_seeds_a_managed_database_only_when_asked(monkeypatch):
    from app import main

    calls = []
    monkeypatch.setattr(main, "is_production_database", lambda: True)
    monkeypatch.setattr(main, "_ensure_seed_data", lambda: calls.append("seed"))
    monkeypatch.setattr(main.Base.metadata, "create_all",
                        lambda *a, **k: calls.append("create_all"))
    monkeypatch.setenv("SEED_DEMO_DATA", "1")
    monkeypatch.delenv("RUN_CREATE_ALL", raising=False)

    main.on_startup()
    assert calls == ["seed"]


def test_startup_still_creates_and_seeds_sqlite_so_the_demo_works(monkeypatch):
    from app import main

    calls = []
    monkeypatch.setattr(main, "is_production_database", lambda: False)
    monkeypatch.setattr(main, "_ensure_seed_data", lambda: calls.append("seed"))
    monkeypatch.setattr(main.Base.metadata, "create_all",
                        lambda *a, **k: calls.append("create_all"))

    main.on_startup()
    assert calls == ["create_all", "seed"]
