import { redirect } from "next/navigation";
import { Card, CardContent } from "@fasalx/ui";

import { getSessionToken } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · FasalX Farmer" };

export default async function LoginPage() {
  if (await getSessionToken()) redirect("/dashboard");

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
