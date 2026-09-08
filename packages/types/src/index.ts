/**
 * Shared FasalX wire types.
 *
 * CLAUDE.md: shared types live here and are imported by apps — never
 * duplicated. These describe what crosses the network, which is deliberately
 * not the same as the Prisma model: apps never import `@prisma/client`, so the
 * database layer cannot leak into a client bundle. The API maps Prisma rows to
 * these shapes, and guards the enums against drift with a compile-time check.
 */

export type Role = "FARMER" | "BUYER" | "FPO" | "ADMIN";

export type Grade = "A" | "B" | "C";

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

// ---------------------------------------------------------------- JWT

/** Claims carried by the signed token. No PII beyond the user id. */
export interface JwtClaims {
  sub: string;
  role: Role;
}
