import type { RequestHandler } from "express";
import type { ZodError, ZodType } from "zod";

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
      return next(toValidationError(parsed.error, "(body)"));
    }
    req.body = parsed.data;
    return next();
  };
}

/**
 * Same for query strings. The parsed result is stashed on `res.locals` rather
 * than written back to `req.query`, which Express 5 exposes as a getter.
 */
export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return next(toValidationError(parsed.error, "(query)"));
    }
    res.locals["query"] = parsed.data;
    return next();
  };
}

/** Reads what validateQuery stored, typed at the call site. */
export function validatedQuery<T>(res: { locals: Record<string, unknown> }): T {
  return res.locals["query"] as T;
}

function toValidationError(error: ZodError, fallbackField: string): HttpError {
  const fields = error.issues.map((i) => ({
    field: i.path.join(".") || fallbackField,
    message: i.message,
  }));
  return HttpError.badRequest(
    "VALIDATION_ERROR",
    fields[0]?.message ?? "Check the details you entered",
    fields,
  );
}
