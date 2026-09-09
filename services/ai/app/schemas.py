"""Request and response shapes for the AI service."""

from __future__ import annotations

# Aliased: the request field is called `date` (the API contract), and an
# unaliased import would be shadowed by that field when pydantic resolves the
# string annotation, leaving `date | None` evaluating to `None | None`.
from datetime import date as DateType
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PriceRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    crop: str = Field(default="wheat", min_length=2, max_length=40)
    district: str = Field(default="Karnal", min_length=1, max_length=60)
    #: Predict as if today were this date. Used for backtests, not by the app.
    date: DateType | None = None


class ModelInfo(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    trained_at: str | None = None
    data_source: str | None = None
    mae: float | None = None
    mape: float | None = None
    naive_mae: float | None = None
    skill_vs_naive: float | None = None
    train_rows: int | None = None
    test_rows: int | None = None
    tolerance_pct: float | None = None


class PriceResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    crop: str
    district: str
    #: The date of the latest reading the forecast was made from.
    as_of: str
    horizon_days: int
    #: All money in whole rupees per quintal — CLAUDE.md.
    current: int
    predicted_7d: int
    low: int
    high: int
    delta_pct: float
    #: Share of held-out predictions inside the tolerance band, 0-1.
    confidence: float
    recommendation: Literal["SELL_NOW", "HOLD", "SELL_PARTIAL"]
    model: ModelInfo


# ---------------------------------------------------------------- matching


class MatchRequirement(BaseModel):
    """What the buyer needs. Quantity in quintals, price in whole rupees."""

    model_config = ConfigDict(protected_namespaces=())

    quantityQuintals: float = Field(gt=0)
    grade: str = Field(default="A", min_length=1, max_length=1)
    targetPricePerQuintal: int = Field(gt=0)
    maxDistanceKm: int = Field(default=150, gt=0)


class MatchCandidate(BaseModel):
    """One listing offered into the pool. Scored relative to its peers."""

    model_config = ConfigDict(protected_namespaces=())

    listingId: str
    farmerId: str | None = None
    farmerName: str | None = None
    pricePerQuintal: int = Field(gt=0)
    availableQuintals: float = Field(gt=0)
    distanceKm: float | None = None
    grade: str = "A"
    rating: float = 0.0
    completedOrders: int = 0


class MatchRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    requirement: MatchRequirement
    candidates: list[MatchCandidate]
