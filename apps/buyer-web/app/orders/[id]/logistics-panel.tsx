"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Shipment } from "@fasalx/types";
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@fasalx/ui";

import { optimiseRouteAction } from "@/app/actions";
import { quintals, rupees } from "@/lib/format";

/**
 * Leaflet touches `window` on import, so the map is client-only and never
 * server-rendered. Loading it lazily also keeps its weight off every other
 * order screen.
 */
const RouteMap = dynamic(() => import("./route-map").then((m) => m.RouteMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 w-full items-center justify-center rounded-md border bg-muted/40 text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

export function LogisticsPanel({
  orderId,
  shipment: initial,
}: {
  orderId: string;
  shipment: Shipment | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shipment, setShipment] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function plan() {
    setError(null);
    startTransition(async () => {
      const result = await optimiseRouteAction(orderId);
      if (!result.ok || !result.data) {
        setError(result.error ?? "Could not plan the route");
        return;
      }
      setShipment(result.data);
      router.refresh();
    });
  }

  if (shipment === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pickup logistics</CardTitle>
          <CardDescription>
            Plan one collection route across every farm in this order instead of sending a
            vehicle to each.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <Button onClick={plan} disabled={pending}>
            {pending ? "Optimising…" : "Plan pickup route"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const sequencingTie =
    shipment.sequencingCostRupees !== null &&
    shipment.sequencingCostRupees === shipment.optimisedCostRupees;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Pickup logistics
              <Badge variant="secondary" className="ml-2">
                {shipment.vehicleLabel} × {shipment.vehicleCount}
              </Badge>
            </CardTitle>
            <CardDescription>
              {shipment.stops.length} farms · {quintals(shipment.totalQuintals)} ·{" "}
              {shipment.totalDistanceKm} km to {shipment.destinationLabel}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={plan} disabled={pending}>
            {pending ? "Replanning…" : "Replan"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}

        <RouteMap shipment={shipment} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Optimised cost"
            value={rupees(shipment.optimisedCostRupees)}
            hint={`${shipment.totalDistanceKm} km at ₹${shipment.rupeesPerKm}/km`}
          />
          <Figure
            label="Without aggregation"
            value={rupees(shipment.naiveCostRupees)}
            hint={`${shipment.stops.length} separate trips, ${shipment.naiveDistanceKm} km`}
          />
          <Figure
            label="Saving"
            value={`${shipment.savingRupees >= 0 ? "−" : "+"}${rupees(Math.abs(shipment.savingRupees))}`}
            hint={`${shipment.savingPercent}% of collection cost`}
            tone={shipment.savingRupees > 0 ? "text-success" : undefined}
          />
          <Figure
            label="Vehicles"
            value={`${shipment.vehicleCount} × ${quintals(shipment.capacityQuintals)}`}
            hint={shipment.vehicleLabel}
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-right">#</TableHead>
              <TableHead>Truck</TableHead>
              <TableHead>Farmer</TableHead>
              <TableHead>Village</TableHead>
              <TableHead className="text-right">Collect</TableHead>
              <TableHead className="text-right">Leg</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipment.stops.map((stop) => (
              <TableRow key={stop.id}>
                <TableCell className="text-right text-xs font-bold text-muted-foreground tabular-nums">
                  {stop.sequence}
                </TableCell>
                <TableCell className="text-sm">#{stop.vehicleNumber}</TableCell>
                <TableCell className="font-medium">{stop.farmer.name}</TableCell>
                <TableCell className="text-muted-foreground">{stop.farmer.village}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {quintals(stop.quantityQuintals)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{stop.legDistanceKm} km</TableCell>
                <TableCell>
                  <Badge variant="muted">{stop.status.toLowerCase()}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">How the saving is measured.</span>{" "}
            {shipment.assumptions?.baseline}
          </p>
          {sequencingTie ? (
            <p>
              Re-sequencing the same fleet saves nothing on this order — four lots, each
              filling most of a truck, leave little to reorder. Savings from sequencing grow
              sharply as lots get smaller and more numerous.
            </p>
          ) : shipment.sequencingCostRupees !== null ? (
            <p>
              Visiting the farms in listed order with the same fleet would cost{" "}
              {rupees(shipment.sequencingCostRupees)} — the optimiser saves{" "}
              {rupees(shipment.sequencingCostRupees - shipment.optimisedCostRupees)} on
              sequencing alone.
            </p>
          ) : null}
          <p>{shipment.assumptions?.note}</p>
        </div>
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
