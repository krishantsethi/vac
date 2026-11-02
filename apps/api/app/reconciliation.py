"""Record reconciliation: duplicate and conflict detection.

Detection only. Nothing here merges identities or deletes history — ambiguous
candidates are surfaced with their evidence for a human decision.
"""

import re
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Optional

from sqlalchemy.orm import Session

from . import models

# Controlled terminology mapping: common card spellings -> catalogue codes.
# Deliberately explicit and auditable rather than inferred at runtime.
TERMINOLOGY_MAP: dict[str, str] = {
    "bcg": "BCG",
    "bacille calmette": "BCG",
    "bacille calmette-guerin": "BCG",
    "opv": "OPV0",
    "opv 0": "OPV0",
    "oral polio": "OPV0",
    "polio birth dose": "OPV0",
    "hep b": "HEPB0",
    "hepb": "HEPB0",
    "hepatitis b": "HEPB0",
    "hepatitis b birth dose": "HEPB0",
    "pentavalent": "PENTA1",
    "penta": "PENTA1",
    "pentavalent 1": "PENTA1",
    "dpt-hepb-hib": "PENTA1",
    "pentavalent 2": "PENTA2",
    "pentavalent 3": "PENTA3",
    "rotavirus": "ROTA1",
    "rota": "ROTA1",
    "rotavirus 1": "ROTA1",
    "rotavirus 2": "ROTA2",
    "ipv": "IPV1",
    "inactivated polio": "IPV1",
    "measles": "MCV1",
    "measles-rubella": "MCV1",
    "mr": "MCV1",
    "measles rubella": "MCV1",
    "measles-rubella 2": "MCV2",
    "mr 2": "MCV2",
    "pneumococcal": "PCV1",
    "pcv": "PCV1",
    "dpt booster": "DPT_BOOSTER",
    "dpt": "DPT_BOOSTER",
    "polio booster": "OPV_BOOSTER",
}

DATE_FORMATS = [
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%m/%d/%Y",
    "%d %b %Y",
    "%d %B %Y",
    "%b %d, %Y",
    "%B %d, %Y",
    "%Y/%m/%d",
    "%d%m%Y",
]


def normalize_text(value: Optional[str]) -> str:
    """Lowercase, collapse whitespace, strip punctuation for comparison."""
    if not value:
        return ""
    v = value.strip().lower()
    v = re.sub(r"[^a-z0-9\s-]", " ", v)
    v = re.sub(r"\s+", " ", v)
    return v.strip()


def map_vaccine_name(candidate: Optional[str]) -> tuple[Optional[str], str]:
    """Map a free-text vaccine name to a catalogue code.

    Returns (code_or_None, method). Never invents a vaccine: when nothing
    matches confidently it returns None so the field is escalated for review.
    """
    norm = normalize_text(candidate)
    if not norm:
        return None, "empty"

    if norm in TERMINOLOGY_MAP:
        return TERMINOLOGY_MAP[norm], "controlled_terminology_exact"

    # Strip a trailing dose number and retry ("pentavalent 3" -> "pentavalent").
    stem = re.sub(r"\s*\d+$", "", norm).strip()
    if stem and stem in TERMINOLOGY_MAP:
        return TERMINOLOGY_MAP[stem], "controlled_terminology_stem"

    # Exact catalogue code match.
    upper = norm.upper().replace(" ", "").replace("-", "")
    for code in TERMINOLOGY_MAP.values():
        if code.replace("_", "") == upper:
            return code, "catalogue_code_exact"

    # Fuzzy match against terminology keys, with a conservative threshold.
    best_key: Optional[str] = None
    best_ratio = 0.0
    for key in TERMINOLOGY_MAP:
        ratio = SequenceMatcher(None, norm, key).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_key = key
    if best_key and best_ratio >= 0.88:
        return TERMINOLOGY_MAP[best_key], f"fuzzy_match_{best_ratio:.2f}"

    return None, "no_confident_match"


