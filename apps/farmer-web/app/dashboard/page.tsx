import type { AuthUser, Listing, OfferThread, Order, PricePrediction } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, CardContent } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { quintals } from "@/lib/format";
import { signOutAction } from "@/app/actions";
import { ErrorPanel } from "@/app/components/error-panel";
import { PriceCard } from "@/app/components/price-card";

export const metadata = { title: "Home · FasalX Farmer" };

/**
 * Farmer home.
 *
 * Designed for a cheap Android phone in daylight: one column, 18-20px body
 * text, 56px+ targets, and a single obvious next action.
 */
export default async function HomePage() {
  if (!(await getSessionToken())) redirect("/login");

  let user: AuthUser;
  try {
    user = await apiCall<AuthUser>("/auth/me");
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load your account"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  // The price card and the listing count are independent: if the outlook
  // lookup fails, the farmer should still be able to reach "Sell produce".
  // /ai/price degrades to the latest mandi row on its own, so this only
  // returns null when there is no price data at all.
  const [price, listings, offers, orders] = await Promise.all([
    apiCall<PricePrediction>(
      `/ai/price?crop=wheat&district=${encodeURIComponent(user.district ?? "Karnal")}`,
    ).catch(() => null),
    apiCall<Listing[]>("/listings/mine").catch(() => null),
    apiCall<OfferThread[]>("/offers/mine").catch(() => null),
    apiCall<Order[]>("/orders/mine").catch(() => null),
  ]);

  const awaiting = offers?.filter((t) => t.awaitingYou).length ?? 0;

  const firstName = user.name.split(" ")[0] ?? user.name;
  const liveListings = listings?.filter((l) => l.status === "ACTIVE") ?? [];
  const totalAvailable = liveListings.reduce((sum, l) => sum + l.availableQuintals, 0);

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 p-5 pb-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg text-muted-foreground">Namaste,</p>
          <h1 className="text-3xl font-bold tracking-tight">{firstName}</h1>
          <p className="text-base text-muted-foreground">
            {user.district ? `${user.district}, Haryana` : "Haryana"}
          </p>
        </div>
        <span className="text-4xl" aria-hidden>
          🌾
        </span>
      </header>

      {price ? <PriceCard price={price} /> : <PriceUnavailable />}

      <div className="space-y-3">
        <Button asChild size="touch" className="w-full text-lg">
          <Link href="/listings/new">Sell produce</Link>
        </Button>
        <Button
          asChild
          size="touch"
          variant={awaiting > 0 ? "default" : "outline"}
          className="w-full text-lg"
        >
          <Link href="/offers">
            Offers
            {awaiting > 0 ? (
              <Badge variant="secondary" size="lg" className="ml-1">
                {awaiting} new
              </Badge>
            ) : null}
          </Link>
        </Button>

        <div className="grid grid-cols-2 gap-3">
          <Button asChild size="touch" variant="outline" className="text-base">
            <Link href="/listings">
              My listings
              {liveListings.length > 0 ? (
                <Badge variant="secondary" className="ml-1">
                  {liveListings.length}
                </Badge>
              ) : null}
            </Link>
          </Button>
          <Button asChild size="touch" variant="outline" className="text-base">
            <Link href="/orders">
              My deals
              {orders && orders.length > 0 ? (
                <Badge variant="secondary" className="ml-1">
                  {orders.length}
                </Badge>
              ) : null}
            </Link>
          </Button>
        </div>
      </div>

      {liveListings.length > 0 ? (
        <Card>
          <CardContent className="space-y-1">
            <p className="text-base text-muted-foreground">You have listed</p>
            <p className="text-2xl font-bold">{quintals(totalAvailable)} wheat</p>
            <p className="text-base text-muted-foreground">
              Across {liveListings.length} live {liveListings.length === 1 ? "listing" : "listings"}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <form action={signOutAction} className="pt-2">
        <Button type="submit" size="touch" variant="ghost" className="w-full text-base">
          Sign out
        </Button>
      </form>
    </main>
  );
}

function PriceUnavailable() {
  return (
    <Card className="border-dashed">
      <CardContent>
        <p className="text-lg font-semibold">Today&apos;s rate is unavailable</p>
        <p className="text-base text-muted-foreground">
          You can still list your produce — the rate will appear once the market service is back.
        </p>
      </CardContent>
    </Card>
  );
}
