# FasalX — Claude Code session prompts

Run these **in order**, one per session. Each has acceptance criteria. Do not start
the next prompt until the current one's criteria pass and you've committed.

Every prompt below assumes `CLAUDE.md` and `docs/PLAN.md` are already in the repo root.

---

## Session 0 — Do this yourself, no prompt

```bash
mkdir fasalx && cd fasalx
git init
npm i -g pnpm
# copy CLAUDE.md to repo root
mkdir docs   # copy your architecture plan to docs/PLAN.md
```

Also before you start:

- Create a Postgres on Neon or Supabase. Copy the connection string.
- Download wheat price history for Karnal from data.gov.in (Agmarknet resource) as CSV.
  Put it at `services/ai/data/wheat_karnal.csv`. **Open it and confirm it has usable rows.**
- Create a MetaMask wallet, switch to Polygon Amoy, get test POL from the Amoy faucet.
  Do this now — faucets rate-limit and you don't want to discover that on day four.

---

## Session 1 — Scaffold

```
Read CLAUDE.md before doing anything.

Scaffold the FasalX monorepo. Nothing else — no features, no business logic,
no database models yet.

Create:

fasalx/
├── apps/
│   ├── farmer-web/     Next.js 15, App Router, TS, Tailwind, mobile-first
│   ├── buyer-web/      Next.js 15, App Router, TS, Tailwind
│   └── admin-web/      Next.js 15, App Router, TS, Tailwind
├── services/
│   ├── api/            Node 20 + TS + Express, tsx watch, Zod
│   └── ai/             Python 3.11 + FastAPI, requirements.txt, venv
├── packages/
│   ├── types/          shared TS types, empty barrel export
│   ├── validation/     shared Zod schemas, empty barrel export
│   └── config/         shared tsconfig + eslint base
├── blockchain/         Hardhat + TS, empty contracts dir
├── prisma/             schema.prisma with datasource + generator only
├── .env.example
├── turbo.json
├── pnpm-workspace.yaml
└── package.json

Requirements:
- Root scripts: `pnpm dev` runs all three Next apps + the API concurrently via Turborepo
- api exposes GET /health returning { data: { status: "ok", ts } }
- ai exposes GET /health returning { status: "ok" }
- Each Next app renders a single page with just its name as an h1
- shadcn/ui initialised in packages/ui, consumed by at least farmer-web
- Ports: farmer-web 3000, buyer-web 3001, admin-web 3002, api 4000, ai 8000
- .gitignore covers node_modules, .env, .next, venv, artifacts, cache

Done when: `pnpm dev` starts everything with zero errors, all five ports respond,
and `pnpm build` succeeds.

Stop after this. Do not create models, routes, or UI beyond the placeholder pages.
```

**Commit:** `chore: scaffold monorepo`

---

## Session 2 — Schema and seed

This is the highest-leverage session in the project. Your entire demo lives in the seed file.

```
Read CLAUDE.md.

Design the Prisma schema and write the seed script. No API routes, no UI.

Models (adapt names/fields as sensible, keep them minimal — only what the
10-scene demo script in CLAUDE.md needs):

User, FarmerProfile, BuyerProfile, FpoProfile, ProduceListing,
BuyerRequirement, Offer, Order, OrderAllocation, Contract, ContractEvent,
Escrow, Shipment, ShipmentStop, QualityCheck, Settlement, PriceHistory

Rules:
- Enums for role, grade, listing status, order status, and the full contract
  state machine: CREATED, ACCEPTED, FUNDED, PICKED_UP, DELIVERED,
  QC_APPROVED, RELEASED, DISPUTED, REFUNDED
- OrderAllocation is the aggregation join: one Order, many farmers, each with
  an allocated quantity. This model is the centrepiece of the demo.
- lat/lng as plain Float columns. No PostGIS.
- Money as Int (rupees). Quantity as Decimal(10,2) (quintals).

Then write prisma/seed.ts producing exactly this world:

- 1 buyer: ABC Foods, Karnal
- 1 FPO: Karnal Kisan Producer Company, with 12 member farmers
- 12 farmers around Karnal with REAL plausible lat/lng within ~150km,
  spread across different distances so distance-based ranking is visible
- Ramesh Kumar is one of them, with a 50Q Grade A wheat listing at ₹2,400
- Four of the twelve have listings of exactly 80Q, 120Q, 150Q, 150Q Grade A
  so they sum to 500Q. Price them between ₹2,395 and ₹2,425.
- The other farmers have listings that are deliberately worse fits — wrong
  grade, too far, too expensive — so matching has something to reject
- 1 open BuyerRequirement: 500Q Grade A wheat, ₹2,400/Q target, 150km, 7 days
- 24 months of daily PriceHistory rows for wheat/Karnal, seeded from
  services/ai/data/wheat_karnal.csv if present, otherwise generated with a
  realistic seasonal curve ending at ₹2,380

Add root scripts: db:push, db:seed, db:reset, db:studio

Done when: `pnpm db:reset && pnpm db:seed` runs clean and Prisma Studio shows
the four farmers whose quantities sum to 500.
```

