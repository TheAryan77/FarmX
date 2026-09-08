import type {
  Requirement,
  RequirementCandidates,
  RequirementStatus,
} from "@fasalx/types";
import type { CreateRequirementInput } from "@fasalx/validation";
import {
  ListingStatus as PrismaListingStatus,
  OrderStatus as PrismaOrderStatus,
  Prisma,
  RequirementStatus as PrismaRequirementStatus,
} from "@prisma/client";

import { HttpError } from "../lib/errors.js";
import { boundingBox, haversineKm, roundKm } from "../lib/geo.js";
import { prisma } from "../lib/prisma.js";
import { fromIsoDate, toIsoDate, toQuintals, toRupees } from "../lib/serialize.js";
import { listingInclude, toListing, type Origin } from "./listing.service.js";

/** Compile-time guard against enum drift — see listing.service.ts. */
const _statusParity: Record<PrismaRequirementStatus, RequirementStatus> = {
  OPEN: "OPEN",
  MATCHING: "MATCHING",
  PARTIALLY_FULFILLED: "PARTIALLY_FULFILLED",
  FULFILLED: "FULFILLED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
};
void _statusParity;

/** Orders that no longer count towards a requirement's fulfilment. */
const DEAD_ORDER_STATUSES: PrismaOrderStatus[] = [PrismaOrderStatus.CANCELLED];

const requirementInclude = {
  buyer: {
    select: { id: true, companyName: true, district: true, state: true, lat: true, lng: true },
  },
} satisfies Prisma.BuyerRequirementInclude;

type RequirementRow = Prisma.BuyerRequirementGetPayload<{ include: typeof requirementInclude }>;

