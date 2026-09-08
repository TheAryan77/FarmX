import type { Grade, Listing, ListingPage, ListingStatus } from "@fasalx/types";
import type { CreateListingInput, ListingFilterInput, UpdateListingInput } from "@fasalx/validation";
import {
  Grade as PrismaGrade,
  ListingStatus as PrismaListingStatus,
  Prisma,
} from "@prisma/client";

import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { fromIsoDate, toIsoDate, toQuintals, toRupees } from "../lib/serialize.js";

/**
 * Compile-time guards against enum drift between the Prisma schema and the
 * wire types in @fasalx/types. Adding a value to one without the other stops
 * typechecking rather than failing at runtime in a client.
 */
const _gradeParity: Record<PrismaGrade, Grade> = { A: "A", B: "B", C: "C" };
const _statusParity: Record<PrismaListingStatus, ListingStatus> = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  RESERVED: "RESERVED",
  PARTIALLY_ALLOCATED: "PARTIALLY_ALLOCATED",
  SOLD: "SOLD",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
};
void _gradeParity;
void _statusParity;

/** Statuses a buyer should see when browsing without an explicit filter. */
const BROWSABLE: PrismaListingStatus[] = [
  PrismaListingStatus.ACTIVE,
  PrismaListingStatus.PARTIALLY_ALLOCATED,
];

/** A listing may only be edited while nothing is committed against it. */
const EDITABLE: PrismaListingStatus[] = [
  PrismaListingStatus.DRAFT,
  PrismaListingStatus.ACTIVE,
];

const listingInclude = {
  farmer: {
    select: {
      id: true,
      village: true,
      district: true,
      rating: true,
      completedOrders: true,
      user: { select: { name: true } },
    },
  },
} satisfies Prisma.ProduceListingInclude;

type ListingRow = Prisma.ProduceListingGetPayload<{ include: typeof listingInclude }>;

