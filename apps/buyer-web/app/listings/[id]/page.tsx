import type { AuthUser, Listing } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { GRADE_LABEL, km, quintals, rupees, rupeesCompact, shortDate } from "@/lib/format";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";
import { OfferForm } from "./offer-form";

export const metadata = { title: "Supply · FasalX Buyer" };

export default async function SupplyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ requirementId?: string }>;
}) {
  if (!(await getSessionToken())) redirect("/login");

  const [{ id }, { requirementId }] = await Promise.all([params, searchParams]);

  let user: AuthUser;
  let listing: Listing;
  try {
    [user, listing] = await Promise.all([
      apiCall<AuthUser>("/auth/me"),
      apiCall<Listing>(`/listings/${id}`),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load this listing"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  const openForOffers =
    listing.availableQuintals > 0 &&
    (listing.status === "ACTIVE" || listing.status === "PARTIALLY_ALLOCATED");

  return (
    <AppShell user={user}>
      <div className="space-y-1">
        <Link
          href={requirementId ? `/requirements/${requirementId}` : "/dashboard"}
          className="text-sm text-muted-foreground hover:text-primary"
        >
          ← Back
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight capitalize">
            {quintals(listing.quantityQuintals)} {listing.crop}
          </h1>
          <Badge variant="outline">{GRADE_LABEL[listing.grade]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {listing.farmer.name} · {listing.village}, {listing.district}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Asking price" value={`${rupees(listing.expectedPricePerQuintal)}/Q`} />
        <Stat
          label="Available"
          value={quintals(listing.availableQuintals)}
          hint={
            listing.reservedQuintals > 0
              ? `${quintals(listing.reservedQuintals)} already committed`
              : undefined
          }
        />
        <Stat label="Lot value" value={rupeesCompact(listing.totalValueRupees)} />
        <Stat
          label="Distance"
          value={km(listing.distanceKm)}
          hint={`Ready ${shortDate(listing.availableFrom)}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Seller</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <Field label="Farmer" value={listing.farmer.name} />
            <Field
              label="Rating"
              value={`${listing.farmer.rating.toFixed(1)} · ${listing.farmer.completedOrders} completed orders`}
            />
            <Field label="Location" value={`${listing.farmer.village}, ${listing.farmer.district}`} />
          </dl>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Make an offer</CardTitle>
          <CardDescription>
            The farmer can accept, decline, or counter with their own price.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {openForOffers ? (
            <OfferForm
              listingId={listing.id}
              {...(requirementId ? { requirementId } : {})}
              availableQuintals={listing.availableQuintals}
              askingPrice={listing.expectedPricePerQuintal}
            />
          ) : (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              This produce is fully committed to another deal and is no longer open for offers.
            </p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-0.5">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className="text-xl font-bold tracking-tight">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
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
