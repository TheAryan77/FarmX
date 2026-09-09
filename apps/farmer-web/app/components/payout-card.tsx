import type { Settlement, SettlementAssumptions } from "@fasalx/types";
import { Card, CardContent } from "@fasalx/ui";

import { quintals, rupees } from "@/lib/format";

/**
 * The money screen — what the whole platform exists to change.
 *
 * Leads with net, because that is the number a farmer actually receives.
 * Everything below it exists to account for the difference between that and
 * the gross, and then to say what the same lot would have fetched through the
 * mandi.
 *
 * The comparison is labelled an estimate every single time it appears. A
 * precise-looking fabricated number would be worse than no comparison at all,
 * and the assumption behind it travels from the API rather than being restated
 * here where it could drift.
 */
export function PayoutCard({
  settlement,
  assumptions,
}: {
  settlement: Settlement;
  assumptions: SettlementAssumptions;
}) {
  const { grossRupees, logisticsShareRupees, platformFeeRupees, netRupees } = settlement;

  // Widths for the breakdown bar. Deductions are small against gross, so they
  // get a floor — a 1px sliver communicates nothing.
  const share = (value: number) =>
    grossRupees > 0 ? Math.max((value / grossRupees) * 100, 1.5) : 0;

  const gainPositive = settlement.farmerGainRupees >= 0;

  return (
    <>
      <Card className="border-success/40 bg-success/5">
        <CardContent className="space-y-1">
          <p className="text-lg font-semibold">You received</p>
          <p className="text-5xl font-bold tracking-tight text-success">
            {rupees(netRupees)}
          </p>
          <p className="text-base text-muted-foreground">
            For {quintals(settlement.allocatedQuintals)} at{" "}
            {rupees(settlement.pricePerQuintal)} per quintal
          </p>
        </CardContent>
      </Card>

      {/* Where the money went — the deductions, in full, with nothing hidden. */}
      <Card>
        <CardContent className="space-y-4">
          <p className="text-lg font-semibold">Where your money went</p>

          <div className="flex h-7 w-full overflow-hidden rounded-md" role="img"
            aria-label={`Of ${rupees(grossRupees)} gross, ${rupees(netRupees)} reached you, ${rupees(logisticsShareRupees)} went to transport and ${rupees(platformFeeRupees)} to the platform fee`}
          >
            <span
              className="flex items-center justify-center bg-success text-xs font-bold text-success-foreground"
              style={{ width: `${share(netRupees)}%` }}
            >
              You
            </span>
            <span
              className="bg-chart-2"
              style={{ width: `${share(logisticsShareRupees)}%` }}
              title={`Transport ${rupees(logisticsShareRupees)}`}
            />
            <span
              className="bg-chart-5"
              style={{ width: `${share(platformFeeRupees)}%` }}
              title={`FasalX fee ${rupees(platformFeeRupees)}`}
            />
          </div>

          <dl className="space-y-1 text-lg">
            <Row label="Buyer paid" value={rupees(grossRupees)} />
            <Row
              label="Transport (your share)"
              value={`− ${rupees(logisticsShareRupees)}`}
              hint="Shared with the other farmers on your truck"
            />
            <Row
              label={`FasalX fee (${Math.round(assumptions.platformFeeRate * 100)}%)`}
              value={`− ${rupees(platformFeeRupees)}`}
            />
            <div className="flex justify-between gap-4 border-t pt-2">
              <dt className="text-lg font-semibold">You received</dt>
              <dd className="text-2xl font-bold text-success">{rupees(netRupees)}</dd>
            </div>
          </dl>

          <p className="text-sm text-muted-foreground">
            {Math.round((netRupees / grossRupees) * 100)}% of what the buyer paid reached you.
          </p>
        </CardContent>
      </Card>

      {/* The comparison. Labelled as an estimate, with the reasoning attached. */}
      <Card className={gainPositive ? "border-primary/30 bg-primary/5" : undefined}>
        <CardContent className="space-y-3">
          <p className="text-lg font-semibold">Compared with selling at the mandi</p>

          <dl className="space-y-1 text-lg">
            <Row label="Through FasalX" value={rupees(netRupees)} strong />
            <Row
              label="Mandi estimate"
              value={rupees(settlement.traditionalEstimateRupees)}
            />
            <div className="flex justify-between gap-4 border-t pt-2">
              <dt className="text-lg font-semibold">
                {gainPositive ? "You earned extra" : "Difference"}
              </dt>
              <dd
                className={`text-3xl font-bold ${gainPositive ? "text-primary" : "text-destructive"}`}
              >
                {gainPositive ? "+" : "−"}
                {rupees(Math.abs(settlement.farmerGainRupees))}
              </dd>
            </div>
          </dl>

          {gainPositive ? (
            <p className="text-base font-medium">
              That is {Math.round(settlement.farmerGainPercent * 100)}% more than this lot
              would likely have fetched through the mandi.
            </p>
          ) : null}

          <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">This comparison is an estimate.</span>{" "}
            {assumptions.traditionalNote}
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <dt>
        <span className="text-muted-foreground">{label}</span>
        {hint ? <span className="block text-sm text-muted-foreground/80">{hint}</span> : null}
      </dt>
      <dd className={strong ? "font-bold" : "font-semibold"}>{value}</dd>
    </div>
  );
}