def parse_date_flexible(value: Optional[str]) -> tuple[Optional[datetime], Optional[str]]:
    """Parse a date string in any supported format.

    Returns (datetime_or_None, format_used). A value that cannot be parsed is
    reported as unparseable rather than guessed.
    """
    if not value:
        return None, None
    v = str(value).strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt), fmt
        except ValueError:
            continue
    # ISO with time component
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).replace(tzinfo=None), "iso8601"
    except ValueError:
        return None, None


# Day-first and month-first readings of the same string. Indian clinical
# records are overwhelmingly day-first, but imported cards and older software
# exports are often month-first, so the same digits can mean two different days.
AMBIGUOUS_DATE_FORMAT_PAIRS = (
    ("%d/%m/%Y", "%m/%d/%Y"),
    ("%d-%m-%Y", "%m-%d-%Y"),
    ("%d.%m.%Y", "%m.%d.%Y"),
)


def date_ambiguity(value: Optional[str]) -> dict[str, Any]:
    """Report whether a date string can legitimately be read two ways.

    Returns a dict with:
      ``ambiguous``     True when two supported readings give different days.
      ``chosen``        ISO date actually used (day-first, the local convention).
      ``format``        The format string that produced ``chosen``.
      ``alternatives``  Every supported reading, as ``{format: iso_date}``.
      ``note``          Human-readable explanation, or None.

    Ambiguity is *reported*, never silently resolved: an OCR-extracted date that
    could be 3 April or 4 March is flagged for a human to confirm.
    """
    readings: dict[str, str] = {}
    if not value:
        return {"ambiguous": False, "chosen": None, "format": None, "alternatives": {}, "note": None}

    v = str(value).strip()
    for fmt in DATE_FORMATS:
        try:
            readings[fmt] = datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    if not readings:
        try:
            parsed = datetime.fromisoformat(v.replace("Z", "+00:00")).replace(tzinfo=None)
            readings["iso8601"] = parsed.date().isoformat()
        except ValueError:
            return {"ambiguous": False, "chosen": None, "format": None, "alternatives": {},
                    "note": "value could not be parsed as a date"}

    chosen_dt, chosen_fmt = parse_date_flexible(v)
    chosen = chosen_dt.date().isoformat() if chosen_dt else None

    ambiguous = False
    for day_first, month_first in AMBIGUOUS_DATE_FORMAT_PAIRS:
        if day_first in readings and month_first in readings and readings[day_first] != readings[month_first]:
            ambiguous = True
            break

    note = None
    if ambiguous:
        distinct = sorted(set(readings.values()))
        note = (
            f"'{v}' can be read as {' or '.join(distinct)}. Day-first (the convention used here) "
            f"was applied, but this must be confirmed against the source document before it is "
            f"treated as authoritative."
        )
    return {
        "ambiguous": ambiguous,
        "chosen": chosen,
        "format": chosen_fmt,
        "alternatives": readings,
        "note": note,
    }


def _dose_number(label: Optional[str]) -> int:
    norm = (label or "").lower().strip()
    if not norm:
        return 0
    if "birth" in norm or "zero" in norm:
        return 0
    if "booster" in norm:
        return 99
    digits = "".join(ch for ch in norm if ch.isdigit())
    return int(digits) if digits else 1


