import type { Role } from "@fasalx/types";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { HttpError } from "../lib/errors.js";
import { verifyToken } from "../lib/jwt.js";

/**
 * Bearer-token auth. The API reads no cookies: each web app keeps its own
 * httpOnly cookie and attaches the token server-side. Cookies are scoped by
 * domain and ignore ports, so a shared cookie on `localhost` would make the
 * farmer and buyer sessions overwrite one another — and the demo needs both
 * signed in at the same time. Staying bearer-only also means a future
 * voice/IVR layer authenticates against these same routes.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.get("authorization");

  if (!header?.startsWith("Bearer ")) {
    return next(HttpError.unauthorized("Sign in to continue"));
  }

  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) {
    return next(HttpError.unauthorized("Sign in to continue"));
  }

  try {
    req.auth = verifyToken(token);
    return next();
  } catch (err) {
    return next(err);
  }
};

/** Route-level RBAC. Must run after requireAuth. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) {
      return next(HttpError.unauthorized("Sign in to continue"));
    }
    if (!roles.includes(auth.role)) {
      return next(
        HttpError.forbidden(
          `This action is for ${roles.join(" or ")} accounts — you are signed in as ${auth.role}`,
        ),
      );
    }
    return next();
  };
}
