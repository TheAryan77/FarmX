# FasalX AI service

Python 3.12 + FastAPI. Stateless: takes data, returns a prediction.

## Setup

From the repo root:

```bash
pnpm ai:setup   # creates services/ai/.venv and installs requirements.txt
pnpm ai:dev     # uvicorn on http://localhost:8000
```

`GET /health` → `{ "status": "ok" }`

## Data

Put the Agmarknet wheat price history for Karnal at `data/wheat_karnal.csv`.
The Prisma seed (Session 2) reads it if present and falls back to a generated
seasonal curve if it is not.
