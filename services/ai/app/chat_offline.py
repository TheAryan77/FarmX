"""Deterministic answers for when Gemini is unavailable.

This exists because the supplied key is on the Gemini free tier, which allows
**20 generate_content requests per day per model**. A demo where a judge asks
four questions and the fifth returns "the assistant is busy" is worse than no
assistant, so the two summaries the feature was actually asked for — the
farmer's crop position and the buyer's logistics — are also written here, in
both languages, from the same facts.

Nothing here calls a model. It reads the same `facts` dictionary the prompt
would have received and formats it, which means these answers cannot drift
from the data and cannot invent a figure.
"""

from __future__ import annotations

from typing import Any


def rupees(value: Any) -> str:
    """₹3,56,854 — Indian digit grouping, whole rupees, matching the web apps."""
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return "—"
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"{'-' if n < 0 else ''}₹{s}"


def quintals(value: Any) -> str:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return "—"
    return f"{int(n)}Q" if n == int(n) else f"{n:.2f}Q"


ORDER_STATUS = {
    "CREATED": {"en": "agreed", "hi": "तय हुआ"},
    "CONTRACTED": {"en": "contracted", "hi": "अनुबंध हुआ"},
    "FUNDED": {"en": "payment secured", "hi": "भुगतान सुरक्षित"},
    "IN_TRANSIT": {"en": "in transit", "hi": "रास्ते में"},
    "DELIVERED": {"en": "delivered", "hi": "पहुँच गया"},
    "QC_PASSED": {"en": "quality approved", "hi": "गुणवत्ता स्वीकृत"},
    "SETTLED": {"en": "settled", "hi": "भुगतान पूरा"},
    "DISPUTED": {"en": "in dispute", "hi": "विवाद में"},
    "CANCELLED": {"en": "cancelled", "hi": "रद्द"},
}

SHIPMENT_STATUS = {
    "PLANNED": {"en": "planned", "hi": "नियोजित"},
    "LOADING": {"en": "loading", "hi": "लदान जारी"},
    "IN_TRANSIT": {"en": "in transit", "hi": "रास्ते में"},
    "DELIVERED": {"en": "delivered", "hi": "पहुँच गया"},
}

VEHICLE_LABEL = {
    "tractor_trolley": {"en": "tractor trolley", "hi": "ट्रैक्टर ट्रॉली"},
    "truck_6w": {"en": "6-wheel truck", "hi": "6-पहिया ट्रक"},
    "truck_10w": {"en": "10-wheel truck", "hi": "10-पहिया ट्रक"},
    "truck_multi_axle": {"en": "multi-axle truck", "hi": "मल्टी-एक्सल ट्रक"},
}

MONTHS = {
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"],
    "hi": ["जन", "फ़र", "मार्च", "अप्रैल", "मई", "जून",
           "जुल", "अग", "सित", "अक्तू", "नव", "दिस"],
}


def short_date(value: Any, lang: str) -> str:
    """"2026-09-28" → "28 Sept 2026". Matches how the web apps write dates."""
    text = str(value or "")
    parts = text.split("-")
    if len(parts) != 3:
        return text or "—"
    try:
        year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return text
    if not 1 <= month <= 12:
        return text
    return f"{day} {MONTHS.get(lang, MONTHS['en'])[month - 1]} {year}"


RECOMMENDATION = {
    "SELL_NOW": {"en": "Sell now", "hi": "अभी बेचें"},
    "SELL_PARTIAL": {"en": "Sell part of it now", "hi": "कुछ हिस्सा अभी बेचें"},
    "HOLD": {"en": "Hold for now", "hi": "अभी रोकें"},
}