function toRequirement(row: RequirementRow, allocatedQuintals: number): Requirement {
  const quantity = toQuintals(row.quantityQuintals);
  const allocated = Math.min(allocatedQuintals, quantity);
  const remaining = Math.round((quantity - allocated) * 100) / 100;

  return {
    id: row.id,
    crop: row.crop,
    grade: row.grade,

    quantityQuintals: quantity,
    targetPricePerQuintal: row.targetPricePerQuintal,
    maxDistanceKm: row.maxDistanceKm,
    minLotQuintals: row.minLotQuintals === null ? null : toQuintals(row.minLotQuintals),

    deliveryBy: toIsoDate(row.deliveryBy),
    status: row.status,
    notes: row.notes,

    buyer: {
      id: row.buyer.id,
      companyName: row.buyer.companyName,
      district: row.buyer.district,
      state: row.buyer.state,
      lat: row.buyer.lat,
      lng: row.buyer.lng,
    },

    allocatedQuintals: allocated,
    remainingQuintals: Math.max(remaining, 0),
    fulfilmentPercent: quantity === 0 ? 0 : Math.round((allocated / quantity) * 100),

    estimatedValueRupees: toRupees(quantity * row.targetPricePerQuintal),

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Resolves the BuyerProfile behind a JWT's user id, the way
 * requireFarmerProfile does for the farmer side.
 */
export async function requireBuyerProfile(userId: string): Promise<{
  id: string;
  companyName: string;
  district: string;
  state: string;
  lat: number;
  lng: number;
}> {
  const buyer = await prisma.buyerProfile.findUnique({
    where: { userId },
    select: { id: true, companyName: true, district: true, state: true, lat: true, lng: true },
  });

  if (!buyer) {
    throw HttpError.forbidden("This account has no buyer profile");
  }
  return buyer;
}

/**
 * How much has actually been committed against each requirement, summed from
 * order allocations. One grouped query rather than one per requirement, so the
 * dashboard's fulfilment bars cost a single round trip.
 */
async function allocatedByRequirement(requirementIds: string[]): Promise<Map<string, number>> {
  if (requirementIds.length === 0) return new Map();

  const rows = await prisma.orderAllocation.findMany({
    where: {
      order: {
        requirementId: { in: requirementIds },
        status: { notIn: DEAD_ORDER_STATUSES },
      },
    },
    select: { allocatedQuintals: true, order: { select: { requirementId: true } } },
  });

  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = row.order.requirementId;
    if (key === null) continue;
    totals.set(key, (totals.get(key) ?? 0) + toQuintals(row.allocatedQuintals));
  }
  return totals;
}

export async function createRequirement(
  userId: string,
  input: CreateRequirementInput,
): Promise<Requirement> {
  const buyer = await requireBuyerProfile(userId);

  const row = await prisma.buyerRequirement.create({
    data: {
      buyerId: buyer.id,
      crop: input.crop,
      grade: input.grade,
      quantityQuintals: new Prisma.Decimal(input.quantityQuintals),
      targetPricePerQuintal: input.targetPricePerQuintal,
      maxDistanceKm: input.maxDistanceKm,
      ...(input.minLotQuintals === undefined
        ? {}
        : { minLotQuintals: new Prisma.Decimal(input.minLotQuintals) }),
      deliveryBy: fromIsoDate(input.deliveryBy),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      status: PrismaRequirementStatus.OPEN,
    },
    include: requirementInclude,
  });

  return toRequirement(row, 0);
}

export async function listMyRequirements(userId: string): Promise<Requirement[]> {
  const buyer = await requireBuyerProfile(userId);

  const rows = await prisma.buyerRequirement.findMany({
    where: { buyerId: buyer.id },
    include: requirementInclude,
    orderBy: { createdAt: "desc" },
  });

  const allocated = await allocatedByRequirement(rows.map((r) => r.id));
  return rows.map((row) => toRequirement(row, allocated.get(row.id) ?? 0));
}

/**
 * Readable by any signed-in user, not just the owner: session 6 lets a farmer
 * see the requirement an offer relates to. Nothing here is sensitive — no
 * contact details, no bank references.
 */
export async function getRequirement(id: string): Promise<Requirement> {
  const row = await prisma.buyerRequirement.findUnique({
    where: { id },
    include: requirementInclude,
  });

  if (!row) {
    throw HttpError.notFound("REQUIREMENT_NOT_FOUND", "That requirement no longer exists");
  }

  const allocated = await allocatedByRequirement([row.id]);
  return toRequirement(row, allocated.get(row.id) ?? 0);
}

/**
 * Supply matching a requirement's own constraints: right crop, right grade,
 * inside the radius, and at or above the minimum lot size.
 *
 * Deliberately unranked — session 8 adds the weighted score and the greedy
 * aggregation. What this does add is a count of what was rejected and why, so
 * the buyer can see the engine is discarding supply for stated reasons rather
 * than silently returning a short list.
 */
export async function getRequirementCandidates(id: string): Promise<RequirementCandidates> {
  const requirement = await getRequirement(id);
  const origin: Origin = { lat: requirement.buyer.lat, lng: requirement.buyer.lng };
  const box = boundingBox(origin.lat, origin.lng, requirement.maxDistanceKm);

  // Everything of the right crop that is still buyable. Grade and radius are
  // evaluated here rather than in SQL so the rejections can be counted.
  const rows = await prisma.produceListing.findMany({
    where: {
      deletedAt: null,
      crop: requirement.crop,
      status: { in: [PrismaListingStatus.ACTIVE, PrismaListingStatus.PARTIALLY_ALLOCATED] },
    },
    include: listingInclude,
  });

  const minLot = requirement.minLotQuintals ?? 0;
  const excluded = { wrongGrade: 0, tooFar: 0, belowMinLot: 0 };
  const candidates = [];

  for (const row of rows) {
    if (row.grade !== requirement.grade) {
      excluded.wrongGrade += 1;
      continue;
    }

    const withinBox =
      row.lat >= box.minLat &&
      row.lat <= box.maxLat &&
      row.lng >= box.minLng &&
      row.lng <= box.maxLng;
    const distanceKm = roundKm(haversineKm(origin.lat, origin.lng, row.lat, row.lng));
    if (!withinBox || distanceKm > requirement.maxDistanceKm) {
      excluded.tooFar += 1;
      continue;
    }

    const listing = toListing(row, origin);
    if (listing.availableQuintals < minLot) {
      excluded.belowMinLot += 1;
      continue;
    }

    candidates.push(listing);
  }

  // Nearest first. Session 8 replaces this with the weighted match score.
  candidates.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

  const totalAvailableQuintals =
    Math.round(candidates.reduce((sum, c) => sum + c.availableQuintals, 0) * 100) / 100;

  return {
    requirement,
    candidates,
    totalAvailableQuintals,
    satisfiable: totalAvailableQuintals >= requirement.remainingQuintals,
    excluded,
  };
}
