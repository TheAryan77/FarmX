import type { ChatAnswer, ChatLanguage } from "@fasalx/types";

import { env } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { toQuintals } from "../lib/serialize.js";
import { getPriceOutlook } from "./ai.service.js";
import { requireFarmerProfile } from "./listing.service.js";
import { listMyRequirements } from "./requirement.service.js";

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

  const [listings, pendingOffers, allocations, settlement] = await Promise.all([
    prisma.produceListing.findMany({
      where: { farmerId: farmer.id, status: { in: ["ACTIVE", "PARTIALLY_ALLOCATED"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.offer.findMany({
      where: { listing: { farmerId: farmer.id }, status: "PENDING", initiatedBy: "BUYER" },
      include: { buyer: { select: { companyName: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
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
    openOffers: pendingOffers.length,
    offers: pendingOffers.map((offer) => ({
      from: offer.buyer.companyName,
      pricePerQuintal: offer.pricePerQuintal,
      quantityQuintals: toQuintals(offer.quantityQuintals),
      expiresAt: offer.expiresAt?.toISOString() ?? null,
    })),
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

  // Requirements in full, not a count. A count told the assistant that
  // something had changed without telling it what, so a buyer who had just
  // posted a requirement got an answer that made no mention of it.
  //
  // Read through the requirement service rather than the table: fulfilment is
  // summed from order allocations there, and CLAUDE.md is explicit that there
  // is no parallel business logic.
  const allRequirements = await listMyRequirements(userId);
  const requirements = allRequirements
    .filter((requirement) =>
      ["OPEN", "MATCHING", "PARTIALLY_FULFILLED"].includes(requirement.status),
    )
    .slice(0, 5);

  // Every order still in flight, so a buyer running several at once is not
  // answered about only one of them.
  const activeOrders = await prisma.order.findMany({
    where: { buyerId: buyer.id, status: { notIn: ["SETTLED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const shipment = order?.shipment ?? null;

  return {
    company: buyer.companyName,
    requirements: requirements.map((requirement) => ({
      crop: requirement.crop,
      grade: requirement.grade,
      quantityQuintals: requirement.quantityQuintals,
      committedQuintals: requirement.allocatedQuintals,
      remainingQuintals: requirement.remainingQuintals,
      fulfilmentPercent: requirement.fulfilmentPercent,
      targetPricePerQuintal: requirement.targetPricePerQuintal,
      maxDistanceKm: requirement.maxDistanceKm,
      deliveryBy: requirement.deliveryBy,
      status: requirement.status,
    })),
    activeOrders: activeOrders.map((row) => ({
      orderNo: row.orderNo,
      status: row.status,
      quintals: toQuintals(row.totalQuintals),
      pricePerQuintal: row.settledPricePerQuintal,
    })),
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
