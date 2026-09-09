import type { Shipment, ShipmentStatus, StopStatus } from "@fasalx/types";
import {
  Prisma,
  ShipmentStatus as PrismaShipmentStatus,
  StopStatus as PrismaStopStatus,
} from "@prisma/client";

import { env } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { haversineKm } from "../lib/geo.js";
import { prisma } from "../lib/prisma.js";
import { toQuintals } from "../lib/serialize.js";
import { getOrder, orderInclude } from "./order.service.js";

/**
 * Pickup planning for aggregated orders.
 *
 * CLAUDE.md: Node never runs the optimisation. It gathers the pickup points
 * from Postgres, posts them to the Python service, and persists the resulting
 * plan as a Shipment with one ShipmentStop per farm.
 *
 * Session 11's settlement divides `optimisedCostRupees` across farmers by
 * their allocated quantity, so the figure stored here ends up in a farmer's
 * net payout — which is why the cost model is explicit rather than a guess.
 */

/** Compile-time guards against enum drift — see listing.service.ts. */
const _shipmentParity: Record<PrismaShipmentStatus, ShipmentStatus> = {
  PLANNED: "PLANNED",
  PICKUP_SCHEDULED: "PICKUP_SCHEDULED",
  IN_TRANSIT: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
};
const _stopParity: Record<PrismaStopStatus, StopStatus> = {
  PENDING: "PENDING",
  ARRIVED: "ARRIVED",
  LOADED: "LOADED",
  SKIPPED: "SKIPPED",
};
void _shipmentParity;
void _stopParity;

const OPTIMISE_TIMEOUT_MS = 15000;

/** Shape of the Python service's POST /optimize/route response. */
interface AiRouteResponse {
  destination: { lat: number; lng: number };
  stops: {
    sequence: number;
    vehicleNumber: number;
    id: string | null;
    lat: number;
    lng: number;
    quantityQuintals: number;
    legRoadKm: number;
  }[];
  trucks: { vehicleNumber: number; loadQuintals: number; roadKm: number; stopIds: (string | null)[] }[];
  vehicleClass: string;
  vehicleLabel: string;
  vehiclesUsed: number;
  capacityQuintals: number;
  rupeesPerKm: number;
  totalQuintals: number;
  straightLineKm: number;
  roadKm: number;
  costRupees: number;
  naiveSequential: { vehiclesUsed: number; roadKm: number; costRupees: number };
  separateTrips: { vehiclesUsed: number; roadKm: number; costRupees: number };
  savingRupees: number;
  savingPercent: number;
  sequencingSavingRupees: number;
  assumptions: { roadCircuityFactor: number; note: string; baseline: string };
}

const shipmentInclude = {
  stops: {
    include: {
      farmer: {
        select: { id: true, village: true, district: true, user: { select: { name: true } } },
      },
    },
    orderBy: { sequence: "asc" },
  },
  order: { select: { buyer: { select: { companyName: true, district: true } } } },
} satisfies Prisma.ShipmentInclude;

type ShipmentRow = Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>;

/**
 * Vehicle labels and rates live in the Python service, which is authoritative.
 * These are only used to render a stored shipment, where re-asking the
 * optimiser would be wasteful — and the key is stored, so they cannot diverge
 * silently for a class that exists.
 */
const VEHICLE_LABELS: Record<string, { label: string; rupeesPerKm: number }> = {
  tractor_trolley: { label: "Tractor trolley", rupeesPerKm: 28 },
  lcv: { label: "Light commercial vehicle", rupeesPerKm: 38 },
  truck_6w: { label: "6-wheel truck", rupeesPerKm: 52 },
  multi_axle: { label: "Multi-axle truck", rupeesPerKm: 70 },
};

const ROAD_CIRCUITY_FACTOR = 1.35;

