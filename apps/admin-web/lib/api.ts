import type { ApiError, ApiResponse } from "@fasalx/types";

import { getSessionToken } from "./session";

/**
 * Server-side API client for the operations console.
 *
 * Every call runs on the Next server, which reads the httpOnly cookie and
 * attaches the bearer token itself. The browser never sees the token and the
 * API stays a plain REST service — the same one a voice/IVR layer would call.
 */
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface ApiCallOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /**
   * Multipart payload, for endpoints that accept a file. Passed straight to
   * fetch with no content-type header — the boundary has to be generated, and
   * setting the header by hand breaks the upload.
   */
  form?: FormData;
  /** Send the session bearer token. Off for login, where none exists yet. */
  auth?: boolean;
}

export async function apiCall<T>(pathname: string, options: ApiCallOptions = {}): Promise<T> {
  const { method = "GET", body, form, auth = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined && form === undefined) headers["content-type"] = "application/json";

  if (auth) {
    const token = await getSessionToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${pathname}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      cache: "no-store",
    });
  } catch {
    // The API being down must not render a stack trace or a blank page.
    throw new ApiRequestError(
      503,
      "API_UNREACHABLE",
      "Cannot reach the FasalX server. Is the API running on port 4000?",
    );
  }

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || payload === null || "error" in payload) {
    const err: ApiError | undefined = payload && "error" in payload ? payload.error : undefined;
    throw new ApiRequestError(
      response.status,
      err?.code ?? "UNKNOWN_ERROR",
      err?.message ?? "Something went wrong",
    );
  }

  return payload.data;
}
