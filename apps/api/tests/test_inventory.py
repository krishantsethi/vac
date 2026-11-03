"""Inventory tests (acceptance workflow G).

The important invariant is that usable stock is computed the same way
everywhere. A regression here previously let a batch issue doses that had been
written off as wastage, because the transaction guard ignored negative
adjustments while the summary and analytics ignored adjustments altogether.
"""

from datetime import datetime, timedelta

import pytest

from app import models
from app.inventory import available_quantity
from tests.conftest import auth


@pytest.fixture
def vaccine(db):
    return db.query(models.Vaccine).first()


@pytest.fixture
def make_batch(client, tokens, db, vaccine):
    """Create a batch through the API so transactions are recorded too."""
    created = []

    def _make(quantity=50, expiry_days=120, batch_number=None):
        batch_number = batch_number or f"TEST-BATCH-{len(created)}-{quantity}"
        r = client.post(
            "/api/v1/inventory/batches",
            headers=auth(tokens["clinic_admin"]),
            json={
                "vaccine_id": vaccine.id,
                "batch_number": batch_number,
                "quantity_received": quantity,
                "expiry_date": (datetime.utcnow() + timedelta(days=expiry_days)).isoformat(),
            },
        )
        assert r.status_code == 200, r.text
        created.append(r.json()["id"])
        return r.json()

    yield _make

    for batch_id in created:
        b = db.get(models.InventoryBatch, batch_id)
        if b is not None:
            db.delete(b)
    db.commit()


def transact(client, token, batch_id, kind, quantity, reference=None):
    return client.post(
        "/api/v1/inventory/transactions",
        headers=auth(token),
        json={"batch_id": batch_id, "transaction_type": kind, "quantity": quantity, "reference": reference},
    )


# --------------------------------------------------------------------------- #
# Authorization
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("role", ["patient", "caregiver", "system_admin"])
def test_inventory_is_not_visible_outside_clinical_roles(client, tokens, role):
    for path in ("/api/v1/inventory/batches", "/api/v1/inventory/summary"):
        assert client.get(path, headers=auth(tokens[role])).status_code == 403, f"{role} {path}"


def test_oversight_role_may_read_but_not_write_inventory(client, tokens, make_batch):
    batch = make_batch(quantity=20)
    assert client.get("/api/v1/inventory/summary", headers=auth(tokens["public_health_admin"])).status_code == 200
    r = transact(client, tokens["public_health_admin"], batch["id"], "usage", 1)
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["patient", "caregiver", "system_admin", "public_health_admin"])
def test_stock_receipts_are_restricted(client, tokens, vaccine, role):
    r = client.post(
        "/api/v1/inventory/batches",
        headers=auth(tokens[role]),
        json={
            "vaccine_id": vaccine.id,
            "batch_number": "SHOULD-NOT-EXIST",
            "quantity_received": 10,
            "expiry_date": (datetime.utcnow() + timedelta(days=90)).isoformat(),
        },
    )
    assert r.status_code == 403


def test_worker_may_record_usage(client, tokens, make_batch):
    batch = make_batch(quantity=20)
    r = transact(client, tokens["healthcare_worker"], batch["id"], "usage", 2, "Session 4")
    assert r.status_code == 200, r.text


# --------------------------------------------------------------------------- #
# Receipts
# --------------------------------------------------------------------------- #

def test_receiving_stock_records_a_receipt_transaction(client, tokens, db, make_batch):
    batch = make_batch(quantity=40)
    db.expire_all()
    row = db.get(models.InventoryBatch, batch["id"])
    assert row.quantity_received == 40
    assert row.quantity_used == 0
    txs = db.query(models.InventoryTransaction).filter_by(batch_id=batch["id"]).all()
    assert any(t.transaction_type == "receipt" and t.quantity == 40 for t in txs)
    assert available_quantity(row) == 40


def test_cannot_receive_already_expired_stock(client, tokens, vaccine):
    r = client.post(
        "/api/v1/inventory/batches",
        headers=auth(tokens["clinic_admin"]),
        json={
            "vaccine_id": vaccine.id,
            "batch_number": "EXPIRED-ON-ARRIVAL",
            "quantity_received": 10,
            "expiry_date": (datetime.utcnow() - timedelta(days=5)).isoformat(),
        },
    )
    assert r.status_code == 422


def test_batch_number_is_required_for_traceability(client, tokens, vaccine):
    r = client.post(
        "/api/v1/inventory/batches",
        headers=auth(tokens["clinic_admin"]),
        json={
            "vaccine_id": vaccine.id,
            "batch_number": "   ",
            "quantity_received": 10,
            "expiry_date": (datetime.utcnow() + timedelta(days=90)).isoformat(),
        },
    )
    assert r.status_code == 422


def test_negative_receipt_quantity_is_rejected(client, tokens, vaccine):
    r = client.post(
        "/api/v1/inventory/batches",
        headers=auth(tokens["clinic_admin"]),
        json={
            "vaccine_id": vaccine.id,
            "batch_number": "NEGATIVE-RECEIPT",
            "quantity_received": -10,
            "expiry_date": (datetime.utcnow() + timedelta(days=90)).isoformat(),
        },
    )
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# Usage and the available-stock invariant
# --------------------------------------------------------------------------- #

def test_usage_reduces_available_stock(client, tokens, db, make_batch):
    batch = make_batch(quantity=30)
    assert transact(client, tokens["clinic_admin"], batch["id"], "usage", 12).status_code == 200
    db.expire_all()
    row = db.get(models.InventoryBatch, batch["id"])
    assert row.quantity_used == 12
    assert available_quantity(row) == 18


