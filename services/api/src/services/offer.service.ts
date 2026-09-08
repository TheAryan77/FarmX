import type { Offer, OfferParty, OfferStatus, OfferThread, Order } from "@fasalx/types";
import type { CounterOfferInput, CreateOfferInput } from "@fasalx/validation";
import {
  ListingStatus as PrismaListingStatus,
  OfferParty as PrismaOfferParty,
  OfferStatus as PrismaOfferStatus,
  OrderStatus as PrismaOrderStatus,
  Prisma,
  RequirementStatus as PrismaRequirementStatus,
} from "@prisma/client";

import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { fromIsoDate, toIsoDate, toQuintals, toRupees } from "../lib/serialize.js";
import { requireFarmerProfile } from "./listing.service.js";
import {
  grossRupees,
  nextOrderNo,
  orderInclude,
  reserveListingQuantity,
  toOrder,
} from "./order.service.js";
import { requireBuyerProfile } from "./requirement.service.js";

/** Compile-time guards against enum drift — see listing.service.ts. */
const _statusParity: Record<PrismaOfferStatus, OfferStatus> = {
  PENDING: "PENDING",
  COUNTERED: "COUNTERED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
};
const _partyParity: Record<PrismaOfferParty, OfferParty> = { BUYER: "BUYER", FARMER: "FARMER" };
void _statusParity;
void _partyParity;

/** How long a price stays on the table before it lapses. */
const OFFER_TTL_HOURS = 48;
/** Fallback delivery window when neither side named a date. */
const DEFAULT_DELIVERY_DAYS_AFTER_READY = 7;

const offerInclude = {
  listing: {
    select: {
      id: true,
      crop: true,
      grade: true,
      quantityQuintals: true,
      reservedQuintals: true,
      expectedPricePerQuintal: true,
      availableFrom: true,
      village: true,
      district: true,
      status: true,
      deletedAt: true,
    },
  },
  farmer: {
    select: {
      id: true,
      village: true,
      district: true,
      rating: true,
      user: { select: { name: true } },
    },
  },
  buyer: { select: { id: true, companyName: true, district: true } },
} satisfies Prisma.OfferInclude;

type OfferRow = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

