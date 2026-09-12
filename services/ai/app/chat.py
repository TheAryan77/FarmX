"""Grounded assistant for the farmer and buyer apps.

CLAUDE.md keeps every model call in this service: Node gathers the rows and
sends them here, and this module is the only place that talks to Gemini.

The whole design rests on one constraint. This platform's argument is a rupee
figure, so an assistant that confidently states a wrong one is worse than no
assistant at all. Every number the model is allowed to say is passed in as
`facts` and the prompt forbids it from producing any other — no arithmetic, no
estimates, no remembered market rates. When the facts do not cover a question,
the instruction is to say so rather than to be helpful.
"""

from __future__ import annotations

import json
import time
from typing import Any

from google import genai
from google.genai import errors as genai_errors

from . import chat_offline
from .config import settings


class ChatUnavailable(RuntimeError):
    """Raised when the assistant cannot answer — never silently faked."""


_client: genai.Client | None = None


def _get_client() -> genai.Client | None:
    """The Gemini client, or None when no key is configured.

    Returns rather than raises: a checkout with no key is an ordinary state,
    not an error. The caller falls back to the offline summary, which is the
    whole reason that module exists.
    """
    global _client
    if _client is None:
        if not settings.gemini_api_key:
            return None
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


LANGUAGE_NAME = {"hi": "Hindi (Devanagari script)", "en": "English"}

# Deliberately plain. A farmer reading this on a phone in daylight does not
# need paragraphs, and a procurement manager does not want prose either.
_SHARED_RULES = """
You are the FasalX assistant. FasalX connects wheat farmers in Karnal, Haryana
directly to bulk buyers, removing the intermediaries that cut farmer earnings.

ABSOLUTE RULES — these override everything else:
1. Use ONLY the numbers in the FACTS block below. Never invent, estimate,
   recall, or calculate a figure that is not there. Not prices, not weights,
   not dates, not totals.
2. If the FACTS do not answer the question, say plainly that you do not have
   that information and name what the person can check in the app instead.
3. Money is whole rupees, written like ₹2,420. Quantity is quintals, written
   like 150Q. Never use kilograms, tonnes, lakhs-as-decimals, or paise.
4. Never mention blockchain, escrow contracts, wallets, transaction hashes,
   token amounts or chain names. The farmer is paid in rupees; that is the
   whole story as far as this conversation is concerned.
5. Keep it short: at most 120 words, in short lines or bullets. No preamble,
   no sign-off, no offers to help further.
6. Any comparison against mandi or traditional-channel earnings is an
   ESTIMATE. If you mention one, say so in the same sentence.
"""

_ROLE_BRIEF = {
    "FARMER": """
You are speaking to a smallholder farmer. Be warm, direct and concrete.
Their concerns are: what their crop is worth, whether to sell now or wait,
what is happening with their listings and offers, and when they get paid.
Never advise them to take a risk the FACTS do not support.
""",
    "BUYER": """
You are speaking to a procurement manager at a bulk buyer. Be brisk and
factual. Their concerns are: order status, collection routes and transport
cost, delivery timing, quality checks, and what they are paying.
""",
}


def _prompt(role: str, language: str, question: str, facts: dict[str, Any]) -> str:
    return "\n".join(
        [
            _SHARED_RULES,
            _ROLE_BRIEF.get(role, _ROLE_BRIEF["FARMER"]),
            f"Reply entirely in {LANGUAGE_NAME.get(language, 'English')}. "
            f"Keep rupee and quintal figures in digits.",
            "",
            "FACTS (the only numbers you may use):",
            json.dumps(facts, ensure_ascii=False, indent=2),
            "",
            f"QUESTION: {question}",
        ]
    )


# Measured, not guessed: this key is rate-limited, and a run of five bare
# calls to the model originally configured returned 429 and a dropped
# connection two times out of five. Retrying absorbs that; without it roughly
# a third of questions would fail in front of an audience.
_RETRYABLE = {429, 500, 502, 503, 504}
_ATTEMPTS = 3
_BACKOFF_SECONDS = (0.8, 2.0)


def answer(role: str, language: str, question: str, facts: dict[str, Any]) -> dict[str, Any]:
    """Answers one question from the caller's own data."""
    client = _get_client()
    if client is None:
        # No key configured — answer from the facts rather than refusing. A
        # teammate cloning the repo without secrets still gets a working
        # assistant, which is what the offline module was built for.
        fallback = chat_offline.answer(role, language, question, facts)
        fallback["reason"] = "No GEMINI_API_KEY configured"
        return fallback

    prompt = _prompt(role, language, question, facts)
    last: Exception | None = None

    for attempt in range(_ATTEMPTS):
        try:
            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
            )
            text = (response.text or "").strip()
            if text:
                return {
                    "answer": text,
                    "language": language,
                    "model": settings.gemini_model,
                }
            last = ChatUnavailable("The assistant returned an empty answer.")
        except genai_errors.APIError as exc:
            last = exc
            if exc.code not in _RETRYABLE:
                break
        except Exception as exc:  # noqa: BLE001 — transport failures are retryable too
            last = exc

        if attempt < _ATTEMPTS - 1:
            time.sleep(_BACKOFF_SECONDS[attempt])

    # Never leave the person with nothing. The supplied key is on the Gemini
    # free tier, which allows only 20 requests per day per model, so quota
    # exhaustion is the expected steady state rather than an edge case — and a
    # summary built from their own rows is more useful than an apology.
    #
    # The upstream message can carry the request body and key material, so the
    # reason surfaced here is only ever a status code.
    reason = (
        f"Gemini returned {last.code}"
        if isinstance(last, genai_errors.APIError)
        else "Gemini could not be reached"
    )
    fallback = chat_offline.answer(role, language, question, facts)
    fallback["reason"] = reason
    return fallback
