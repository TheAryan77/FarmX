import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { kycStatusSchema } from "@fasalx/validation";

import {
  getAdminOverview,
  getOrderDetail,
  listFarmers,
  listListings,
  listOrders,
  refundOrder,
  resettleOrder,
  setFarmerKyc,
} from "../services/admin.service.js";
import { validateBody } from "../middleware/validate.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const adminRouter: ExpressRouter = Router();

// Every route here is ADMIN-only, so the guard is applied once rather than
// repeated per route where one could be forgotten.
adminRouter.use(requireAuth, requireRole("ADMIN"));

/** Everything the operations dashboard renders, in one round trip. */
adminRouter.get("/overview", async (_req, res) => {
  res.json({ data: await getAdminOverview() });
});

/** Writes the payouts a released order should already have. Idempotent. */
adminRouter.post<{ orderId: string }>("/orders/:orderId/resettle", async (req, res) => {
  res.json({ data: await resettleOrder(req.params.orderId) });
});

/** Refunds the buyer on a disputed order. */
adminRouter.post<{ orderId: string }>("/orders/:orderId/refund", async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await refundOrder(req.params.orderId, sub, role) });
});

// ------------------------------------------------------------- directories

adminRouter.get("/orders", async (_req, res) => {
  res.json({ data: await listOrders() });
});

adminRouter.get<{ id: string }>("/orders/:id", async (req, res) => {
  res.json({ data: await getOrderDetail(req.params.id) });
});

adminRouter.get("/farmers", async (_req, res) => {
  res.json({ data: await listFarmers() });
});

adminRouter.get("/listings", async (_req, res) => {
  res.json({ data: await listListings() });
});

/** The one field on a farmer an operator may change. */
adminRouter.patch<{ id: string }>(
  "/farmers/:id/kyc",
  validateBody(kycStatusSchema),
  async (req, res) => {
    const { status } = req.body as { status: "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED" };
    res.json({ data: await setFarmerKyc(req.params.id, status) });
  },
);
