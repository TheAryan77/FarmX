import { chatAskSchema } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { ask } from "../services/chat.service.js";

// CLAUDE.md: route handlers stay thin, logic lives in service modules.
export const chatRouter: ExpressRouter = Router();

/**
 * One question, answered from the signed-in person's own rows.
 *
 * FARMER and BUYER only — an admin has the operations console, and giving the
 * assistant a role whose data spans every user would mean building a context
 * that is not scoped to one person.
 */
chatRouter.post(
  "/",
  requireAuth,
  requireRole("FARMER", "BUYER"),
  validateBody(chatAskSchema),
  async (req, res) => {
    const { sub, role } = req.auth!;
    const { question, language } = req.body as { question: string; language: "en" | "hi" };
    res.json({ data: await ask(sub, role, question, language) });
  },
);
