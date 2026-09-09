import type { QualityCheck, QcStatus } from "@fasalx/types";
import type { QualityCheckInput } from "@fasalx/validation";
import {
  ContractStatus as PrismaContractStatus,
  Prisma,
  QcStatus as PrismaQcStatus,
  ShipmentStatus as PrismaShipmentStatus,
  StopStatus as PrismaStopStatus,
} from "@prisma/client";

import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { transitionContract } from "./contract.service.js";
import { requireFarmerProfile } from "./listing.service.js";
import { getOrder } from "./order.service.js";
import { writeSettlements } from "./settlement.service.js";

/**
 * Delivery, quality check, and the release that pays the farmers.
 *
 * This is where the escrow's promise is kept or broken: approving quality
 * releases the money, rejecting it freezes the escrow and opens a dispute.
 * Both go through the contract service, so the chain and Postgres move
 * together rather than one claiming something the other denies.
 */

/** Compile-time guard against enum drift — see listing.service.ts. */
const _qcParity: Record<PrismaQcStatus, QcStatus> = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
};
void _qcParity;

const GRADE_ORDER = { A: 0, B: 1, C: 2 } as const;

const qualityInclude = {
  order: { select: { id: true, grade: true, buyerId: true } },
  inspector: { select: { name: true } },
} satisfies Prisma.QualityCheckInclude;

type QualityRow = Prisma.QualityCheckGetPayload<{ include: typeof qualityInclude }>;

function toQualityCheck(row: QualityRow): QualityCheck {
  return {
    id: row.id,
    orderId: row.orderId,
    gradeFound: row.gradeFound,
    gradeAgreed: row.order.grade,
    moisturePct: row.moisturePct === null ? null : Number(row.moisturePct),
    status: row.status,
    notes: row.notes,
    proofUrl: row.proofPath === null ? null : `/quality/${row.id}/proof`,
    inspectorName: row.inspector?.name ?? null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------- shipment steps

/**
 * Confirms produce has been loaded.
 *
 * With a `stopId` it confirms one farm, which is what a farmer taps on their
 * own screen. Without one it confirms the whole run, which is what a driver or
 * the buyer does. Either way, the shipment only advances — and the on-chain
 * pickup only fires — once every stop is loaded, because the escrow's
 * "collected" state means the whole order, not one farm.
 */
export async function confirmPickup(
  shipmentId: string,
  userId: string,
  role: string,
  stopId?: string,
): Promise<{ allLoaded: boolean }> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { stops: true },
  });
  if (!shipment) {
    throw HttpError.notFound("SHIPMENT_NOT_FOUND", "That shipment no longer exists");
  }
  await getOrder(shipment.orderId, userId, role);

  if (shipment.status === PrismaShipmentStatus.DELIVERED) {
    throw new HttpError(409, "ALREADY_DELIVERED", "This shipment has already been delivered");
  }

  if (stopId !== undefined) {
    const stop = shipment.stops.find((candidate) => candidate.id === stopId);
    if (!stop) {
      throw HttpError.notFound("STOP_NOT_FOUND", "That pickup stop is not on this shipment");
    }
    // A farmer may only confirm their own farm's pickup.
    if (role === "FARMER") {
      const farmer = await requireFarmerProfile(userId);
      if (stop.farmerId !== farmer.id) {
        throw HttpError.forbidden("You can only confirm the pickup from your own farm");
      }
    }
    await prisma.shipmentStop.update({
      where: { id: stopId },
      data: { status: PrismaStopStatus.LOADED, arrivedAt: new Date(), loadedAt: new Date() },
    });
  } else {
    if (role === "FARMER") {
      throw HttpError.forbidden("Confirm the pickup from your own farm instead");
    }
    await prisma.shipmentStop.updateMany({
      where: { shipmentId, status: { not: PrismaStopStatus.LOADED } },
      data: { status: PrismaStopStatus.LOADED, arrivedAt: new Date(), loadedAt: new Date() },
    });
  }

  const remaining = await prisma.shipmentStop.count({
    where: { shipmentId, status: { not: PrismaStopStatus.LOADED } },
  });
  const allLoaded = remaining === 0;

  if (allLoaded && shipment.status !== PrismaShipmentStatus.IN_TRANSIT) {
    await prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: PrismaShipmentStatus.IN_TRANSIT, pickupScheduledAt: new Date() },
    });

    // Mirror it on-chain, but only if the escrow is actually at FUNDED. A
    // pickup confirmed before the buyer funded is a real situation; it should
    // not fail the farmer's tap.
    const contract = await prisma.contract.findUnique({ where: { orderId: shipment.orderId } });
    if (contract?.status === PrismaContractStatus.FUNDED) {
      await transitionContract(contract.id, userId, role, "pickup");
    }
  }

  return { allLoaded };
}

