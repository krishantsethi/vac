"""Document text extraction, behind a provider interface.

Three providers, selected by ``OCR_PROVIDER``:

``demo``
    The deterministic labelled fixture this project shipped with. It reads
    nothing from the uploaded image and always says so. Retained because the
    demonstration must work with no binary installed and no key configured.

``tesseract``
    Real OCR from the open-source Tesseract engine, invoked as a subprocess.
    Free, offline, no API key, no account, no network egress — which matters
    for a system handling immunisation records. Reports per-word confidence
    because the engine genuinely supplies it.

``auto`` (default)
    Tesseract when the binary is really present, otherwise demo. The choice is
    recorded on every document and surfaced in the health endpoint, so nobody
    has to guess which one ran.

Two honesty rules the code enforces rather than documents:

1. A provider that supplies no confidence measure reports ``None``. A number is
   never invented to fill the column.
2. Extraction that did not happen is reported as not having happened. There is
   no path that returns fixture values while claiming to be Tesseract.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger("vaxbridge.ocr")

OCR_PROVIDER = os.getenv("OCR_PROVIDER", "").strip().lower()
# Backwards compatible with the original single switch.
OCR_DEMO_MODE = os.getenv("OCR_DEMO_MODE", "true").strip().lower() == "true"
if not OCR_PROVIDER:
    OCR_PROVIDER = "demo" if OCR_DEMO_MODE else "auto"

TESSERACT_TIMEOUT = int(os.getenv("OCR_TIMEOUT_SECONDS", "60"))
# Tesseract's own 0-100 scale. Below this the word is treated as unread rather
# than guessed, because a wrong vaccine date is worse than a missing one.
MIN_WORD_CONFIDENCE = float(os.getenv("OCR_MIN_CONFIDENCE", "60"))

DEMO_FIXTURES: Dict[str, Dict[str, str]] = {
    "card_aarav": {
        "vaccination_date": "2024-03-15",
        "vaccine_name": "Pentavalent",
        "dose_label": "Dose 3",
        "facility": "Delhi Urban PHC",
        "batch_number": "PNT-2024-003",
        "record_id": "REC-1001",
    },
    "card_diya": {
        "vaccination_date": "2024-06-10",
        "vaccine_name": "Measles-Rubella",
        "dose_label": "Dose 1",
        "facility": "Mumbai East Centre",
        "batch_number": "MR-2024-005",
        "record_id": "REC-1002",
    },
    "card_ananya": {
        "vaccination_date": "2024-09-01",
        "vaccine_name": "Pentavalent",
        "dose_label": "Dose 1",
        "facility": "Chennai PHC",
        "batch_number": "PNT-2024-015",
        "record_id": "REC-1003",
    },
}


@dataclass
class ExtractedValue:
    field_name: str
    field_value: str
    # None means "the provider did not measure this". Not zero, not a guess.
    confidence: Optional[float] = None


@dataclass
class ExtractionResult:
    provider: str
    status: str                      # completed | failed | unavailable
    is_demo: bool                    # True whenever the values are fixtures
    fields: List[ExtractedValue] = field(default_factory=list)
    raw_text: str = ""
    detail: str = ""

    @property
    def mean_confidence(self) -> Optional[float]:
        values = [f.confidence for f in self.fields if f.confidence is not None]
        return round(sum(values) / len(values), 2) if values else None


def demo_extract(filename: str) -> ExtractionResult:
    """The labelled fixture. Deterministic across restarts (md5, not hash())."""
    name = (filename or "").lower()
    key = next((k for k in DEMO_FIXTURES if k in name), None)
    if key is None:
        # Python's str hash is salted per process; using it here would break the
        # determinism the README and the test suite both rely on.
        digest = hashlib.md5(name.encode("utf-8")).hexdigest()
        key = list(DEMO_FIXTURES)[int(digest, 16) % len(DEMO_FIXTURES)]
    fixture = DEMO_FIXTURES[key]
    return ExtractionResult(
        provider="demo-ocr",
        status="completed",
        is_demo=True,
        fields=[ExtractedValue(k, v, None) for k, v in fixture.items()],
        detail="Demonstration fixture. No text was read from the uploaded file.",
    )


def tesseract_available() -> bool:
    """True only when the engine can actually be executed."""
    return shutil.which("tesseract") is not None


def _run_tesseract(image_path: str) -> Optional[str]:
    """Run the engine and return TSV so per-word confidence survives."""
    try:
        proc = subprocess.run(
            ["tesseract", image_path, "stdout", "--psm", "6", "tsv"],
            capture_output=True, text=True, timeout=TESSERACT_TIMEOUT,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("[ocr] tesseract_failed stage=exec detail=%s", type(exc).__name__)
        return None
    if proc.returncode != 0:
        logger.warning("[ocr] tesseract_failed stage=exit code=%s", proc.returncode)
        return None
    return proc.stdout


def _rasterise_pdf(data: bytes) -> Optional[str]:
    """Turn page 1 of a PDF into a PNG. Returns None if poppler is absent."""
    if shutil.which("pdftoppm") is None:
        return None
    workdir = tempfile.mkdtemp(prefix="vaxbridge-ocr-")
    src = os.path.join(workdir, "document.pdf")
    with open(src, "wb") as fh:
        fh.write(data)
    try:
        subprocess.run(
            ["pdftoppm", "-png", "-r", "300", "-f", "1", "-l", "1", src,
             os.path.join(workdir, "page")],
            capture_output=True, timeout=TESSERACT_TIMEOUT, check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    for candidate in sorted(os.listdir(workdir)):
        if candidate.endswith(".png"):
            return os.path.join(workdir, candidate)
    return None


# Field labels as they appear on Indian immunisation cards, mapped to the
# application's own field names. Matching is deliberately conservative: an
# unrecognised line is dropped rather than guessed into a clinical field.
_FIELD_PATTERNS = [
    ("vaccination_date", ("date of vaccination", "vaccination date", "date given", "date administered")),
    ("vaccine_name", ("vaccine", "antigen", "immunization", "immunisation")),
    ("dose_label", ("dose", "booster")),
    ("batch_number", ("batch", "lot")),
    ("facility", ("facility", "centre", "center", "phc", "clinic", "hospital")),
    ("record_id", ("record id", "record no", "card no", "beneficiary id")),
]


def _map_lines_to_fields(text: str) -> List[ExtractedValue]:
    """Extract label:value pairs the engine actually read, with real confidence."""
    rows: List[ExtractedValue] = []
    seen = set()
    for line in text.splitlines():
        parts = line.split("\t")
        # Tesseract TSV: level page block par line word left top width height conf text
        if len(parts) < 12:
            continue
        try:
            conf = float(parts[10])
        except ValueError:
            continue
        word = parts[11].strip()
        if not word or conf < 0:
            continue
        if conf < MIN_WORD_CONFIDENCE:
            continue
        normalised = word.lower().strip(":")
        for field_name, needles in _FIELD_PATTERNS:
            if field_name in seen:
                continue
            if any(n in normalised for n in needles):
                # The value usually follows the label on the same line.
                value = word.split(":", 1)[-1].strip() if ":" in word else ""
                if not value:
                    remainder = line.split("\t")[-1].strip()
                    value = remainder
                if value:
                    rows.append(ExtractedValue(field_name, value, round(conf, 2)))
                    seen.add(field_name)
                break
    return rows


def tesseract_extract(data: bytes, filename: str, content_type: str) -> ExtractionResult:
    """Real OCR. Falls back to *reporting failure*, never to fixtures."""
    if not tesseract_available():
        return ExtractionResult(
            provider="tesseract", status="unavailable", is_demo=False,
            detail="The Tesseract binary is not installed on this host.",
        )

    workdir = tempfile.mkdtemp(prefix="vaxbridge-ocr-")
    try:
        if content_type == "application/pdf":
            image_path = _rasterise_pdf(data)
            if not image_path:
                return ExtractionResult(
                    provider="tesseract", status="failed", is_demo=False,
                    detail="PDF rasterisation needs poppler-utils (pdftoppm), which is not installed.",
                )
        else:
            suffix = ".png" if "png" in content_type else ".jpg"
            image_path = os.path.join(workdir, "upload" + suffix)
            with open(image_path, "wb") as fh:
                fh.write(data)

        tsv = _run_tesseract(image_path)
        if tsv is None:
            return ExtractionResult(
                provider="tesseract", status="failed", is_demo=False,
                detail="The OCR engine did not return a result for this file.",
            )

        words = [
            (row.split("\t")[11], float(row.split("\t")[10]))
            for row in tsv.splitlines()
            if len(row.split("\t")) >= 12 and row.split("\t")[11].strip()
        ]
        readable = [w for w, c in words if c >= MIN_WORD_CONFIDENCE]
        if not readable:
            # An unreadable scan is a real result. Reporting empty is honest;
            # reporting a fixture would be fabrication.
            return ExtractionResult(
                provider="tesseract", status="completed", is_demo=False,
                fields=[], raw_text="",
                detail="No text reached the minimum confidence threshold; nothing was extracted.",
            )

        fields_found = _map_lines_to_fields(tsv)
        confs = [c for _, c in words if c >= MIN_WORD_CONFIDENCE]
        return ExtractionResult(
            provider="tesseract", status="completed", is_demo=False,
            fields=fields_found, raw_text=" ".join(readable)[:4000],
            detail=(
                f"Read {len(readable)} of {len(words)} words at or above "
                f"{MIN_WORD_CONFIDENCE:.0f} confidence; mapped {len(fields_found)} clinical field(s)."
            ),
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def extract(data: bytes, filename: str, content_type: str) -> ExtractionResult:
    """The single entry point the upload endpoint uses."""
    provider = OCR_PROVIDER

    if provider == "demo":
        return demo_extract(filename)

    if provider == "none":
        return ExtractionResult(
            provider="none", status="unavailable", is_demo=False,
            detail="OCR is disabled by configuration. Upload the document and enter the fields manually.",
        )

    # tesseract / auto
    if not tesseract_available():
        if provider == "tesseract":
            return ExtractionResult(
                provider="tesseract", status="unavailable", is_demo=False,
                detail="OCR_PROVIDER=tesseract but the binary is not installed.",
            )
        # auto: fall back to the labelled fixture rather than failing the upload.
        result = demo_extract(filename)
        result.detail += " Tesseract is not installed on this host, so auto mode used the demo fixture."
        return result

    return tesseract_extract(data, filename, content_type)


def ocr_status() -> dict:
    """For the health endpoint and the UI. States plainly what will happen."""
    available = tesseract_available()
    if OCR_PROVIDER == "demo":
        effective, is_demo = "demo-ocr", True
    elif OCR_PROVIDER == "none":
        effective, is_demo = "none", False
    elif OCR_PROVIDER == "tesseract":
        effective, is_demo = ("tesseract" if available else "unavailable"), False
    else:  # auto
        effective, is_demo = ("tesseract" if available else "demo-ocr"), not available
    return {
        "configured": OCR_PROVIDER,
        "effective": effective,
        "tesseract_installed": available,
        "pdf_rasteriser_installed": shutil.which("pdftoppm") is not None,
        "returns_demo_values": is_demo,
        "supplies_confidence": effective == "tesseract",
        "min_word_confidence": MIN_WORD_CONFIDENCE,
    }