**Commit:** `feat: prisma schema and demo seed`

---

## Session 3 — Auth

```
Read CLAUDE.md.

Build mock-OTP auth in services/api plus login on farmer-web and buyer-web.

- POST /auth/request-otp  { phone } → always succeeds, logs the OTP to console
- POST /auth/verify-otp   { phone, otp } → any 6-digit code works in dev;
  returns { data: { token, user } } with a signed JWT carrying userId and role
- GET  /auth/me           → returns the current user
- requireAuth and requireRole(...roles) Express middleware
- Client side: phone entry → OTP entry → redirect to a role-appropriate
  empty dashboard. Token in an httpOnly cookie.
- Seeded users must be able to log in: Ramesh's phone (FARMER),
  ABC Foods' phone (BUYER)

Done when: I can log in as Ramesh on :3000 and as ABC Foods on :3001, and
GET /auth/me returns the right user and role for each.
```

**Commit:** `feat: mock otp auth with rbac`

---

## Session 4 — Farmer listings

```
Read CLAUDE.md.

Farmer can list produce and see their listings.

API:
- POST   /listings          create (FARMER only, Zod validated)
- GET    /listings/mine     current farmer's listings
- GET    /listings          public browse, filterable by crop, grade, district
- GET    /listings/:id
- PATCH  /listings/:id      edit own
- DELETE /listings/:id      soft delete own

farmer-web:
- Home: greeting, current wheat price from PriceHistory (latest row, no AI yet),
  primary "Sell Produce" CTA, "My Listings" secondary
- Sell Produce: crop, quantity + unit, expected price, grade, available-from
  date, location prefilled from profile. Mobile-first, large touch targets.
- My Listings: cards with status badges
- Listing detail

Design: this is for a farmer on a cheap Android phone. Big text, high contrast,
minimal chrome, no dense tables. Assume outdoor sunlight.

Done when: I log in as Ramesh, create a 50Q wheat listing, see it in My Listings,
and see it appear in GET /listings.
```

**Commit:** `feat: farmer produce listings`

---

## Session 5 — Buyer requirements and supply browse

```
Read CLAUDE.md.

Buyer side of the marketplace.

API:
- POST /requirements        create (BUYER only)
- GET  /requirements/mine
- GET  /requirements/:id
- GET  /listings            reuse, add distance-from-buyer to each result
  using haversine (no PostGIS)

buyer-web (desktop-first, dense, data-heavy — opposite of the farmer app):
- Dashboard: active requirements with a fulfilment percentage bar each
- Create Requirement: crop, quantity, grade, target price, max distance,
  delivery deadline
- Requirement detail: matching supply listed below it, showing farmer name,
  quantity, price, grade, distance. Sorted by nothing clever yet — that's next session.

Done when: I log in as ABC Foods, see the seeded 500Q requirement, open it, and
see candidate listings with correct distances in km.
```

**Commit:** `feat: buyer requirements and supply browse`

---

## Session 6 — Offers and orders

```
Read CLAUDE.md.

Close the loop: an offer becomes an order.

API:
- POST /offers                buyer offers on a listing { listingId, pricePerUnit, quantity }
- POST /offers/:id/counter    farmer counters with their price
- POST /offers/:id/accept     either side accepts → creates Order + OrderAllocation
- POST /offers/:id/reject
- GET  /offers/mine           both roles, filtered by their side
- GET  /orders/mine
- GET  /orders/:id

Rules:
- Offer state machine: PENDING → COUNTERED → ACCEPTED | REJECTED | EXPIRED
- Accepting creates one Order with one OrderAllocation, reserves the listing quantity
- All state transitions validated server-side; reject invalid ones with a clear error

UI both apps: offer inbox, counter flow, accept, order detail.

Done when: ABC Foods offers ₹2,350 on Ramesh's listing, Ramesh counters ₹2,450,
ABC Foods accepts, and both see the resulting Order with correct totals.
```

