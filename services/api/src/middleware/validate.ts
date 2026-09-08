import type { RequestHandler } from "express";
import type { ZodType } from "zod";

import { HttpError } from "../lib/errors.js";

/**
 * Validates the request body against a shared schema from
 * `@fasalx/validation` and replaces the body with the parsed result, so
 * handlers receive typed, trimmed input. Keeps route handlers thin.
 */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => ({
        field: i.path.join(".") || "(body)",
        message: i.message,
      }));
      return next(
        HttpError.badRequest(
          "VALIDATION_ERROR",
          fields[0]?.message ?? "Check the details you entered",
          fields,
        ),
      );
    }
    req.body = parsed.data;
    return next();
  };
}
