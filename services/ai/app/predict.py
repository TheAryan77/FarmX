"""Serving the trained wheat price model.

The artifact is loaded once and reused. CLAUDE.md: this service is stateless —
it holds no per-request state and never writes. It reads PriceHistory
read-only to build the lag features a forecast needs, because shipping sixty
days of history in every request body would be worse in every respect.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date

import pandas as pd
from xgboost import XGBRegressor

from .config import ARTIFACT_PATH, METRICS_PATH
from .data import load_price_history
from .features import FEATURE_COLUMNS, HORIZON_DAYS, build_features

#: Below this, a directional call is not worth making and we advise hedging.
MIN_CONFIDENCE_FOR_DIRECTION = 0.5

#: A move only counts as actionable once it clears the model's own typical
#: error — advising HOLD for a gain smaller than the average miss is noise.
#: Derived from the measured MAPE, with a floor so a very accurate model still
#: needs a real move before it tells a farmer to wait.
ERROR_MULTIPLE = 1.5
MIN_MOVE_PCT = 0.005


class ModelNotTrained(RuntimeError):
    """Raised when no artifact exists yet — the API turns this into a 503."""


@dataclass(frozen=True)
class LoadedModel:
    model: XGBRegressor
    metrics: dict
    mtime: float


_cache: LoadedModel | None = None


def load_model() -> LoadedModel:
    """Loads the artifact, reloading only if it changed on disk."""
    global _cache

    if not ARTIFACT_PATH.exists() or not METRICS_PATH.exists():
        raise ModelNotTrained(
            "No trained price model. Run `pnpm ai:train` from the repo root."
        )

    mtime = ARTIFACT_PATH.stat().st_mtime
    if _cache is not None and _cache.mtime == mtime:
        return _cache

    model = XGBRegressor()
    model.load_model(ARTIFACT_PATH)
    metrics = json.loads(METRICS_PATH.read_text())
    _cache = LoadedModel(model=model, metrics=metrics, mtime=mtime)
    print(f"[ai] loaded price model trained {metrics.get('trained_at')}")
    return _cache


def _recommendation(delta_pct: float, confidence: float, mape: float) -> str:
    """SELL_NOW / HOLD / SELL_PARTIAL from the forecast and the model's error."""
    if confidence < MIN_CONFIDENCE_FOR_DIRECTION:
        return "SELL_PARTIAL"

    threshold = max(ERROR_MULTIPLE * mape, MIN_MOVE_PCT)
    if delta_pct >= threshold:
        return "HOLD"
    if delta_pct <= -threshold:
        return "SELL_NOW"
    return "SELL_PARTIAL"


def predict_price(crop: str, district: str, as_of: date | None = None) -> dict:
    loaded = load_model()
    history = load_price_history(crop, district)

    if as_of is not None:
        history = history[history["date"].dt.date <= as_of]
        if history.empty:
            raise RuntimeError(f"No price history for {crop}/{district} on or before {as_of}")

    featured = build_features(history)
    ready = featured.dropna(subset=FEATURE_COLUMNS)
    if ready.empty:
        raise RuntimeError(
            "Not enough price history to build features — at least 30 days are needed"
        )

    row = ready.iloc[[-1]]
    current = float(row["modal"].iloc[0])
    reading_date = pd.Timestamp(row["date"].iloc[0]).date()

    delta = float(loaded.model.predict(row[FEATURE_COLUMNS])[0])
    predicted = current + delta
    delta_pct = delta / current if current else 0.0

    metrics = loaded.metrics
    confidence = float(metrics.get("confidence", 0.0))
    mape = float(metrics.get("mape", 0.0))

    # Empirical 80% interval from the held-out residuals, not a made-up band.
    low = predicted + float(metrics.get("residual_low_offset", 0.0))
    high = predicted + float(metrics.get("residual_high_offset", 0.0))

    return {
        "crop": crop,
        "district": district,
        "as_of": reading_date.isoformat(),
        "horizon_days": HORIZON_DAYS,
        "current": round(current),
        "predicted_7d": round(predicted),
        "low": round(min(low, high)),
        "high": round(max(low, high)),
        "delta_pct": round(delta_pct, 5),
        "confidence": round(confidence, 4),
        "recommendation": _recommendation(delta_pct, confidence, mape),
        "model": {
            "trained_at": metrics.get("trained_at"),
            "data_source": metrics.get("data_source"),
            "mae": metrics.get("mae"),
            "mape": metrics.get("mape"),
            "naive_mae": metrics.get("naive_mae"),
            "skill_vs_naive": metrics.get("skill_vs_naive"),
            "train_rows": metrics.get("train_rows"),
            "test_rows": metrics.get("test_rows"),
            "tolerance_pct": metrics.get("tolerance_pct"),
        },
    }
