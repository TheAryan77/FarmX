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

/** The one action a buyer can take from each state, if any. */
export const NEXT_ACTION: Partial<
  Record<ContractStatus, { action: "accept" | "fund" | "pickup" | "deliver" | "approve-quality" | "release"; label: string }>
> = {
  CREATED: { action: "accept", label: "Sign contract" },
  ACCEPTED: { action: "fund", label: "Fund escrow" },
  FUNDED: { action: "pickup", label: "Confirm pickup" },
  PICKED_UP: { action: "deliver", label: "Confirm delivery" },
  DELIVERED: { action: "approve-quality", label: "Approve quality" },
  QC_APPROVED: { action: "release", label: "Release payment" },
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
