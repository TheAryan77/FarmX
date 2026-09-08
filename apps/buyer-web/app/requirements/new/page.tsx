import type { AuthUser, PriceSnapshot } from "@fasalx/types";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";
import { RequirementForm } from "./requirement-form";

export const metadata = { title: "New requirement · FasalX Buyer" };

export default async function NewRequirementPage() {
  if (!(await getSessionToken())) redirect("/login");

  let user: AuthUser;
  try {
    user = await apiCall<AuthUser>("/auth/me");
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot open this form"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  // Prefills the target price. A failure must not block posting a requirement.
  const price = await apiCall<PriceSnapshot>(
    `/market/price?crop=wheat&district=${encodeURIComponent(user.district ?? "Karnal")}`,
  ).catch(() => null);

  return (
    <AppShell user={user}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New requirement</h1>
        <p className="text-sm text-muted-foreground">
          FasalX will find and aggregate farmer supply that fits these constraints.
        </p>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">What do you need?</CardTitle>
          <CardDescription>
            Collection distance is measured from {user.district ?? "your registered location"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequirementForm suggestedPrice={price?.modalPricePerQuintal ?? null} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
