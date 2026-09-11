import type {
  AdminAlert,
  AdminChain,
  AdminFarmerRow,
  AdminImpact,
  AdminListingRow,
  AdminLogistics,
  AdminNetwork,
  AdminOrderDetail,
  AdminOrderRow,
  AdminOverview,
  AdminPipelineRow,
  AdminServiceHealth,
  ContractStatus,
  Grade,
  KycStatus,
  ListingStatus,
  OrderStatus,
} from "@fasalx/types";

import { getChain } from "../lib/chain.js";
import { HttpError } from "../lib/errors.js";
import { env } from "../env.js";
import { prisma } from "../lib/prisma.js";
import { toQuintals } from "../lib/serialize.js";
import { transitionContract } from "./contract.service.js";
import { ASSUMPTIONS, writeSettlements } from "./settlement.service.js";

/**
 * Platform-level view for operations.
 *
 * Two rules shape this module:
 *
 * 1. **Nothing is stored.** Every figure is derived at read time from orders,
 *    settlements and shipments. A cached "total farmer earnings" column would
 *    be one more thing that can silently disagree with the settlements it
 *    claims to summarise.
 *
 * 2. **It checks the data against itself.** The alerts below are not read from
 *    a status column — they compare what a row claims against what the rows
 *    beneath it say. An order marked SETTLED while no farmer was paid is
 *    precisely the failure a status column cannot report, and it is the one
 *    failure that matters most here: CLAUDE.md's north star is value reaching
 *    the farmer, so money that stopped short is the first thing an operator
 *    should see.
 */

/** How long a health probe may take before it is called unreachable. */
const PROBE_TIMEOUT_MS = 2_000;

