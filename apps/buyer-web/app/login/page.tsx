import type { AuthUser } from "@fasalx/types";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fasalx/ui";

import { apiCall } from "@/lib/api";
import { APP_ROLE, getSessionToken } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · FasalX Buyer" };

/**
 * The presence of a cookie is not a session — see the farmer app's login page
 * for the redirect loop this guard exists to prevent.
 */
async function hasLiveSession(): Promise<boolean> {
  if (!(await getSessionToken())) return false;
  try {
    const user = await apiCall<AuthUser>("/auth/me");
    return user.role === APP_ROLE;
  } catch {
    return false;
  }
}

export default async function LoginPage() {
  if (await hasLiveSession()) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-[0.2em] text-primary uppercase">FasalX</p>
          <h1 className="text-2xl font-bold tracking-tight">Buyer procurement</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Source verified produce direct from farmers and FPOs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Demo buyer account: <span className="font-mono">9812345678</span> (ABC Foods)
        </p>
      </div>
    </main>
  );
}
