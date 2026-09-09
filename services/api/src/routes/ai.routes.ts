import { priceQuerySchema } from "@fasalx/validation";
import type { PriceQueryInput } from "@fasalx/validation";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { validateQuery, validatedQuery } from "../middleware/validate.js";
import { getPriceOutlook } from "../services/ai.service.js";

/**
 * Proxies the Python AI service. Sits in front of `GET /market/price`, which
 * remains available as the raw un-modelled reading.
 */
export const aiRouter: ExpressRouter = Router();

aiRouter.get("/price", validateQuery(priceQuerySchema), async (_req, res) => {
  const { crop, district } = validatedQuery<PriceQueryInput>(res);
  res.json({ data: await getPriceOutlook(crop, district) });
});