/** Marks the shipment delivered and mirrors it on-chain. */
export async function confirmDelivery(
  shipmentId: string,
  userId: string,
  role: string,
  proofPath?: string,
): Promise<void> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) {
    throw HttpError.notFound("SHIPMENT_NOT_FOUND", "That shipment no longer exists");
  }
  await getOrder(shipment.orderId, userId, role);

  if (shipment.status !== PrismaShipmentStatus.IN_TRANSIT) {
    throw new HttpError(
      409,
      "NOT_IN_TRANSIT",
      shipment.status === PrismaShipmentStatus.DELIVERED
        ? "This shipment has already been delivered"
        : "Confirm pickup from every farm before recording delivery",
    );
  }

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status: PrismaShipmentStatus.DELIVERED,
      deliveredAt: new Date(),
      ...(proofPath === undefined ? {} : { deliveryProofPath: proofPath }),
    },
  });

  const contract = await prisma.contract.findUnique({ where: { orderId: shipment.orderId } });
  if (contract?.status === PrismaContractStatus.PICKED_UP) {
    await transitionContract(contract.id, userId, role, "deliver");
  }
}

// ---------------------------------------------------------------- quality check

/** The buyer records what actually arrived. One check per order. */
export async function recordQualityCheck(
  userId: string,
  input: QualityCheckInput,
  proofPath?: string,
): Promise<QualityCheck> {
  const order = await getOrder(input.orderId, userId, "BUYER");

  const shipment = await prisma.shipment.findUnique({ where: { orderId: order.id } });
  if (shipment && shipment.status !== PrismaShipmentStatus.DELIVERED) {
    throw new HttpError(
      409,
      "NOT_DELIVERED",
      "Record the delivery before checking quality",
    );
  }

  const row = await prisma.qualityCheck.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      inspectorUserId: userId,
      gradeFound: input.gradeFound,
      ...(input.moisturePct === undefined
        ? {}
        : { moisturePct: new Prisma.Decimal(input.moisturePct) }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(proofPath === undefined ? {} : { proofPath }),
      status: PrismaQcStatus.PENDING,
      checkedAt: new Date(),
    },
    update: {
      gradeFound: input.gradeFound,
      moisturePct:
        input.moisturePct === undefined ? null : new Prisma.Decimal(input.moisturePct),
      notes: input.notes ?? null,
      ...(proofPath === undefined ? {} : { proofPath }),
      checkedAt: new Date(),
    },
    include: qualityInclude,
  });

  return toQualityCheck(row);
}

export async function getQualityCheckForOrder(
  orderId: string,
  userId: string,
  role: string,
): Promise<QualityCheck | null> {
  await getOrder(orderId, userId, role);
  const row = await prisma.qualityCheck.findUnique({
    where: { orderId },
    include: qualityInclude,
  });
  return row === null ? null : toQualityCheck(row);
}

async function loadCheck(id: string, userId: string, role: string): Promise<QualityRow> {
  const row = await prisma.qualityCheck.findUnique({ where: { id }, include: qualityInclude });
  if (!row) {
    throw HttpError.notFound("QC_NOT_FOUND", "That quality check no longer exists");
  }
  await getOrder(row.orderId, userId, role);
  return row;
}

