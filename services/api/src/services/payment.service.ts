import type { ContractRecord, PaymentIntent, PaymentStatus } from "@fasalx/types";
import { PaymentStatus as PrismaPaymentStatus } from "@prisma/client";

import { env } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  createRazorpayOrder,
  fundingAmount,
  isConfigured,
  RAZORPAY_MAX_RUPEES,
  verifyPaymentSignature,
} from "../lib/razorpay.js";
import { transitionContract } from "./contract.service.js";

/**
 * Funding a contract through Razorpay, test mode.
 *
 * The rule that matters: **the chain is only told the escrow is funded after a
 * signature verifies.** Everything else here is bookkeeping. An unverified
 * callback moves nothing, exactly as the release path can only be reached
 * through quality approval — the same principle at the other end of the deal.
 */

/** Compile-time guard against enum drift — see listing.service.ts. */
const _statusParity: Record<PrismaPaymentStatus, PaymentStatus> = {
  CREATED: "CREATED",
  PAID: "PAID",
  FAILED: "FAILED",
};
void _statusParity;

async function loadContractForBuyer(contractId: string, userId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { order: { include: { buyer: { select: { userId: true } } } } },
  });
  if (!contract) {
    throw HttpError.notFound("CONTRACT_NOT_FOUND", "That contract no longer exists");
  }
  if (contract.order.buyer.userId !== userId) {
    throw HttpError.forbidden("Only the buyer on this order can fund it");
  }
  return contract;
}

/**
 * Starts a funding attempt and returns what the browser needs for checkout.
 *
 * Only the key **id** goes back — it is public and belongs in the browser. The
 * secret never leaves this service.
 */
export async function createPaymentIntent(
  contractId: string,
  userId: string,
): Promise<PaymentIntent> {
  const contract = await loadContractForBuyer(contractId, userId);

  if (contract.status !== "ACCEPTED") {
    throw new HttpError(
      409,
      "NOT_FUNDABLE",
      `This contract is ${contract.status.toLowerCase().replace(/_/g, " ")}, so it cannot be funded`,
    );
  }

  const { rupees, isAdvance, balanceRupees } = fundingAmount(contract.amountRupees);
  const order = await createRazorpayOrder(rupees, `fasalx-${contract.contractNo}`);

  await prisma.payment.create({
    data: {
      contractId: contract.id,
      razorpayOrderId: order.id,
      amountRupees: rupees,
      isAdvance,
      status: PrismaPaymentStatus.CREATED,
    },
  });

  return {
    razorpayOrderId: order.id,
    keyId: env.RAZORPAY_KEY_ID,
    amountRupees: rupees,
    contractAmountRupees: contract.amountRupees,
    isAdvance,
    balanceRupees,
    maxSinglePaymentRupees: RAZORPAY_MAX_RUPEES,
    contractNo: contract.contractNo,
  };
}

/**
 * Verifies the checkout callback and, only then, locks the escrow on chain.
 *
 * The signature check is the gate. A caller who invents a payment id gets
 * nothing: the attempt is recorded FAILED and the contract stays where it was.
 */
export async function confirmPayment(
  contractId: string,
  userId: string,
  role: string,
  input: { razorpayOrderId: string; razorpayPaymentId: string; signature: string },
): Promise<ContractRecord> {
  await loadContractForBuyer(contractId, userId);

  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId: input.razorpayOrderId },
  });
  if (!payment || payment.contractId !== contractId) {
    throw HttpError.notFound("PAYMENT_NOT_FOUND", "That payment does not belong to this contract");
  }

  if (!verifyPaymentSignature(input.razorpayOrderId, input.razorpayPaymentId, input.signature)) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PrismaPaymentStatus.FAILED,
        failureReason: "Signature did not verify",
        razorpayPaymentId: input.razorpayPaymentId,
      },
    });
    throw new HttpError(
      400,
      "SIGNATURE_INVALID",
      "That payment could not be verified, so nothing was funded",
    );
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: PrismaPaymentStatus.PAID, razorpayPaymentId: input.razorpayPaymentId },
  });

  // Payment verified — now the chain may be told.
  return transitionContract(contractId, userId, role, "fund");
}

/** Records an abandoned or failed checkout so it does not vanish silently. */
export async function markPaymentFailed(
  contractId: string,
  userId: string,
  razorpayOrderId: string,
  reason: string,
): Promise<{ ok: true }> {
  await loadContractForBuyer(contractId, userId);

  const payment = await prisma.payment.findUnique({ where: { razorpayOrderId } });
  if (payment && payment.contractId === contractId && payment.status === "CREATED") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PrismaPaymentStatus.FAILED, failureReason: reason.slice(0, 200) },
    });
  }
  return { ok: true };
}

export function paymentsConfigured(): boolean {
  return isConfigured();
}
