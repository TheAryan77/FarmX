import type { Order, OrderStatus } from "@fasalx/types";
import {
  ListingStatus as PrismaListingStatus,
  OrderStatus as PrismaOrderStatus,
  Prisma,
  RequirementStatus as PrismaRequirementStatus,
} from "@prisma/client";

import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { fromIsoDate, toIsoDate, toQuintals, toRupees } from "../lib/serialize.js";
import { requireFarmerProfile } from "./listing.service.js";
import { proposeAggregation } from "./matching.service.js";
import { requireBuyerProfile } from "./requirement.service.js";

/** Compile-time guard against enum drift — see listing.service.ts. */
const _statusParity: Record<PrismaOrderStatus, OrderStatus> = {
  CREATED: "CREATED",
  CONTRACTED: "CONTRACTED",
  FUNDED: "FUNDED",
  IN_TRANSIT: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  QC_PASSED: "QC_PASSED",
  SETTLED: "SETTLED",
  DISPUTED: "DISPUTED",
  CANCELLED: "CANCELLED",
};
void _statusParity;

/** Order numbers start here so the very first demo order reads as FSL1024. */
const ORDER_NO_BASE = 1023;

export const orderInclude = {
  buyer: { select: { id: true, companyName: true, district: true } },
  allocations: {
    include: {
      farmer: {
        select: { id: true, village: true, district: true, user: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    orderNo: row.orderNo,
    crop: row.crop,
    grade: row.grade,

    totalQuintals: toQuintals(row.totalQuintals),
    settledPricePerQuintal: row.settledPricePerQuintal,
    grossAmountRupees: row.grossAmountRupees,

    deliveryBy: toIsoDate(row.deliveryBy),
    status: row.status,
    isAggregated: row.isAggregated,

    buyer: {
      id: row.buyer.id,
      companyName: row.buyer.companyName,
      district: row.buyer.district,
    },
    requirementId: row.requirementId,
    sourceOfferId: row.sourceOfferId,

    allocations: row.allocations.map((a) => ({
      id: a.id,
      listingId: a.listingId,
      farmer: {
        id: a.farmer.id,
        name: a.farmer.user.name,
        village: a.farmer.village,
        district: a.farmer.district,
      },
      allocatedQuintals: toQuintals(a.allocatedQuintals),
      pricePerQuintal: a.pricePerQuintal,
      grossAmountRupees: a.grossAmountRupees,
      matchScore: a.matchScore === null ? null : Number(a.matchScore),
      matchRank: a.matchRank,
      distanceKm: a.distanceKm === null ? null : Number(a.distanceKm),
    })),

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Next human-readable order number.
 *
 * Must run inside the accepting transaction: counting outside it would let two
 * simultaneous accepts read the same count and mint the same number, which the
 * unique index would then reject.
 */
export async function nextOrderNo(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.order.count();
  return `FSL${ORDER_NO_BASE + count + 1}`;
}

/**
 * Commits produce on a listing to an order.
 *
 * Re-reads the listing inside the transaction rather than trusting a value
 * read earlier: two buyers accepting against the same lot at the same time
 * must not both succeed, and only the row read under the transaction can say
 * what is actually still free.
 */
export async function reserveListingQuantity(
  tx: Prisma.TransactionClient,
  listingId: string,
  quantityQuintals: number,
): Promise<void> {
  const listing = await tx.produceListing.findFirst({
    where: { id: listingId, deletedAt: null },
    select: { quantityQuintals: true, reservedQuintals: true, status: true },
  });

  if (!listing) {
    throw HttpError.notFound("LISTING_NOT_FOUND", "That listing no longer exists");
  }

  const total = toQuintals(listing.quantityQuintals);
  const reserved = toQuintals(listing.reservedQuintals);
  const available = Math.round((total - reserved) * 100) / 100;

  if (quantityQuintals > available) {
    throw new HttpError(
      409,
      "INSUFFICIENT_QUANTITY",
      available <= 0
        ? "That produce has already been committed to another deal"
        : `Only ${available}Q is still available on this listing`,
    );
  }

  const nowReserved = Math.round((reserved + quantityQuintals) * 100) / 100;
  const fullyCommitted = nowReserved >= total;

  await tx.produceListing.update({
    where: { id: listingId },
    data: {
      reservedQuintals: new Prisma.Decimal(nowReserved),
      status: fullyCommitted
        ? PrismaListingStatus.RESERVED
        : PrismaListingStatus.PARTIALLY_ALLOCATED,
    },
  });
}

/** Orders the caller is a party to — as buyer, or as an allocated farmer. */
export async function listMyOrders(userId: string, role: string): Promise<Order[]> {
  const where: Prisma.OrderWhereInput =
    role === "BUYER"
      ? { buyerId: (await requireBuyerProfile(userId)).id }
      : { allocations: { some: { farmerId: (await requireFarmerProfile(userId)).id } } };

  const rows = await prisma.order.findMany({
    where,
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toOrder);
}

/**
 * A single order, readable only by its parties. A farmer sees the whole order
 * including the other farmers in an aggregated deal — they are co-suppliers on
 * the same contract, and the total is what the settlement screen divides.
 */
export async function getOrder(id: string, userId: string, role: string): Promise<Order> {
  const row = await prisma.order.findUnique({ where: { id }, include: orderInclude });

  if (!row) {
    throw HttpError.notFound("ORDER_NOT_FOUND", "That order no longer exists");
  }

  if (role === "BUYER") {
    const buyer = await requireBuyerProfile(userId);
    if (row.buyerId !== buyer.id) {
      throw HttpError.forbidden("You are not a party to this order");
    }
  } else if (role === "FARMER") {
    const farmer = await requireFarmerProfile(userId);
    if (!row.allocations.some((a) => a.farmerId === farmer.id)) {
      throw HttpError.forbidden("You are not a party to this order");
    }
  } else if (role !== "ADMIN") {
    throw HttpError.forbidden("You are not a party to this order");
  }

  return toOrder(row);
}

/** Whole rupees. Quantity is quintals, price is rupees per quintal. */
export function grossRupees(quantityQuintals: number, pricePerQuintal: number): number {
  return toRupees(quantityQuintals * pricePerQuintal);
}

/**
 * Turns an aggregation proposal into one order supplied by several farmers.
 *
 * The proposal is recomputed here rather than trusted from the client: between
 * the buyer seeing the panel and pressing the button, a farmer could have sold
 * elsewhere. Everything then happens in a single transaction — the order, one
 * allocation per farmer, and each listing's quantity committed — because a
 * partial failure would reserve produce against an order that does not exist.
 *
 * Every farmer is paid the same settled price. Where that exceeds their ask,
 * they receive more than they asked for, which is the point: aggregation is
 * supposed to move value toward the farmer, not extract it.
 */
export async function createAggregatedOrder(
  userId: string,
  requirementId: string,
  settledPricePerQuintal?: number,
): Promise<Order> {
  const buyer = await requireBuyerProfile(userId);
  const proposal = await proposeAggregation(requirementId);

  if (proposal.requirement.buyer.id !== buyer.id) {
    throw HttpError.forbidden("That requirement is not yours");
  }
  if (proposal.allocations.length === 0) {
    throw new HttpError(
      409,
      "NO_SUPPLY",
      "No farmer supply currently fits this requirement's constraints",
    );
  }

  const settled = settledPricePerQuintal ?? proposal.weightedAveragePriceRupees;
  const totalQuintals = proposal.totalQuintals;

  const orderId = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNo: await nextOrderNo(tx),
        buyerId: buyer.id,
        requirementId: proposal.requirement.id,
        crop: proposal.requirement.crop,
        grade: proposal.requirement.grade,
        totalQuintals: new Prisma.Decimal(totalQuintals),
        settledPricePerQuintal: settled,
        grossAmountRupees: grossRupees(totalQuintals, settled),
        deliveryBy: fromIsoDate(proposal.requirement.deliveryBy),
        status: PrismaOrderStatus.CREATED,
        isAggregated: true,
      },
    });

    for (const allocation of proposal.allocations) {
      // Re-reads each listing under the transaction; see reserveListingQuantity.
      await reserveListingQuantity(tx, allocation.listing.id, allocation.allocatedQuintals);

      await tx.orderAllocation.create({
        data: {
          orderId: order.id,
          farmerId: allocation.listing.farmer.id,
          listingId: allocation.listing.id,
          allocatedQuintals: new Prisma.Decimal(allocation.allocatedQuintals),
          pricePerQuintal: settled,
          grossAmountRupees: grossRupees(allocation.allocatedQuintals, settled),
          matchScore: new Prisma.Decimal(allocation.score),
          matchRank: allocation.rank,
          ...(allocation.listing.distanceKm === null
            ? {}
            : { distanceKm: new Prisma.Decimal(allocation.listing.distanceKm) }),
        },
      });
    }

    // Fully sourced or not decides whether the requirement stays open.
    const filled = totalQuintals >= proposal.requirement.remainingQuintals;
    await tx.buyerRequirement.update({
      where: { id: proposal.requirement.id },
      data: {
        status: filled
          ? PrismaRequirementStatus.FULFILLED
          : PrismaRequirementStatus.PARTIALLY_FULFILLED,
      },
    });

    return order.id;
  });

  const row = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: orderInclude,
  });
  return toOrder(row);
}
