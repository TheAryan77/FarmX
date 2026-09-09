"""FasalX AI service.

CLAUDE.md: this service is stateless. It receives data and returns a
prediction. Node never runs ML; it calls this over HTTP.
"""

from fastapi import FastAPI, HTTPException

from .config import METRICS_PATH
from .matching import WEIGHTS, run_match
from .predict import ModelNotTrained, load_model, predict_price
from .schemas import MatchRequest, PriceRequest, PriceResponse

app = FastAPI(
    title="FasalX AI",
    description="Price prediction, demand forecasting, match scoring, route optimisation.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict[str, object]:
    """Reports whether a trained model is actually loadable, not just liveness."""
    trained = METRICS_PATH.exists()
    return {"status": "ok", "model_trained": trained}


@app.get("/model/price")
def price_model_info() -> dict:
    """Full training metrics — what backs any accuracy claim made about this."""
    try:
        return load_model().metrics
    except ModelNotTrained as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/predict/price", response_model=PriceResponse)
def predict(request: PriceRequest) -> dict:
    try:
        return predict_price(request.crop, request.district, request.date)
    except ModelNotTrained as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/match/weights")
def match_weights() -> dict:
    """The scoring weights in force, so the UI can label the breakdown."""
    return {"weights": WEIGHTS}


@app.post("/match")
def match(request: MatchRequest) -> dict:
    """Scores a candidate pool and proposes a greedy aggregation.

    Deterministic and stateless: no database, no model artifact, same inputs
    always give the same ranking. The response carries the full per-component
    breakdown so the buyer portal can explain *why* a farmer ranked where they
    did rather than showing an unexplained number.
    """
    return run_match(
        request.requirement.model_dump(),
        [candidate.model_dump() for candidate in request.candidates],
    )
