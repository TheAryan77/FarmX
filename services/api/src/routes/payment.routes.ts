import { confirmPaymentSchema, failPaymentSchema } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { RAZORPAY_MAX_RUPEES } from "../lib/razorpay.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  confirmPayment,
  createPaymentIntent,
  markPaymentFailed,
  paymentsConfigured,
} from "../services/payment.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const paymentRouter: ExpressRouter = Router();

// Funding is the buyer's act — it is their money and their escrow.
paymentRouter.use(requireAuth, requireRole("BUYER"));

/**
 * Whether checkout can be offered, and the limits in force.
 *
 * The UI used to hardcode the ceiling and the advance rate, which meant
 * tuning them in .env silently made the button lie about what it would
 * charge. They travel with the answer instead.
 */
paymentRouter.get("/status", (_req, res) => {
  res.json({
    data: {
      configured: paymentsConfigured(),
      maxSinglePaymentRupees: RAZORPAY_MAX_RUPEES,
    },
  });
});

/** Opens a funding attempt and returns what checkout needs. */
paymentRouter.post<{ contractId: string }>("/:contractId/intent", async (req, res) => {
  res.status(201).json({ data: await createPaymentIntent(req.params.contractId, req.auth!.sub) });
});

/** Verifies the callback and, only then, locks the escrow on chain. */
paymentRouter.post<{ contractId: string }>(
  "/:contractId/confirm",
  validateBody(confirmPaymentSchema),
  async (req, res) => {
    const { sub, role } = req.auth!;
    const body = req.body as {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      signature: string;
    };
    res.json({ data: await confirmPayment(req.params.contractId, sub, role, body) });
  },
);

/** Records an abandoned checkout rather than leaving a silent gap. */
paymentRouter.post<{ contractId: string }>(
  "/:contractId/failed",
  validateBody(failPaymentSchema),
  async (req, res) => {
    const { razorpayOrderId, reason } = req.body as { razorpayOrderId: string; reason: string };
    res.json({
      data: await markPaymentFailed(req.params.contractId, req.auth!.sub, razorpayOrderId, reason),
    });
  },
);
