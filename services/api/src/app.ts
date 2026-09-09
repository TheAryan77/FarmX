import cors from "cors";
import express, { type Express } from "express";

import { env } from "./env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { aiRouter } from "./routes/ai.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { contractRouter } from "./routes/contract.routes.js";
import { listingRouter } from "./routes/listing.routes.js";
import { marketRouter } from "./routes/market.routes.js";
import { matchingRouter } from "./routes/matching.routes.js";
import { offerRouter } from "./routes/offer.routes.js";
import { orderRouter } from "./routes/order.routes.js";
import { requirementRouter } from "./routes/requirement.routes.js";

/**
 * CLAUDE.md: every route returns `{ data: T }` or `{ error: { code, message } }`.
 * Route handlers stay thin — logic lives in service modules.
 *
 * Express 5 forwards rejected promises from async handlers to the error
 * middleware, so services can just throw HttpError.
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ data: { status: "ok", ts: new Date().toISOString() } });
  });

  app.use("/auth", authRouter);
  app.use("/ai", aiRouter);
  app.use("/contracts", contractRouter);
  app.use("/listings", listingRouter);
  app.use("/market", marketRouter);
  app.use("/matching", matchingRouter);
  app.use("/requirements", requirementRouter);
  app.use("/offers", offerRouter);
  app.use("/orders", orderRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
