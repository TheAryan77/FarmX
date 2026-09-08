import { priceQuerySchema } from "@fasalx/validation";
import type { PriceQueryInput } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { validateQuery, validatedQuery } from "../middleware/validate.js";
import { getLatestPrice } from "../services/market.service.js";

/**
 * Raw market data, no model involved. The farmer home screen reads this until
 * session 7 puts `GET /ai/price` in front of it.
 */
export const marketRouter: ExpressRouter = Router();

marketRouter.get("/price", validateQuery(priceQuerySchema), async (_req, res) => {
  const { crop, district } = validatedQuery<PriceQueryInput>(res);
  res.json({ data: await getLatestPrice(crop, district) });
});
