import { createListingSchema, listingFilterSchema, updateListingSchema } from "@fasalx/validation";
import type { ListingFilterInput } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateQuery, validatedQuery } from "../middleware/validate.js";
import {
  createListing,
  getListing,
  listMine,
  listPublic,
  softDeleteListing,
  updateListing,
} from "../services/listing.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const listingRouter: ExpressRouter = Router();

// Public browse. Ordered before /:id so "mine" is never read as an id.
listingRouter.get("/", validateQuery(listingFilterSchema), async (_req, res) => {
  res.json({ data: await listPublic(validatedQuery<ListingFilterInput>(res)) });
});

listingRouter.get("/mine", requireAuth, requireRole("FARMER"), async (req, res) => {
  res.json({ data: await listMine(req.auth!.sub) });
});

listingRouter.get("/:id", async (req, res) => {
  res.json({ data: await getListing(req.params.id) });
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
