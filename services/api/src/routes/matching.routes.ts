import { aggregateOrderSchema, matchingRunSchema } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { proposeAggregation, runMatching } from "../services/matching.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const matchingRouter: ExpressRouter = Router();

matchingRouter.post(
  "/run",
  requireAuth,
  requireRole("BUYER"),
  validateBody(matchingRunSchema),
  async (req, res) => {
    const { requirementId } = req.body as { requirementId: string };
    res.json({ data: await runMatching(requirementId) });
  },
);

matchingRouter.post(
  "/aggregate",
  requireAuth,
  requireRole("BUYER"),
  validateBody(aggregateOrderSchema),
  async (req, res) => {
    const { requirementId } = req.body as { requirementId: string };
    res.json({ data: await proposeAggregation(requirementId) });
  },
);
