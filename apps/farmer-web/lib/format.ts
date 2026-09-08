import type { ListingStatus } from "@fasalx/types";

/**
 * Display helpers for the farmer app.
 *
 * CLAUDE.md units: money is whole rupees, quantity is quintals. There is no kg
 * anywhere — the only place kg is even mentioned is the "1 quintal = 100 kg"
 * hint on the sell form, which is a reading aid and never a stored value.
 */

/** ₹1,21,000 — Indian digit grouping, no paise. */
export function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

/** Drops a trailing .00 so "50Q" does not read as "50.00Q". */
export function quintals(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}Q` : `${rounded.toFixed(2)}Q`;
}

/** "12 Sep 2026" — unambiguous, and short enough for a narrow screen. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted";

/** Plain-language status plus the badge colour that matches it. */
export const STATUS_LABEL: Record<ListingStatus, { text: string; variant: BadgeVariant }> = {
  DRAFT: { text: "Draft", variant: "muted" },
  ACTIVE: { text: "Live", variant: "success" },
  RESERVED: { text: "Reserved", variant: "warning" },
  PARTIALLY_ALLOCATED: { text: "Part sold", variant: "warning" },
  SOLD: { text: "Sold", variant: "default" },
  EXPIRED: { text: "Expired", variant: "muted" },
  CANCELLED: { text: "Removed", variant: "destructive" },
};

export const GRADE_LABEL: Record<string, string> = {
  A: "Grade A",
  B: "Grade B",
  C: "Grade C",
};

/**
 * Status as the farmer should read it.
 *
 * A PENDING offer is "waiting for you" only to the side that has to answer.
 * After the farmer counters, the offer on the table is still PENDING but it is
 * the buyer who owes a reply — labelling that "Waiting for you" was wrong.
 */
export function offerStatusLabel(
  status: string,
  awaitingYou: boolean,
): { text: string; variant: BadgeVariant } {
  if (status === "PENDING") {
    return awaitingYou
      ? { text: "Waiting for you", variant: "warning" }
      : { text: "Waiting for buyer", variant: "muted" };
  }
  const rest: Record<string, { text: string; variant: BadgeVariant }> = {
    COUNTERED: { text: "Answered", variant: "muted" },
    ACCEPTED: { text: "Deal agreed", variant: "success" },
    REJECTED: { text: "Declined", variant: "destructive" },
    EXPIRED: { text: "Expired", variant: "muted" },
  };
  return rest[status] ?? { text: status, variant: "muted" };
}

export const ORDER_STATUS: Record<string, { text: string; variant: BadgeVariant }> = {
  CREATED: { text: "Agreed", variant: "success" },
  CONTRACTED: { text: "Contract signed", variant: "default" },
  FUNDED: { text: "Payment secured", variant: "default" },
  IN_TRANSIT: { text: "On the way", variant: "warning" },
  DELIVERED: { text: "Delivered", variant: "warning" },
  QC_PASSED: { text: "Quality approved", variant: "success" },
  SETTLED: { text: "Paid", variant: "success" },
  DISPUTED: { text: "Disputed", variant: "destructive" },
  CANCELLED: { text: "Cancelled", variant: "muted" },
};

/** "2 hours left" / "Expired" — offers lapse after 48 hours. */
export function timeLeft(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)} day${hours >= 48 ? "s" : ""} left`;
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} left`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min left`;
}
