# FasalX

AI-powered direct farmer↔buyer agricultural commerce platform.
SIH problem 26033: multiple intermediaries reduce farmer earnings and increase consumer prices.

Full architecture reference: `docs/PLAN.md`. That document is background, not a task list.
This file is authoritative where the two disagree.

## North star

Every feature must increase **value reaching the farmer per transaction**.
If a change does not eventually show up in the farmer's net realization number, it is out of scope.

## Locked demo world — do not invent alternatives

- Commodity: **Wheat only**
- Region: **Karnal, Haryana**
- Unit: **quintal (Q)**. Never mix kg and quintal anywhere in the codebase.
- Currency: INR, whole rupees, stored as integers
- Farmer persona: **Ramesh Kumar**, Karnal, 50Q wheat available
- Buyer persona: **ABC Foods**, requirement 500Q Grade A wheat
- The 500Q requirement is fulfilled by exactly 4 farmers: **80 + 120 + 150 + 150 = 500**
- Settled price for the demo deal: **₹2,420/Q**

## Stack — locked, do not substitute

- Monorepo: pnpm workspaces + Turborepo
- Farmer app: Next.js 15 App Router, **mobile-first PWA** (deliberately NOT React Native)
- Buyer / FPO / Admin: Next.js 15 App Router
- UI: Tailwind + shadcn/ui, shared through `packages/ui`
- API: Node 20 + TypeScript + Express + Zod
- DB: Prisma + PostgreSQL (hosted). **No PostGIS** — use haversine in TS/SQL.
- AI service: Python 3.11 + FastAPI + pandas + scikit-learn + XGBoost + OR-Tools
- Blockchain: Solidity + Hardhat + OpenZeppelin + viem, deployed to Polygon Amoy
- Auth: mock OTP + JWT + RBAC with roles `FARMER | BUYER | FPO | ADMIN`

## Explicitly out of scope

Crop disease detection, crop management, equipment rental, insurance, loans,
government schemes, social/community features, input marketplace, warehouse
marketplace, real Aadhaar or KYC integration, real INR escrow, WhatsApp bot,
IVR, LSTM, IPFS, tokenomics, DAO, farmer-held crypto wallets, microservices,
Kubernetes, Kafka, PostGIS, React Native.

Do not add any of these even though `docs/PLAN.md` mentions them. They are Phase 2.

## Architecture rules

- **PostgreSQL is the source of truth.** Polygon stores trust state only.
- On-chain state: `dealId`, buyer address, seller address, amount, status enum,
  timestamps, contract PDF SHA-256 hash. Nothing else.
- **Never on-chain:** names, phone numbers, addresses, bank details, any PII.
- Node never runs ML. It calls the Python service over HTTP.
- The Python service is stateless — it receives data, returns a prediction.
- Blockchain calls happen only from the API layer's contract service, never from a client.
- Any future voice/IVR layer calls the same REST endpoints as the UI. No parallel business logic.

## Code conventions

- TypeScript strict mode. No `any`.
- Shared types live in `packages/types`, imported by apps — never duplicated.
- Zod schemas live in `packages/validation`, shared by API and clients.
- Money: integer rupees. Quantity: decimal quintals, 2dp.
- Every API route returns `{ data: T }` or `{ error: { code, message } }`.
- Route handlers stay thin; logic lives in service modules.

## Working agreement

- Build **one vertical slice at a time**. Do not scaffold ahead of the current slice.
- A slice is done when it runs and I can click through it. Then stop and report.
- Never write more than ~5 files without pausing so I can run it.
- If a slice needs a decision I have not made, ask. Do not guess, and do not
  silently stub something and move on.
- Do not write tests unless I ask. Do not add CI, Docker, or deployment config unless I ask.

## Demo script — this is the real spec

1. Ramesh has 50Q wheat, opens the farmer app
2. AI shows: current ₹2,380/Q, predicted ₹2,450/Q, demand HIGH, recommendation
3. ABC Foods posts a requirement: 500Q Grade A, ₹2,400 target, within 150km, 7 days
4. Matching engine ranks farmers and aggregates 80+120+150+150 = 500Q
5. Negotiation settles at ₹2,420/Q
6. Digital contract generated as PDF, hashed
7. Buyer funds escrow on Amoy — funds LOCKED
8. Logistics optimizes the 4-farm pickup route to the buyer
9. Delivery + QC: Grade A, APPROVED
10. `releaseFunds()` fires; farmer sees net payout and gain vs traditional channel

Every screen built must map to a scene above. If it doesn't, it isn't in the MVP.