function toOffer(row: OfferRow): Offer {
  const quantity = toQuintals(row.quantityQuintals);
  return {
    id: row.id,
    listingId: row.listingId,
    requirementId: row.requirementId,
    parentOfferId: row.parentOfferId,
    initiatedBy: row.initiatedBy,
    pricePerQuintal: row.pricePerQuintal,
    quantityQuintals: quantity,
    totalRupees: toRupees(quantity * row.pricePerQuintal),
    status: row.status,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Lapses offers whose expiry has passed.
 *
 * Done on read rather than by a scheduler: there is no job runner in this
 * stack, and an offer that is stale only matters at the moment somebody looks
 * at it or tries to act on it.
 */
async function expireStaleOffers(): Promise<void> {
  await prisma.offer.updateMany({
    where: { status: PrismaOfferStatus.PENDING, expiresAt: { lt: new Date() } },
    data: { status: PrismaOfferStatus.EXPIRED },
  });
}

/** The chain is built root-first, so the root is simply its head. */
function rootIdOf(chain: OfferRow[]): string {
  return chain[0]?.id ?? "";
}

/**
 * Assembles a thread from the caller's point of view, including what they are
 * allowed to do. The clients never re-derive the state machine.
 */
function toThread(
  chain: OfferRow[],
  viewer: { side: OfferParty | null },
  order: { id: string; orderNo: string } | null,
): OfferThread {
  const latest = chain[chain.length - 1]!;
  const listing = latest.listing;
  const available =
    Math.round((toQuintals(listing.quantityQuintals) - toQuintals(listing.reservedQuintals)) * 100) /
    100;

  // Only the side that did not make the current offer may act on it. That one
  // rule is what stops anyone accepting their own price.
  const isCounterparty =
    viewer.side !== null &&
    latest.status === PrismaOfferStatus.PENDING &&
    latest.initiatedBy !== viewer.side;

  const listingUsable = listing.deletedAt === null && listing.status !== PrismaListingStatus.SOLD;
  const enoughLeft = toQuintals(latest.quantityQuintals) <= available;

  return {
    rootId: rootIdOf(chain),
    latest: toOffer(latest),
    history: chain.map(toOffer),

    listing: {
      id: listing.id,
      crop: listing.crop,
      grade: listing.grade,
      availableQuintals: available,
      expectedPricePerQuintal: listing.expectedPricePerQuintal,
      village: listing.village,
      district: listing.district,
    },
    farmer: {
      id: latest.farmer.id,
      name: latest.farmer.user.name,
      village: latest.farmer.village,
      district: latest.farmer.district,
      rating: Number(latest.farmer.rating),
    },
    buyer: {
      id: latest.buyer.id,
      companyName: latest.buyer.companyName,
      district: latest.buyer.district,
    },

    awaitingYou: isCounterparty,
    canAccept: isCounterparty && listingUsable && enoughLeft,
    canCounter: isCounterparty && listingUsable,
    canReject: isCounterparty,

    orderId: order?.id ?? null,
    orderNo: order?.orderNo ?? null,
  };
}

/** Every offer in the same negotiation, oldest first. */
async function loadChain(offerId: string): Promise<OfferRow[]> {
  const target = await prisma.offer.findUnique({ where: { id: offerId }, include: offerInclude });
  if (!target) {
    throw HttpError.notFound("OFFER_NOT_FOUND", "That offer no longer exists");
  }

  // Threads are short (a handful of rounds), so walking parents one at a time
  // is cheaper and clearer than a recursive CTE.
  const backwards: OfferRow[] = [target];
  let cursor = target;
  while (cursor.parentOfferId !== null) {
    const parent = await prisma.offer.findUnique({
      where: { id: cursor.parentOfferId },
      include: offerInclude,
    });
    if (!parent) break;
    backwards.push(parent);
    cursor = parent;
  }

  const forwards: OfferRow[] = [];
  let head: OfferRow | null = target;
  while (head) {
    const child: OfferRow | null = await prisma.offer.findFirst({
      where: { parentOfferId: head.id },
      include: offerInclude,
      orderBy: { createdAt: "asc" },
    });
    if (!child) break;
    forwards.push(child);
    head = child;
  }

  return [...backwards.reverse(), ...forwards];
}

/** Which side of a negotiation this user sits on. */
async function viewerSide(
  userId: string,
  role: string,
): Promise<{ side: OfferParty | null; profileId: string | null }> {
  if (role === "BUYER") {
    const buyer = await requireBuyerProfile(userId);
    return { side: "BUYER", profileId: buyer.id };
  }
  if (role === "FARMER") {
    const farmer = await requireFarmerProfile(userId);
    return { side: "FARMER", profileId: farmer.id };
  }
  return { side: null, profileId: null };
}

function assertParty(chain: OfferRow[], profileId: string | null, side: OfferParty | null): void {
  const latest = chain[chain.length - 1]!;
  const isParty =
    (side === "BUYER" && latest.buyerId === profileId) ||
    (side === "FARMER" && latest.farmerId === profileId);
  if (!isParty) {
    throw HttpError.forbidden("You are not part of this negotiation");
  }
}

/** The order a thread produced, if it was accepted. */
async function orderForThread(chain: OfferRow[]): Promise<{ id: string; orderNo: string } | null> {
  const accepted = chain.find((o) => o.status === PrismaOfferStatus.ACCEPTED);
  if (!accepted) return null;
  return prisma.order.findUnique({
    where: { sourceOfferId: accepted.id },
    select: { id: true, orderNo: true },
  });
}

// ---------------------------------------------------------------- reads

export async function listMyOfferThreads(userId: string, role: string): Promise<OfferThread[]> {
  await expireStaleOffers();
  const { side, profileId } = await viewerSide(userId, role);

  const mine = await prisma.offer.findMany({
    where: side === "BUYER" ? { buyerId: profileId ?? "" } : { farmerId: profileId ?? "" },
    include: offerInclude,
    orderBy: { createdAt: "asc" },
  });

  // Group into threads by walking each offer back to its root, so a
  // multi-round negotiation appears once rather than once per counter.
  const byRoot = new Map<string, OfferRow[]>();
  const rootCache = new Map<string, string>();
  const byId = new Map(mine.map((o) => [o.id, o]));

  const findRoot = (offer: OfferRow): string => {
    const cached = rootCache.get(offer.id);
    if (cached) return cached;
    let cursor = offer;
    while (cursor.parentOfferId !== null) {
      const parent = byId.get(cursor.parentOfferId);
      if (!parent) break;
      cursor = parent;
    }
    rootCache.set(offer.id, cursor.id);
    return cursor.id;
  };

  for (const offer of mine) {
    const root = findRoot(offer);
    const bucket = byRoot.get(root) ?? [];
    bucket.push(offer);
    byRoot.set(root, bucket);
  }

  const threads = await Promise.all(
    [...byRoot.values()].map(async (chain) => {
      chain.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return toThread(chain, { side }, await orderForThread(chain));
    }),
  );

  // Anything waiting on the caller first, then newest.
  return threads.sort((a, b) => {
    if (a.awaitingYou !== b.awaitingYou) return a.awaitingYou ? -1 : 1;
    return b.latest.createdAt.localeCompare(a.latest.createdAt);
  });
}

export async function getOfferThread(
  offerId: string,
  userId: string,
  role: string,
): Promise<OfferThread> {
  await expireStaleOffers();
  const { side, profileId } = await viewerSide(userId, role);
  const chain = await loadChain(offerId);
  assertParty(chain, profileId, side);
  return toThread(chain, { side }, await orderForThread(chain));
}

// ---------------------------------------------------------------- writes

export async function createOffer(userId: string, input: CreateOfferInput): Promise<OfferThread> {
  const buyer = await requireBuyerProfile(userId);

  const listing = await prisma.produceListing.findFirst({
    where: { id: input.listingId, deletedAt: null },
    select: {
      id: true,
      farmerId: true,
      quantityQuintals: true,
      reservedQuintals: true,
      availableFrom: true,
      status: true,
    },
  });

  if (!listing) {
    throw HttpError.notFound("LISTING_NOT_FOUND", "That listing no longer exists");
  }
  if (
    listing.status !== PrismaListingStatus.ACTIVE &&
    listing.status !== PrismaListingStatus.PARTIALLY_ALLOCATED
  ) {
    throw new HttpError(409, "LISTING_UNAVAILABLE", "That produce is no longer open for offers");
  }

  const available =
    Math.round((toQuintals(listing.quantityQuintals) - toQuintals(listing.reservedQuintals)) * 100) /
    100;
  if (input.quantityQuintals > available) {
    throw new HttpError(
      409,
      "INSUFFICIENT_QUANTITY",
      `Only ${available}Q is available on this listing`,
    );
  }

  if (input.requirementId !== undefined) {
    const requirement = await prisma.buyerRequirement.findFirst({
      where: { id: input.requirementId, buyerId: buyer.id },
      select: { id: true },
    });
    if (!requirement) {
      throw HttpError.notFound("REQUIREMENT_NOT_FOUND", "That requirement is not yours");
    }
  }

  const created = await prisma.offer.create({
    data: {
      listingId: listing.id,
      ...(input.requirementId === undefined ? {} : { requirementId: input.requirementId }),
      buyerId: buyer.id,
      farmerId: listing.farmerId,
      initiatedBy: PrismaOfferParty.BUYER,
      pricePerQuintal: input.pricePerQuintal,
      quantityQuintals: new Prisma.Decimal(input.quantityQuintals),
      status: PrismaOfferStatus.PENDING,
      expiresAt: new Date(Date.now() + OFFER_TTL_HOURS * 3600 * 1000),
    },
    include: offerInclude,
  });

  return toThread([created], { side: "BUYER" }, null);
}

export async function counterOffer(
  offerId: string,
  userId: string,
  role: string,
  input: CounterOfferInput,
): Promise<OfferThread> {
  await expireStaleOffers();
  const { side, profileId } = await viewerSide(userId, role);
  const chain = await loadChain(offerId);
  assertParty(chain, profileId, side);

  const latest = chain[chain.length - 1]!;
  assertActionable(latest, side, "counter");

  const quantity = input.quantityQuintals ?? toQuintals(latest.quantityQuintals);
  const available =
    Math.round(
      (toQuintals(latest.listing.quantityQuintals) - toQuintals(latest.listing.reservedQuintals)) *
        100,
    ) / 100;
  if (quantity > available) {
    throw new HttpError(
      409,
      "INSUFFICIENT_QUANTITY",
      `Only ${available}Q is available on this listing`,
    );
  }

  // The old price comes off the table and the new one replaces it, in one
  // transaction — a thread must never show two live prices at once.
  const [, created] = await prisma.$transaction([
    prisma.offer.update({
      where: { id: latest.id },
      data: { status: PrismaOfferStatus.COUNTERED },
    }),
    prisma.offer.create({
      data: {
        listingId: latest.listingId,
        ...(latest.requirementId === null ? {} : { requirementId: latest.requirementId }),
        buyerId: latest.buyerId,
        farmerId: latest.farmerId,
        parentOfferId: latest.id,
        initiatedBy: side === "BUYER" ? PrismaOfferParty.BUYER : PrismaOfferParty.FARMER,
        pricePerQuintal: input.pricePerQuintal,
        quantityQuintals: new Prisma.Decimal(quantity),
        status: PrismaOfferStatus.PENDING,
        expiresAt: new Date(Date.now() + OFFER_TTL_HOURS * 3600 * 1000),
      },
      include: offerInclude,
    }),
  ]);

  // Re-read rather than splice: the parent row in `chain` still says PENDING
  // in memory, and a thread must never render two live prices.
  return toThread(await loadChain(created.id), { side }, null);
}

export async function rejectOffer(
  offerId: string,
  userId: string,
  role: string,
): Promise<OfferThread> {
  await expireStaleOffers();
  const { side, profileId } = await viewerSide(userId, role);
  const chain = await loadChain(offerId);
  assertParty(chain, profileId, side);

  const latest = chain[chain.length - 1]!;
  assertActionable(latest, side, "reject");

  const updated = await prisma.offer.update({
    where: { id: latest.id },
    data: { status: PrismaOfferStatus.REJECTED },
    include: offerInclude,
  });

  return toThread([...chain.slice(0, -1), updated], { side }, null);
}

/**
 * Accepting settles the price and turns the negotiation into an order.
 *
 * Everything here is one transaction: the offer moves to ACCEPTED, the order
 * and its single allocation are written, and the listing quantity is committed.
 * A partial failure would leave produce reserved against an order that does not
 * exist, or an order with nothing behind it.
 */
export async function acceptOffer(
  offerId: string,
  userId: string,
  role: string,
): Promise<{ thread: OfferThread; order: Order }> {
  await expireStaleOffers();
  const { side, profileId } = await viewerSide(userId, role);
  const chain = await loadChain(offerId);
  assertParty(chain, profileId, side);

  const latest = chain[chain.length - 1]!;
  assertActionable(latest, side, "accept");

  if (latest.listing.deletedAt !== null) {
    throw new HttpError(409, "LISTING_UNAVAILABLE", "That produce has been withdrawn");
  }

  const quantity = toQuintals(latest.quantityQuintals);
  const deliveryBy = await resolveDeliveryDate(latest);

  const orderId = await prisma.$transaction(async (tx) => {
    await tx.offer.update({
      where: { id: latest.id },
      data: { status: PrismaOfferStatus.ACCEPTED },
    });

    // Re-reads the listing under the transaction; see reserveListingQuantity.
    await reserveListingQuantity(tx, latest.listingId, quantity);

    const order = await tx.order.create({
      data: {
        orderNo: await nextOrderNo(tx),
        buyerId: latest.buyerId,
        ...(latest.requirementId === null ? {} : { requirementId: latest.requirementId }),
        sourceOfferId: latest.id,
        crop: latest.listing.crop,
        grade: latest.listing.grade,
        totalQuintals: new Prisma.Decimal(quantity),
        settledPricePerQuintal: latest.pricePerQuintal,
        grossAmountRupees: grossRupees(quantity, latest.pricePerQuintal),
        deliveryBy,
        status: PrismaOrderStatus.CREATED,
        isAggregated: false,
        allocations: {
          create: {
            farmerId: latest.farmerId,
            listingId: latest.listingId,
            allocatedQuintals: new Prisma.Decimal(quantity),
            pricePerQuintal: latest.pricePerQuintal,
            grossAmountRupees: grossRupees(quantity, latest.pricePerQuintal),
          },
        },
      },
    });

    if (latest.requirementId !== null) {
      await tx.buyerRequirement.update({
        where: { id: latest.requirementId },
        data: { status: PrismaRequirementStatus.PARTIALLY_FULFILLED },
      });
    }

    return order.id;
  });

  const [order, updatedChain] = await Promise.all([
    prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude }),
    loadChain(latest.id),
  ]);

  return {
    thread: toThread(updatedChain, { side }, { id: order.id, orderNo: order.orderNo }),
    order: toOrder(order),
  };
}

