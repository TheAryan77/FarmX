import type { OfferThread } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, CardContent } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { offerStatusLabel, quintals, rupees, timeLeft } from "@/lib/format";
import { ErrorPanel } from "@/app/components/error-panel";
import { PageHeader } from "@/app/components/page-header";
import { OfferActions } from "./offer-actions";

export const metadata = { title: "Offers · FasalX Farmer" };

export default async function OffersPage() {
  if (!(await getSessionToken())) redirect("/login");

  let threads: OfferThread[];
  try {
    threads = await apiCall<OfferThread[]>("/offers/mine");
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
    <main className="mx-auto min-h-dvh max-w-md space-y-5 p-5 pb-10">
      <PageHeader
        title="Offers"
        subtitle={
          waiting.length > 0
            ? `${waiting.length} waiting for your answer`
            : threads.length > 0
              ? "Nothing needs your answer right now"
              : undefined
        }
      />

      {threads.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-3 text-center">
            <p className="text-4xl" aria-hidden>
              📨
            </p>
            <p className="text-xl font-semibold">No offers yet</p>
            <p className="text-base text-muted-foreground">
              When a buyer is interested in your produce, their price appears here.
            </p>
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
    </main>
  );
}

function ThreadCard({ thread }: { thread: OfferThread }) {
  const status = offerStatusLabel(thread.latest.status, thread.awaitingYou);
  const expiry = thread.awaitingYou ? timeLeft(thread.latest.expiresAt) : null;

  // Whose price is currently on the table decides how the comparison reads.
  const mine = thread.latest.initiatedBy === "FARMER";
  const buyersLastPrice = [...thread.history]
    .reverse()
    .find((o) => o.initiatedBy === "BUYER")?.pricePerQuintal;

  return (
    <Card className={thread.awaitingYou ? "border-primary/40" : undefined}>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xl font-bold">{thread.buyer.companyName}</p>
            <p className="text-base text-muted-foreground">
              wants {quintals(thread.latest.quantityQuintals)}{" "}
              <span className="capitalize">{thread.listing.crop}</span> · Grade{" "}
              {thread.listing.grade}
            </p>
          </div>
          <Badge variant={status.variant} size="lg">
            {status.text}
          </Badge>
        </div>

        {/* Their price against the price you asked for. */}
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3">
          <div>
            <p className="text-sm text-muted-foreground">{mine ? "Your price" : "Their offer"}</p>
            <p className="text-2xl font-bold">
              {rupees(thread.latest.pricePerQuintal)}
              <span className="text-base font-normal text-muted-foreground"> /Q</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">
              {mine ? "They offered" : "You asked"}
            </p>
            <p className="text-2xl font-semibold text-muted-foreground">
              {rupees(
                mine
                  ? (buyersLastPrice ?? thread.listing.expectedPricePerQuintal)
                  : thread.listing.expectedPricePerQuintal,
              )}
              <span className="text-base font-normal"> /Q</span>
            </p>
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <span className="text-base text-muted-foreground">You would receive</span>
          <span className="text-2xl font-bold text-primary">
            {rupees(thread.latest.totalRupees)}
          </span>
        </div>

        {expiry ? <p className="text-sm text-muted-foreground">{expiry}</p> : null}

        {thread.history.length > 1 ? (
          <details className="rounded-md border bg-muted/30 px-3 py-2">
            <summary className="cursor-pointer text-base font-medium">
              How you got here ({thread.history.length} steps)
            </summary>
            <ol className="mt-2 space-y-1 text-base">
              {thread.history.map((offer) => (
                <li key={offer.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    {offer.initiatedBy === "BUYER" ? thread.buyer.companyName : "You"}
                  </span>
                  <span className="font-semibold">{rupees(offer.pricePerQuintal)}/Q</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}

        {thread.orderId ? (
          <Button asChild size="touch" className="w-full text-lg">
            <Link href={`/orders/${thread.orderId}`}>View deal {thread.orderNo}</Link>
          </Button>
        ) : (
          <OfferActions thread={thread} />
        )}
      </CardContent>
    </Card>
  );
}
