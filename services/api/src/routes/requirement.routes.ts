import { createRequirementSchema } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  createRequirement,
  getRequirement,
  getRequirementCandidates,
  listMyRequirements,
} from "../services/requirement.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const requirementRouter: ExpressRouter = Router();

// Ordered before /:id so "mine" is never read as an id.
requirementRouter.get("/mine", requireAuth, requireRole("BUYER"), async (req, res) => {
  res.json({ data: await listMyRequirements(req.auth!.sub) });
});

requirementRouter.post(
  "/",
  requireAuth,
  requireRole("BUYER"),
  validateBody(createRequirementSchema),
  async (req, res) => {
    res.status(201).json({ data: await createRequirement(req.auth!.sub, req.body) });
  },
);

requirementRouter.get<{ id: string }>("/:id", requireAuth, async (req, res) => {
  res.json({ data: await getRequirement(req.params.id) });
});

/**
 * Supply that satisfies this requirement's constraints, with distances.
 *
 * Not in the original session plan, but the requirement detail screen has to
 * show "matching supply" and the constraints that decide what matches — crop,
 * grade, radius, minimum lot — live on the requirement, so applying them
 * server-side is the honest place for it. Session 8's POST /matching/run adds
 * the ranking on top of this.
 */
requirementRouter.get<{ id: string }>("/:id/candidates", requireAuth, async (req, res) => {
  res.json({ data: await getRequirementCandidates(req.params.id) });
});
