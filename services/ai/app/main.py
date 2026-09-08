"""FasalX AI service.

CLAUDE.md: this service is stateless. It receives data and returns a
prediction. Node never runs ML; it calls this service over HTTP.
"""

from fastapi import FastAPI

app = FastAPI(
    title="FasalX AI",
    description="Price prediction, demand forecasting, match scoring, route optimisation.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
