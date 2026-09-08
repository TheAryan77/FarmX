import type { Listing } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, CardContent } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { GRADE_LABEL, quintals, rupees, shortDate, STATUS_LABEL } from "@/lib/format";
import { ErrorPanel } from "@/app/components/error-panel";
import { PageHeader } from "@/app/components/page-header";

export const metadata = { title: "My listings · FasalX Farmer" };

export default async function MyListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  if (!(await getSessionToken())) redirect("/login");

  const { created } = await searchParams;

  let listings: Listing[];
  try {
    listings = await apiCall<Listing[]>("/listings/mine");
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load your listings"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 p-5 pb-10">
      <PageHeader
        title="My listings"
        subtitle={
          listings.length === 0
            ? undefined
            : `${listings.length} ${listings.length === 1 ? "listing" : "listings"}`
        }
      />

      {created ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success/10 px-4 py-3 text-base font-medium text-success"
        >
          ✓ Your produce is listed. Buyers can see it now.
        </p>
      ) : null}

      {listings.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-3 text-center">
            <p className="text-4xl" aria-hidden>
              🌾
            </p>
            <p className="text-xl font-semibold">Nothing listed yet</p>
            <p className="text-base text-muted-foreground">
              List your wheat and buyers will start making offers.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {listings.map((listing) => (
            <li key={listing.id}>
              <ListingCard listing={listing} />
            </li>
          ))}
        </ul>
      )}

      <Button asChild size="touch" className="w-full text-lg">
        <Link href="/listings/new">Sell more produce</Link>
      </Button>
    </main>
  );
}

function ListingCard({ listing }: { listing: Listing }) {
  const status = STATUS_LABEL[listing.status];

  return (
    <Link href={`/listings/${listing.id}`} className="block">
      <Card className="transition-colors hover:border-primary/40">
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-bold">
                {quintals(listing.quantityQuintals)}{" "}
                <span className="font-semibold capitalize">{listing.crop}</span>
              </p>
              <p className="text-base text-muted-foreground">
                {GRADE_LABEL[listing.grade] ?? listing.grade} · {listing.village}
              </p>
            </div>
            <Badge variant={status.variant} size="lg">
              {status.text}
            </Badge>
          </div>

          <div className="flex items-end justify-between gap-3 border-t pt-3">
            <div>
              <p className="text-sm text-muted-foreground">Your price</p>
              <p className="text-xl font-bold">
                {rupees(listing.expectedPricePerQuintal)}
                <span className="text-base font-normal text-muted-foreground"> /Q</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total value</p>
              <p className="text-xl font-bold">{rupees(listing.totalValueRupees)}</p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Ready from {shortDate(listing.availableFrom)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
