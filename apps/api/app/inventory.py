"""Shared inventory arithmetic.

Stock maths lives in one place so the summary endpoint, the transaction guard
and the analytics projection cannot drift apart. They previously disagreed: the
transaction guard computed available stock as
``received + max(adjusted, 0) - used``, which discarded *negative* adjustments.
A batch that had 5 doses written off as wastage could therefore still issue
those 5 doses, and the summary and analytics ignored adjustments entirely.

Conventions used here:
  * ``quantity_adjusted`` is **signed** — negative means wastage, breakage or a
    correction that reduces supply.
  * Expired stock contributes nothing. A dose past its expiry cannot be
    administered, so counting it as usable would overstate readiness.
  * Available quantity is never negative; over-issuing is prevented at write
    time rather than reported as a negative balance afterwards.
"""

from datetime import datetime, timedelta
from typing import Optional

#: Batches expiring within this window are surfaced for rotation.
EXPIRING_SOON_WINDOW_DAYS = 60

#: A batch at or below this many usable doses is flagged as low stock.
LOW_STOCK_THRESHOLD = 10


def _now(reference: Optional[datetime]) -> datetime:
    return reference or datetime.utcnow()


def is_expired(batch, reference: Optional[datetime] = None) -> bool:
    """True when a batch is past its expiry date or has been marked expired."""
    now = _now(reference)
    if batch.status == "expired":
        return True
    return batch.expiry_date is not None and batch.expiry_date < now


def is_expiring_soon(batch, reference: Optional[datetime] = None) -> bool:
    """True when a batch is still usable but inside the rotation window."""
    now = _now(reference)
    if is_expired(batch, now):
        return False
    if batch.status != "active":
        return False
    return batch.expiry_date is not None and batch.expiry_date <= now + timedelta(days=EXPIRING_SOON_WINDOW_DAYS)


def available_quantity(batch, reference: Optional[datetime] = None) -> int:
    """Doses still usable from a batch."""
    if is_expired(batch, reference):
        return 0
    total = (
        (batch.quantity_received or 0)
        + (batch.quantity_adjusted or 0)
        - (batch.quantity_used or 0)
    )
    return max(total, 0)


def is_low_stock(batch, reference: Optional[datetime] = None) -> bool:
    """True for an active batch with at or below the low-stock threshold."""
    if batch.status != "active" or is_expired(batch, reference):
        return False
    return available_quantity(batch, reference) <= LOW_STOCK_THRESHOLD
