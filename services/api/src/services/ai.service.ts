import type {
  DemandLevel,
  DemandSignal,
  PriceModelInfo,
  PricePrediction,
  PriceRecommendation,
} from "@fasalx/types";
import {
  ListingStatus as PrismaListingStatus,
  OrderStatus as PrismaOrderStatus,
  RequirementStatus as PrismaRequirementStatus,
} from "@prisma/client";

import { env } from "../env.js";
import { prisma } from "../lib/prisma.js";
import { toQuintals } from "../lib/serialize.js";
import { getLatestPrice } from "./market.service.js";

/**
 * CLAUDE.md: Node never runs ML. It calls the Python service over HTTP.
 *
 * This module owns three things the Python service deliberately does not:
 * the cache, the demand signal (marketplace data, not a model output), and the
 * degraded path when the AI service is down.
 */

/** Predictions move once a day at most, so a short cache costs nothing. */
const CACHE_TTL_MS = 15 * 60 * 1000;
const AI_TIMEOUT_MS = 4000;

/**
 * Unfilled buyer demand thresholds, in quintals. Pilot-scale heuristics, not
 * science — which is why the UI always shows the underlying quantity next to
 * the label.
 */
const DEMAND_HIGH_QUINTALS = 300;
const DEMAND_MODERATE_QUINTALS = 100;

/** Requirement states that still represent live demand. */
const LIVE_REQUIREMENT_STATUSES: PrismaRequirementStatus[] = [
  PrismaRequirementStatus.OPEN,
  PrismaRequirementStatus.MATCHING,
  PrismaRequirementStatus.PARTIALLY_FULFILLED,
];

interface CacheEntry {
  value: PricePrediction;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const cacheKey = (crop: string, district: string) => `${crop}::${district.toLowerCase()}`;

/** Shape of the Python service's POST /predict/price response. */
interface AiPriceResponse {
  crop: string;
  district: string;
  as_of: string;
  horizon_days: number;
  current: number;
  predicted_7d: number;
  low: number;
  high: number;
  delta_pct: number;
  confidence: number;
  recommendation: PriceRecommendation;
  model: {
    trained_at: string | null;
    data_source: string | null;
    mae: number | null;
    mape: number | null;
    naive_mae: number | null;
    skill_vs_naive: number | null;
    train_rows: number | null;
    test_rows: number | null;
    tolerance_pct: number | null;
  };
}

function toModelInfo(model: AiPriceResponse["model"]): PriceModelInfo {
  return {
    trainedAt: model.trained_at,
    dataSource: model.data_source,
    maeRupees: model.mae,
    mape: model.mape,
    naiveMaeRupees: model.naive_mae,
    skillVsNaive: model.skill_vs_naive,
    trainRows: model.train_rows,
    testRows: model.test_rows,
    tolerancePct: model.tolerance_pct,
  };
}

/**
 * How much buyer demand is genuinely unmet in this district.
 *
 * Unfilled quantity is the requirement total minus everything already
 * committed through order allocations — the same arithmetic the buyer
 * dashboard's fulfilment bar uses, so the two can never disagree.
 */
async function getDemandSignal(crop: string, district: string): Promise<DemandSignal> {
  const [requirements, listings] = await Promise.all([
    prisma.buyerRequirement.findMany({
      where: {
        crop,
        status: { in: LIVE_REQUIREMENT_STATUSES },
        buyer: { district: { equals: district, mode: "insensitive" } },
      },
      select: {
        id: true,
        quantityQuintals: true,
        orders: {
          where: { status: { not: PrismaOrderStatus.CANCELLED } },
          select: { allocations: { select: { allocatedQuintals: true } } },
        },
      },
    }),
    prisma.produceListing.findMany({
      where: {
        crop,
        deletedAt: null,
        status: {
          in: [PrismaListingStatus.ACTIVE, PrismaListingStatus.PARTIALLY_ALLOCATED],
        },
        district: { equals: district, mode: "insensitive" },
      },
      select: { quantityQuintals: true, reservedQuintals: true },
    }),
  ]);

  let unfilled = 0;
  for (const requirement of requirements) {
    const allocated = requirement.orders
      .flatMap((order) => order.allocations)
      .reduce((sum, allocation) => sum + toQuintals(allocation.allocatedQuintals), 0);
    unfilled += Math.max(toQuintals(requirement.quantityQuintals) - allocated, 0);
  }
  unfilled = Math.round(unfilled * 100) / 100;

  const availableSupply =
    Math.round(
      listings.reduce(
        (sum, l) => sum + (toQuintals(l.quantityQuintals) - toQuintals(l.reservedQuintals)),
        0,
      ) * 100,
    ) / 100;

  const level: DemandLevel =
    unfilled >= DEMAND_HIGH_QUINTALS
      ? "HIGH"
      : unfilled >= DEMAND_MODERATE_QUINTALS
        ? "MODERATE"
        : "LOW";

  return {
    level,
    unfilledQuintals: unfilled,
    openRequirements: requirements.length,
    availableSupplyQuintals: availableSupply,
  };
}

async function callAiService(crop: string, district: string): Promise<AiPriceResponse> {
  const response = await fetch(`${env.AI_SERVICE_URL}/predict/price`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ crop, district }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI service returned ${response.status}: ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as AiPriceResponse;
}

/**
 * Price outlook for the farmer home screen.
 *
 * Never throws for an AI failure: if the model is unreachable or untrained,
 * the latest mandi reading is returned with `source: "fallback"` and no
 * forecast, and the UI says so. A farmer losing today's rate because a Python
 * process is down would be a worse outcome than a missing prediction.
 */
export async function getPriceOutlook(crop: string, district: string): Promise<PricePrediction> {
  const key = cacheKey(crop, district);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    // Demand comes from live marketplace data, so it is refreshed even on a
    // cache hit — a new requirement should show immediately.
    return { ...cached.value, demand: await getDemandSignal(crop, district) };
  }

  const demand = await getDemandSignal(crop, district);

  try {
    const ai = await callAiService(crop, district);
    const prediction: PricePrediction = {
      crop: ai.crop,
      district: ai.district,
      asOf: ai.as_of,
      horizonDays: ai.horizon_days,
      current: ai.current,
      predicted: ai.predicted_7d,
      low: ai.low,
      high: ai.high,
      deltaPct: ai.delta_pct,
      confidence: ai.confidence,
      recommendation: ai.recommendation,
      demand,
      model: toModelInfo(ai.model),
      source: "model",
    };
    cache.set(key, { value: prediction, expiresAt: Date.now() + CACHE_TTL_MS });
    return prediction;
  } catch (err) {
    console.warn(
      `[ai] price prediction unavailable for ${crop}/${district}, using latest mandi row:`,
      err instanceof Error ? err.message : err,
    );

    const latest = await getLatestPrice(crop, district);
    return {
      crop: latest.crop,
      district: latest.district,
      asOf: latest.date,
      horizonDays: 7,
      current: latest.modalPricePerQuintal,
      // No forecast is available, so the prediction is stated as today's price
      // rather than invented. `source` tells the UI to hide the outlook.
      predicted: latest.modalPricePerQuintal,
      low: latest.minPricePerQuintal ?? latest.modalPricePerQuintal,
      high: latest.maxPricePerQuintal ?? latest.modalPricePerQuintal,
      deltaPct: 0,
      confidence: 0,
      recommendation: "SELL_PARTIAL",
      demand,
      model: null,
      source: "fallback",
    };
  }
}

/** Test seam — the 15-minute cache would otherwise outlive a retrain. */
export function clearPriceCache(): void {
  cache.clear();
}
