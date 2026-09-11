import type { ContractStatus } from "@fasalx/types";

import type { BadgeVariant } from "./format";

/**
 * How each escrow state reads to a buyer, plus what they can do next.
 *
 * The label is deliberately about the money rather than the enum: "Payment
 * locked in escrow" tells a procurement manager something, "FUNDED" does not.
 */
export const CONTRACT_STATE: Record<
  ContractStatus,
  { label: string; detail: string; variant: BadgeVariant }
> = {
  CREATED: {
    label: "Contract created",
    detail: "Document generated and its hash written on-chain.",
    variant: "muted",
  },
  ACCEPTED: {
    label: "Signed by both sides",
    detail: "Ready for you to deposit the payment into escrow.",
    variant: "warning",
  },
  FUNDED: {
    label: "Payment locked in escrow",
    detail: "Neither side can withdraw it while the deal is in progress.",
    variant: "default",
  },
  PICKED_UP: {
    label: "Collected from the farms",
    detail: "Produce is on its way to you.",
    variant: "warning",
  },
  DELIVERED: {
    label: "Delivered",
    detail: "Inspect the produce and approve or dispute the quality.",
    variant: "warning",
  },
  QC_APPROVED: {
    label: "Quality approved",
    detail: "Payment can now be released to the farmers.",
    variant: "success",
  },
  RELEASED: {
    label: "Payment released",
    detail: "Funds have left escrow and been paid out.",
    variant: "success",
  },
  DISPUTED: {
    label: "Disputed",
    detail: "The escrow is frozen until the dispute is resolved.",
    variant: "destructive",
  },
  REFUNDED: {
    label: "Refunded",
    detail: "The escrow was returned to you.",
    variant: "destructive",
  },
};

/**
 * The one action a buyer can take from each state, if any.
 *
 * Quality approval and release are **not** here on purpose. Offering them
 * walked the escrow to RELEASED without recording a single payout: the order
 * read as settled, the escrow read as released, and every farmer's earnings
 * screen stayed empty with nothing to explain why. Both steps now happen only
 * through the quality panel below, which is the path that pays people. The API
 * no longer routes them either, so this is presentation matching the contract
 * rather than the UI politely declining to press a button that still works.
 */
export const NEXT_ACTION: Partial<
  Record<ContractStatus, { action: "accept" | "pickup" | "deliver"; label: string }>
> = {
  CREATED: { action: "accept", label: "Sign contract" },
  FUNDED: { action: "pickup", label: "Confirm pickup" },
  PICKED_UP: { action: "deliver", label: "Confirm delivery" },
};

/**
 * States whose next step lives in the quality panel. Without this the card
 * would simply end with no action and no explanation, which reads as broken.
 */
export const QUALITY_HANDOFF: Partial<Record<ContractStatus, string>> = {
  DELIVERED: "Record the quality check below to approve and release payment.",
  QC_APPROVED: "Approve the quality check below to release payment to the farmers.",
};

/** The escrow lifecycle in order, for drawing a timeline with future steps. */
export const CONTRACT_SEQUENCE: ContractStatus[] = [
  "CREATED",
  "ACCEPTED",
  "FUNDED",
  "PICKED_UP",
  "DELIVERED",
  "QC_APPROVED",
  "RELEASED",
];

/** 0x1234…abcd — enough to recognise a transaction without the noise. */
export function shortHash(hash: string): string {
  return hash.length <= 18 ? hash : `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}