**Commit:** `feat: offers, negotiation and orders`

**Stop here and demo it to yourself.** If sessions 1–6 work you have a defensible
project. Everything past this point is upside on a working spine.

---

## Session 7 — AI price intelligence

```
Read CLAUDE.md.

Build the Python AI service's price module. Real model, not random numbers.

services/ai:
- Load PriceHistory from Postgres (read-only) or the seed CSV
- Feature engineering: month, week-of-year, day-of-week, lag-1/7/30 prices,
  30-day rolling mean, rolling std, arrival volume if present
- Train XGBoost regression to predict next-7-day price. Time-based train/test
  split — never random, this is a time series.
- Persist the model to disk. Add a `train` script; do not retrain per request.
- POST /predict/price  { crop, district, date } →
  { current, predicted_7d, low, high, confidence, recommendation }
  where recommendation ∈ { SELL_NOW, HOLD, SELL_PARTIAL } derived from the
  predicted delta and model confidence
- Confidence must come from real backtest error (e.g. 1 - normalised MAE),
  not a hardcoded number
- Print test MAE and MAPE when training so I can quote real accuracy to judges

services/api:
- GET /ai/price?crop=wheat&district=Karnal proxies to the Python service,
  caches 15 min in memory, falls back to latest PriceHistory row if AI is down

farmer-web home: replace the raw price with the AI card — current, predicted
range, demand level, recommendation, confidence.

Done when: training prints a real MAE, and Ramesh's home screen shows a
prediction sourced from the trained model. Tell me the MAE and MAPE.
```

**Commit:** `feat: xgboost price prediction`

---

## Session 8 — Matching and aggregation

This is your differentiator. Give it the visual weight it deserves.

```
Read CLAUDE.md.

Build matching and supply aggregation.

Scoring (in services/ai, exposed as POST /match):
  score = 0.30*price + 0.25*distance + 0.20*quantity + 0.15*quality + 0.10*reliability
Each component normalised 0-1 across the candidate pool. Return per-farmer
score plus the component breakdown so the UI can explain the ranking.

Aggregation: greedy fill by descending score until the requirement quantity is
met. Allow partial allocation of the final farmer. Return the selected set,
each allocation quantity, the running total, weighted average price, and
whether the requirement is fully satisfiable.

API:
- POST /matching/run           { requirementId } → ranked candidates
- POST /matching/aggregate     { requirementId } → proposed aggregation
- POST /orders/aggregate       accept it → one Order, many OrderAllocations

buyer-web requirement detail — make this the visual centrepiece:
- Ranked candidate table with score and a "why" breakdown per row
- An aggregation panel that visibly fills toward 500Q as farmers are added:
  80 → 200 → 350 → 500. Animate the progress bar. Show the running total large.
- "Create Aggregated Order" confirms the whole set in one action

Done when: opening the seeded 500Q requirement and hitting Aggregate selects
exactly the four farmers summing to 500Q, and accepting creates one Order with
four OrderAllocations.
```

**Commit:** `feat: ai matching and supply aggregation`

---

## Session 9 — Contract and escrow on Amoy

```
Read CLAUDE.md. Blockchain stores trust state only — re-read the architecture rules.

Part 1 — blockchain/contracts/FasalXEscrow.sol
- Struct Deal: dealId, buyer, seller, amount, status, contractHash, timestamps
- Functions: createDeal, acceptDeal, fundDeal (payable), confirmPickup,
  confirmDelivery, approveQuality, raiseDispute, releaseFunds, refundBuyer
- State machine exactly as in CLAUDE.md. Reject invalid transitions.
- OpenZeppelin Ownable + ReentrancyGuard. Events on every transition.
- Hardhat tests covering the happy path and at least three invalid transitions
- Deploy script targeting Amoy, address written to .env

Part 2 — services/api contract service
- Generate a contract PDF from the Order (parties, commodity, quantity, price,
  total, delivery date, grade, payment terms). SHA-256 it.
- viem client, server-side private key from env, never exposed to clients
- POST /contracts              create off-chain record + createDeal on-chain
- POST /contracts/:id/fund     fundDeal
- POST /contracts/:id/release  releaseFunds
- GET  /contracts/:id          off-chain record + live on-chain status + tx hashes
- Write every transition to ContractEvent with its tx hash
- If the Amoy RPC fails, record the intended transition locally and surface a
  clear degraded state. Never crash the request.

Part 3 — UI: a contract timeline on both apps showing each state with its
Amoy explorer link. Escrow shows "🔒 Payment Secured" in rupees — never
expose a hex address or token amount to the farmer.

Done when: I create a contract from the aggregated order, fund it, and see a
real Amoy transaction hash that opens on amoy.polygonscan.com.
```