L = {
    "listed": {"en": "You have {q} {grade} wheat listed at {p} per quintal.",
               "hi": "आपके पास {q} {grade} गेहूं {p} प्रति क्विंटल पर सूचीबद्ध है।"},
    "no_listing": {"en": "You have no active listing right now.",
                   "hi": "अभी आपकी कोई सक्रिय लिस्टिंग नहीं है।"},
    "listed_total": {"en": "Across {n} listings that is {q} in total.",
                     "hi": "कुल {n} लिस्टिंग में {q} है।"},
    "market": {"en": "Today's Karnal rate is {p} per quintal.",
               "hi": "करनाल में आज का भाव {p} प्रति क्विंटल है।"},
    "forecast": {"en": "In 7 days it is predicted at {p} per quintal.",
                 "hi": "7 दिन में {p} प्रति क्विंटल का अनुमान है।"},
    "advice": {"en": "Suggestion: {r}.", "hi": "सुझाव: {r}।"},
    "offers": {"en": "{n} offer(s) waiting for your reply.",
               "hi": "{n} प्रस्ताव आपके जवाब का इंतज़ार कर रहे हैं।"},
    "no_offers": {"en": "No new offers right now.", "hi": "अभी कोई नया प्रस्ताव नहीं है।"},
    "paid": {"en": "You have been paid {n} for {q} (order {o}).",
             "hi": "आपको {q} के लिए {n} मिल चुके हैं (ऑर्डर {o})।"},
    "gain_pos": {"en": "That is {n} more than the mandi estimate for the same lot.",
                 "hi": "यह उसी माल के मंडी अनुमान से {n} अधिक है।"},
    "estimate_note": {"en": "The mandi figure is an estimate.",
                      "hi": "मंडी का आंकड़ा एक अनुमान है।"},
    "order": {"en": "Order {o}: {q} at {p} per quintal — {s}.",
              "hi": "ऑर्डर {o}: {q}, {p} प्रति क्विंटल — {s}।"},
    "route": {"en": "Collection: {v} vehicle(s) ({cls}), {n} stop(s), {km} km.",
              "hi": "संग्रह: {v} वाहन ({cls}), {n} पड़ाव, {km} किमी।"},
    "cost": {"en": "Transport cost {c}; separate trips would have cost {b}.",
             "hi": "परिवहन लागत {c}; अलग-अलग चक्कर लगाने पर {b} लगते।"},
    "saved": {"en": "Aggregating saved {n}.", "hi": "एक साथ इकट्ठा करने से {n} बचे।"},
    "no_shipment": {"en": "No collection route has been planned for this order yet.",
                    "hi": "इस ऑर्डर के लिए अभी कोई मार्ग तय नहीं हुआ है।"},
    "no_order": {"en": "You have no active order right now.",
                 "hi": "अभी आपका कोई सक्रिय ऑर्डर नहीं है।"},
    "req": {"en": "Requirement: {q} Grade {g} at {p} per quintal, {c} committed ({pct}%), deliver by {d}.",
            "hi": "आवश्यकता: {q} ग्रेड {g}, {p} प्रति क्विंटल, {c} तय ({pct}%), {d} तक डिलीवरी।"},
    "req_none": {"en": "You have no open requirements right now.",
                 "hi": "अभी आपकी कोई खुली आवश्यकता नहीं है।"},
    "offer": {"en": "Offer from {b}: {q} at {p} per quintal.",
              "hi": "{b} की ओर से प्रस्ताव: {q}, {p} प्रति क्विंटल।"},
    "offline": {
        "en": "I can only show your summary right now. Ask about your crop, price or payment.",
        "hi": "अभी मैं केवल आपका सारांश दिखा सकता हूँ। फसल, भाव या भुगतान के बारे में पूछें।",
    },
    "offline_buyer": {
        "en": "I can only show your order summary right now. Ask about your order, route or cost.",
        "hi": "अभी मैं केवल ऑर्डर सारांश दिखा सकता हूँ। ऑर्डर, मार्ग या लागत के बारे में पूछें।",
    },
}


def _t(key: str, lang: str, **kw: Any) -> str:
    return L[key][lang if lang in ("hi", "en") else "en"].format(**kw)


def _label(table: dict[str, dict[str, str]], key: Any, lang: str) -> str:
    """Translated label, falling back to the raw value rather than dropping it."""
    entry = table.get(str(key))
    if entry is None:
        return str(key).replace("_", " ").lower()
    return entry.get(lang, entry["en"])


def farmer_summary(facts: dict[str, Any], lang: str) -> list[str]:
    lines: list[str] = []

    listings = facts.get("listings") or []
    if listings:
        # Every listing, not just the newest — a farmer with two lots at
        # different prices was previously told about only one of them.
        for listing in listings[:3]:
            grade = listing.get("grade")
            lines.append(
                _t("listed", lang,
                   q=quintals(listing.get("quantityQuintals")),
                   grade=f"Grade {grade}" if lang == "en" else f"ग्रेड {grade}",
                   p=rupees(listing.get("expectedPricePerQuintal")))
            )
        if len(listings) > 1:
            total = sum(float(l.get("quantityQuintals") or 0) for l in listings)
            lines.append(_t("listed_total", lang, n=len(listings), q=quintals(total)))
    else:
        lines.append(_t("no_listing", lang))

    market = facts.get("marketToday") or {}
    if market.get("modalPricePerQuintal"):
        lines.append(_t("market", lang, p=rupees(market["modalPricePerQuintal"])))

    forecast = facts.get("forecast7d") or {}
    if forecast.get("predictedPricePerQuintal"):
        lines.append(_t("forecast", lang, p=rupees(forecast["predictedPricePerQuintal"])))
        rec = RECOMMENDATION.get(forecast.get("recommendation", ""))
        if rec:
            lines.append(_t("advice", lang, r=rec[lang if lang in rec else "en"]))

    offers = facts.get("offers") or []
    if offers:
        lines.append(_t("offers", lang, n=len(offers)))
        # Named, priced and live — a bare count told the farmer something had
        # happened without telling them whether it was worth reading.
        for offer in offers[:3]:
            lines.append(
                _t("offer", lang,
                   b=offer.get("from", "—"),
                   q=quintals(offer.get("quantityQuintals")),
                   p=rupees(offer.get("pricePerQuintal")))
            )
    else:
        lines.append(_t("no_offers", lang))

    payout = facts.get("latestPayout") or {}
    if payout.get("netRupees"):
        lines.append(
            _t("paid", lang,
               n=rupees(payout["netRupees"]),
               q=quintals(payout.get("quintals")),
               o=payout.get("orderNo", "—"))
        )
        gain = payout.get("gainRupees")
        if isinstance(gain, (int, float)) and gain > 0:
            lines.append(_t("gain_pos", lang, n=rupees(gain)))
            lines.append(_t("estimate_note", lang))

    return lines


