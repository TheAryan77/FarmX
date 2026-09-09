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
brew install libomp       # macOS only — xgboost needs OpenMP
pnpm install
cp .env.example .env      # then fill in DATABASE_URL and the Amoy keys
pnpm ai:setup             # creates services/ai/.venv
pnpm ai:train             # trains and persists the price model
```

`libomp` is not optional on macOS: xgboost's wheel does not bundle an OpenMP
runtime and fails to import without it. The trained model is a build artifact
and is **not** committed, so `pnpm ai:train` is required on a fresh clone.

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

## Database

```bash
pnpm db:push      # sync schema to the database
pnpm db:seed      # load the demo world (idempotent — wipes and reloads)
pnpm db:reset     # force-reset the schema, then re-seed with db:seed
pnpm db:studio    # browse the data
```

`pnpm db:seed` prints a self-check proving the seeded farmers still aggregate to
exactly 500Q, and fails loudly if an edit breaks that. Demo logins:
**9876543210** (Ramesh Kumar, farmer) and **9812345678** (ABC Foods, buyer).

### Price history

The seed reads `services/ai/data/wheat_karnal.csv` if present — an Agmarknet
export from data.gov.in — matching columns fuzzily and converting arrivals from
tonnes to quintals. Real data is **never** rewritten to hit a demo number, since
Session 7 trains on these rows and quotes their error; if the CSV's latest price
differs from the ₹2,380 in CLAUDE.md, the seed warns and the demo script is what
should move. With no CSV it generates 24 months of a deterministic seasonal
curve (April harvest glut, Dec–Jan lean-season peak) ending at ₹2,380.

Other scripts: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm clean`.

## Auth

Mock OTP + JWT + RBAC. Roles: `FARMER | BUYER | FPO | ADMIN`.

| Route                   | Notes                                                        |
| ----------------------- | ------------------------------------------------------------ |
| `POST /auth/request-otp`| Generates a 6-digit code, logs it, returns it as `devOtp` outside production |
| `POST /auth/verify-otp` | Any 6-digit code is accepted outside production; returns `{ token, user }` |
| `GET  /auth/me`         | Requires `Authorization: Bearer <token>`                     |

`requireAuth` and `requireRole(...roles)` are the Express middleware.

**The API reads no cookies — it is bearer-token only.** Each Next app keeps its
own httpOnly cookie (`fasalx_farmer_session`, `fasalx_buyer_session`) and
attaches the token server-side. Two reasons:

1. Cookies are scoped by domain and **ignore the port**, so `localhost:3000` and
   `localhost:3001` share one jar. A single shared cookie name would make signing
   into the buyer portal silently sign you out of the farmer app — and the demo
   needs both live at once (the buyer offers, the farmer counters).
2. A bearer API is what a future voice/IVR layer would call, with no parallel
   business logic.

The token therefore never reaches the browser: `document.cookie` is empty and no
JWT appears in any client bundle. Each app also refuses the wrong role at its own
boundary and says which app to use instead.

Registration is deliberately not implemented — an unknown number is rejected with
a message naming the seeded accounts.

## Listings

| Route                    | Access        | Notes                                        |
| ------------------------ | ------------- | -------------------------------------------- |
| `GET    /listings`       | public        | Browse; filter by crop, grade, district, min quantity |
| `GET    /listings/mine`  | FARMER        | The signed-in farmer's own listings          |
| `GET    /listings/:id`   | public        | Single listing                               |
| `POST   /listings`       | FARMER        | Create                                       |
| `PATCH  /listings/:id`   | FARMER, owner | Edit; blocked once anything is committed     |
| `DELETE /listings/:id`   | FARMER, owner | Soft delete; blocked if quantity is reserved |
| `GET    /market/price`   | public        | Latest PriceHistory row + 7-day change       |

Quantity is **quintals everywhere** — there is no unit field to get wrong, and
the sell form's "1 quintal = 100 kg" line is a reading aid that is never stored.
Money is whole rupees. Both are converted once, at the serialisation boundary.