function toListing(row: ListingRow): Listing {
  const quantity = toQuintals(row.quantityQuintals);
  const reserved = toQuintals(row.reservedQuintals);
  const available = Math.round((quantity - reserved) * 100) / 100;

  return {
    id: row.id,
    crop: row.crop,
    grade: row.grade,

    quantityQuintals: quantity,
    reservedQuintals: reserved,
    availableQuintals: available,

    expectedPricePerQuintal: row.expectedPricePerQuintal,
    totalValueRupees: toRupees(available * row.expectedPricePerQuintal),

    availableFrom: toIsoDate(row.availableFrom),

    village: row.village,
    district: row.district,
    state: row.state,
    lat: row.lat,
    lng: row.lng,

    status: row.status,
    notes: row.notes,

    farmer: {
      id: row.farmer.id,
      name: row.farmer.user.name,
      village: row.farmer.village,
      district: row.farmer.district,
      rating: Number(row.farmer.rating),
      completedOrders: row.farmer.completedOrders,
    },

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Resolves the FarmerProfile behind a JWT's user id. The token carries only
 * the user id and role, so anything farmer-scoped goes through here.
 */
export async function requireFarmerProfile(userId: string): Promise<{
  id: string;
  village: string;
  district: string;
  state: string;
  lat: number;
  lng: number;
}> {
  const farmer = await prisma.farmerProfile.findUnique({
    where: { userId },
    select: { id: true, village: true, district: true, state: true, lat: true, lng: true },
  });

  if (!farmer) {
    throw HttpError.forbidden("This account has no farmer profile");
  }
  return farmer;
}

export async function createListing(
  userId: string,
  input: CreateListingInput,
): Promise<Listing> {
  const farmer = await requireFarmerProfile(userId);

  const row = await prisma.produceListing.create({
    data: {
      farmerId: farmer.id,
      crop: input.crop,
      grade: input.grade,
      quantityQuintals: new Prisma.Decimal(input.quantityQuintals),
      expectedPricePerQuintal: input.expectedPricePerQuintal,
      availableFrom: fromIsoDate(input.availableFrom),
      // The pickup point defaults to the farmer's own location; the app does
      // not ask, it prefills.
      village: input.village ?? farmer.village,
      district: farmer.district,
      state: farmer.state,
      lat: input.lat ?? farmer.lat,
      lng: input.lng ?? farmer.lng,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      status: PrismaListingStatus.ACTIVE,
    },
    include: listingInclude,
  });

  return toListing(row);
}

export async function listMine(userId: string): Promise<Listing[]> {
  const farmer = await requireFarmerProfile(userId);

  const rows = await prisma.produceListing.findMany({
    where: { farmerId: farmer.id, deletedAt: null },
    include: listingInclude,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toListing);
}

export async function listPublic(filter: ListingFilterInput): Promise<ListingPage> {
  const where: Prisma.ProduceListingWhereInput = {
    deletedAt: null,
    // An explicit status filter wins; otherwise show only what can be bought.
    status: filter.status ?? { in: BROWSABLE },
    ...(filter.crop === undefined ? {} : { crop: filter.crop }),
    ...(filter.grade === undefined ? {} : { grade: filter.grade }),
    ...(filter.district === undefined
      ? {}
      : { district: { equals: filter.district, mode: "insensitive" } }),
    ...(filter.minQuantityQuintals === undefined
      ? {}
      : { quantityQuintals: { gte: new Prisma.Decimal(filter.minQuantityQuintals) } }),
  };

  const [rows, total] = await Promise.all([
    prisma.produceListing.findMany({
      where,
      include: listingInclude,
      orderBy: [{ createdAt: "desc" }],
      take: filter.limit,
      skip: filter.offset,
    }),
    prisma.produceListing.count({ where }),
  ]);

  return {
    listings: rows.map(toListing),
    total,
    limit: filter.limit,
    offset: filter.offset,
  };
}

export async function getListing(id: string): Promise<Listing> {
  const row = await prisma.produceListing.findFirst({
    where: { id, deletedAt: null },
    include: listingInclude,
  });

  if (!row) {
    throw HttpError.notFound("LISTING_NOT_FOUND", "That listing no longer exists");
  }
  return toListing(row);
}

/** Loads a listing and asserts the caller owns it. */
async function loadOwned(id: string, userId: string): Promise<ListingRow> {
  const farmer = await requireFarmerProfile(userId);

  const row = await prisma.produceListing.findFirst({
    where: { id, deletedAt: null },
    include: listingInclude,
  });

  if (!row) {
    throw HttpError.notFound("LISTING_NOT_FOUND", "That listing no longer exists");
  }
  if (row.farmerId !== farmer.id) {
    throw HttpError.forbidden("You can only change your own listings");
  }
  return row;
}

export async function updateListing(
  id: string,
  userId: string,
  input: UpdateListingInput,
): Promise<Listing> {
  const existing = await loadOwned(id, userId);

  // Produce already committed to a deal must not have its price or quantity
  // changed underneath the buyer.
  if (!EDITABLE.includes(existing.status)) {
    throw new HttpError(
      409,
      "LISTING_NOT_EDITABLE",
      `This listing is ${existing.status.toLowerCase().replace(/_/g, " ")} and can no longer be edited`,
    );
  }

  const reserved = toQuintals(existing.reservedQuintals);
  if (input.quantityQuintals !== undefined && input.quantityQuintals < reserved) {
    throw new HttpError(
      409,
      "QUANTITY_BELOW_RESERVED",
      `${reserved}Q is already committed — the listing cannot go below that`,
    );
  }

  const row = await prisma.produceListing.update({
    where: { id },
    data: {
      ...(input.crop === undefined ? {} : { crop: input.crop }),
      ...(input.grade === undefined ? {} : { grade: input.grade }),
      ...(input.quantityQuintals === undefined
        ? {}
        : { quantityQuintals: new Prisma.Decimal(input.quantityQuintals) }),
      ...(input.expectedPricePerQuintal === undefined
        ? {}
        : { expectedPricePerQuintal: input.expectedPricePerQuintal }),
      ...(input.availableFrom === undefined
        ? {}
        : { availableFrom: fromIsoDate(input.availableFrom) }),
      ...(input.village === undefined ? {} : { village: input.village }),
      ...(input.lat === undefined ? {} : { lat: input.lat }),
      ...(input.lng === undefined ? {} : { lng: input.lng }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    },
    include: listingInclude,
  });

  return toListing(row);
}

/**
 * Soft delete. The row stays so that any order, contract or settlement that
 * referenced it keeps its history — nothing in the audit trail may dangle.
 */
export async function softDeleteListing(id: string, userId: string): Promise<{ id: string }> {
  const existing = await loadOwned(id, userId);

  if (toQuintals(existing.reservedQuintals) > 0) {
    throw new HttpError(
      409,
      "LISTING_HAS_COMMITMENTS",
      "Some of this produce is already committed to a deal, so it cannot be removed",
    );
  }

  await prisma.produceListing.update({
    where: { id },
    data: { deletedAt: new Date(), status: PrismaListingStatus.CANCELLED },
  });

  return { id };
}
