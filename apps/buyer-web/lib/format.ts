import type { Grade, RequirementStatus } from "@fasalx/types";

/**
 * Display helpers for the buyer portal.
 *
 * CLAUDE.md units: money is whole rupees, quantity is quintals. No kg exists
 * anywhere in this app.
 */

/** ₹12,10,000 — Indian digit grouping, no paise. */
export function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

/** Compact form for dense tables and tiles: ₹12.1L, ₹1.2Cr. */
export function rupeesCompact(value: number): string {
  const v = Math.round(value);
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2).replace(/\.00$/, "")}Cr`;
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(2).replace(/\.00$/, "")}L`;
  return rupees(v);
}

export function quintals(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}Q` : `${rounded.toFixed(2)}Q`;
}

/** A measured distance: one decimal, because 13.3 km is meaningfully not 13. */
export function km(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} km`;
}

/**
 * A radius the buyer typed, which is always whole kilometres — rendering it as
 * "150.0 km" reads like a measurement rather than the setting it is.
 */
export function radiusKm(value: number): string {
  return `${value} km`;
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Whole days from today (IST) until an ISO date. Negative once overdue. */
export function daysUntil(iso: string): number {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const today = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const diff = Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(diff / 86_400_000);
}

export type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted";

export const REQUIREMENT_STATUS: Record<RequirementStatus, { text: string; variant: BadgeVariant }> =
  {
    OPEN: { text: "Open", variant: "success" },
    MATCHING: { text: "Matching", variant: "default" },
    PARTIALLY_FULFILLED: { text: "Part filled", variant: "warning" },
    FULFILLED: { text: "Fulfilled", variant: "default" },
    CANCELLED: { text: "Cancelled", variant: "destructive" },
    EXPIRED: { text: "Expired", variant: "muted" },
  };

export const GRADE_LABEL: Record<Grade, string> = {
  A: "Grade A",
  B: "Grade B",
  C: "Grade C",
};

/** Status as the buyer should read it — see the farmer app for the reasoning. */
export function offerStatusLabel(
  status: string,
  awaitingYou: boolean,
): { text: string; variant: BadgeVariant } {
  if (status === "PENDING") {
    return awaitingYou
      ? { text: "Needs your reply", variant: "warning" }
      : { text: "Awaiting farmer", variant: "muted" };
  }
  const rest: Record<string, { text: string; variant: BadgeVariant }> = {
    COUNTERED: { text: "Countered", variant: "muted" },
    ACCEPTED: { text: "Accepted", variant: "success" },
    REJECTED: { text: "Declined", variant: "destructive" },
    EXPIRED: { text: "Expired", variant: "muted" },
  };
  return rest[status] ?? { text: status, variant: "muted" };
}

export const ORDER_STATUS: Record<string, { text: string; variant: BadgeVariant }> = {
  CREATED: { text: "Agreed", variant: "success" },
  CONTRACTED: { text: "Contracted", variant: "default" },
  FUNDED: { text: "Escrow funded", variant: "default" },
  IN_TRANSIT: { text: "In transit", variant: "warning" },
  DELIVERED: { text: "Delivered", variant: "warning" },
  QC_PASSED: { text: "QC approved", variant: "success" },
  SETTLED: { text: "Settled", variant: "success" },
  DISPUTED: { text: "Disputed", variant: "destructive" },
  CANCELLED: { text: "Cancelled", variant: "muted" },
};

/** Offers lapse after 48 hours. */
export function timeLeft(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d left`;
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}
