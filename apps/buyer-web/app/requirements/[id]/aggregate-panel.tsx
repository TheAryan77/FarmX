"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AggregationProposal } from "@fasalx/types";
import { Badge, Button, Card, CardContent, Input, Label, Progress } from "@fasalx/ui";

import { aggregateAction, createAggregatedOrderAction } from "@/app/actions";
import { quintals, rupees, rupeesCompact } from "@/lib/format";

/** How long each farmer takes to appear as the aggregation fills. */
const REVEAL_STEP_MS = 550;

/**
 * Supply aggregation — the centrepiece.
 *
 * The fill is revealed one farmer at a time because that is the actual claim
 * being made: no single farmer can supply 500Q, and four of them together can.
 * A table that appeared fully populated would show the result but not the idea.
 */
export function AggregatePanel({
  requirementId,
  remainingQuintals,
  targetPricePerQuintal,
}: {
  requirementId: string;
  remainingQuintals: number;
  targetPricePerQuintal: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  const [proposal, setProposal] = useState<AggregationProposal | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [settled, setSettled] = useState("");
  const [error, setError] = useState<string | null>(null);

  function runAggregation() {
    setError(null);
    startTransition(async () => {
      const result = await aggregateAction(requirementId);
      if (!result.ok || !result.data) {
        setError(result.error ?? "Could not aggregate supply");
        return;
      }
      const data = result.data;
      setProposal(data);
      setSettled(String(data.weightedAveragePriceRupees));
      setRevealed(0);

      // Step through the selection so the running total visibly climbs.
      data.allocations.forEach((_, index) => {
        setTimeout(() => setRevealed(index + 1), REVEAL_STEP_MS * (index + 1));
      });
    });
  }

  function createOrder() {
    setError(null);
    setCreating(true);
    startTransition(async () => {
      const result = await createAggregatedOrderAction(requirementId, settled);
      if (!result.ok || !result.data) {
        setError(result.error ?? "Could not create the order");
        setCreating(false);
        return;
      }
      router.push(`/orders/${result.data.id}`);
    });
  }

  if (proposal === null) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold">Aggregate supply</p>
            <p className="text-sm text-muted-foreground">
              Combine the best-ranked farmers into a single order for the{" "}
              {quintals(remainingQuintals)} still needed.
            </p>
            {error ? (
              <p role="alert" className="mt-2 text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <Button onClick={runAggregation} disabled={pending}>
            {pending ? "Aggregating…" : "Aggregate supply"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const shown = proposal.allocations.slice(0, revealed);
  const filledQuintals = shown.length > 0 ? (shown[shown.length - 1]?.cumulativeQuintals ?? 0) : 0;
  const percent = proposal.targetQuintals > 0 ? (filledQuintals / proposal.targetQuintals) * 100 : 0;
  const complete = revealed >= proposal.allocations.length;

  const settledNum = Number(settled);
  const validSettled = Number.isFinite(settledNum) && settledNum > 0;
  const orderTotal = validSettled ? Math.round(settledNum * proposal.totalQuintals) : 0;
  // What the same produce would cost at each farmer's own asking price. The
  // difference is what a uniform settled price adds to (or takes from) farmers.
  const upliftToFarmers = validSettled ? orderTotal - proposal.sumOfAsksRupees : 0;

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-base font-semibold">Aggregated supply</p>
            <p className="text-sm text-muted-foreground">
              {proposal.farmerCount} farmers ranked by match score, filled highest first.
            </p>
          </div>
          <Badge variant={proposal.satisfiable ? "success" : "warning"} size="lg">
            {proposal.satisfiable
              ? "Requirement fully covered"
              : `Short by ${quintals(proposal.shortfallQuintals)}`}
          </Badge>
        </div>

        {/* The running total, large — this is the number the demo turns on. */}
        <div className="space-y-2">
          <div className="flex items-end justify-between gap-4">
            <p>
              <span className="text-5xl font-bold tabular-nums transition-all">
                {quintals(filledQuintals)}
              </span>
              <span className="ml-2 text-xl text-muted-foreground">
                of {quintals(proposal.targetQuintals)}
              </span>
            </p>
            <p className="text-2xl font-bold tabular-nums text-muted-foreground">
              {Math.round(percent)}%
            </p>
          </div>
          <Progress value={percent} className="h-4" />
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {proposal.allocations.map((allocation, index) => (
              <span
                key={allocation.listing.id}
                className={
                  index < revealed
                    ? "rounded border bg-primary/10 px-2 py-0.5 font-medium text-foreground transition-colors"
                    : "rounded border border-dashed px-2 py-0.5 opacity-40"
                }
              >
                +{quintals(allocation.allocatedQuintals)} → {quintals(allocation.cumulativeQuintals)}
              </span>
            ))}
          </p>
        </div>

        <ol className="space-y-2">
          {proposal.allocations.map((allocation, index) => {
            const visible = index < revealed;
            return (
              <li
                key={allocation.listing.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 transition-all duration-300 ${
                  visible ? "opacity-100" : "translate-y-1 opacity-30"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {allocation.rank}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{allocation.listing.farmer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {allocation.listing.village} ·{" "}
                      {allocation.listing.distanceKm?.toFixed(1) ?? "—"} km · score{" "}
                      {allocation.score.toFixed(3)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <p className="text-sm font-bold tabular-nums">
                      {quintals(allocation.allocatedQuintals)}
                    </p>
                    {allocation.isPartial ? (
                      <p className="text-xs text-warning-foreground">
                        part of {quintals(allocation.listing.availableQuintals)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">whole lot</p>
                    )}
                  </div>
                  <div className="min-w-20">
                    <p className="text-sm tabular-nums">{rupees(allocation.pricePerQuintal)}</p>
                    <p className="text-xs text-muted-foreground">their ask</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {complete ? (
          <div className="space-y-4 border-t pt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Figure
                label="Weighted average ask"
                value={`${rupees(proposal.weightedAveragePriceRupees)}/Q`}
                hint={`Target was ${rupees(targetPricePerQuintal)}/Q`}
              />
              <Figure
                label="Order value"
                value={validSettled ? rupeesCompact(orderTotal) : "—"}
                hint={validSettled ? rupees(orderTotal) : "Enter a settled price"}
              />
              <Figure
                label="Versus their own asks"
                value={
                  validSettled
                    ? `${upliftToFarmers >= 0 ? "+" : "−"}${rupees(Math.abs(upliftToFarmers))}`
                    : "—"
                }
                hint={
                  upliftToFarmers >= 0
                    ? "Extra reaching the farmers"
                    : "Below their combined asks"
                }
                tone={upliftToFarmers >= 0 ? "text-success" : "text-destructive"}
              />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="settled">Settled price for every farmer</Label>
                <div className="flex items-stretch gap-2">
                  <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                    ₹
                  </span>
                  <Input
                    id="settled"
                    inputMode="numeric"
                    value={settled}
                    onChange={(e) => setSettled(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-28"
                  />
                  <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                    /Q
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  One price paid to all {proposal.farmerCount} farmers
                </p>
              </div>

              <Button onClick={createOrder} disabled={pending || creating || !validSettled}>
                {creating ? "Creating order…" : "Create aggregated order"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setProposal(null);
                  setRevealed(0);
                }}
                disabled={pending || creating}
              >
                Discard
              </Button>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone ?? ""}`}>{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