/**
 * Rejects any action that the state machine does not allow, with a message
 * that says which rule was broken rather than a bare 409.
 */
function assertActionable(offer: OfferRow, side: OfferParty | null, action: string): void {
  if (offer.status !== PrismaOfferStatus.PENDING) {
    const readable: Record<PrismaOfferStatus, string> = {
      PENDING: "still open",
      COUNTERED: "already been answered with a counter-offer",
      ACCEPTED: "already been accepted",
      REJECTED: "already been declined",
      EXPIRED: "expired",
    };
    throw new HttpError(
      409,
      "OFFER_NOT_PENDING",
      `You cannot ${action} this offer — it has ${readable[offer.status]}`,
    );
  }

  if (offer.initiatedBy === side) {
    throw new HttpError(
      409,
      "OWN_OFFER",
      `This is your own price — wait for the other side to respond, or withdraw it`,
    );
  }
}

/**
 * When the order must be delivered.
 *
 * The build plan's offer body carries no date, so it is derived: the buyer's
 * requirement deadline if the offer is against one, otherwise a week after the
 * produce is ready. Stated here rather than hidden in the order writer.
 */
async function resolveDeliveryDate(offer: OfferRow): Promise<Date> {
  if (offer.requirementId !== null) {
    const requirement = await prisma.buyerRequirement.findUnique({
      where: { id: offer.requirementId },
      select: { deliveryBy: true },
    });
    if (requirement) return requirement.deliveryBy;
  }

  const ready = offer.listing.availableFrom;
  const fallback = new Date(ready);
  fallback.setUTCDate(fallback.getUTCDate() + DEFAULT_DELIVERY_DAYS_AFTER_READY);
  return fromIsoDate(toIsoDate(fallback));
}
