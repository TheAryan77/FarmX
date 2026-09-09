import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { proofUpload } from "../lib/upload.js";
import {
  getShipment,
  getShipmentForOrder,
  optimiseForOrder,
} from "../services/logistics.service.js";
import { confirmDelivery, confirmPickup } from "../services/quality.service.js";

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


/**
 * Pickup confirmation. A farmer confirms their own stop by passing its id; a
 * driver or the buyer confirms the whole run by omitting it. The shipment only
 * advances once every stop is loaded.
 */
logisticsRouter.post<{ id: string }>("/:id/pickup-confirm", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  const { stopId } = (req.body ?? {}) as { stopId?: string };
  const result = await confirmPickup(req.params.id, sub, role, stopId);
  res.json({ data: { ...result, shipment: await getShipment(req.params.id, sub, role) } });
});

/** Delivery, optionally with a proof photo. */
logisticsRouter.post<{ id: string }>(
  "/:id/deliver",
  requireAuth,
  proofUpload,
  async (req, res) => {
    const { sub, role } = req.auth!;
    const proofPath = (req as { file?: { path: string } }).file?.path;
    await confirmDelivery(req.params.id, sub, role, proofPath);
    res.json({ data: await getShipment(req.params.id, sub, role) });
  },
);
