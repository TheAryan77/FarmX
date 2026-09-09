import { qualityCheckSchema, qualityRejectSchema } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { proofUpload } from "../lib/upload.js";
import { validateBody } from "../middleware/validate.js";
import {
  approveQuality,
  getProofPath,
  getQualityCheckForOrder,
  recordQualityCheck,
  rejectQuality,
} from "../services/quality.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const qualityRouter: ExpressRouter = Router();

/**
 * Records what arrived. Accepts multipart so a photo can come with it, which
 * means the body arrives as strings and the shared Zod schema coerces them.
 */
qualityRouter.post(
  "/",
  requireAuth,
  requireRole("BUYER"),
  proofUpload,
  validateBody(qualityCheckSchema),
  async (req, res) => {
    const proofPath = (req as { file?: { path: string } }).file?.path;
    res.status(201).json({
      data: await recordQualityCheck(req.auth!.sub, req.body, proofPath),
    });
  },
);

// Ordered before /:id so "for-order" is never read as an id.
qualityRouter.get<{ orderId: string }>("/for-order/:orderId", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await getQualityCheckForOrder(req.params.orderId, sub, role) });
});

qualityRouter.get<{ id: string }>("/:id/proof", requireAuth, async (req, res) => {
  const { sub, role } = req.auth!;
  const { path, filename } = await getProofPath(req.params.id, sub, role);
  res.sendFile(path, { headers: { "content-disposition": `inline; filename="${filename}"` } });
});

/** Approving releases the escrow and writes every farmer's payout. */
qualityRouter.post<{ id: string }>(
  "/:id/approve",
  requireAuth,
  requireRole("BUYER"),
  async (req, res) => {
    const { sub, role } = req.auth!;
    res.json({ data: await approveQuality(req.params.id, sub, role) });
  },
);

qualityRouter.post<{ id: string }>(
  "/:id/reject",
  requireAuth,
  requireRole("BUYER"),
  validateBody(qualityRejectSchema),
  async (req, res) => {
    const { sub, role } = req.auth!;
    const { reason } = req.body as { reason: string };
    res.json({ data: await rejectQuality(req.params.id, sub, role, reason) });
  },
);
