import type { JwtClaims, Role } from "@fasalx/types";
import jwt from "jsonwebtoken";

import { env } from "../env.js";
import { HttpError } from "./errors.js";

/**
 * `expiresIn` is typed as a template-literal duration by
 * @types/jsonwebtoken, which a `string` read from the environment cannot
 * satisfy structurally. env.ts validates the value against exactly that
 * format with a regex, so this narrowing is checked — at startup, not here.
 */
const expiresIn = env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"];

export function signToken(userId: string, role: Role): string {
  const claims: JwtClaims = { sub: userId, role };
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string): JwtClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === "string" || typeof decoded.sub !== "string") {
      throw HttpError.unauthorized("Malformed session token");
    }
    return { sub: decoded.sub, role: decoded["role"] as Role };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw HttpError.unauthorized("Your session expired — sign in again");
    }
    throw HttpError.unauthorized("Invalid session token");
  }
}
