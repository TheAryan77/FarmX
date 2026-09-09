"""Train the wheat price model and persist it.

Run from the repo root with `pnpm ai:train`. The API never triggers training —
it loads the persisted artifact, so a prediction is a single matrix lookup.

The split is strictly chronological. A random split on a time series lets the
model interpolate between dates it has already seen and reports an accuracy it
cannot reproduce on a real forward prediction.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error
from xgboost import XGBRegressor

from .config import ARTIFACT_DIR, ARTIFACT_PATH, METRICS_PATH
from .data import load_price_history
from .features import (
    FEATURE_COLUMNS,
    HORIZON_DAYS,
    add_target,
    build_features,
    trainable,
)

#: Fraction of the series held back, taken from the end.
TEST_FRACTION = 0.2

#: A prediction counts as "on target" if it lands within this band. Confidence
#: is the share of held-out predictions that do — a number a farmer can read as
#: "how often is this roughly right", rather than an abstract error figure.
#: Kept at 1% because a looser band passed every prediction and told us nothing.
TOLERANCE_PCT = 0.01

PARAMS = {
    "n_estimators": 400,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "min_child_weight": 3,
    "reg_lambda": 1.0,
    "objective": "reg:squarederror",
    "random_state": 26033,
}


def train() -> dict:
    history = load_price_history()
    source = str(history["source"].iloc[0])

    featured = trainable(add_target(build_features(history)))
    if len(featured) < 120:
        raise RuntimeError(
            f"Only {len(featured)} usable rows after feature engineering — "
            "need at least 120. Run `pnpm db:seed` first."
        )

    split = int(len(featured) * (1 - TEST_FRACTION))
    train_set, test_set = featured.iloc[:split], featured.iloc[split:]

    x_train = train_set[FEATURE_COLUMNS]
    y_train = train_set["y"]
    x_test = test_set[FEATURE_COLUMNS]
    y_test = test_set["y"]

    model = XGBRegressor(**PARAMS)
    model.fit(x_train, y_train, eval_set=[(x_test, y_test)], verbose=False)

    # The model predicts the 7-day change; add it back to today's price so
    # every figure below is in ₹/quintal on the actual price level.
    predicted_delta = model.predict(x_test)
    current = test_set["modal"].to_numpy()
    actual_price = current + y_test.to_numpy()
    predicted_price = current + predicted_delta
    residuals = actual_price - predicted_price

    mae = float(mean_absolute_error(actual_price, predicted_price))
    mape = float(mean_absolute_percentage_error(actual_price, predicted_price))
    rmse = float(np.sqrt(np.mean(residuals**2)))

    # Persistence baseline: assume the price in 7 days equals today's — i.e. a
    # predicted delta of zero. Any honest accuracy claim has to beat this, so
    # it is always reported alongside.
    naive_mae = float(mean_absolute_error(actual_price, current))
    skill = 1 - (mae / naive_mae) if naive_mae > 0 else 0.0

    within_band = float(np.mean(np.abs(residuals) <= actual_price * TOLERANCE_PCT))

    # Empirical prediction interval from the held-out residuals, rather than a
    # made-up percentage band around the point forecast.
    low_offset = float(np.quantile(residuals, 0.1))
    high_offset = float(np.quantile(residuals, 0.9))

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(ARTIFACT_PATH)

    metrics = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "data_source": source,
        "rows_total": int(len(history)),
        "rows_usable": int(len(featured)),
        "train_rows": int(len(train_set)),
        "test_rows": int(len(test_set)),
        "train_from": train_set["date"].min().date().isoformat(),
        "train_to": train_set["date"].max().date().isoformat(),
        "test_from": test_set["date"].min().date().isoformat(),
        "test_to": test_set["date"].max().date().isoformat(),
        "horizon_days": HORIZON_DAYS,
        "mae": round(mae, 2),
        "mape": round(mape, 5),
        "rmse": round(rmse, 2),
        "naive_mae": round(naive_mae, 2),
        "skill_vs_naive": round(skill, 4),
        "confidence": round(within_band, 4),
        "tolerance_pct": TOLERANCE_PCT,
        "residual_low_offset": round(low_offset, 2),
        "residual_high_offset": round(high_offset, 2),
        "features": FEATURE_COLUMNS,
    }
    METRICS_PATH.write_text(json.dumps(metrics, indent=2))

    _report(metrics, model)
    return metrics


def _report(metrics: dict, model: XGBRegressor) -> None:
    print("\nFasalX wheat price model")
    print("========================")
    print(f"data source        {metrics['data_source']}")
    print(f"rows               {metrics['rows_total']} total, {metrics['rows_usable']} usable")
    print(f"train              {metrics['train_from']} → {metrics['train_to']}  ({metrics['train_rows']} rows)")
    print(f"test (held back)   {metrics['test_from']} → {metrics['test_to']}  ({metrics['test_rows']} rows)")
    print(f"horizon            {metrics['horizon_days']} days ahead")
    print("target             7-day price CHANGE, reconstructed as current + delta\n")
    print(f"MAE                ₹{metrics['mae']}/quintal")
    print(f"MAPE               {metrics['mape'] * 100:.2f}%")
    print(f"RMSE               ₹{metrics['rmse']}/quintal")
    print(f"naive baseline MAE ₹{metrics['naive_mae']}/quintal  (assume no change)")
    print(f"skill vs naive     {metrics['skill_vs_naive'] * 100:.1f}% lower error")
    print(
        f"confidence         {metrics['confidence'] * 100:.1f}% of held-out predictions "
        f"landed within ±{metrics['tolerance_pct'] * 100:.1f}%"
    )
    print(
        f"80% interval       {metrics['residual_low_offset']:+.0f} / "
        f"{metrics['residual_high_offset']:+.0f} ₹ around the point forecast\n"
    )

    importance = sorted(
        zip(FEATURE_COLUMNS, model.feature_importances_),
        key=lambda pair: pair[1],
        reverse=True,
    )[:6]
    print("top features       " + ", ".join(f"{name} {weight:.2f}" for name, weight in importance))
    print(f"\nsaved              {ARTIFACT_PATH.name}, {METRICS_PATH.name}")


if __name__ == "__main__":
    train()
