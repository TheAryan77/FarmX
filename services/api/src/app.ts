import cors from "cors";
import express, { type Express } from "express";

import { env } from "./env.js";

/**
 * CLAUDE.md: every route returns `{ data: T }` or `{ error: { code, message } }`.
 * Route handlers stay thin — logic lives in service modules.
 */
export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ data: { status: "ok", ts: new Date().toISOString() } });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  return app;
}
