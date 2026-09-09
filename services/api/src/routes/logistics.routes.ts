import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  getShipment,
  getShipmentForOrder,
  optimiseForOrder,
} from "../services/logistics.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const logisticsRouter: ExpressRouter = Router();

const optimiseSchema = z.object({
  orderId: z.string({ error: "Choose an order" }).min(1, "Choose an order"),
});

/** The buyer arranges collection, so only they can plan or replan it. */
logisticsRouter.post(
  "/optimize",
  requireAuth,
  requireRole("BUYER"),
  validateBody(optimiseSchema),
  async (req, res) => {
    const { orderId } = req.body as { orderId: string };
    const { sub, role } = req.auth!;
    res.status(201).json({ data: await optimiseForOrder(orderId, sub, role) });
  },
);

// Ordered before /:id so "for-order" is never read as an id.
logisticsRouter.get<{ orderId: string }>("/for-order/:orderId", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await getShipmentForOrder(req.params.orderId, sub, role) });
});

logisticsRouter.get<{ id: string }>("/:id", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await getShipment(req.params.id, sub, role) });
});