/**
 * Approves quality, releases the escrow, and writes each farmer's payout.
 *
 * The order matters and is not arbitrary: the chain moves first, and the
 * settlement rows are written from the release transaction. If the release
 * fails, no payout is recorded — a farmer must never see a settled figure for
 * money that did not move.
 */
export async function approveQuality(
  id: string,
  userId: string,
  role: string,
): Promise<QualityCheck> {
  const check = await loadCheck(id, userId, role);

  if (role !== "BUYER") {
    throw HttpError.forbidden("Only the buyer can approve quality");
  }
  if (check.status !== PrismaQcStatus.PENDING) {
    throw new HttpError(
      409,
      "QC_NOT_PENDING",
      `This quality check has already been ${check.status.toLowerCase()}`,
    );
  }

  const contract = await prisma.contract.findUnique({ where: { orderId: check.orderId } });
  if (!contract) {
    throw new HttpError(
      409,
      "NO_CONTRACT",
      "This order has no contract, so there is no escrow to release",
    );
  }

  // DELIVERED → QC_APPROVED, then QC_APPROVED → RELEASED. Two transitions
  // because the contract keeps them separate, and so should the record.
  const approved = await transitionContract(contract.id, userId, role, "approve-quality");
  if (approved.status !== "QC_APPROVED") {
    throw new HttpError(
      409,
      "APPROVAL_NOT_CONFIRMED",
      approved.degradedReason ??
        "The escrow could not be moved to quality-approved, so nothing was released",
    );
  }

  const released = await transitionContract(contract.id, userId, role, "release");
  if (released.status !== "RELEASED") {
    throw new HttpError(
      409,
      "RELEASE_FAILED",
      released.degradedReason ??
        "Quality was approved but the escrow could not be released — no payouts were recorded",
    );
  }

  const releaseTx = released.escrow?.releasedTxHash ?? null;

  const row = await prisma.$transaction(async (tx) => {
    await writeSettlements(tx, check.orderId, releaseTx);
    return tx.qualityCheck.update({
      where: { id },
      data: { status: PrismaQcStatus.APPROVED, checkedAt: new Date() },
      include: qualityInclude,
    });
  });

  return toQualityCheck(row);
}

/** Rejects quality and freezes the escrow by raising a dispute. */
export async function rejectQuality(
  id: string,
  userId: string,
  role: string,
  reason: string,
): Promise<QualityCheck> {
  const check = await loadCheck(id, userId, role);

  if (role !== "BUYER") {
    throw HttpError.forbidden("Only the buyer can reject a delivery");
  }
  if (check.status !== PrismaQcStatus.PENDING) {
    throw new HttpError(
      409,
      "QC_NOT_PENDING",
      `This quality check has already been ${check.status.toLowerCase()}`,
    );
  }

  const contract = await prisma.contract.findUnique({ where: { orderId: check.orderId } });
  if (contract) {
    await transitionContract(contract.id, userId, role, "dispute", reason);
  }

  const row = await prisma.qualityCheck.update({
    where: { id },
    data: {
      status: PrismaQcStatus.REJECTED,
      notes: check.notes === null ? reason : `${check.notes}\n\nRejected: ${reason}`,
      checkedAt: new Date(),
    },
    include: qualityInclude,
  });

  return toQualityCheck(row);
}

/** Whether the delivered grade met what was agreed. Used by the UI to warn. */
export function gradeMeetsAgreement(found: string, agreed: string): boolean {
  const f = GRADE_ORDER[found as keyof typeof GRADE_ORDER];
  const a = GRADE_ORDER[agreed as keyof typeof GRADE_ORDER];
  return f !== undefined && a !== undefined && f <= a;
}

/** Path to a stored delivery-proof photo, for download. */
export async function getProofPath(
  id: string,
  userId: string,
  role: string,
): Promise<{ path: string; filename: string }> {
  const row = await loadCheck(id, userId, role);
  if (row.proofPath === null) {
    throw HttpError.notFound("PROOF_NOT_FOUND", "No delivery proof was uploaded");
  }
  return { path: row.proofPath, filename: row.proofPath.split("/").pop() ?? "proof" };
}
