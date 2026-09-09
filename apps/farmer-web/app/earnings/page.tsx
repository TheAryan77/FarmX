import type { FarmerEarnings } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardContent } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { quintals, rupees, shortDate } from "@/lib/format";
import { ErrorPanel } from "@/app/components/error-panel";
import { PageHeader } from "@/app/components/page-header";

export const metadata = { title: "My earnings · FasalX Farmer" };

/**
 * Month-to-date earnings.
 *
 * The headline is additional realisation — what FasalX added over the mandi
 * estimate — because that is the platform's entire claim, and a farmer should
 * be able to check it against their own deals listed underneath.
 */
export default async function EarningsPage() {
  if (!(await getSessionToken())) redirect("/login");

  let earnings: FarmerEarnings;
  try {
    earnings = await apiCall<FarmerEarnings>("/settlements/my-earnings");
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load your earnings"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  const hasEarnings = earnings.settlements.length > 0;
  const extra = earnings.additionalRealisationRupees;

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 p-5 pb-10">
      <PageHeader title="My earnings" subtitle={earnings.monthLabel} />

      {!hasEarnings ? (
        <Card className="border-dashed">
          <CardContent className="space-y-3 text-center">
            <p className="text-4xl" aria-hidden>
              💰
            </p>
            <p className="text-xl font-semibold">Nothing settled yet</p>
            <p className="text-base text-muted-foreground">
              Once a buyer approves a delivery, your payment and earnings appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="space-y-1">
              <p className="text-base text-muted-foreground">
                Extra earned with FasalX this month
              </p>
              <p className="text-4xl font-bold text-primary">
                {extra >= 0 ? "+" : "−"}
                {rupees(Math.abs(extra))}
              </p>
              <p className="text-sm text-muted-foreground">
                Against an estimate of the same produce sold at the mandi
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total received" value={rupees(earnings.totalSalesRupees)} />
            <Stat label="Sold" value={quintals(earnings.totalQuintals)} />
            <Stat
              label="Average price"
              value={`${rupees(earnings.averagePriceRealised)}/Q`}
            />
            <Stat
              label="Deals"
              value={`${earnings.orders}`}
              hint={`${earnings.successfulDeliveries} delivered`}
            />
          </div>

          <div className="space-y-3">
            <p className="text-lg font-semibold">Your deals this month</p>
            {earnings.settlements.map((settlement) => (
              <Link key={settlement.id} href={`/orders/${settlement.orderId}`} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold">{settlement.orderNo}</p>
                        <p className="text-sm text-muted-foreground">
                          {quintals(settlement.allocatedQuintals)} at{" "}
                          {rupees(settlement.pricePerQuintal)}/Q
                          {settlement.releasedAt
                            ? ` · ${shortDate(settlement.releasedAt.slice(0, 10))}`
                            : ""}
                        </p>
                      </div>
                      <Badge variant="success" size="lg">
                        Paid
                      </Badge>
                    </div>
                    <div className="flex items-end justify-between gap-3 border-t pt-2">
                      <div>
                        <p className="text-sm text-muted-foreground">You received</p>
                        <p className="text-xl font-bold">{rupees(settlement.netRupees)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Extra vs mandi</p>
                        <p className="text-xl font-bold text-primary">
                          +{rupees(settlement.farmerGainRupees)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <p className="rounded-md border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              The mandi comparison is an estimate.
            </span>{" "}
            {earnings.assumptions.traditionalNote}
          </p>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-0.5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