def resolve_vaccine_code(
    db: Session, name: Optional[str], dose_label: Optional[str] = None
) -> tuple[Optional[Any], str]:
    """Resolve a free-text vaccine name plus dose label to a catalogue vaccine.

    Returns ``(vaccine_or_None, method)``.

    The dose label matters. A card reading "Pentavalent, Dose 3" must resolve to
    PENTA3, not to whichever Pentavalent row a substring search happens to hit
    first. Recording the wrong dose code both invents a dose that was not given
    and leaves the real gap unresolved, so this function never falls back to a
    loose substring match.

    When nothing matches confidently it returns ``(None, "no_confident_match")``
    so the caller escalates for human review instead of guessing.
    """
    catalogue = db.query(models.Vaccine).all()
    by_code = {v.code.upper(): v for v in catalogue}
    by_name = {normalize_text(v.name): v for v in catalogue if v.name}

    label = (dose_label or "").lower()
    dose = _dose_number(dose_label)
    is_birth = "birth" in label
    is_booster = "booster" in label

    raw = (name or "").strip().upper().replace(" ", "_").replace("-", "_")
    if raw in by_code:
        return by_code[raw], "catalogue_code_exact"

    norm = normalize_text(name)
    if norm and norm in by_name:
        return by_name[norm], "catalogue_name_exact"

    base_code, method = map_vaccine_name(name)
    if base_code is None:
        return None, "no_confident_match"
    base = by_code.get(base_code.upper())
    if base is None:
        return None, "no_confident_match"

    stem = re.sub(r"\d+$", "", base.code)
    has_numeric_suffix = bool(stem) and stem != base.code

    # A booster is its own catalogue entry; do not append a dose number to it.
    if has_numeric_suffix and dose >= 1 and not is_booster:
        candidate = by_code.get(f"{stem}{dose}")
        if candidate is not None and candidate.code != base.code:
            return candidate, f"{method}+dose_adjusted"

    # Birth doses are catalogued with a trailing 0 (HEPB0, OPV0).
    if has_numeric_suffix and is_birth:
        candidate = by_code.get(f"{stem}0")
        if candidate is not None:
            return candidate, f"{method}+birth_dose_adjusted"

    return base, method


def detect_event_issues(db: Session, patient_id: str) -> list[dict[str, Any]]:
    """Find duplicate and conflicting vaccination events for one patient.

    Returns a list of issue descriptors with explicit evidence. Detection only:
    no event is modified, merged, or deleted.
    """
    events = (
        db.query(models.VaccinationEvent)
        .filter_by(patient_id=patient_id)
        .order_by(models.VaccinationEvent.administered_at)
        .all()
    )

    issues: list[dict[str, Any]] = []

    # Group by (vaccine_code, dose_number)
    groups: dict[tuple[str, int], list[models.VaccinationEvent]] = {}
    for e in events:
        groups.setdefault((e.vaccine_code, _dose_number(e.dose_label)), []).append(e)

    for (code, dose), group in groups.items():
        if len(group) < 2:
            continue

        # Exact duplicate: same vaccine, dose, and calendar date.
        by_date: dict[str, list[models.VaccinationEvent]] = {}
        for e in group:
            key = e.administered_at.date().isoformat() if e.administered_at else "unknown"
            by_date.setdefault(key, []).append(e)

        for date_key, same_day in by_date.items():
            if len(same_day) > 1:
                issues.append({
                    "type": "duplicate_event",
                    "severity": "medium",
                    "vaccine_code": code,
                    "dose_number": dose,
                    "date": date_key,
                    "event_ids": [e.id for e in same_day],
                    "evidence": {
                        "matched_on": ["patient", "vaccine_code", "dose_number", "administered_date"],
                        "facilities": sorted({e.facility or "unrecorded" for e in same_day}),
                        "batch_numbers": sorted({e.batch_number or "unrecorded" for e in same_day}),
                    },
                    "conflicting_fields": (
                        ["batch_number"] if len({e.batch_number for e in same_day}) > 1 else []
                    ),
                    "recommended_action": (
                        "Confirm whether this is one dose recorded twice, or two separate entries. "
                        "Do not delete either record until a reviewer decides."
                    ),
                })

        # Conflicting dates: same dose recorded on different days.
        if len(by_date) > 1:
            dates = sorted(by_date.keys())
            issues.append({
                "type": "conflicting_dates",
                "severity": "high",
                "vaccine_code": code,
                "dose_number": dose,
                "dates": dates,
                "event_ids": [e.id for e in group],
                "evidence": {
                    "matched_on": ["patient", "vaccine_code", "dose_number"],
                    "differing": ["administered_date"],
                    "per_date": {
                        d: [
                            {
                                "event_id": e.id,
                                "facility": e.facility,
                                "batch_number": e.batch_number,
                                "is_verified": e.is_verified,
                                "source": e.source,
                            }
                            for e in by_date[d]
                        ]
                        for d in dates
                    },
                },
                "conflicting_fields": ["administered_date"],
                "recommended_action": (
                    "Resolve which date is authoritative before the schedule is trusted. "
                    "The earlier verified date is typically used for interval calculations, "
                    "but this requires a human decision."
                ),
            })

    # Different vaccine names mapping to the same code (terminology drift).
    by_code: dict[str, set[str]] = {}
    for e in events:
        by_code.setdefault(e.vaccine_code, set()).add(e.vaccine_name or "")
    for code, names in by_code.items():
        if len(names) > 1:
            issues.append({
                "type": "terminology_variance",
                "severity": "low",
                "vaccine_code": code,
                "names": sorted(names),
                "evidence": {"matched_on": ["vaccine_code"], "differing": ["vaccine_name"]},
                "conflicting_fields": ["vaccine_name"],
                "recommended_action": (
                    "Normalize to the controlled terminology so reporting is consistent. "
                    "No clinical change is implied."
                ),
            })

    # Verification gaps: a dose exists but no entry is verified.
    for (code, dose), group in groups.items():
        if group and not any(e.is_verified for e in group):
            issues.append({
                "type": "unverified_dose",
                "severity": "medium",
                "vaccine_code": code,
                "dose_number": dose,
                "event_ids": [e.id for e in group],
                "evidence": {"matched_on": ["patient", "vaccine_code", "dose_number"], "verified_count": 0},
                "conflicting_fields": [],
                "recommended_action": (
                    "Verification required. An unverified entry is not evidence that a dose was given, "
                    "and is not evidence that it was not."
                ),
            })

    order = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda i: (order.get(i.get("severity", "low"), 3), i.get("type", "")))
    return issues