function toShipment(row: ShipmentRow): Shipment {
  const vehicle = VEHICLE_LABELS[row.vehicleClass];
  const totalDistanceKm = Number(row.totalDistanceKm);
  const naiveCost = row.naiveCostRupees;
  const saving = naiveCost - row.optimisedCostRupees;

  const stops = row.stops.map((stop) => ({
    id: stop.id,
    sequence: stop.sequence,
    vehicleNumber: stop.vehicleNumber,
    farmer: {
      id: stop.farmer.id,
      name: stop.farmer.user.name,
      village: stop.farmer.village,
      district: stop.farmer.district,
    },
    lat: stop.lat,
    lng: stop.lng,
    quantityQuintals: toQuintals(stop.quantityQuintals),
    legDistanceKm: Number(stop.legDistanceKm),
    status: stop.status,
    arrivedAt: stop.arrivedAt?.toISOString() ?? null,
    loadedAt: stop.loadedAt?.toISOString() ?? null,
  }));

  // Regrouped per vehicle so each truck's route can be drawn as its own line.
  //
  // Stop legs only cover the inbound hops; each truck also drives its final
  // load back to the buyer. Without that return leg the per-truck figures
  // would not sum to the plan total, which is the first thing anyone checking
  // the numbers would notice.
  const byVehicle = new Map<number, { load: number; km: number; sequences: number[] }>();
  for (const stop of stops) {
    const entry = byVehicle.get(stop.vehicleNumber) ?? { load: 0, km: 0, sequences: [] };
    entry.load += stop.quantityQuintals;
    entry.km += stop.legDistanceKm;
    entry.sequences.push(stop.sequence);
    byVehicle.set(stop.vehicleNumber, entry);
  }

  for (const [vehicleNumber, entry] of byVehicle) {
    const last = stops.filter((stop) => stop.vehicleNumber === vehicleNumber).at(-1);
    if (!last) continue;
    entry.km +=
      haversineKm(last.lat, last.lng, row.destinationLat, row.destinationLng) *
      ROAD_CIRCUITY_FACTOR;
  }

  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,

    vehicleClass: row.vehicleClass,
    vehicleLabel: vehicle?.label ?? row.vehicleClass,
    vehicleCount: row.vehicleCount,
    capacityQuintals: toQuintals(row.capacityQuintals),
    rupeesPerKm: vehicle?.rupeesPerKm ?? null,

    totalDistanceKm,
    straightLineKm: Math.round((totalDistanceKm / ROAD_CIRCUITY_FACTOR) * 100) / 100,
    totalQuintals: Math.round(stops.reduce((sum, s) => sum + s.quantityQuintals, 0) * 100) / 100,

    optimisedCostRupees: row.optimisedCostRupees,
    naiveCostRupees: naiveCost,
    naiveDistanceKm: Number(row.naiveDistanceKm),
    sequencingCostRupees: row.sequencingCostRupees,

    savingRupees: saving,
    savingPercent: naiveCost > 0 ? Math.round((saving / naiveCost) * 1000) / 10 : 0,

    destinationLat: row.destinationLat,
    destinationLng: row.destinationLng,
    destinationLabel: `${row.order.buyer.companyName}, ${row.order.buyer.district}`,

    stops,
    vehicles: [...byVehicle.entries()]
      .sort(([a], [b]) => a - b)
      .map(([vehicleNumber, entry]) => ({
        vehicleNumber,
        loadQuintals: Math.round(entry.load * 100) / 100,
        roadKm: Math.round(entry.km * 100) / 100,
        stopSequences: entry.sequences,
      })),

    assumptions: {
      roadCircuityFactor: ROAD_CIRCUITY_FACTOR,
      note:
        "Distances are great-circle multiplied by a road-circuity factor, not " +
        "routed road distances. ₹/km rates are illustrative pilot figures.",
      baseline:
        "Saving is measured against one round trip per farm — collection " +
        "without aggregation, which is what FasalX replaces.",
    },

    createdAt: row.createdAt.toISOString(),
  };
}

