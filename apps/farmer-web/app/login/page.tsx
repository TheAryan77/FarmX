import type { AuthUser } from "@fasalx/types";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@fasalx/ui";

import { apiCall } from "@/lib/api";
import { APP_ROLE, getSessionToken } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · FasalX Farmer" };

/**
 * The presence of a cookie is not a session.
 *
 * Every guarded page verifies the token against the API and sends a rejected
 * one back here. When this page only checked that a cookie *existed* it sent
 * it straight back — so a token the API no longer accepts (minted against an
 * earlier seed, expired, or for the wrong role) locked the app in an
 * ERR_TOO_MANY_REDIRECTS loop with no way left to sign in.
 *
 * So verify, and fall through to the form whenever the answer is no. A stale
 * cookie is then harmless: it is overwritten by the next successful sign-in.
 */
async function hasLiveSession(): Promise<boolean> {
  if (!(await getSessionToken())) return false;
  try {
    const user = await apiCall<AuthUser>("/auth/me");
    return user.role === APP_ROLE;
  } catch {
    // Rejected, expired, wrong role, or the API is unreachable — in every one
    // of those cases this person needs the form, not another redirect.
    return false;
  }
}

export default async function LoginPage() {
  if (await hasLiveSession()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-5">
      <header className="space-y-2">
        <p className="text-4xl">🌾</p>
        <h1 className="text-3xl font-bold tracking-tight">FasalX</h1>
        <p className="text-lg text-muted-foreground">
          Sell your produce direct to buyers. No middlemen.
        </p>
      </header>

      <Card>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Demo farmer account: <span className="font-mono font-medium">9876543210</span>
      </p>
    </main>
  );
}