Deletes are soft so any order, contract or settlement referencing a listing
keeps its history. A listing cannot be edited once produce is committed to a
deal, or reduced below the committed quantity.

`GET /market/price` is not in the original session plan but the farmer home
screen needs a price and apps only ever talk to the API. Session 7's
`GET /ai/price` goes in front of it.

## Requirements and supply matching

| Route                                | Access | Notes                                          |
| ------------------------------------ | ------ | ---------------------------------------------- |
| `POST /requirements`                 | BUYER  | Create                                         |
| `GET  /requirements/mine`            | BUYER  | With fulfilment percentage on each             |
| `GET  /requirements/:id`             | signed in | Readable by farmers too — session 6 needs it |
| `GET  /requirements/:id/candidates`  | signed in | Supply matching the requirement's constraints |

`GET /listings` uses **optional** auth: it stays a public route, but a
signed-in buyer additionally gets `distanceKm` on every result, measured from
their registered location. Anyone else gets `null` rather than a guess.

Distance is haversine, no PostGIS. A radius filter first narrows the query with
a lat/lng **bounding box** so Postgres can use its indexes, then the exact
distance is applied in TS — the box is always a superset of the circle, so
nothing in range is lost. With a radius active, paging and `total` are computed
after the exact filter, otherwise `total` would count listings the radius rejects.

`/candidates` also returns a count of what it *rejected* and why — wrong grade,
too far, below minimum lot — so the buyer can see supply being discarded for
stated reasons rather than just getting a short list. It is deliberately
unranked (nearest first); session 8 adds the weighted score and aggregation.

Not in the original session plan, but the requirement detail screen has to show
matching supply, and the constraints that decide what matches live on the
requirement.

## Offers, negotiation and orders

| Route                     | Access        | Notes                                       |
| ------------------------- | ------------- | ------------------------------------------- |
| `POST /offers`            | BUYER         | Opens a negotiation on a listing            |
| `POST /offers/:id/counter`| either party  | Counters with a new price                   |
| `POST /offers/:id/accept` | counterparty  | Creates the Order + OrderAllocation         |
| `POST /offers/:id/reject` | counterparty  | Declines                                    |
| `GET  /offers/mine`       | both roles    | Threads, scoped to the caller's side        |
| `GET  /orders/mine`       | both roles    | Buyer's orders, or a farmer's allocations   |
| `GET  /orders/:id`        | parties only  | 403 for anyone not on the deal              |

`PENDING → COUNTERED → ACCEPTED | REJECTED | EXPIRED`. A counter is a **new
offer** pointing at the one it answers, not an edit — the whole price history
stays readable, and a thread never shows two live prices.

Only the side that did *not* make the live offer may act on it. That single
rule is what prevents accepting your own price, and it lives in the API:
`/offers/mine` returns `canAccept` / `canCounter` / `canReject` per thread so
the farmer app and the buyer portal cannot drift apart on the state machine.

Accepting is one transaction — offer to ACCEPTED, order and allocation written,
listing quantity committed. The listing is re-read *inside* that transaction, so
two buyers accepting the same lot at once cannot both succeed. Order numbers are
minted in the same transaction for the same reason.

Offers lapse after 48 hours, swept on read rather than by a scheduler — there is
no job runner in this stack, and a stale offer only matters when someone looks
at it.