async function callOptimiser(
  destination: { lat: number; lng: number },
  pickups: { id: string; lat: number; lng: number; quantityQuintals: number }[],
): Promise<AiRouteResponse> {
  let response: Response;
  try {
    response = await fetch(`${env.AI_SERVICE_URL}/optimize/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination, pickups }),
      signal: AbortSignal.timeout(OPTIMISE_TIMEOUT_MS),
    });
  } catch {
    // Like matching, there is no honest degraded form: a route Node invented
    // would not be the optimiser's route, and its cost feeds a farmer's payout.
    throw new HttpError(
      503,
      "OPTIMISER_UNAVAILABLE",
      "The route optimiser is not reachable. Start it with `pnpm ai:dev` and try again.",
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      502,
      "OPTIMISER_FAILED",
      `The optimiser could not plan this route (${response.status}). ${detail.slice(0, 160)}`,
    );
  }

  return (await response.json()) as AiRouteResponse;
}

/**
 * Plans the pickup route for an order and stores it.
 *
 * Re-planning replaces the previous plan: the allocation may have changed, and
 * two live shipments for one order would leave the settlement unable to say
 * which cost to divide.
 */
export async function optimiseForOrder(
  orderId: string,
  userId: string,
  role: string,
): Promise<Shipment> {
  // Reuses the order's party check.
  await getOrder(orderId, userId, role);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { ...orderInclude, buyer: true, shipment: true },
  });
  if (!order) {
    throw HttpError.notFound("ORDER_NOT_FOUND", "That order no longer exists");
  }
  if (order.allocations.length === 0) {
    throw new HttpError(409, "NO_ALLOCATIONS", "This order has no farmers to collect from");
  }
  if (order.shipment && order.shipment.status !== PrismaShipmentStatus.PLANNED) {
    throw new HttpError(
      409,
      "SHIPMENT_IN_PROGRESS",
      "This shipment is already under way and cannot be replanned",
    );
  }

  const pickups = await Promise.all(
    order.allocations.map(async (allocation) => {
      const listing = await prisma.produceListing.findUniqueOrThrow({
        where: { id: allocation.listingId },
        select: { lat: true, lng: true },
      });
      return {
        id: allocation.id,
        farmerId: allocation.farmerId,
        lat: listing.lat,
        lng: listing.lng,
        quantityQuintals: toQuintals(allocation.allocatedQuintals),
      };
    }),
  );

  const destination = { lat: order.buyer.lat, lng: order.buyer.lng };
  const plan = await callOptimiser(
    destination,
    pickups.map(({ id, lat, lng, quantityQuintals }) => ({ id, lat, lng, quantityQuintals })),
  );

  const byAllocation = new Map(pickups.map((pickup) => [pickup.id, pickup]));

  const shipmentId = await prisma.$transaction(async (tx) => {
    if (order.shipment) {
      // Stops cascade with the shipment, so the old plan leaves nothing behind.
      await tx.shipment.delete({ where: { id: order.shipment.id } });
    }

    const shipment = await tx.shipment.create({
      data: {
        orderId: order.id,
        status: PrismaShipmentStatus.PLANNED,
        vehicleClass: plan.vehicleClass,
        vehicleCount: plan.vehiclesUsed,
        capacityQuintals: new Prisma.Decimal(plan.capacityQuintals),
        totalDistanceKm: new Prisma.Decimal(plan.roadKm),
        naiveDistanceKm: new Prisma.Decimal(plan.separateTrips.roadKm),
        optimisedCostRupees: plan.costRupees,
        naiveCostRupees: plan.separateTrips.costRupees,
        sequencingCostRupees: plan.naiveSequential.costRupees,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
      },
    });

    for (const stop of plan.stops) {
      const pickup = stop.id === null ? undefined : byAllocation.get(stop.id);
      if (!pickup) continue;

      await tx.shipmentStop.create({
        data: {
          shipmentId: shipment.id,
          farmerId: pickup.farmerId,
          allocationId: pickup.id,
          sequence: stop.sequence,
          vehicleNumber: stop.vehicleNumber,
          lat: stop.lat,
          lng: stop.lng,
          quantityQuintals: new Prisma.Decimal(stop.quantityQuintals),
          legDistanceKm: new Prisma.Decimal(stop.legRoadKm),
          status: PrismaStopStatus.PENDING,
        },
      });
    }

    return shipment.id;
  });

  return getShipment(shipmentId, userId, role);
}

export async function getShipment(
  shipmentId: string,
  userId: string,
  role: string,
): Promise<Shipment> {
  const row = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: shipmentInclude,
  });
  if (!row) {
    throw HttpError.notFound("SHIPMENT_NOT_FOUND", "That shipment no longer exists");
  }

  await getOrder(row.orderId, userId, role);
  return toShipment(row);
}

export async function getShipmentForOrder(
  orderId: string,
  userId: string,
  role: string,
): Promise<Shipment | null> {
  const row = await prisma.shipment.findUnique({
    where: { orderId },
    include: shipmentInclude,
  });
  if (!row) return null;

  await getOrder(orderId, userId, role);
  return toShipment(row);
}
