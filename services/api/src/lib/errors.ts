import type { ApiError } from "@fasalx/types";

/**
 * Thrown by service modules. The error middleware turns these into
 * `{ error: { code, message } }` — CLAUDE.md's response contract.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  toApiError(): ApiError {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }

  static badRequest(code: string, message: string, details?: unknown): HttpError {
    return new HttpError(400, code, message, details);
  }

  static unauthorized(message = "Sign in to continue"): HttpError {
    return new HttpError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "You do not have access to this"): HttpError {
    return new HttpError(403, "FORBIDDEN", message);
  }

  static notFound(code: string, message: string): HttpError {
    return new HttpError(404, code, message);
  }
}
