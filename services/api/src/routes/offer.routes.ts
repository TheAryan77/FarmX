import { counterOfferSchema, createOfferSchema } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  acceptOffer,
  counterOffer,
  createOffer,
  getOfferThread,
  listMyOfferThreads,
  rejectOffer,
} from "../services/offer.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const offerRouter: ExpressRouter = Router();

// Ordered before /:id so "mine" is never read as an id.
offerRouter.get("/mine", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await listMyOfferThreads(sub, role) });
});

offerRouter.get<{ id: string }>("/:id", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await getOfferThread(req.params.id, sub, role) });
});

// Only a buyer opens a negotiation — a farmer's asking price is the listing.
offerRouter.post(
  "/",
  requireAuth,
  requireRole("BUYER"),
  validateBody(createOfferSchema),
  async (req, res) => {
    res.status(201).json({ data: await createOffer(req.auth!.sub, req.body) });
  },
);

// Counter, accept and reject are open to both sides; the service enforces that
// only the counterparty of the live offer may act.
offerRouter.post<{ id: string }>(
  "/:id/counter",
  requireAuth,
  requireRole("BUYER", "FARMER"),
  validateBody(counterOfferSchema),
  async (req, res) => {
    const { sub, role } = req.auth!;
    res.json({ data: await counterOffer(req.params.id, sub, role, req.body) });
  },
);

offerRouter.post<{ id: string }>(
  "/:id/accept",
  requireAuth,
  requireRole("BUYER", "FARMER"),
  async (req, res) => {
    const { sub, role } = req.auth!;
    res.json({ data: await acceptOffer(req.params.id, sub, role) });
  },
);

offerRouter.post<{ id: string }>(
  "/:id/reject",
  requireAuth,
  requireRole("BUYER", "FARMER"),
  async (req, res) => {
    const { sub, role } = req.auth!;
    res.json({ data: await rejectOffer(req.params.id, sub, role) });
  },
);
