import type { ChatAnswer, ChatLanguage } from "@fasalx/types";

import { env } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { toQuintals } from "../lib/serialize.js";
import { getPriceOutlook } from "./ai.service.js";
import { requireFarmerProfile } from "./listing.service.js";

/**
 * The assistant's context layer.
 *
 * CLAUDE.md keeps models out of Node: this module gathers the person's own
 * rows and hands them to the Python service, which is the only thing that
 * talks to Gemini. Nothing is looked up there, so one user's data can never
 * reach another's answer.
 *
 * What goes in `facts` is exactly what the assistant is permitted to say.
 * Scoping it here — by farmer profile, by buyer profile — is therefore both
 * the privacy boundary and the accuracy boundary, and it is why the prompt can
 * forbid every number that is not in this object.
 */

/** The assistant answers about the signed-in person only. */
const DEFAULT_CROP = "wheat";
const DEFAULT_DISTRICT = "Karnal";

async function farmerFacts(userId: string): Promise<Record<string, unknown>> {
  const farmer = await requireFarmerProfile(userId);

  const [listings, openOffers, allocations, settlement] = await Promise.all([
    prisma.produceListing.findMany({
      where: { farmerId: farmer.id, status: { in: ["ACTIVE", "PARTIALLY_ALLOCATED"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.offer.count({
      where: { listing: { farmerId: farmer.id }, status: "PENDING", initiatedBy: "BUYER" },
    }),
    prisma.orderAllocation.findMany({
      where: { farmerId: farmer.id },
      include: { order: { select: { orderNo: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    prisma.settlement.findFirst({
      where: { farmerId: farmer.id },
      include: { order: { select: { orderNo: true } }, allocation: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // The price outlook is the one fact not owned by this farmer, and it is the
  // same public figure their dashboard already shows.
  const outlook = await getPriceOutlook(DEFAULT_CROP, farmer.district ?? DEFAULT_DISTRICT).catch(
    () => null,
  );

  return {
    village: farmer.village,
    district: farmer.district,
    listings: listings.map((listing) => ({
      crop: listing.crop,
      grade: listing.grade,
      quantityQuintals: toQuintals(listing.quantityQuintals),
      availableQuintals: toQuintals(listing.quantityQuintals) - toQuintals(listing.reservedQuintals),
      expectedPricePerQuintal: listing.expectedPricePerQuintal,
      status: listing.status,
    })),
    openOffers,
    marketToday: outlook
      ? { district: outlook.district, modalPricePerQuintal: outlook.current }
      : null,
    forecast7d: outlook
      ? {
          horizonDays: outlook.horizonDays,
          predictedPricePerQuintal: outlook.predicted,
          recommendation: outlook.recommendation,
          confidence: outlook.confidence,
          demand: outlook.demand?.level ?? null,
        }
      : null,
    orders: allocations.map((allocation) => ({
      orderNo: allocation.order.orderNo,
      status: allocation.order.status,
      quintals: toQuintals(allocation.allocatedQuintals),
      pricePerQuintal: allocation.pricePerQuintal,
    })),
    latestPayout: settlement
      ? {
          orderNo: settlement.order.orderNo,
          quintals: toQuintals(settlement.allocation.allocatedQuintals),
          grossRupees: settlement.grossAmountRupees,
          transportShareRupees: settlement.logisticsShareRupees,
          platformFeeRupees: settlement.platformFeeRupees,
          netRupees: settlement.netAmountRupees,
          mandiEstimateRupees: settlement.traditionalEstimateRupees,
          gainRupees: settlement.farmerGainRupees,
        }
      : null,
  };
}

async function buyerFacts(userId: string): Promise<Record<string, unknown>> {
  const buyer = await prisma.buyerProfile.findUnique({ where: { userId } });
  if (!buyer) {
    throw HttpError.forbidden("This account has no buyer profile");
  }

  // The order the buyer is most likely asking about: the newest one that has
  // not finished, falling back to the newest of all.
  const order =
    (await prisma.order.findFirst({
      where: { buyerId: buyer.id, status: { notIn: ["SETTLED", "CANCELLED"] } },
      include: {
        shipment: { include: { _count: { select: { stops: true } } } },
        qualityCheck: true,
        _count: { select: { allocations: true, settlements: true } },
      },
      orderBy: { createdAt: "desc" },
    })) ??
    (await prisma.order.findFirst({
      where: { buyerId: buyer.id },
      include: {
        shipment: { include: { _count: { select: { stops: true } } } },
        qualityCheck: true,
        _count: { select: { allocations: true, settlements: true } },
      },
      orderBy: { createdAt: "desc" },
    }));

  const openRequirements = await prisma.buyerRequirement.count({
    where: { buyerId: buyer.id, status: { in: ["OPEN", "MATCHING", "PARTIALLY_FULFILLED"] } },
  });

  const shipment = order?.shipment ?? null;

  return {
    company: buyer.companyName,
    openRequirements,
    order: order
      ? {
          orderNo: order.orderNo,
          status: order.status,
          totalQuintals: toQuintals(order.totalQuintals),
          pricePerQuintal: order.settledPricePerQuintal,
          grossRupees: order.grossAmountRupees,
          farmers: order._count.allocations,
          farmersPaid: order._count.settlements,
          deliverBy: order.deliveryBy.toISOString().slice(0, 10),
        }
      : null,
    shipment: shipment
      ? {
          status: shipment.status,
          vehicleClass: shipment.vehicleClass,
          vehicleCount: shipment.vehicleCount,
          stops: shipment._count.stops,
          totalDistanceKm: toQuintals(shipment.totalDistanceKm),
          optimisedCostRupees: shipment.optimisedCostRupees,
          separateTripsCostRupees: shipment.naiveCostRupees,
        }
      : null,
    quality: order?.qualityCheck
      ? {
          status: order.qualityCheck.status,
          gradeFound: order.qualityCheck.gradeFound,
          moisturePercent:
            order.qualityCheck.moisturePct === null
              ? null
              : Number(order.qualityCheck.moisturePct),
        }
      : null,
  };
}

export async function ask(
  userId: string,
  role: string,
  question: string,
  language: ChatLanguage,
): Promise<ChatAnswer> {
  if (role !== "FARMER" && role !== "BUYER") {
    throw HttpError.forbidden("The assistant is available to farmers and buyers");
  }

  const facts = role === "FARMER" ? await farmerFacts(userId) : await buyerFacts(userId);

  let response: Response;
  try {
    response = await fetch(`${env.AI_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, language, question, facts }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new HttpError(
      503,
      "ASSISTANT_UNREACHABLE",
      "The assistant service is not running. Start it with `pnpm ai:dev`.",
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { answer?: string; language?: string; model?: string; offline?: boolean; detail?: string }
    | null;

  if (!response.ok || !body?.answer) {
    throw new HttpError(
      503,
      "ASSISTANT_UNAVAILABLE",
      body?.detail ?? "The assistant could not answer right now. Please try again.",
    );
  }

  return {
    answer: body.answer,
    language: (body.language as ChatLanguage) ?? language,
    // Surfaced so the UI can label a fallback answer honestly rather than
    // passing off a template as the assistant's own reasoning.
    offline: body.offline === true,
  };
}
