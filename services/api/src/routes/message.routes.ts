import { sendMessageSchema } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { listThreads, markRead, sendMessage } from "../services/message.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const messageRouter: ExpressRouter = Router();

// Buyers and farmers only — nobody else is a party to a trade.
messageRouter.use(requireAuth, requireRole("BUYER", "FARMER"));

/** Threads on one order, with the counterpart's contact details. */
messageRouter.get<{ orderId: string }>("/for-order/:orderId", async (req, res) => {
  const { sub, role } = req.auth!;
  res.json({ data: await listThreads(req.params.orderId, sub, role) });
});

messageRouter.post("/", validateBody(sendMessageSchema), async (req, res) => {
  const { sub, role } = req.auth!;
  const body = req.body as { orderId: string; farmerId?: string; body: string };
  res.status(201).json({ data: await sendMessage(sub, role, body) });
});

messageRouter.post<{ orderId: string; farmerId: string }>(
  "/for-order/:orderId/:farmerId/read",
  async (req, res) => {
    const { sub, role } = req.auth!;
    res.json({ data: await markRead(req.params.orderId, req.params.farmerId, sub, role) });
  },
);
