import type { OrderStatus } from "@fasalx/types";

/**
 * Display helpers for the operations console.
 *
 * CLAUDE.md units: money is whole rupees, quantity is quintals. No kg exists
 * anywhere in this app.
 */

/** ₹12,10,000 — Indian digit grouping, no paise. */
export function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

/** Compact form for dense tiles: ₹12.1L, ₹1.2Cr. */
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

/** A rate held as a fraction: 0.1234 → "12.3%". */
export function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "muted";

export const ORDER_STATUS: Record<OrderStatus, { text: string; variant: BadgeVariant }> = {
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

export const KYC_STATUS: Record<string, { text: string; variant: BadgeVariant }> = {
  NOT_STARTED: { text: "Not started", variant: "muted" },
  PENDING: { text: "Pending", variant: "warning" },
  VERIFIED: { text: "Verified", variant: "success" },
  REJECTED: { text: "Rejected", variant: "destructive" },
};

export const LISTING_STATUS: Record<string, { text: string; variant: BadgeVariant }> = {
  DRAFT: { text: "Draft", variant: "muted" },
  ACTIVE: { text: "Active", variant: "success" },
  RESERVED: { text: "Reserved", variant: "warning" },
  PARTIALLY_ALLOCATED: { text: "Part allocated", variant: "warning" },
  SOLD: { text: "Sold", variant: "default" },
  EXPIRED: { text: "Expired", variant: "muted" },
  WITHDRAWN: { text: "Withdrawn", variant: "muted" },
};

export function shortDate(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