def detect_identity_candidates(db: Session, threshold: float = 0.82) -> list[dict[str, Any]]:
    """Find patient-identity near-duplicate candidates across the registry.

    Uses normalized name similarity plus exact date-of-birth agreement.
    Candidates are returned for review; identities are never merged here.
    """
    patients = db.query(models.Patient).all()
    seen: set[tuple[str, str]] = set()
    candidates: list[dict[str, Any]] = []

    for i, a in enumerate(patients):
        for b in patients[i + 1:]:
            pair = tuple(sorted((a.id, b.id)))
            if pair in seen:
                continue

            name_a = normalize_text(f"{a.first_name} {a.last_name}")
            name_b = normalize_text(f"{b.first_name} {b.last_name}")
            name_ratio = SequenceMatcher(None, name_a, name_b).ratio()

            dob_match = (
                a.date_of_birth is not None
                and b.date_of_birth is not None
                and a.date_of_birth.date() == b.date_of_birth.date()
            )

            matched: list[str] = []
            differing: list[str] = []
            if name_ratio >= threshold:
                matched.append("name")
            else:
                differing.append("name")
            if dob_match:
                matched.append("date_of_birth")
            else:
                differing.append("date_of_birth")
            if a.service_area and a.service_area == b.service_area:
                matched.append("service_area")
            else:
                differing.append("service_area")
            if a.phone and b.phone and a.phone == b.phone:
                matched.append("phone")
            else:
                differing.append("phone")

            # Require name agreement AND date-of-birth agreement to raise a candidate.
            if not (name_ratio >= threshold and dob_match):
                continue

            seen.add(pair)
            score = round(name_ratio * 70 + (20 if dob_match else 0) + (10 if a.service_area == b.service_area else 0), 2)
            candidates.append({
                "patient_id": a.id,
                "patient_display_id": a.patient_id,
                "patient_name": f"{a.first_name} {a.last_name}",
                "candidate_patient_id": b.id,
                "candidate_display_id": b.patient_id,
                "candidate_name": f"{b.first_name} {b.last_name}",
                "match_score": score,
                "evidence": {
                    "matched": matched,
                    "differing": differing,
                    "name_similarity": round(name_ratio, 3),
                    "method": "normalized_name_similarity_plus_exact_dob",
                },
                "conflicting_fields": differing,
                "recommended_action": (
                    "Review before any merge. Ambiguous identities are never merged automatically, "
                    "and no historical record is deleted because a duplicate is suspected."
                ),
            })

    candidates.sort(key=lambda c: c["match_score"], reverse=True)
    return candidates
