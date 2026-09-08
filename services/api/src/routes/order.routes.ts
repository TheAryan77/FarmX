import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth } from "../middleware/auth.js";
import { getOrder, listMyOrders } from "../services/order.service.js";

export const orderRouter: ExpressRouter = Router();

// Ordered before /:id so "mine" is never read as an id.
orderRouter.get("/mine", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await listMyOrders(sub, role) });
});

orderRouter.get<{ id: string }>("/:id", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await getOrder(req.params.id, sub, role) });
});
