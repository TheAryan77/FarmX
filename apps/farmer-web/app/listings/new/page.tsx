import type { AuthUser, PriceSnapshot } from "@fasalx/types";
import { redirect } from "next/navigation";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { ErrorPanel } from "@/app/components/error-panel";
import { PageHeader } from "@/app/components/page-header";
import { ListingForm } from "./listing-form";

export const metadata = { title: "Sell produce · FasalX Farmer" };

export default async function NewListingPage() {
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

  const district = user.district ?? "Karnal";

  // Used only to prefill and to show today's rate. A failure here must not stop
  // the farmer listing produce, so the form renders without it.
  const [price, mine] = await Promise.all([
    apiCall<PriceSnapshot>(
      `/market/price?crop=wheat&district=${encodeURIComponent(district)}`,
    ).catch(() => null),
    apiCall<{ village: string }[]>("/listings/mine").catch(() => null),
  ]);

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-6 p-5 pb-10">
      <PageHeader title="Sell produce" subtitle="Tell FasalX what you have to sell." />
      <ListingForm
        village={mine?.[0]?.village ?? district}
        district={district}
        suggestedPrice={price?.modalPricePerQuintal ?? null}
      />
    </main>
  );
}
