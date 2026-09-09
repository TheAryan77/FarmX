import type { DemandLevel, PricePrediction, PriceRecommendation } from "@fasalx/types";
import { Badge, Card, CardContent, Progress } from "@fasalx/ui";

import { quintals, rupees, shortDate } from "@/lib/format";

/**
 * The farmer home price card — scene 2 of the demo.
 *
 * Leads with the action, not the number: a farmer opening this in a field
 * wants "should I sell today?" answered before anything else. Everything below
 * it exists to justify that one word.
 *
 * Every claim here is labelled with where it came from. When the model is
 * unreachable the forecast disappears rather than degrading into a guess, and
 * when the underlying price history is simulated the card says so.
 */

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted";

const ADVICE: Record<
  PriceRecommendation,
  { headline: string; because: string; variant: BadgeVariant; tone: string }
> = {
  SELL_NOW: {
    headline: "Sell now",
    because: "The rate is expected to fall over the next week.",
    variant: "destructive",
    tone: "border-destructive/30 bg-destructive/5",
  },
  HOLD: {
    headline: "Wait a few days",
    because: "The rate is expected to rise over the next week.",
    variant: "success",
    tone: "border-success/40 bg-success/5",
  },
  SELL_PARTIAL: {
    headline: "Sell part now",
    because: "The rate is not expected to move much either way.",
    variant: "warning",
    tone: "border-warning/40 bg-warning/5",
  },
};

const DEMAND: Record<DemandLevel, { text: string; variant: BadgeVariant }> = {
  HIGH: { text: "Demand HIGH", variant: "success" },
  MODERATE: { text: "Demand steady", variant: "warning" },
  LOW: { text: "Demand low", variant: "muted" },
};

export function PriceCard({ price }: { price: PricePrediction }) {
  const advice = ADVICE[price.recommendation];
  const demand = DEMAND[price.demand.level];
  const hasForecast = price.source === "model";
  const deltaRupees = price.predicted - price.current;
  const simulated = price.model?.dataSource !== "agmarknet-csv";

  return (
    <Card className={hasForecast ? advice.tone : "border-dashed"}>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-lg font-semibold">Wheat · {price.district} mandi</p>
          <Badge variant={demand.variant} size="lg">
            {demand.text}
          </Badge>
        </div>

        <div>
          <p className="text-base text-muted-foreground">Today&apos;s rate</p>
          <p>
            <span className="text-4xl font-bold tracking-tight">{rupees(price.current)}</span>
            <span className="ml-1 text-xl text-muted-foreground">/ quintal</span>
          </p>
        </div>

        {hasForecast ? (
          <>
            <div className="rounded-lg border bg-background/70 p-3">
              <p className="text-lg font-bold">{advice.headline}</p>
              <p className="text-base text-muted-foreground">{advice.because}</p>
            </div>

            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-base text-muted-foreground">Expected in 7 days</span>
                <span className="text-2xl font-bold">
                  {rupees(price.predicted)}
                  <span className="ml-1 text-base font-normal text-muted-foreground">
                    {deltaRupees === 0
                      ? ""
                      : `(${deltaRupees > 0 ? "+" : "−"}${rupees(Math.abs(deltaRupees))})`}
                  </span>
                </span>
              </div>
              <p className="text-base text-muted-foreground">
                Likely between {rupees(price.low)} and {rupees(price.high)}
              </p>
            </div>

            {/* Confidence is a measured backtest figure, so it is shown as one
                rather than as a vague "AI powered" claim. */}
            <div className="space-y-1 border-t pt-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">Forecast reliability</span>
                <span className="text-base font-semibold">
                  {Math.round(price.confidence * 100)}%
                </span>
              </div>
              <Progress value={price.confidence * 100} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {price.model?.tolerancePct
                  ? `Share of past forecasts that landed within ${(price.model.tolerancePct * 100).toFixed(0)}% of the real rate`
                  : "Measured on past forecasts"}
                {price.model?.maeRupees
                  ? ` · typically off by ₹${price.model.maeRupees}/quintal`
                  : ""}
              </p>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-3">
            <p className="text-lg font-semibold">Forecast unavailable</p>
            <p className="text-base text-muted-foreground">
              Today&apos;s mandi rate is shown above. The 7-day outlook will return once the
              prediction service is back.
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Rate on {shortDate(price.asOf)} · {quintals(price.demand.unfilledQuintals)} of buyer
          demand unfilled nearby
          {simulated ? " · prices are simulated for this pilot" : ""}
        </p>
      </CardContent>
    </Card>
  );
}
