"""Buyer↔farmer match scoring and supply aggregation.

CLAUDE.md: this service is stateless — it receives the candidate pool and
returns scores. It does no database access and holds nothing between requests,
so the same inputs always produce the same ranking.

The weights are the ones locked in the build plan:

    score = 0.30·price + 0.25·distance + 0.20·quantity
          + 0.15·quality + 0.10·reliability

Every component is normalised 0-1 *across the candidate pool*, which is what
makes the weights meaningful: a farmer scores well on price because they are
cheap relative to the others actually available, not against an absolute scale.
"""

from __future__ import annotations

from dataclasses import dataclass

WEIGHTS = {
    "price": 0.30,
    "distance": 0.25,
    "quantity": 0.20,
    "quality": 0.15,
    "reliability": 0.10,
}

#: Reliability blends the star rating with track record: a farmer with 23
#: completed orders has demonstrated something a newly-rated one has not.
RATING_WEIGHT = 0.7
HISTORY_WEIGHT = 0.3
MAX_RATING = 5.0

#: Grade ordering, best first. Used to score quality against what was asked.
GRADE_RANK = {"A": 0, "B": 1, "C": 2}


@dataclass(frozen=True)
class Component:
    """One scored dimension, kept explainable end to end."""

    raw: float
    normalised: float
    weighted: float

    def as_dict(self) -> dict:
        return {
            "raw": round(self.raw, 4),
            "normalised": round(self.normalised, 4),
            "weighted": round(self.weighted, 4),
        }


def _normalise(value: float, low: float, high: float, lower_is_better: bool) -> float:
    """Scales `value` into 0-1 against the pool's own range.

    When every candidate shares a value the range collapses, and the honest
    answer is that the dimension does not distinguish them — so they all score
    1.0 rather than 0.0, which would silently penalise the whole pool.
    """
    if high <= low:
        return 1.0
    scaled = (high - value) / (high - low) if lower_is_better else (value - low) / (high - low)
    return max(0.0, min(1.0, scaled))


def _quality_score(candidate_grade: str, requested_grade: str) -> float:
    """1.0 for the requested grade, higher-graded produce also 1.0.

    NOTE: the API filters candidates to the requested grade before calling
    this, so in practice every candidate scores 1.0 and this component is
    currently a constant. It is kept weighted so the other four weights stay
    proportioned as specified, and so accepting substitute grades later is a
    change to the filter, not to the scoring.
    """
    candidate = GRADE_RANK.get(candidate_grade.upper(), len(GRADE_RANK))
    requested = GRADE_RANK.get(requested_grade.upper(), len(GRADE_RANK))
    if candidate <= requested:
        return 1.0
    # One grade below what was asked keeps some value; two is nearly useless.
    return max(0.0, 1.0 - 0.5 * (candidate - requested))