**Commit:** `feat: escrow smart contract on polygon amoy`

**Immediately after this works:** screen-record the full escrow flow. That recording
is your demo-day insurance against a dead RPC.

---

## Session 10 — Logistics optimisation

```
Read CLAUDE.md.

Route optimisation for aggregated pickups.

services/ai — POST /optimize/route
- Input: pickup points with lat/lng and quantity, destination, truck capacity
- OR-Tools CVRP: minimise total distance subject to capacity
- Output: per-truck ordered stop sequence, per-leg distance, total distance,
  load, estimated cost, and a naive-sequential baseline cost for comparison
- Cost model: ₹/km by vehicle class, stated as a named constant so it's honest

services/api
- POST /logistics/optimize   { orderId } → creates Shipment + ShipmentStops
- GET  /logistics/:id

buyer-web + farmer-web
- Map (Mapbox or Leaflet + OSM) with numbered pickup markers, the destination,
  and the route line drawn between them
- Shipment summary card: stops, total produce, distance, naive cost vs
  optimised cost, saving, vehicle

Done when: the four-farmer order produces a map with a sensible route and a
stated saving versus the unoptimised sequence.
```

**Commit:** `feat: or-tools route optimisation`

---

## Session 11 — QC, settlement and the profit dashboard

This is the session that wins or loses the pitch. It's the payoff of everything above.

```
Read CLAUDE.md.

Close the transaction and prove farmer benefit.

API:
- POST /shipments/:id/pickup-confirm    driver/farmer confirms, hits confirmPickup
- POST /shipments/:id/deliver           delivery proof upload, confirmDelivery
- POST /quality                         buyer records grade + notes
- POST /quality/:id/approve             approveQuality then releaseFunds
- POST /quality/:id/reject              raiseDispute
- Settlement rows written per farmer allocation on release

Settlement maths — every number derived, none hardcoded:
  gross            = allocated quantity × settled price
  logistics share  = shipment cost × (this farmer's qty / total qty)
  platform fee     = 1% of gross, as a named constant
  net              = gross − logistics share − platform fee
  traditional est  = gross × TRADITIONAL_REALISATION_RATE (named constant,
                     documented in a comment as an illustrative assumption)
  farmer gain      = net − traditional est

farmer-web — the money screen:
- Deal completed view: gross, logistics, platform, net, and gain vs traditional
- A "where did your money go" breakdown bar
- Month-to-date: total sales, average price realised, additional realisation,
  orders, successful deliveries

Label simulated economics honestly in the UI. Judges respect a labelled
assumption and punish a fake precise number.

Done when: approving QC releases funds on Amoy and Ramesh's screen shows his
net payout and his gain versus the traditional channel, all computed from
real seeded numbers.
```

**Commit:** `feat: qc, settlement and farmer profit dashboard`

---

## Session 12 — Demo hardening (do not skip)

```
Read CLAUDE.md.

No new features. Make the demo unbreakable.

1. `pnpm demo:reset` — wipes and reseeds to the exact pre-demo state in one command
2. A /demo route on each app with one-click login as Ramesh / ABC Foods, no OTP typing
3. Loading skeletons on every screen that fetches. No spinner-on-white anywhere.
4. Every API failure renders a readable message, never a stack trace or blank page
5. If the Amoy RPC or the Python service is unreachable, show clearly-labelled
   cached last-known values instead of breaking the flow
6. Empty states on every list
7. Audit for hardcoded values that should be derived, and any place kg and
   quintal could be mixed up
8. Console errors: fix all of them

Then walk the 10-scene demo script end to end and give me a numbered report of
every place it stalls, looks broken, or takes more than 2 seconds.
```

**Commit:** `chore: demo hardening`

---

## If you fall behind

Cut in this order:

1. Session 10 (logistics) — replace with a static map image and a cost table
2. Session 7's real model — keep the endpoint shape, swap XGBoost for a
   seasonal-average baseline, and say so honestly
3. admin-web and the FPO dashboard — they add no new story
4. Session 9's live chain — run against a local Hardhat node and show the tx
   hash from your recorded Amoy run

**Never cut:** sessions 1–6, session 8 (aggregation), or session 11 (the money screen).
Those three are the whole argument.
