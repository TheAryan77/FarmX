import { cookies } from "next/headers";

/**
 * Session cookie for this app.
 *
 * The name is app-specific on purpose. Cookies are scoped by domain and ignore
 * the port, so `localhost:3000` and `localhost:3001` share one jar — a single
 * shared name would make signing into the buyer portal silently sign you out
 * of the farmer app. The demo needs both live at once.
 */
export const SESSION_COOKIE = "fasalx_farmer_session";

/** The only role this app will sign in. */
export const APP_ROLE = "FARMER" as const;

const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionToken(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
