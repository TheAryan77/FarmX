import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fasalx/ui";

import { getSessionToken } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · FasalX Buyer" };

export default async function LoginPage() {
  if (await getSessionToken()) redirect("/dashboard");

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
