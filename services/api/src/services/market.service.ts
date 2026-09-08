import type { PriceSnapshot } from "@fasalx/types";

import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { toIsoDate, toRupees } from "../lib/serialize.js";

const COMPARISON_WINDOW_DAYS = 7;

/**
 * Latest mandi price straight out of PriceHistory — no model involved.
 *
 * This is what the farmer home screen shows until session 7 puts a real
 * prediction in front of it. Kept in its own service so that session replaces
 * the caller, not this.
 */
export async function getLatestPrice(crop: string, district: string): Promise<PriceSnapshot> {
  const latest = await prisma.priceHistory.findFirst({
    where: { crop, district },
    orderBy: { date: "desc" },
  });

  if (!latest) {
    throw HttpError.notFound(
      "PRICE_UNAVAILABLE",
      `No price history for ${crop} in ${district}. Run \`pnpm db:seed\`.`,
    );
  }

  const priorDate = new Date(latest.date);
  priorDate.setUTCDate(priorDate.getUTCDate() - COMPARISON_WINDOW_DAYS);

  const prior = await prisma.priceHistory.findFirst({
    where: { crop, district, date: { lte: priorDate } },
    orderBy: { date: "desc" },
  });

  return {
    crop: latest.crop,
    district: latest.district,
    date: toIsoDate(latest.date),
    modalPricePerQuintal: latest.modalPricePerQuintal,
    minPricePerQuintal: latest.minPricePerQuintal,
    maxPricePerQuintal: latest.maxPricePerQuintal,
    changeVs7dRupees: prior
      ? toRupees(latest.modalPricePerQuintal - prior.modalPricePerQuintal)
      : null,
    source: latest.source,
  };
}
