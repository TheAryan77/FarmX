import type { ErrorRequestHandler, RequestHandler } from "express";

import { HttpError } from "../lib/errors.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` },
  });
};

/**
 * Terminal error handler. CLAUDE.md: every route returns `{ data }` or
 * `{ error: { code, message } }` — never a stack trace, never a blank body.
 */
/** body-parser rejects unparseable JSON with a tagged SyntaxError. */
function isJsonParseError(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    (err as SyntaxError & { type?: string }).type === "entity.parse.failed"
  );
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.toApiError() });
    return;
  }

  // multer rejects an oversized or wrong-typed upload with its own error
  // class; that is the client's mistake, not ours.
  if (err instanceof Error && err.name === "MulterError") {
    const message =
      (err as Error & { code?: string }).code === "LIMIT_FILE_SIZE"
        ? "That photo is too large — keep it under 8 MB"
        : "That file could not be accepted";
    res.status(400).json({ error: { code: "UPLOAD_REJECTED", message } });
    return;
  }
  if (err instanceof Error && err.message.startsWith("Delivery proof must be")) {
    res.status(400).json({ error: { code: "UPLOAD_REJECTED", message: err.message } });
    return;
  }

  // A client sending broken JSON is a 400, not a 500.
  if (isJsonParseError(err)) {
    res.status(400).json({
      error: { code: "BAD_JSON", message: "Request body is not valid JSON" },
    });
    return;
  }

  console.error("[api] unhandled error:", err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side" },
  });
};
