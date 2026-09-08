import type { Prisma } from "@prisma/client";

/**
 * Wire serialisation helpers.
 *
 * CLAUDE.md units: money is whole rupees, quantity is quintals to 2dp, and the
 * two are never mixed. Prisma hands back Decimal objects, which would serialise
 * to JSON as strings — these convert once, at the boundary, so nothing
 * downstream has to think about it.
 */

/** Prisma Decimal → quintals as a number, clamped to 2dp. */
export function toQuintals(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value) * 100) / 100;
}

/** Whole rupees. Rounds defensively — money must never carry a fraction. */
export function toRupees(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value));
}

/** A Postgres `date` column → "YYYY-MM-DD". */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → the Date a Postgres `date` column expects. */
export function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
