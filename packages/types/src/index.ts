/**
 * Shared FasalX wire types.
 *
 * CLAUDE.md: shared types live here and are imported by apps — never
 * duplicated. These describe what crosses the network, which is deliberately
 * not the same as the Prisma model: apps never import `@prisma/client`, so the
 * database layer cannot leak into a client bundle. The API maps Prisma rows to
 * these shapes, and guards the enums against drift with a compile-time check.
 *
 * Units, everywhere and without exception:
 *   - money    → whole rupees, as `number` (integer)
 *   - quantity → quintals, as `number` with at most 2 decimals. Never kg.
 */

export type Role = "FARMER" | "BUYER" | "FPO" | "ADMIN";

export type Grade = "A" | "B" | "C";

export type ListingStatus =
  | "DRAFT"
  | "ACTIVE"
  | "RESERVED"
  | "PARTIALLY_ALLOCATED"
  | "SOLD"
  | "EXPIRED"
  | "CANCELLED";

/** Every API route returns one of these two shapes. */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> = { data: T } | { error: ApiError };

// ---------------------------------------------------------------- auth

export interface AuthUser {
  id: string;
  phone: string;
  name: string;
  role: Role;
  language: string;
  /** FarmerProfile / BuyerProfile / FpoProfile id, whichever matches the role. */
  profileId: string | null;
  district: string | null;
}

export interface RequestOtpResult {
  phone: string;
  expiresInSeconds: number;
  /**
   * Present only outside production. Mock OTP has no SMS provider, so the code
   * is surfaced here as well as logged, which keeps demo-day logins out of the
   * terminal. Never populated when NODE_ENV is production.
   */
  devOtp?: string;
}

export interface VerifyOtpResult {
  token: string;
  user: AuthUser;
}

/** Claims carried by the signed token. No PII beyond the user id. */
export interface JwtClaims {
  sub: string;
  role: Role;
}

// ---------------------------------------------------------------- listings

/** The seller, as shown on a public listing. No phone number. */
export interface ListingFarmer {
  id: string;
  name: string;
  village: string;
  district: string;
  rating: number;
  completedOrders: number;
}

export interface Listing {
  id: string;
  crop: string;
  grade: Grade;

  /** Total listed, in quintals. */
  quantityQuintals: number;
  /** Committed to an accepted offer or allocation, in quintals. */
  reservedQuintals: number;
  /** quantityQuintals − reservedQuintals. Derived server-side. */
  availableQuintals: number;

  /** Whole rupees per quintal. */
  expectedPricePerQuintal: number;
  /** availableQuintals × expectedPricePerQuintal, whole rupees. Derived. */
  totalValueRupees: number;

  /** ISO date, no time component (YYYY-MM-DD). */
  availableFrom: string;

  village: string;
  district: string;
  state: string;
  lat: number;
  lng: number;

  status: ListingStatus;
  notes: string | null;

  farmer: ListingFarmer;

  createdAt: string;
  updatedAt: string;
}

export interface ListingPage {
  listings: Listing[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------- market data

/**
 * Latest mandi price straight from PriceHistory. This is the pre-AI reading
 * the farmer home screen shows; session 7 replaces it with a prediction.
 */
export interface PriceSnapshot {
  crop: string;
  district: string;
  /** ISO date of the reading. */
  date: string;
  modalPricePerQuintal: number;
  minPricePerQuintal: number | null;
  maxPricePerQuintal: number | null;
  /** Change against the reading 7 days earlier, in whole rupees. */
  changeVs7dRupees: number | null;
  source: string;
}
