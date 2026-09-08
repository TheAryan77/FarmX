/**
 * Calendar helpers with no Zod dependency.
 *
 * Deliberately its own entry point: the farmer app's sell form needs only
 * `istTodayIso`, and importing it from the package barrel pulled the whole of
 * Zod into the client bundle (+28 kB) for a three-line date function. CLAUDE.md
 * targets a cheap Android phone, so that cost is not acceptable.
 *
 * Import as `@fasalx/validation/date` from client components.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Today's date in India as YYYY-MM-DD. FasalX is a Karnal-only pilot, so IST
 * is the product's clock on both the server and the client — using each side's
 * local midnight would let a "today" date fail validation across the boundary.
 */
export function istTodayIso(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