export async function getAdminOverview(): Promise<AdminOverview> {
  // Independent reads, so they go together rather than in sequence.
  const [
    settlements,
    orders,
    farmers,
    buyers,
    fpos,
    listings,
    requirements,
    shipments,
    contracts,
    degradedEvents,
    escrows,
  ] = await Promise.all([
    prisma.settlement.findMany({
      select: {
        orderId: true,
        farmerId: true,
        grossAmountRupees: true,
        netAmountRupees: true,
        logisticsShareRupees: true,
        platformFeeRupees: true,
        traditionalEstimateRupees: true,
        farmerGainRupees: true,
        allocation: { select: { allocatedQuintals: true } },
      },
    }),
    prisma.order.findMany({
      include: {
        buyer: { select: { companyName: true } },
        _count: { select: { allocations: true, settlements: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.farmerProfile.count(),
    prisma.buyerProfile.count(),
    prisma.fpoProfile.count(),
    prisma.produceListing.findMany({
      where: { status: "ACTIVE" },
      select: { quantityQuintals: true },
    }),
    prisma.buyerRequirement.findMany({
      where: { status: { in: ["OPEN", "MATCHING", "PARTIALLY_FULFILLED"] } },
      select: { quantityQuintals: true },
    }),
    prisma.shipment.findMany({
      select: {
        vehicleCount: true,
        optimisedCostRupees: true,
        naiveCostRupees: true,
      },
    }),
    prisma.contract.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.contractEvent.count({ where: { degraded: true } }),
    prisma.escrow.findMany({ select: { status: true, amountRupees: true } }),
  ]);

  // ------------------------------------------------------------------ impact

  // Counted from settlements rather than from the order's status column, so
  // every figure in this block comes from the same source. An order whose
  // status claims SETTLED but that paid nobody is not trade that happened —
  // it is the alert below.
  const settledOrderIds = new Set(settlements.map((row) => row.orderId));

  const grossValue = settlements.reduce((sum, row) => sum + row.grossAmountRupees, 0);
  const paidToFarmers = settlements.reduce((sum, row) => sum + row.netAmountRupees, 0);
  const traditionalTotal = settlements.reduce(
    (sum, row) => sum + row.traditionalEstimateRupees,
    0,
  );
  const extraVsTraditional = settlements.reduce((sum, row) => sum + row.farmerGainRupees, 0);

  const impact: AdminImpact = {
    settledOrders: settledOrderIds.size,
    quintalsTraded:
      Math.round(
        settlements.reduce((sum, row) => sum + toQuintals(row.allocation.allocatedQuintals), 0) *
          100,
      ) / 100,
    grossValueRupees: grossValue,
    paidToFarmersRupees: paidToFarmers,
    logisticsCostRupees: settlements.reduce((sum, row) => sum + row.logisticsShareRupees, 0),
    platformFeeRupees: settlements.reduce((sum, row) => sum + row.platformFeeRupees, 0),
    extraVsTraditionalRupees: extraVsTraditional,
    // Weighted by value rather than averaging per-farmer percentages, which
    // would let a tiny lot count as much as a 150Q one.
    averageGainPercent:
      traditionalTotal > 0 ? Math.round((extraVsTraditional / traditionalTotal) * 10000) / 10000 : 0,
    farmerSharePercent:
      grossValue > 0 ? Math.round((paidToFarmers / grossValue) * 10000) / 10000 : 0,
    farmersPaid: new Set(settlements.map((row) => row.farmerId)).size,
  };

  // ----------------------------------------------------------------- network

  const network: AdminNetwork = {
    farmers,
    buyers,
    fpos,
    activeListings: listings.length,
    listedQuintals:
      Math.round(listings.reduce((sum, row) => sum + toQuintals(row.quantityQuintals), 0) * 100) /
      100,
    openRequirements: requirements.length,
    requiredQuintals:
      Math.round(
        requirements.reduce((sum, row) => sum + toQuintals(row.quantityQuintals), 0) * 100,
      ) / 100,
  };

  // ---------------------------------------------------------------- pipeline

  const pipelineMap = new Map<OrderStatus, AdminPipelineRow>();
  for (const order of orders) {
    const status = order.status as OrderStatus;
    const row = pipelineMap.get(status) ?? { status, orders: 0, quintals: 0, valueRupees: 0 };
    row.orders += 1;
    row.quintals += toQuintals(order.totalQuintals);
    row.valueRupees += order.grossAmountRupees;
    pipelineMap.set(status, row);
  }
  const pipeline = [...pipelineMap.values()]
    .map((row) => ({ ...row, quintals: Math.round(row.quintals * 100) / 100 }))
    .sort((a, b) => b.orders - a.orders);

  // --------------------------------------------------------------- logistics

  const optimisedCost = shipments.reduce((sum, row) => sum + row.optimisedCostRupees, 0);
  const baselineCost = shipments.reduce((sum, row) => sum + row.naiveCostRupees, 0);
  const logistics: AdminLogistics = {
    shipments: shipments.length,
    vehiclesDispatched: shipments.reduce((sum, row) => sum + row.vehicleCount, 0),
    optimisedCostRupees: optimisedCost,
    baselineCostRupees: baselineCost,
    savedRupees: baselineCost - optimisedCost,
    savedPercent:
      baselineCost > 0
        ? Math.round(((baselineCost - optimisedCost) / baselineCost) * 10000) / 10000
        : 0,
  };

  // ------------------------------------------------------------------- chain

  const chain: AdminChain = {
    configured: getChain() !== null,
    contracts: contracts
      .map((row) => ({ status: row.status as ContractStatus, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    degradedEvents,
    escrowLockedRupees: escrows
      .filter((row) => row.status === "LOCKED")
      .reduce((sum, row) => sum + row.amountRupees, 0),
  };

  // ------------------------------------------------------------ recent orders

  const recentOrders: AdminOrderRow[] = orders.slice(0, 12).map((order) => ({
    id: order.id,
    orderNo: order.orderNo,
    status: order.status as OrderStatus,
    buyerName: order.buyer.companyName,
    quintals: toQuintals(order.totalQuintals),
    pricePerQuintal: order.settledPricePerQuintal,
    grossRupees: order.grossAmountRupees,
    farmers: order._count.allocations,
    settlements: order._count.settlements,
    createdAt: order.createdAt.toISOString(),
  }));

  // ------------------------------------------------------------------ alerts

  const alerts: AdminAlert[] = [];

  for (const order of orders) {
    // The one that matters: the order claims the money moved, but no farmer
    // has a payout row to show for it.
    if (order.status === "SETTLED" && order._count.settlements === 0) {
      alerts.push({
        severity: "critical",
        code: "SETTLED_WITHOUT_PAYOUT",
        title: `${order.orderNo} is settled but nobody was paid`,
        detail:
          `The order is marked SETTLED with ${order._count.allocations} ` +
          `allocation(s) and no settlement records, so the farmer's earnings ` +
          `screen will show nothing for it. The escrow was most likely ` +
          `released through the contract panel rather than by approving the ` +
          `quality check.`,
        orderId: order.id,
        orderNo: order.orderNo,
      });
    }

    if (
      order.status === "SETTLED" &&
      order._count.settlements > 0 &&
      order._count.settlements !== order._count.allocations
    ) {
      alerts.push({
        severity: "critical",
        code: "PARTIAL_PAYOUT",
        title: `${order.orderNo} paid ${order._count.settlements} of ${order._count.allocations} farmers`,
        detail: "Some farmers on this order have no settlement record.",
        orderId: order.id,
        orderNo: order.orderNo,
      });
    }

    if (order.status === "DISPUTED") {
      alerts.push({
        severity: "warning",
        code: "ORDER_DISPUTED",
        title: `${order.orderNo} is in dispute`,
        detail: "Funds stay locked until the dispute is refunded or resolved.",
        orderId: order.id,
        orderNo: order.orderNo,
      });
    }
  }

  if (degradedEvents > 0) {
    alerts.push({
      severity: "warning",
      code: "CHAIN_DEGRADED",
      title: `${degradedEvents} escrow transition${degradedEvents === 1 ? "" : "s"} recorded off-chain`,
      detail:
        "The chain was unreachable or refused the write, so these were logged " +
        "locally and the contract status did not advance.",
    });
  }

  if (!chain.configured) {
    alerts.push({
      severity: "warning",
      code: "CHAIN_UNCONFIGURED",
      title: "No escrow contract configured",
      detail:
        "ESCROW_CONTRACT_ADDRESS is empty — run `pnpm chain` and `pnpm chain:deploy`. " +
        "The marketplace works without it; only escrow is unavailable.",
    });
  }

  alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

  return {
    generatedAt: new Date().toISOString(),
    impact,
    network,
    pipeline,
    logistics,
    chain,
    alerts,
    recentOrders,
    services: await probeServices(),
    assumptions: ASSUMPTIONS,
  };
}

/**
 * Liveness of the things this platform depends on.
 *
 * Probed rather than assumed, because "the AI service is down" is the single
 * most likely reason a demo stalls, and an operator should be able to see that
 * on one screen instead of inferring it from a blank price card.
 */
async function probeServices(): Promise<AdminServiceHealth[]> {
  const chain = getChain();

  const [database, ai, rpc] = await Promise.all([
    probe(async () => {
      await prisma.$queryRaw`SELECT 1`;
      return "Connected";
    }),
    probe(async () => {
      const response = await fetch(`${env.AI_SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { model_trained?: boolean };
      return body.model_trained === true
        ? "Reachable, price model trained"
        : "Reachable, but no trained model — run `pnpm ai:train`";
    }),
    probe(async () => {
      if (chain === null) throw new Error("Not configured");
      const block = await chain.publicClient.getBlockNumber();
      return `Block ${block}`;
    }),
  ]);

  return [
    { name: "PostgreSQL", target: "source of truth", ...database },
    { name: "AI service", target: env.AI_SERVICE_URL, ...ai },
    { name: "Chain RPC", target: env.CHAIN_RPC_URL, ...rpc },
  ];
}

async function probe(run: () => Promise<string>): Promise<{ ok: boolean; detail: string }> {
  try {
    return { ok: true, detail: await run() };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Unreachable" };
  }
}

// ------------------------------------------------------------------ repairs

export interface AdminActionResult {
  ok: boolean;
  message: string;
}

/**
 * Writes the payouts an order should already have.
 *
 * This exists because the escrow can be released through the contract panel
 * without ever passing through quality approval, and only quality approval
 * writes settlements — so an order can reach SETTLED with nobody paid. The
 * dashboard detects that; this repairs it.
 *
 * The guard is the important part: it refuses unless the escrow has actually
 * RELEASED. Writing payout records for money that never moved would turn a
 * visible accounting gap into an invisible lie, which is strictly worse than
 * the bug it is fixing.
 *
 * Idempotent, because `writeSettlements` upserts on `allocationId` — running
 * it on a healthy order changes nothing and pays nobody twice.
 */
export async function resettleOrder(orderId: string): Promise<AdminActionResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      allocations: { select: { id: true } },
      settlements: { select: { id: true } },
      contract: { include: { escrow: true } },
    },
  });

  if (!order) {
    throw HttpError.notFound("ORDER_NOT_FOUND", "That order no longer exists");
  }
  if (order.allocations.length === 0) {
    throw new HttpError(
      409,
      "NO_ALLOCATIONS",
      "This order has no farmer allocations, so there is nothing to pay out",
    );
  }

  const escrow = order.contract?.escrow ?? null;
  if (escrow === null) {
    throw new HttpError(
      409,
      "NO_ESCROW",
      "This order has no escrow. Payouts are only written for money that moved.",
    );
  }
  if (escrow.status !== "RELEASED") {
    throw new HttpError(
      409,
      "ESCROW_NOT_RELEASED",
      `The escrow for this order is ${escrow.status.toLowerCase()}, not released. ` +
        `Payouts are only written once the buyer's funds have actually been released.`,
    );
  }

  const before = order.settlements.length;

  await prisma.$transaction(async (tx) => {
    await writeSettlements(tx, order.id, escrow.releasedTxHash);
    if (order.status !== "SETTLED") {
      await tx.order.update({ where: { id: order.id }, data: { status: "SETTLED" } });
    }
  });

  const after = await prisma.settlement.count({ where: { orderId: order.id } });
  const written = after - before;

  return {
    ok: true,
    message:
      written === 0
        ? `${order.orderNo} already had every payout recorded — nothing changed.`
        : `Wrote ${written} payout${written === 1 ? "" : "s"} for ${order.orderNo}. ` +
          `Each farmer's earnings screen will now show their share.`,
  };
}

/**
 * Refunds a disputed order's buyer.
 *
 * Delegates to the same `transitionContract` the buyer portal uses — CLAUDE.md
 * is explicit that there is no parallel business logic, and the escrow's own
 * state machine is what decides whether a refund is legal.
 */
export async function refundOrder(
  orderId: string,
  userId: string,
  role: string,
): Promise<AdminActionResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { contract: { select: { id: true } } },
  });

  if (!order) {
    throw HttpError.notFound("ORDER_NOT_FOUND", "That order no longer exists");
  }
  if (!order.contract) {
    throw new HttpError(409, "NO_CONTRACT", "This order has no contract, so there is no escrow");
  }

  await transitionContract(order.contract.id, userId, role, "refund");

  return { ok: true, message: `Refunded the buyer on ${order.orderNo}.` };
}

// -------------------------------------------------------------- directories

/** Every order, newest first — the dashboard shows only the most recent few. */
export async function listOrders(): Promise<AdminOrderRow[]> {
  const rows = await prisma.order.findMany({
    include: {
      buyer: { select: { companyName: true } },
      _count: { select: { allocations: true, settlements: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((order) => ({
    id: order.id,
    orderNo: order.orderNo,
    status: order.status as OrderStatus,
    buyerName: order.buyer.companyName,
    quintals: toQuintals(order.totalQuintals),
    pricePerQuintal: order.settledPricePerQuintal,
    grossRupees: order.grossAmountRupees,
    farmers: order._count.allocations,
    settlements: order._count.settlements,
    createdAt: order.createdAt.toISOString(),
  }));
}

/**
 * The farmer directory, with what each has actually earned.
 *
 * Earnings are summed from settlements rather than read from a column, for the
 * same reason as everything else here: a stored total is one more thing that
 * can disagree with the payouts it claims to summarise.
 */
export async function listFarmers(): Promise<AdminFarmerRow[]> {
  const rows = await prisma.farmerProfile.findMany({
    include: {
      user: { select: { name: true, phone: true } },
      listings: { select: { status: true, quantityQuintals: true } },
      settlements: {
        select: {
          netAmountRupees: true,
          farmerGainRupees: true,
          allocation: { select: { allocatedQuintals: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows
    .map((farmer) => {
      const active = farmer.listings.filter((listing) => listing.status === "ACTIVE");
      return {
        id: farmer.id,
        name: farmer.user.name,
        phone: farmer.user.phone,
        village: farmer.village,
        district: farmer.district,
        farmSizeAcres: toQuintals(farmer.farmSizeAcres),
        rating: Math.round(Number(farmer.rating) * 100) / 100,
        completedOrders: farmer.completedOrders,
        kycStatus: farmer.kycStatus as KycStatus,
        activeListings: active.length,
        listedQuintals:
          Math.round(
            active.reduce((sum, listing) => sum + toQuintals(listing.quantityQuintals), 0) * 100,
          ) / 100,
        soldQuintals:
          Math.round(
            farmer.settlements.reduce(
              (sum, row) => sum + toQuintals(row.allocation.allocatedQuintals),
              0,
            ) * 100,
          ) / 100,
        earnedRupees: farmer.settlements.reduce((sum, row) => sum + row.netAmountRupees, 0),
        gainRupees: farmer.settlements.reduce((sum, row) => sum + row.farmerGainRupees, 0),
      };
    })
    .sort((a, b) => b.earnedRupees - a.earnedRupees || a.name.localeCompare(b.name));
}

export async function listListings(): Promise<AdminListingRow[]> {
  const rows = await prisma.produceListing.findMany({
    include: { farmer: { include: { user: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((listing) => ({
    id: listing.id,
    farmerId: listing.farmerId,
    farmerName: listing.farmer.user.name,
    village: listing.village,
    crop: listing.crop,
    grade: listing.grade as Grade,
    quantityQuintals: toQuintals(listing.quantityQuintals),
    reservedQuintals: toQuintals(listing.reservedQuintals),
    expectedPricePerQuintal: listing.expectedPricePerQuintal,
    status: listing.status as ListingStatus,
    availableFrom: listing.availableFrom.toISOString().slice(0, 10),
    createdAt: listing.createdAt.toISOString(),
  }));
}

/** One order in full, including whether each farmer on it was actually paid. */
export async function getOrderDetail(orderId: string): Promise<AdminOrderDetail> {
  const row = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      buyer: { select: { companyName: true } },
      allocations: {
        include: { farmer: { include: { user: { select: { name: true } } } } },
        orderBy: { allocatedQuintals: "desc" },
      },
      settlements: true,
      contract: { include: { escrow: true } },
      shipment: { include: { _count: { select: { stops: true } } } },
      qualityCheck: true,
    },
  });

  if (!row) {
    throw HttpError.notFound("ORDER_NOT_FOUND", "That order no longer exists");
  }

  // Keyed by allocation so an unpaid farmer shows as null rather than zero —
  // "not paid" and "paid nothing" are different facts.
  const byAllocation = new Map(row.settlements.map((s) => [s.allocationId, s]));

  return {
    order: {
      id: row.id,
      orderNo: row.orderNo,
      status: row.status as OrderStatus,
      buyerName: row.buyer.companyName,
      quintals: toQuintals(row.totalQuintals),
      pricePerQuintal: row.settledPricePerQuintal,
      grossRupees: row.grossAmountRupees,
      farmers: row.allocations.length,
      settlements: row.settlements.length,
      createdAt: row.createdAt.toISOString(),
    },
    grade: row.grade as Grade,
    deliveryBy: row.deliveryBy.toISOString().slice(0, 10),
    isAggregated: row.isAggregated,
    allocations: row.allocations.map((allocation) => {
      const settlement = byAllocation.get(allocation.id) ?? null;
      return {
        farmerId: allocation.farmerId,
        farmerName: allocation.farmer.user.name,
        village: allocation.farmer.village,
        allocatedQuintals: toQuintals(allocation.allocatedQuintals),
        pricePerQuintal: allocation.pricePerQuintal,
        grossRupees: allocation.grossAmountRupees,
        netRupees: settlement?.netAmountRupees ?? null,
        gainRupees: settlement?.farmerGainRupees ?? null,
      };
    }),
    contract: row.contract
      ? {
          contractNo: row.contract.contractNo,
          status: row.contract.status as ContractStatus,
          escrowStatus: row.contract.escrow?.status ?? null,
          amountRupees: row.contract.amountRupees,
          pdfSha256: row.contract.pdfSha256,
          onChainDealId: row.contract.onChainDealId,
        }
      : null,
    shipment: row.shipment
      ? {
          status: row.shipment.status,
          vehicleClass: row.shipment.vehicleClass,
          vehicleCount: row.shipment.vehicleCount,
          totalDistanceKm: toQuintals(row.shipment.totalDistanceKm),
          optimisedCostRupees: row.shipment.optimisedCostRupees,
          naiveCostRupees: row.shipment.naiveCostRupees,
          stops: row.shipment._count.stops,
        }
      : null,
    quality: row.qualityCheck
      ? {
          status: row.qualityCheck.status,
          gradeAssessed: row.qualityCheck.gradeFound as Grade,
          moisturePercent:
            row.qualityCheck.moisturePct === null ? null : Number(row.qualityCheck.moisturePct),
          notes: row.qualityCheck.notes,
          checkedAt: row.qualityCheck.checkedAt?.toISOString() ?? null,
        }
      : null,
    assumptions: ASSUMPTIONS,
  };
}

/**
 * Sets a farmer's KYC state.
 *
 * Verification is a human judgement in the real world; this records the
 * outcome of one. It is the only field on a farmer an operator may change —
 * everything else about them is theirs to edit.
 */
export async function setFarmerKyc(
  farmerId: string,
  status: KycStatus,
): Promise<AdminActionResult> {
  const farmer = await prisma.farmerProfile.findUnique({
    where: { id: farmerId },
    include: { user: { select: { name: true } } },
  });
  if (!farmer) {
    throw HttpError.notFound("FARMER_NOT_FOUND", "That farmer no longer exists");
  }

  await prisma.farmerProfile.update({
    where: { id: farmerId },
    data: { kycStatus: status },
  });

  return {
    ok: true,
    message: `${farmer.user.name}'s KYC is now ${status.toLowerCase().replace(/_/g, " ")}.`,
  };
}
