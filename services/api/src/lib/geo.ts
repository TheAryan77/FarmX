/**
 * Distance maths. CLAUDE.md: no PostGIS — haversine in TS/SQL.
 *
 * This is the canonical implementation. `prisma/seed.ts` carries its own copy
 * because it is a standalone script outside any workspace; the two must agree,
 * and there is a check in the seed that would surface it if they drifted.
 */

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Rounded to 100 m, which is more precision than a pickup route needs. */
export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

/**
 * Latitude/longitude window that fully contains a radius around a point.
 *
 * Used to narrow the SQL query before the exact haversine runs in TS. Without
 * it, a radius filter would mean loading every listing in the country; with it
 * the database does the coarse work using the lat/lng indexes and TS only
 * refines the corners of the box. The box is always a superset of the circle,
 * so nothing inside the radius is ever excluded.
 */
export function boundingBox(
  lat: number,
  lng: number,
  radiusKm: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  // Longitude degrees shrink towards the poles. Guard the cosine so a point
  // near a pole widens the box rather than dividing by ~0.
  const cosLat = Math.max(Math.cos(toRadians(lat)), 1e-6);
  const lngDelta = latDelta / cosLat;

  return {
    minLat: Math.max(lat - latDelta, -90),
    maxLat: Math.min(lat + latDelta, 90),
    minLng: Math.max(lng - lngDelta, -180),
    maxLng: Math.min(lng + lngDelta, 180),
  };
}
