import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { getFarmerEarnings, getSettlementsForOrder } from "../services/settlement.service.js";

export const settlementRouter: ExpressRouter = Router();

/**
 * The farmer's own month-to-date earnings. Ordered before /:orderId so
 * "my-earnings" is never read as an order id.
 */
settlementRouter.get("/my-earnings", requireAuth, requireRole("FARMER"), async (req, res) => {
  res.json({ data: await getFarmerEarnings(req.auth!.sub) });
});

settlementRouter.get<{ orderId: string }>("/for-order/:orderId", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await getSettlementsForOrder(req.params.orderId, sub, role) });
});
