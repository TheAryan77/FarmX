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

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted";

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