def score_candidates(requirement: dict, candidates: list[dict]) -> list[dict]:
    """Ranks the pool, returning a score plus its full breakdown per candidate."""
    if not candidates:
        return []

    prices = [float(c["pricePerQuintal"]) for c in candidates]
    distances = [float(c.get("distanceKm") or 0.0) for c in candidates]
    quantities = [float(c["availableQuintals"]) for c in candidates]
    histories = [float(c.get("completedOrders") or 0) for c in candidates]

    price_lo, price_hi = min(prices), max(prices)
    dist_lo, dist_hi = min(distances), max(distances)
    qty_lo, qty_hi = min(quantities), max(quantities)
    hist_lo, hist_hi = min(histories), max(histories)

    requested_grade = str(requirement.get("grade", "A"))

    scored: list[dict] = []
    for candidate in candidates:
        price = float(candidate["pricePerQuintal"])
        distance = float(candidate.get("distanceKm") or 0.0)
        quantity = float(candidate["availableQuintals"])
        rating = float(candidate.get("rating") or 0.0)
        completed = float(candidate.get("completedOrders") or 0)

        # Cheaper and closer are better; bigger lots mean fewer pickups.
        price_norm = _normalise(price, price_lo, price_hi, lower_is_better=True)
        dist_norm = _normalise(distance, dist_lo, dist_hi, lower_is_better=True)
        qty_norm = _normalise(quantity, qty_lo, qty_hi, lower_is_better=False)
        quality_norm = _quality_score(str(candidate.get("grade", requested_grade)), requested_grade)
        reliability_norm = RATING_WEIGHT * (rating / MAX_RATING) + HISTORY_WEIGHT * _normalise(
            completed, hist_lo, hist_hi, lower_is_better=False
        )
        reliability_norm = max(0.0, min(1.0, reliability_norm))

        components = {
            "price": Component(price, price_norm, WEIGHTS["price"] * price_norm),
            "distance": Component(distance, dist_norm, WEIGHTS["distance"] * dist_norm),
            "quantity": Component(quantity, qty_norm, WEIGHTS["quantity"] * qty_norm),
            "quality": Component(
                float(GRADE_RANK.get(str(candidate.get("grade", "A")).upper(), 0)),
                quality_norm,
                WEIGHTS["quality"] * quality_norm,
            ),
            # `raw` is the star rating; completed orders are folded into the
            # normalised value, not the raw one, so the UI can print "4.8".
            "reliability": Component(rating, reliability_norm, WEIGHTS["reliability"] * reliability_norm),
        }

        scored.append(
            {
                "listingId": candidate["listingId"],
                "farmerId": candidate.get("farmerId"),
                "score": round(sum(c.weighted for c in components.values()), 4),
                "breakdown": {name: c.as_dict() for name, c in components.items()},
            }
        )

    # Descending score. Ties break on listingId so the ranking is reproducible
    # rather than dependent on dict ordering.
    scored.sort(key=lambda row: (-row["score"], str(row["listingId"])))
    for rank, row in enumerate(scored, start=1):
        row["rank"] = rank
    return scored


def aggregate(
    requirement: dict,
    candidates: list[dict],
    ranked: list[dict],
) -> dict:
    """Greedy fill by descending score until the requirement is met.

    The last farmer may be partially allocated — taking a whole lot past the
    target would commit produce the buyer did not ask for. `runningTotals` is
    the cumulative quantity after each pick, which is what the UI animates.
    """
    target = float(requirement["quantityQuintals"])
    by_id = {c["listingId"]: c for c in candidates}

    selected: list[dict] = []
    running_totals: list[float] = []
    total = 0.0

    for row in ranked:
        if total >= target:
            break
        candidate = by_id.get(row["listingId"])
        if candidate is None:
            continue

        available = float(candidate["availableQuintals"])
        take = min(available, round(target - total, 2))
        if take <= 0:
            continue

        total = round(total + take, 2)
        running_totals.append(total)
        selected.append(
            {
                "listingId": row["listingId"],
                "farmerId": candidate.get("farmerId"),
                "farmerName": candidate.get("farmerName"),
                "allocatedQuintals": round(take, 2),
                "availableQuintals": round(available, 2),
                "isPartial": take < available,
                "pricePerQuintal": int(candidate["pricePerQuintal"]),
                "distanceKm": candidate.get("distanceKm"),
                "score": row["score"],
                "rank": row["rank"],
            }
        )

    # Weighted by allocated quantity, so a big cheap lot moves it more than a
    # small expensive one — this is what the buyer would actually pay per
    # quintal if every farmer were paid their own asking price.
    cost = sum(item["allocatedQuintals"] * item["pricePerQuintal"] for item in selected)
    weighted_average = round(cost / total) if total > 0 else 0

    return {
        "selected": selected,
        "runningTotals": running_totals,
        "totalQuintals": round(total, 2),
        "targetQuintals": round(target, 2),
        "shortfallQuintals": round(max(target - total, 0.0), 2),
        "satisfiable": total >= target,
        "weightedAveragePriceRupees": weighted_average,
        "sumOfAsksRupees": int(round(cost)),
        "farmerCount": len(selected),
    }


def run_match(requirement: dict, candidates: list[dict]) -> dict:
    ranked = score_candidates(requirement, candidates)
    return {
        "weights": WEIGHTS,
        "ranked": ranked,
        "aggregation": aggregate(requirement, candidates, ranked),
    }
