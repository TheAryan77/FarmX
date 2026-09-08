import { requestOtpSchema, verifyOtpSchema } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { getCurrentUser, requestOtp, verifyOtp } from "../services/auth.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const authRouter: ExpressRouter = Router();

authRouter.post("/request-otp", validateBody(requestOtpSchema), async (req, res) => {
  const { phone } = req.body as { phone: string };
  res.json({ data: await requestOtp(phone) });
});

authRouter.post("/verify-otp", validateBody(verifyOtpSchema), async (req, res) => {
  const { phone, otp } = req.body as { phone: string; otp: string };
  res.json({ data: await verifyOtp(phone, otp) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ data: await getCurrentUser(req.auth!.sub) });
});
