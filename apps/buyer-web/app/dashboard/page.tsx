import type { AuthUser } from "@fasalx/types";
import { redirect } from "next/navigation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { signOutAction } from "@/app/actions";

export const metadata = { title: "Dashboard · FasalX Buyer" };

export default async function DashboardPage() {
  if (!(await getSessionToken())) redirect("/login");

  let user: AuthUser;
  try {
    user = await apiCall<AuthUser>("/auth/me");
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    const message = err instanceof ApiRequestError ? err.message : "Could not load your account";
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Cannot load your account</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" className="w-full">
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold tracking-[0.2em] text-primary uppercase">
              FasalX
            </span>
            <span className="text-sm text-muted-foreground">Buyer procurement</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{user.name}</span>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {user.role}
            </span>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Requirements, matched supply and contracts appear here next.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
              <Field label="Contact" value={user.name} />
              <Field label="Mobile" value={`+91 ${user.phone}`} />
              <Field label="District" value={user.district ?? "—"} />
            </dl>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
