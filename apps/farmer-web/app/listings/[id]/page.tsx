import type { AuthUser, Listing } from "@fasalx/types";
import { redirect } from "next/navigation";
import { Badge, Card, CardContent } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { GRADE_LABEL, quintals, rupees, shortDate, STATUS_LABEL } from "@/lib/format";
import { ErrorPanel } from "@/app/components/error-panel";
import { PageHeader } from "@/app/components/page-header";
import { RemoveListing } from "./remove-listing";

export const metadata = { title: "Listing · FasalX Farmer" };

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await getSessionToken())) redirect("/login");

  const { id } = await params;

  let listing: Listing;
  let user: AuthUser;
  try {
    // GET /listings/:id is public so buyers can browse, but this screen is
    // titled "Your listing" — so ownership is checked here rather than only
    // hiding the remove button, which would still show a farmer someone
    // else's produce and then fail the delete with a 403.
    [listing, user] = await Promise.all([
      apiCall<Listing>(`/listings/${id}`),
      apiCall<AuthUser>("/auth/me"),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Listing not found"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
        backHref="/listings"
        backLabel="Back to my listings"
      />
    );
  }

  if (listing.farmer.id !== user.profileId) {
    return (
      <ErrorPanel
        title="Not your listing"
        message="This produce belongs to another farmer, so you cannot view or change it here."
        backHref="/listings"
        backLabel="Back to my listings"
      />
    );
  }

  const status = STATUS_LABEL[listing.status];
  const canRemove = listing.reservedQuintals === 0 && listing.status === "ACTIVE";

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 p-5 pb-10">
      <PageHeader title="Your listing" backHref="/listings" />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-3xl font-bold">
                {quintals(listing.quantityQuintals)}{" "}
                <span className="capitalize">{listing.crop}</span>
              </p>
              <p className="text-lg text-muted-foreground">
                {GRADE_LABEL[listing.grade] ?? listing.grade}
              </p>
            </div>
            <Badge variant={status.variant} size="lg">
              {status.text}
            </Badge>
          </div>

          <dl className="space-y-1 border-t pt-3 text-lg">
            <Row label="Your price" value={`${rupees(listing.expectedPricePerQuintal)} / quintal`} />
            <Row label="Available" value={quintals(listing.availableQuintals)} />
            {listing.reservedQuintals > 0 ? (
              <Row label="Committed" value={quintals(listing.reservedQuintals)} />
            ) : null}
            <Row label="Total value" value={rupees(listing.totalValueRupees)} strong />
            <Row label="Ready from" value={shortDate(listing.availableFrom)} />
            <Row label="Pickup" value={`${listing.village}, ${listing.district}`} />
          </dl>
        </CardContent>
      </Card>

      {listing.reservedQuintals > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-base">
          {quintals(listing.reservedQuintals)} of this produce is committed to a deal, so the
          listing can no longer be removed.
        </p>
      ) : null}

      {canRemove ? <RemoveListing id={listing.id} /> : null}
    </main>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "text-xl font-bold" : "font-semibold"}>{value}</dd>
    </div>
  );
}
