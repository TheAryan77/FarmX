"""Feature engineering for the wheat price model.

Every feature is strictly backward-looking. Lags and rolling windows are
computed on the date-sorted series before any train/test split, so a row can
only ever see prices that existed on or before its own date — otherwise the
backtest would report an accuracy the model cannot reproduce live.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

#: How far ahead the model predicts. Session 7 asks for next-7-day price.
HORIZON_DAYS = 7

LAGS = (1, 7, 30)
ROLLING_WINDOW = 30

FEATURE_COLUMNS = [
    "month",
    "week_of_year",
    "day_of_week",
    "day_of_year_sin",
    "day_of_year_cos",
    "lag_1",
    "lag_7",
    "lag_30",
    "roll_mean_30",
    "roll_std_30",
    "momentum_7",
    "spread",
    "arrivals",
    "arrivals_roll_mean_30",
]


def build_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Adds calendar, lag, rolling and arrival features to a price frame."""
    out = frame.sort_values("date").reset_index(drop=True).copy()

    day_of_year = out["date"].dt.dayofyear
    out["month"] = out["date"].dt.month
    out["week_of_year"] = out["date"].dt.isocalendar().week.astype("int32")
    out["day_of_week"] = out["date"].dt.dayofweek
    # Wheat price is strongly seasonal, and December sits next to January.
    # Encoding the day of year on a circle keeps that adjacency, which raw
    # integers destroy.
    out["day_of_year_sin"] = np.sin(2 * np.pi * day_of_year / 365.25)
    out["day_of_year_cos"] = np.cos(2 * np.pi * day_of_year / 365.25)

    for lag in LAGS:
        out[f"lag_{lag}"] = out["modal"].shift(lag)

    # shift(1) so the window ends yesterday and never includes today's price.
    past = out["modal"].shift(1)
    out["roll_mean_30"] = past.rolling(ROLLING_WINDOW, min_periods=10).mean()
    out["roll_std_30"] = past.rolling(ROLLING_WINDOW, min_periods=10).std()
    out["momentum_7"] = out["lag_1"] - out["lag_7"]

    out["spread"] = (out["high"] - out["low"]).fillna(0.0)
    out["arrivals"] = out["arrivals"].fillna(0.0)
    out["arrivals_roll_mean_30"] = (
        out["arrivals"].shift(1).rolling(ROLLING_WINDOW, min_periods=10).mean().fillna(0.0)
    )

    return out


def add_target(frame: pd.DataFrame) -> pd.DataFrame:
    """`y` is the CHANGE in modal price over the next HORIZON_DAYS.

    Predicting the level directly does not work here, and the first version of
    this model proved it: trained on the absolute price it scored MAE ₹18.5
    against a naive "no change" baseline of ₹11.4 — 61% *worse* than doing
    nothing, with every single held-out residual positive.

    The cause is structural, not a tuning problem. Wheat prices trend upward,
    the chronological test split therefore sits at price levels the training
    window never contained, and a gradient-boosted tree cannot predict outside
    the range of targets it has seen. It pinned every forecast to the top of
    the prices it knew and under-predicted the lot.

    Modelling the delta removes the trend from the target. Deltas are roughly
    stationary, so the tree is interpolating rather than extrapolating, and the
    prediction is reconstructed as `current + predicted_delta`.
    """
    out = frame.copy()
    out["y"] = out["modal"].shift(-HORIZON_DAYS) - out["modal"]
    return out


def trainable(frame: pd.DataFrame) -> pd.DataFrame:
    """Rows with every feature and a known future price."""
    return frame.dropna(subset=[*FEATURE_COLUMNS, "y"]).reset_index(drop=True)


def latest_feature_row(frame: pd.DataFrame) -> pd.DataFrame:
    """The most recent row whose features are all known — what we predict from."""
    ready = frame.dropna(subset=FEATURE_COLUMNS)
    if ready.empty:
        raise RuntimeError("Not enough price history to build features")
    return ready.iloc[[-1]]