The build plan names the offer field `pricePerUnit`; it is `pricePerQuintal`
here, because a field called "per unit" invites exactly the kg/quintal
confusion CLAUDE.md bans. Delivery dates are derived on accept (the
requirement's deadline, else ready + 7 days) since an offer carries no date.

## AI price intelligence

```bash
pnpm ai:train     # train, print real backtest metrics, persist the model
pnpm ai:dev       # serve it on :8000 (not part of `pnpm dev`)
```

| Route                       | Notes                                                    |
| --------------------------- | -------------------------------------------------------- |
| `GET  /ai/price` (API)      | Proxies the model, adds demand, caches 15 min, degrades  |
| `POST /predict/price` (AI)  | `{ crop, district, date? }` → forecast                   |
| `GET  /model/price` (AI)    | Full training metrics — what backs any accuracy claim    |
| `GET  /market/price` (API)  | The raw un-modelled mandi reading, still available       |

**The model predicts the 7-day price *change*, not the level.** Trained on the
absolute price it scored MAE ₹18.5 against a naive "no change" baseline of
₹11.4 — 61% *worse* than doing nothing, with every held-out residual positive.
That is structural: prices trend upward, the chronological test split sits at
levels the training window never contained, and a gradient-boosted tree cannot
predict outside the target range it has seen. Modelling the delta removes the
trend from the target, and the forecast is reconstructed as
`current + predicted_delta`.

The split is strictly chronological, and every feature is backward-looking
(rolling windows are shifted by one day so today's price never leaks into its
own features).

**Confidence is measured, not asserted:** the share of held-out forecasts that
landed within 1% of the real price. `low`/`high` are the 10th/90th percentile
of the held-out residuals — an empirical interval, not a made-up band. Training
also prints the naive baseline and the skill against it, because an accuracy
figure with nothing to compare it to means nothing.

**Recommendation** is `SELL_NOW | HOLD | SELL_PARTIAL`, and the threshold is
derived from the model's own error (1.5 × MAPE, floored at 0.5%): it will not
tell a farmer to wait for a gain smaller than its typical miss.

**Demand** is marketplace data, not a model output — the quintals of open buyer
requirement still unsourced in the district. The level is a pilot-scale
bucketing of that quantity, and the UI always prints the quantity next to the
label.

If the AI service is down or untrained, `/ai/price` returns the latest mandi
row with `source: "fallback"` and no forecast, and the farmer card says the
outlook is unavailable rather than inventing one.

## Matching and supply aggregation

| Route                          | Notes                                                |
| ------------------------------ | ---------------------------------------------------- |
| `POST /matching/run`           | Ranked candidates with the per-component breakdown   |
| `POST /matching/aggregate`     | The proposed greedy fill, uncommitted                |
| `POST /orders/aggregate`       | Commits it: one Order, many OrderAllocations         |
| `POST /match` (AI service)     | Stateless scoring — no DB, no model artifact         |

```
score = 0.30·price + 0.25·distance + 0.20·quantity
      + 0.15·quality + 0.10·reliability
```

Every component is normalised 0-1 **across the candidate pool**, which is what
makes the weights mean anything: a farmer scores well on price because they are
cheap relative to the supply actually available, not against an absolute scale.
Reliability blends the star rating (70%) with completed-order count (30%).

The buyer portal draws the score **as its own explanation** — a stacked bar
whose segment widths are each component's weighted contribution, so the bar
length is the score and its composition shows how it was earned. One farmer
ranks on price, another on distance, and that is visible at a glance.

**Quality is currently a constant.** Candidates are filtered to the requested
grade before scoring, so every one of them scores 1.0 on it. The component
keeps its weight so the other four stay proportioned as specified, and
accepting substitute grades later is a change to the filter, not the scoring.

Aggregation is a greedy fill by descending score, and may take part of the last
farmer's lot rather than commit produce the buyer did not ask for. It fills
against what is still **outstanding**, so a part-filled requirement only sources
the remainder. `runningTotals` is the cumulative quantity after each pick, which
is what the UI animates.

Committing recomputes the proposal server-side rather than trusting the client —
a farmer could have sold elsewhere between the panel rendering and the button
being pressed — then writes the order, one allocation per farmer, and each
listing's reservation in a single transaction.

**Every farmer is paid the same settled price.** Where that exceeds their ask
they receive more than they asked for: at ₹2,420 the four selected farmers take
₹6,200 more than their combined asking prices. The panel shows that figure live
as the price is changed, because moving value toward the farmer is the point.

Unlike the price card, matching has **no degraded mode**: a ranking Node
invented would not be the ranking the engine produces, and the buyer would be
committing money against it. If the AI service is down the request fails with a
clear message telling you to start it.

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
