"""FasalX AI service.

CLAUDE.md: this service is stateless. It receives data and returns a
prediction. Node never runs ML; it calls this over HTTP.
"""

from fastapi import FastAPI, HTTPException

from .config import METRICS_PATH
from .predict import ModelNotTrained, load_model, predict_price
from .schemas import PriceRequest, PriceResponse

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
