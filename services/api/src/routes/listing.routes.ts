import { createListingSchema, listingFilterSchema, updateListingSchema } from "@fasalx/validation";
import type { ListingFilterInput } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateQuery, validatedQuery } from "../middleware/validate.js";
import {
  createListing,
  getListing,
  listMine,
  listPublic,
  softDeleteListing,
  updateListing,
  type Origin,
} from "../services/listing.service.js";
import { requireBuyerProfile } from "../services/requirement.service.js";

/**
 * Where to measure distance from. A signed-in buyer gets distances relative to
 * their own registered location — CLAUDE.md's "distance-from-buyer" — and
 * anyone else gets none rather than a guess.
 */
async function originFor(auth: { sub: string; role: string } | undefined): Promise<Origin | null> {
  if (auth?.role !== "BUYER") return null;
  const buyer = await requireBuyerProfile(auth.sub);
  return { lat: buyer.lat, lng: buyer.lng };
}

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const listingRouter: ExpressRouter = Router();

// Public browse. Ordered before /:id so "mine" is never read as an id.
// optionalAuth, not requireAuth: the route stays public, but a signed-in buyer
// additionally gets distanceKm on every result.
listingRouter.get("/", optionalAuth, validateQuery(listingFilterSchema), async (req, res) => {
  const origin = await originFor(req.auth);
  res.json({ data: await listPublic(validatedQuery<ListingFilterInput>(res), origin) });
});

listingRouter.get("/mine", requireAuth, requireRole("FARMER"), async (req, res) => {
  res.json({ data: await listMine(req.auth!.sub) });
});

listingRouter.get<{ id: string }>("/:id", optionalAuth, async (req, res) => {
  const origin = await originFor(req.auth);
  res.json({ data: await getListing(req.params.id, origin) });
});

listingRouter.post(
  "/",
  requireAuth,
  requireRole("FARMER"),
  validateBody(createListingSchema),
  async (req, res) => {
    const listing = await createListing(req.auth!.sub, req.body);
    res.status(201).json({ data: listing });
  },
);

listingRouter.patch<{ id: string }>(
  "/:id",
  requireAuth,
  requireRole("FARMER"),
  validateBody(updateListingSchema),
  async (req, res) => {
    res.json({ data: await updateListing(req.params.id, req.auth!.sub, req.body) });
  },
);

listingRouter.delete<{ id: string }>("/:id", requireAuth, requireRole("FARMER"), async (req, res) => {
  res.json({ data: await softDeleteListing(req.params.id, req.auth!.sub) });
});
