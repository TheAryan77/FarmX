import type { Shipment } from "@fasalx/types";
import { Badge, Card, CardContent } from "@fasalx/ui";

import { quintals, rupees } from "@/lib/format";

/**
 * The pickup, as a farmer needs it.
 *
 * They do not care about fleet optimisation — they care when a truck arrives
 * at their farm and how much it takes. So this shows their own stop, and the
 * shared-transport saving only as a plain sentence, with no map: a route map of
 * four other farms is chrome on a phone screen in a field.
 *
 * The transport cost their share carries is shown because session 11 subtracts
 * it from their payout, and a deduction should never appear without having
 * been explained first.
 */
export function PickupCard({
  shipment,
  farmerId,
}: {
  shipment: Shipment;
  farmerId: string | null;
}) {
  const mine = shipment.stops.find((stop) => stop.farmer.id === farmerId);
  if (!mine) return null;

  const truck = shipment.vehicles.find((v) => v.vehicleNumber === mine.vehicleNumber);
  const othersOnTruck = shipment.stops.filter(
    (stop) => stop.vehicleNumber === mine.vehicleNumber && stop.id !== mine.id,
  );

  // Their share of the collection cost, by quantity — the same split the
  // settlement screen uses, shown here first so it is not a surprise later.
  const shareOfCost =
    shipment.totalQuintals > 0
      ? Math.round(
          (mine.quantityQuintals / shipment.totalQuintals) * shipment.optimisedCostRupees,
        )
      : 0;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-lg font-semibold">Pickup from your farm</p>
          <Badge variant="secondary" size="lg">
            Stop {mine.sequence}
          </Badge>
        </div>

        <div>
          <p className="text-base text-muted-foreground">They will collect</p>
          <p className="text-3xl font-bold">{quintals(mine.quantityQuintals)}</p>
          <p className="text-base text-muted-foreground">
            From {mine.farmer.village} · {shipment.vehicleLabel}
          </p>
        </div>

        {othersOnTruck.length > 0 ? (
          <p className="rounded-md border bg-muted/50 px-4 py-3 text-base">
            The same truck also collects from{" "}
            {othersOnTruck.map((stop) => stop.farmer.name.split(" ")[0]).join(" and ")}, so the
            transport cost is shared between you.
          </p>
        ) : null}

        <dl className="space-y-1 border-t pt-3 text-lg">
          <div className="flex justify-between gap-4 py-1">
            <dt className="text-muted-foreground">Your share of transport</dt>
            <dd className="font-semibold">{rupees(shareOfCost)}</dd>
          </div>
          {truck ? (
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Truck route</dt>
              <dd className="font-semibold">{truck.roadKm} km</dd>
            </div>
          ) : null}
        </dl>

        {shipment.savingRupees > 0 ? (
          <p className="rounded-md border border-success/40 bg-success/5 px-4 py-3 text-base">
            Sharing a truck with the other farmers saves{" "}
            <span className="font-bold">{rupees(shipment.savingRupees)}</span> in transport
            against separate trips — money that stays with the farmers.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
