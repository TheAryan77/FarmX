import type { AuthUser, OfferThread } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { offerStatusLabel, quintals, rupees, timeLeft } from "@/lib/format";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";
import { OfferActions } from "./offer-actions";

export const metadata = { title: "Offers · FasalX Buyer" };

export default async function OffersPage() {
  if (!(await getSessionToken())) redirect("/login");

  let user: AuthUser;
  let threads: OfferThread[];
  try {
    [user, threads] = await Promise.all([
      apiCall<AuthUser>("/auth/me"),
      apiCall<OfferThread[]>("/offers/mine"),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load your offers"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  const waiting = threads.filter((t) => t.awaitingYou);

  return (
    <AppShell user={user}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Negotiations</h1>
        <p className="text-sm text-muted-foreground">
          {waiting.length > 0
            ? `${waiting.length} waiting on you`
            : "Every negotiation you have opened with a farmer."}
        </p>
      </div>

      {threads.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No offers yet</CardTitle>
            <CardDescription>
              Open a requirement, pick a farmer from the matching supply, and make an offer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard">Go to requirements</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {threads.map((thread) => (
            <li key={thread.rootId}>
              <ThreadCard thread={thread} />
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function ThreadCard({ thread }: { thread: OfferThread }) {
  const status = offerStatusLabel(thread.latest.status, thread.awaitingYou);
  const expiry = thread.awaitingYou ? timeLeft(thread.latest.expiresAt) : null;

  return (
    <Card className={thread.awaitingYou ? "border-primary/40" : undefined}>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Link
                href={`/listings/${thread.listing.id}`}
                className="text-lg font-semibold hover:text-primary hover:underline"
              >
                {thread.farmer.name}
              </Link>
              <Badge variant="outline">Grade {thread.listing.grade}</Badge>
              <Badge variant={status.variant}>{status.text}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {thread.farmer.village}, {thread.farmer.district} ·{" "}
              {quintals(thread.latest.quantityQuintals)}{" "}
              <span className="capitalize">{thread.listing.crop}</span> · asking{" "}
              {rupees(thread.listing.expectedPricePerQuintal)}/Q
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">{rupees(thread.latest.pricePerQuintal)}/Q</p>
            <p className="text-xs text-muted-foreground">
              {rupees(thread.latest.totalRupees)}
              {expiry ? ` · ${expiry}` : ""}
            </p>
          </div>
        </div>

        {thread.history.length > 1 ? (
          <ol className="flex flex-wrap items-center gap-2 text-xs">
            {thread.history.map((offer, i) => (
              <li key={offer.id} className="flex items-center gap-2">
                {i > 0 ? <span className="text-muted-foreground">→</span> : null}
                <span className="rounded border bg-muted/50 px-2 py-0.5">
                  <span className="text-muted-foreground">
                    {offer.initiatedBy === "BUYER" ? "You" : thread.farmer.name.split(" ")[0]}
                  </span>{" "}
                  <span className="font-semibold">{rupees(offer.pricePerQuintal)}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {thread.orderId ? (
          <div className="border-t pt-3">
            <Button asChild size="sm" variant="outline">
              <Link href={`/orders/${thread.orderId}`}>View order {thread.orderNo}</Link>
            </Button>
          </div>
        ) : (
          <OfferActions thread={thread} />
        )}
      </CardContent>
    </Card>
  );
}
