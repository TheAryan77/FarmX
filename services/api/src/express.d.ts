import type { JwtClaims } from "@fasalx/types";

// requireAuth attaches the verified claims here; requireRole and the route
// handlers read them. Declaration-merged so no handler needs a cast.
declare global {
  namespace Express {
    interface Request {
      auth?: JwtClaims;
    }
  }
}

export {};