def test_cannot_issue_more_than_is_available(client, tokens, db, make_batch):
    batch = make_batch(quantity=10)
    r = transact(client, tokens["clinic_admin"], batch["id"], "usage", 11)
    assert r.status_code == 400
    assert "Insufficient stock" in r.json()["detail"]
    db.expire_all()
    assert db.get(models.InventoryBatch, batch["id"]).quantity_used == 0


def test_wastage_reduces_what_can_be_issued(client, tokens, db, make_batch):
    """Regression: negative adjustments used to be ignored by the guard.

    A batch of 20 with 15 written off as wastage has 5 usable doses. The old
    arithmetic (``received + max(adjusted, 0)``) still allowed issuing 20.
    """
    batch = make_batch(quantity=20)
    r = transact(client, tokens["clinic_admin"], batch["id"], "adjustment", -15, "Vial breakage")
    assert r.status_code == 200, r.text

    db.expire_all()
    row = db.get(models.InventoryBatch, batch["id"])
    assert available_quantity(row) == 5

    too_many = transact(client, tokens["clinic_admin"], batch["id"], "usage", 6)
    assert too_many.status_code == 400, "wastage was not deducted from issuable stock"

    assert transact(client, tokens["clinic_admin"], batch["id"], "usage", 5).status_code == 200
    db.expire_all()
    assert available_quantity(db.get(models.InventoryBatch, batch["id"])) == 0


def test_write_off_cannot_exceed_available_stock(client, tokens, make_batch):
    batch = make_batch(quantity=8)
    r = transact(client, tokens["clinic_admin"], batch["id"], "adjustment", -20, "Bad write-off")
    assert r.status_code == 400


def test_expiry_makes_stock_unusable(client, tokens, db, make_batch):
    batch = make_batch(quantity=25)
    assert transact(client, tokens["clinic_admin"], batch["id"], "expiry", 0, "Cold chain failure").status_code == 200
    db.expire_all()
    row = db.get(models.InventoryBatch, batch["id"])
    assert row.status == "expired"
    assert available_quantity(row) == 0
    # And nothing further can be issued or received against it.
    assert transact(client, tokens["clinic_admin"], batch["id"], "usage", 1).status_code == 400
    assert transact(client, tokens["clinic_admin"], batch["id"], "receipt", 10).status_code == 400


def test_expired_batch_is_excluded_from_summary_counts(client, tokens, db, make_batch):
    batch = make_batch(quantity=25)
    transact(client, tokens["clinic_admin"], batch["id"], "expiry", 0)
    summary = client.get("/api/v1/inventory/summary", headers=auth(tokens["clinic_admin"])).json()
    db.expire_all()
    expired_rows = [
        b for b in db.query(models.InventoryBatch).all()
        if b.status == "expired" or b.expiry_date < datetime.utcnow()
    ]
    assert summary["expired_count"] == len(expired_rows)


def test_unknown_transaction_type_is_rejected(client, tokens, make_batch):
    batch = make_batch(quantity=10)
    r = transact(client, tokens["clinic_admin"], batch["id"], "donate", 5)
    assert r.status_code in (400, 422)


def test_transaction_for_unknown_batch_is_rejected(client, tokens):
    r = transact(client, tokens["clinic_admin"], "no-such-batch-id", "usage", 1)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Summary and projection
# --------------------------------------------------------------------------- #

def test_summary_shape_and_thresholds_are_disclosed(client, tokens):
    body = client.get("/api/v1/inventory/summary", headers=auth(tokens["clinic_admin"])).json()
    for key in ("total_batches", "active_batches", "low_stock_count", "expiring_soon_count",
                "expired_count", "usable_doses", "thresholds"):
        assert key in body, f"summary is missing {key}"
    assert body["thresholds"]["low_stock_at_or_below"] == 10
    assert body["thresholds"]["expiring_within_days"] == 60


def test_summary_agrees_with_the_analytics_projection(client, tokens, db):
    """Both views must derive usable stock the same way."""
    summary = client.get("/api/v1/inventory/summary", headers=auth(tokens["clinic_admin"])).json()
    levels = client.get("/api/v1/analytics/inventory-levels", headers=auth(tokens["clinic_admin"])).json()

    from_summary = summary["usable_doses"]
    from_analytics = sum(item["usable_stock"] for item in levels["items"])
    assert from_summary == from_analytics, (
        f"inventory summary ({from_summary}) and analytics ({from_analytics}) disagree"
    )
    assert from_summary == sum(available_quantity(b) for b in db.query(models.InventoryBatch).all())


def test_projection_labels_a_shortage_without_claiming_a_stockout(client, tokens):
    levels = client.get("/api/v1/analytics/inventory-levels", headers=auth(tokens["clinic_admin"])).json()
    assert levels["items"]
    assert "requires verification" in levels["method"]["note"]
    assert "adjustments" in levels["method"]["usable_stock"]

    for item in levels["items"]:
        assert item["projected_shortage"] == max(item["expected_demand"] - item["usable_stock"], 0)
        assert item["stock_status"] in ("shortage_projected", "low_stock", "adequate")
        if item["projected_shortage"] > 0:
            assert item["stock_status"] == "shortage_projected"


def test_soon_to_expire_stock_is_still_counted_as_usable(client, tokens, db, make_batch):
    """Expiring soon is a rotation prompt, not a reason to discard the count."""
    batch = make_batch(quantity=15, expiry_days=20)
    db.expire_all()
    row = db.get(models.InventoryBatch, batch["id"])
    assert available_quantity(row) == 15
    summary = client.get("/api/v1/inventory/summary", headers=auth(tokens["clinic_admin"])).json()
    assert summary["expiring_soon_count"] >= 1
