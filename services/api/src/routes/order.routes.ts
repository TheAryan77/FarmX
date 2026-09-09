import { aggregateOrderSchema } from "@fasalx/validation";
import type { AggregateOrderInput } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { createAggregatedOrder, getOrder, listMyOrders } from "../services/order.service.js";

export const orderRouter: ExpressRouter = Router();

// Ordered before /:id so "mine" is never read as an id.
orderRouter.get("/mine", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await listMyOrders(sub, role) });
});

/** Commits an aggregation: one order, many farmers. Ordered before /:id. */
orderRouter.post(
  "/aggregate",
  requireAuth,
  requireRole("BUYER"),
  validateBody(aggregateOrderSchema),
  async (req, res) => {
    const { requirementId, settledPricePerQuintal } = req.body as AggregateOrderInput;
    const order = await createAggregatedOrder(
      req.auth!.sub,
      requirementId,
      settledPricePerQuintal,
    );
    res.status(201).json({ data: order });
  },
);

orderRouter.get<{ id: string }>("/:id", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await getOrder(req.params.id, sub, role) });
});
