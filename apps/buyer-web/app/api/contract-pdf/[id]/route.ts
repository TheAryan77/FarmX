import { getSessionToken } from "@/lib/session";

/**
 * Streams a contract PDF from the API.
 *
 * The browser cannot fetch it directly: the session token lives in an httpOnly
 * cookie that only this app's server can read, and the API is a different
 * origin. So the request is proxied here with the bearer attached, which also
 * means the PDF is never reachable without a valid session.
 */
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const token = await getSessionToken();
  if (!token) {
    return new Response("Sign in to view this contract", { status: 401 });
  }

  const { id } = await params;

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/contracts/${id}/pdf`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return new Response("Cannot reach the FasalX server", { status: 503 });
  }

  if (!upstream.ok) {
    return new Response("Contract document unavailable", { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${id}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
