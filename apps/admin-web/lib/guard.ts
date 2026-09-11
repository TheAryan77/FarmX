import type { AuthUser } from "@fasalx/types";
import { redirect } from "next/navigation";

import { apiCall, ApiRequestError } from "./api";
import { getSessionToken } from "./session";

/**
 * Loads the signed-in operator and whatever the page needs, in one place.
 *
 * Every admin page needs the same three things: a session, the user for the
 * header, and its own data. Repeating that in each page is how one of them
 * ends up missing the 401 branch and rendering a stack trace instead of the
 * login screen.
 */
export async function loadPage<T>(
  fetchData: () => Promise<T>,
): Promise<{ user: AuthUser; data: T } | { error: string }> {
  if (!(await getSessionToken())) redirect("/login");

  try {
    const [user, data] = await Promise.all([apiCall<AuthUser>("/auth/me"), fetchData()]);
    return { user, data };
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return { error: err instanceof ApiRequestError ? err.message : "Please try again" };
  }
}
