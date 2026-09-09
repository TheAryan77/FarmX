"""Loading wheat price history.

CLAUDE.md: PostgreSQL is the source of truth. This service reads PriceHistory
**read only** — it never writes, and it holds no state between requests. It
falls back to the Agmarknet CSV only when the database is unreachable, so the
model can still be trained on a laptop with no database running.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from .config import CSV_PATH, settings

# Canonical frame every downstream step expects.
COLUMNS = ["date", "modal", "low", "high", "arrivals"]


def _psycopg_dsn(url: str) -> str:
    """Prisma appends `?schema=public`, which libpq does not understand."""
    return re.sub(r"[?&]schema=[^&]*", "", url)


def _from_postgres(crop: str, district: str) -> pd.DataFrame | None:
    if not settings.database_url:
        return None

    try:
        import psycopg
    except ImportError:  # pragma: no cover - dependency is pinned
        return None

    query = """
        select date,
               "modalPricePerQuintal" as modal,
               "minPricePerQuintal"   as low,
               "maxPricePerQuintal"   as high,
               "arrivalQuintals"      as arrivals
          from "PriceHistory"
         where crop = %s and district = %s
         order by date asc
    """

    try:
        with psycopg.connect(_psycopg_dsn(settings.database_url), connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(query, (crop, district))
                rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001 - any connection problem falls back
        print(f"[ai] Postgres unavailable ({type(exc).__name__}), trying CSV: {exc}")
        return None

    if not rows:
        print(f"[ai] no PriceHistory rows for {crop}/{district}")
        return None

    frame = pd.DataFrame(rows, columns=COLUMNS)
    frame["source"] = "postgres"
    return frame


def _from_csv(path: Path) -> pd.DataFrame | None:
    """Tolerant Agmarknet reader, mirroring the seed's fuzzy header matching."""
    if not path.exists():
        return None

    raw = pd.read_csv(path)
    lowered = {str(c).strip().lower(): c for c in raw.columns}

    def find(*patterns: str) -> str | None:
        for pattern in patterns:
            for key, original in lowered.items():
                if re.search(pattern, key):
                    return original
        return None

    date_col = find(r"arrival.*date", r"reported.*date", r"^date$", r"date")
    modal_col = find(r"modal", r"avg|average", r"price")
    if date_col is None or modal_col is None:
        print(f"[ai] {path.name}: no usable date/price column")
        return None

    arrivals_col = find(r"arrival(?!.*date)", r"quantity|tonnes|qty")
    frame = pd.DataFrame(
        {
            "date": pd.to_datetime(raw[date_col], dayfirst=True, errors="coerce"),
            "modal": pd.to_numeric(raw[modal_col], errors="coerce"),
            "low": pd.to_numeric(raw[find(r"min") or modal_col], errors="coerce"),
            "high": pd.to_numeric(raw[find(r"max") or modal_col], errors="coerce"),
            "arrivals": (
                pd.to_numeric(raw[arrivals_col], errors="coerce")
                if arrivals_col
                else pd.Series(dtype="float64")
            ),
        }
    )

    # Agmarknet reports arrivals in TONNES. CLAUDE.md forbids mixing units, so
    # convert on the way in — exactly as the seed does.
    if arrivals_col and re.search(r"tonne|mt\b", str(arrivals_col).lower()):
        frame["arrivals"] = frame["arrivals"] * 10

    frame = frame.dropna(subset=["date", "modal"]).sort_values("date")
    frame["source"] = "agmarknet-csv"
    return frame if len(frame) else None


def load_price_history(crop: str = "wheat", district: str = "Karnal") -> pd.DataFrame:
    """Daily price history, oldest first, one row per date."""
    frame = _from_postgres(crop, district)
    if frame is None:
        frame = _from_csv(CSV_PATH)
    if frame is None:
        raise RuntimeError(
            "No price history available. Run `pnpm db:seed`, or place an "
            f"Agmarknet export at {CSV_PATH}."
        )

    frame["date"] = pd.to_datetime(frame["date"])
    for column in ("modal", "low", "high", "arrivals"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    frame = (
        frame.dropna(subset=["modal"])
        .drop_duplicates(subset=["date"], keep="last")
        .sort_values("date")
        .reset_index(drop=True)
    )
    return frame
