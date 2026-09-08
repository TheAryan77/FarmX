import type { AuthUser } from "@fasalx/types";
import { redirect } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { signOutAction } from "@/app/actions";

export const metadata = { title: "Dashboard · FasalX Farmer" };

export default async function DashboardPage() {
  if (!(await getSessionToken())) redirect("/login");

  // The session is proved by asking the API who we are, rather than trusting
  // anything decoded client-side.
  let user: AuthUser;
  try {
    user = await apiCall<AuthUser>("/auth/me");
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    const message =
      err instanceof ApiRequestError ? err.message : "Could not load your account";
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-5">
        <h1 className="text-2xl font-bold">Cannot load your account</h1>
        <p className="text-lg text-muted-foreground">{message}</p>
        <form action={signOutAction}>
          <Button type="submit" size="touch" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </main>
    );
  }

  const firstName = user.name.split(" ")[0] ?? user.name;

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 p-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg text-muted-foreground">Namaste,</p>
          <h1 className="text-3xl font-bold tracking-tight">{firstName}</h1>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
          {user.role}
        </span>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">You are signed in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-lg">
          <Row label="Name" value={user.name} />
          <Row label="Mobile" value={`+91 ${user.phone}`} />
          <Row label="District" value={user.district ?? "—"} />
        </CardContent>
      </Card>

      <p className="text-base text-muted-foreground">
        Your prices, listings and deals appear here next.
      </p>

      <form action={signOutAction}>
        <Button type="submit" size="touch" variant="outline" className="w-full text-base">
          Sign out
        </Button>
      </form>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
