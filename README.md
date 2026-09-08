# FasalX

AI-powered direct farmer↔buyer agricultural commerce platform.
**SIH problem 26033** — multiple intermediaries reduce farmer earnings and increase consumer prices.

North star: every feature must increase **value reaching the farmer per transaction**.
See [CLAUDE.md](CLAUDE.md) for the locked demo world, stack and scope boundaries.

## Layout

```
apps/
  farmer-web/    Next.js 15 · mobile-first PWA   :3000
  buyer-web/     Next.js 15 · desktop-first      :3001
  admin-web/     Next.js 15 · ops dashboard      :3002
services/
  api/           Node 20 + Express + Zod         :4000
  ai/            Python 3.12 + FastAPI           :8000
packages/
  ui/            shadcn/ui + shared Tailwind tokens
  types/         shared TS types  (never duplicated in apps)
  validation/    shared Zod schemas (API + clients)
  config/        shared tsconfig + eslint bases
blockchain/      Hardhat · FasalXEscrow.sol → Polygon Amoy
prisma/          schema.prisma — PostgreSQL is the source of truth
```

## Setup

```bash
pnpm install
cp .env.example .env      # then fill in DATABASE_URL and the Amoy keys
pnpm ai:setup             # creates services/ai/.venv
```

## Running

```bash
pnpm dev                  # all three Next apps + the API, via Turborepo
pnpm ai:dev               # the Python AI service (separate — it has its own venv)
```

| Service    | URL                             | Health                                        |
| ---------- | ------------------------------- | --------------------------------------------- |
| farmer-web | http://localhost:3000           | —                                             |
| buyer-web  | http://localhost:3001           | —                                             |
| admin-web  | http://localhost:3002           | —                                             |
| api        | http://localhost:4000           | `/health` → `{ data: { status, ts } }`        |
| ai         | http://localhost:8000           | `/health` → `{ status: "ok" }`                |

Other scripts: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm clean`.

## Conventions

- TypeScript strict, no `any`. Money is **integer rupees**; quantity is **quintals (Q), 2dp** — never kg.
- Every API route returns `{ data: T }` or `{ error: { code, message } }`.
- Node never runs ML — it calls the Python service over HTTP.
- Polygon stores trust state only. **No PII ever goes on-chain.**

## Environment notes

- Python **3.12** is used instead of 3.11 (3.11 is not installed on this machine).
  Every locked dependency — FastAPI, pandas, scikit-learn, XGBoost, OR-Tools — supports 3.12.
- The repo path contains an apostrophe (`Devansh's SIH`), which breaks `node-gyp`'s
  generated shell command. Native builds for `keccak`, `secp256k1`, `bufferutil` and
  `utf-8-validate` are therefore left disabled in `pnpm-workspace.yaml`; all four have
  pure-JS fallbacks. Moving the repo to a path without an apostrophe would remove the caveat.
