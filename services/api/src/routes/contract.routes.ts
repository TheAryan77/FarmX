import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  createContract,
  getContract,
  getContractForOrder,
  getContractPdfPath,
  transitionContract,
} from "../services/contract.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const contractRouter: ExpressRouter = Router();

const createContractSchema = z.object({
  orderId: z.string({ error: "Choose an order" }).min(1, "Choose an order"),
});

const disputeSchema = z.object({
  // The `error` option covers a missing value too, so an omitted reason gets a
  // human sentence rather than "expected string, received undefined".
  reason: z
    .string({ error: "Say what is wrong with the delivery" })
    .trim()
    .min(3, "Say what is wrong with the delivery")
    .max(200, "Keep the reason under 200 characters"),
});

/** Only a buyer creates a contract — it is their order and their escrow. */
contractRouter.post(
  "/",
  requireAuth,
  requireRole("BUYER"),
  validateBody(createContractSchema),
  async (req, res) => {
    const { orderId } = req.body as { orderId: string };
    res.status(201).json({ data: await createContract(req.auth!.sub, orderId) });
  },
);

// Ordered before /:id so "for-order" is never read as an id.
contractRouter.get<{ orderId: string }>("/for-order/:orderId", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await getContractForOrder(req.params.orderId, sub, role) });
});

contractRouter.get<{ id: string }>("/:id", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await getContract(req.params.id, sub, role) });
});

/** The agreed document itself. Both parties may download it. */
contractRouter.get<{ id: string }>("/:id/pdf", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  const { path, filename } = await getContractPdfPath(req.params.id, sub, role);
  res.type("application/pdf").sendFile(path, { headers: { "content-disposition": `inline; filename="${filename}"` } });
});

/**
 * One route per escrow transition. The service enforces the state machine and
 * who is allowed to sign; the contract enforces it again on-chain.
 */
for (const action of ["accept", "fund", "pickup", "deliver", "approve-quality", "release"] as const) {
  contractRouter.post<{ id: string }>(`/:id/${action}`, requireAuth, async (req, res) => {
    const { sub, role } = req.auth!;
    res.json({ data: await transitionContract(req.params.id, sub, role, action) });
  });
}

contractRouter.post<{ id: string }>(
  "/:id/dispute",
  requireAuth,
  validateBody(disputeSchema),
  async (req, res) => {
    const { sub, role } = req.auth!;
    const { reason } = req.body as { reason: string };
    res.json({ data: await transitionContract(req.params.id, sub, role, "dispute", reason) });
  },
);

contractRouter.post<{ id: string }>(
  "/:id/refund",
  requireAuth,
  requireRole("BUYER", "ADMIN"),
  async (req, res) => {
    const { sub, role } = req.auth!;
    res.json({ data: await transitionContract(req.params.id, sub, role, "refund") });
  },
);
