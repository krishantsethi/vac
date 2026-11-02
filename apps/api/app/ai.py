"""Optional AI providers, and the deterministic analysis that needs no key.

Two things live here, and keeping them separate is the point.

**Insights** are computed from real database rows by ordinary code: coverage
gaps, overdue doses, inventory nearing expiry, verification backlog. They need
no network, no account and no key, and they are always available. They are
*not* described as AI, because they are not — they are arithmetic over the
registry, and calling them intelligence would overstate what the user is
looking at.

**Generative features** — grounded Q&A, free-text summarisation, AI-assisted
document interpretation — need a model. This module defines the seam and the
providers, all optional. With no key configured the endpoints report plainly
that enhanced AI is unavailable and still return the deterministic insights, so
core functionality never depends on a paid service.

Rules that the code enforces:

* No provider is ever called without an explicit key. There is no anonymous or
  trial endpoint, and nothing is hardcoded.
* A provider failure is reported as a failure. There is no cached or synthetic
  response standing in for one.
* The deterministic scheduling and prioritisation engines remain authoritative.
  A model may *explain* a recommendation; it may never *decide* one.
* Prompts are grounded in retrieved rows, and the retrieved rows are returned
  alongside the answer so a reviewer can check what the model was given.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger("vaxbridge.ai")

AI_PROVIDER = os.getenv("AI_PROVIDER", "none").strip().lower()
AI_API_KEY = os.getenv("AI_API_KEY", "").strip()
AI_MODEL = os.getenv("AI_MODEL", "").strip()
AI_BASE_URL = os.getenv("AI_BASE_URL", "").strip().rstrip("/")
AI_TIMEOUT = int(os.getenv("AI_TIMEOUT_SECONDS", "30"))
# A hard ceiling on how much patient data may be placed in a prompt.
AI_MAX_CONTEXT_ROWS = int(os.getenv("AI_MAX_CONTEXT_ROWS", "50"))

SUPPORTED_PROVIDERS = ("none", "openai", "anthropic", "google", "openai_compatible")

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-3-5-haiku-latest",
    "google": "gemini-1.5-flash",
    "openai_compatible": "",
}


@dataclass
class AiResult:
    available: bool
    provider: str
    text: str = ""
    model: str = ""
    grounded_on: List[Dict[str, Any]] = field(default_factory=list)
    reason: str = ""
    error_stage: str = ""

    def as_response(self) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "ai_available": self.available,
            "provider": self.provider,
            "model": self.model or None,
        }
        if self.available:
            body["text"] = self.text
        else:
            # Say what is missing and what still works, rather than a bare error.
            body["text"] = None
            body["unavailable_reason"] = self.reason or self.error_stage
        if self.grounded_on:
            body["grounded_on"] = self.grounded_on
        return body


def ai_configured() -> bool:
    if AI_PROVIDER in ("", "none"):
        return False
    if AI_PROVIDER not in SUPPORTED_PROVIDERS:
        return False
    return bool(AI_API_KEY)


def ai_status() -> Dict[str, Any]:
    """For the health endpoint and the settings UI. Never echoes the key."""
    configured = ai_configured()
    if AI_PROVIDER not in SUPPORTED_PROVIDERS:
        reason = f"AI_PROVIDER '{AI_PROVIDER[:24]}' is not one of {', '.join(SUPPORTED_PROVIDERS)}"
    elif AI_PROVIDER in ("", "none"):
        reason = "AI_PROVIDER is 'none'; enhanced AI features are disabled by configuration."
    elif not AI_API_KEY:
        reason = f"AI_PROVIDER is '{AI_PROVIDER}' but AI_API_KEY is not set."
    else:
        reason = ""
    return {
        "provider": AI_PROVIDER or "none",
        "configured": configured,
        "model": AI_MODEL or DEFAULT_MODELS.get(AI_PROVIDER, "") or None,
        "base_url_set": bool(AI_BASE_URL),
        # Explicitly: the key is never returned, only whether one exists.
        "api_key_present": bool(AI_API_KEY),
        "reason_unavailable": reason if not configured else "",
        "timeout_seconds": AI_TIMEOUT,
        "max_context_rows": AI_MAX_CONTEXT_ROWS,
        "note": (
            "Deterministic insights are always available and need no key. "
            "Generative features require a configured provider."
        ),
    }


def _model_name() -> str:
    return AI_MODEL or DEFAULT_MODELS.get(AI_PROVIDER, "")


def _post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any]) -> Dict[str, Any]:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(req, timeout=AI_TIMEOUT) as resp:
        return json.loads(resp.read() or b"{}")


def _call_openai(messages: List[Dict[str, str]], base: str) -> str:
    body = _post_json(
        f"{base}/chat/completions",
        {"Authorization": f"Bearer {AI_API_KEY}"},
        {"model": _model_name(), "messages": messages, "temperature": 0.2},
    )
    return (body.get("choices") or [{}])[0].get("message", {}).get("content", "")


def _call_anthropic(messages: List[Dict[str, str]], base: str) -> str:
    system = next((m["content"] for m in messages if m["role"] == "system"), "")
    turns = [m for m in messages if m["role"] != "system"]
    body = _post_json(
        f"{base}/messages",
        {
            "x-api-key": AI_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        {
            "model": _model_name(),
            "max_tokens": 1024,
            "system": system,
            "messages": turns,
        },
    )
    return "".join(b.get("text", "") for b in body.get("content", []))


def _call_google(messages: List[Dict[str, str]], base: str) -> str:
    system = next((m["content"] for m in messages if m["role"] == "system"), "")
    contents = [
        {
            "role": "model" if m["role"] == "assistant" else "user",
            "parts": [{"text": m["content"]}],
        }
        for m in messages if m["role"] != "system"
    ]
    payload: Dict[str, Any] = {"contents": contents}
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    body = _post_json(f"{base}/models/{_model_name()}:generateContent", {}, payload)
    parts = (body.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts)


_CALLERS = {
    "openai": _call_openai,
    "openai_compatible": _call_openai,
    "anthropic": _call_anthropic,
    "google": _call_google,
}

_DEFAULT_BASES = {
    "openai": "https://api.openai.com/v1",
    "openai_compatible": "",
    "anthropic": "https://api.anthropic.com/v1",
    # Google requires the key as a query parameter, so it is appended below.
    "google": "https://generativelanguage.googleapis.com/v1beta",
}


def generate(messages: List[Dict[str, str]], grounded_on: Optional[List[Dict[str, Any]]] = None) -> AiResult:
    """Call the configured provider. Never invents a response when unavailable."""
    provider = AI_PROVIDER or "none"
    grounded = (grounded_on or [])[:AI_MAX_CONTEXT_ROWS]

    if not ai_configured():
        return AiResult(
            available=False, provider=provider, grounded_on=grounded,
            reason=ai_status()["reason_unavailable"],
        )

    base = AI_BASE_URL or _DEFAULT_BASES.get(provider, "")
    if not base:
        return AiResult(
            available=False, provider=provider, grounded_on=grounded,
            reason="AI_BASE_URL is required for this provider and is not set.",
        )
    if provider == "google":
        base = f"{base}?key={AI_API_KEY}"

    try:
        text = _CALLERS[provider](messages, base)
    except urllib.error.HTTPError as exc:
        # The provider's error body can contain account identifiers; log the
        # status only and never return the body to the client.
        logger.warning("[ai] provider_rejected provider=%s http=%s", provider, exc.code)
        return AiResult(
            available=False, provider=provider, grounded_on=grounded,
            error_stage=f"provider_returned_http_{exc.code}",
            reason=f"The AI provider rejected the request (HTTP {exc.code}). No response was generated.",
        )
    except urllib.error.URLError as exc:
        logger.warning("[ai] provider_unreachable provider=%s error=%s", provider, type(exc.reason).__name__)
        return AiResult(
            available=False, provider=provider, grounded_on=grounded,
            error_stage="provider_unreachable",
            reason="The AI provider could not be reached. No response was generated.",
        )
    except Exception as exc:  # noqa: BLE001 - never leak a traceback to a client
        logger.warning("[ai] provider_error provider=%s error=%s", provider, type(exc).__name__)
        return AiResult(
            available=False, provider=provider, grounded_on=grounded,
            error_stage=type(exc).__name__,
            reason="The AI provider call failed. No response was generated.",
        )

    if not text or not text.strip():
        return AiResult(
            available=False, provider=provider, grounded_on=grounded,
            error_stage="empty_response",
            reason="The AI provider returned an empty response.",
        )

    return AiResult(available=True, provider=provider, text=text.strip(),
                    model=_model_name(), grounded_on=grounded)


SYSTEM_PROMPT = (
    "You are an assistant embedded in VAXBRIDGE, an immunisation gap-resolution "
    "tool used by clinics and public-health staff in India. Answer only from the "
    "records supplied below. If the records do not contain the answer, say so "
    "explicitly instead of inferring it. Never invent a vaccination date, dose, "
    "batch number or patient identifier. A missing record is not evidence that a "
    "dose was not given — say that the record is incomplete. Do not give medical "
    "advice, diagnosis or a risk prediction; describe what the registry shows and "
    "what step the workflow suggests next. Be concise."
)


def grounded_prompt(question: str, context_rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Build a prompt whose only facts are the rows we actually retrieved."""
    limited = context_rows[:AI_MAX_CONTEXT_ROWS]
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Records retrieved from the database (this is the complete set you "
                "may use):\n"
                + json.dumps(limited, default=str, ensure_ascii=False)[:12000]
                + f"\n\nQuestion: {question.strip()[:1000]}"
            ),
        },
    ]


def ask(question: str, context_rows: List[Dict[str, Any]]) -> AiResult:
    """Grounded Q&A. Returns the retrieved rows either way, so the answer is checkable."""
    limited = context_rows[:AI_MAX_CONTEXT_ROWS]
    if not ai_configured():
        return AiResult(
            available=False, provider=AI_PROVIDER or "none", grounded_on=limited,
            reason=ai_status()["reason_unavailable"],
        )
    return generate(grounded_prompt(question, limited), grounded_on=limited)