def buyer_summary(facts: dict[str, Any], lang: str) -> list[str]:
    lines: list[str] = []

    # Requirements first: a buyer who has just posted one is asking about it.
    requirements = facts.get("requirements") or []
    if requirements:
        for requirement in requirements[:3]:
            lines.append(
                _t("req", lang,
                   q=quintals(requirement.get("quantityQuintals")),
                   g=requirement.get("grade", "—"),
                   p=rupees(requirement.get("targetPricePerQuintal")),
                   c=quintals(requirement.get("committedQuintals")),
                   pct=requirement.get("fulfilmentPercent", 0),
                   d=short_date(requirement.get("deliveryBy"), lang))
            )
    else:
        lines.append(_t("req_none", lang))

    order = facts.get("order") or {}
    if order.get("orderNo"):
        lines.append(
            _t("order", lang,
               o=order["orderNo"],
               q=quintals(order.get("totalQuintals")),
               p=rupees(order.get("pricePerQuintal")),
               s=_label(ORDER_STATUS, order.get("status"), lang))
        )
    else:
        lines.append(_t("no_order", lang))
        return lines

    shipment = facts.get("shipment") or {}
    if shipment.get("vehicleCount"):
        lines.append(
            _t("route", lang,
               v=shipment.get("vehicleCount"),
               cls=_label(VEHICLE_LABEL, shipment.get("vehicleClass"), lang),
               n=shipment.get("stops", "—"),
               km=shipment.get("totalDistanceKm", "—"))
        )
        optimised = shipment.get("optimisedCostRupees")
        baseline = shipment.get("separateTripsCostRupees")
        if optimised is not None and baseline is not None:
            lines.append(_t("cost", lang, c=rupees(optimised), b=rupees(baseline)))
            if baseline > optimised:
                lines.append(_t("saved", lang, n=rupees(baseline - optimised)))
    else:
        lines.append(_t("no_shipment", lang))

    return lines


# Questions the offline path can answer in full rather than deflecting.
# Domain words only. Bare interrogatives ("what", "how", "क्या") were tried and
# removed: they matched "what is the weather tomorrow?", which this mode has no
# business answering.
_SUMMARY_WORDS = (
    "summary", "summarise", "summarize", "status", "update", "overview",
    "crop", "wheat", "price", "rate", "market", "mandi",
    "sell", "sold", "sale", "hold", "wait", "offer", "listing", "earn",
    "payment", "paid", "pay", "money", "order", "route", "logistics",
    "transport", "delivery", "shipment", "vehicle", "cost", "saving", "saved",
    "quality", "farmer", "requirement", "requirements", "demand", "sourcing",
    "source", "need", "buying", "procure", "procurement",
    "सारांश", "हाल", "भाव", "कीमत", "बाज़ार", "मंडी", "फसल", "गेहूं", "बेच", "बेचूँ",
    "रोक", "प्रस्ताव", "लिस्टिंग", "भुगतान", "पैसा", "पैसे", "कमाई", "ऑर्डर", "मार्ग",
    "परिवहन", "लागत", "बचत", "गुणवत्ता", "स्थिति", "आवश्यकता", "मांग", "खरीद",
)


def answer(role: str, language: str, question: str, facts: dict[str, Any]) -> dict[str, Any]:
    """Best available answer with no model call."""
    lang = language if language in ("hi", "en") else "en"
    lines = farmer_summary(facts, lang) if role == "FARMER" else buyer_summary(facts, lang)

    # Anything outside the summary's scope gets the summary plus an honest note
    # about what this mode can and cannot do.
    asked = (question or "").lower()
    if not any(word in asked for word in _SUMMARY_WORDS):
        lines.append(_t("offline" if role == "FARMER" else "offline_buyer", lang))

    return {
        "answer": "\n".join(f"• {line}" for line in lines),
        "language": lang,
        "model": "offline",
        "offline": True,
    }
