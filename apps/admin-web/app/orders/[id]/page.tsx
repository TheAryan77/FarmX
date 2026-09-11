import type { AdminOrderDetail } from "@fasalx/types";
import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fasalx/ui";

import { apiCall } from "@/lib/api";
import { loadPage } from "@/lib/guard";
import { AlertAction } from "@/app/dashboard/alert-actions";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";
import { ORDER_STATUS, percent, quintals, rupees, shortDate } from "@/lib/format";

export const metadata = { title: "Order · FasalX Admin" };

/**
 * One order, end to end.
 *
 * The allocation table is the point: it shows each farmer's gross beside what
 * they were actually paid, so a farmer who was never settled reads as "not
 * paid" rather than silently missing from a list of successful payouts.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await loadPage(() => apiCall<AdminOrderDetail>(`/admin/orders/${id}`));
  if ("error" in result) return <ErrorPanel title="Cannot load this order" message={result.error} />;

  const { user, data } = result;
  const { order, allocations, contract, shipment, quality } = data;
  const label = ORDER_STATUS[order.status] ?? { text: order.status, variant: "muted" as const };
  const unpaid = order.status === "SETTLED" && order.settlements < order.farmers;

  return (
    <AppShell user={user}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/orders" className="text-sm text-muted-foreground hover:text-primary">
            ← All orders
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold tracking-tight">
            <span className="font-mono">{order.orderNo}</span>
            <Badge variant={label.variant}>{label.text}</Badge>
            {data.isAggregated ? <Badge variant="outline">Aggregated</Badge> : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.buyerName} · {quintals(order.quintals)} Grade {data.grade} at{" "}
            {rupees(order.pricePerQuintal)}/Q · deliver by {shortDate(data.deliveryBy)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Order value</p>
          <p className="text-2xl font-bold">{rupees(order.grossRupees)}</p>
        </div>
      </div>

      {unpaid ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-4">
            <Badge variant="destructive">Critical</Badge>
            <div className="space-y-2">
              <p className="font-semibold">
                {order.settlements} of {order.farmers} farmers have a payout record
              </p>
              <p className="text-sm text-muted-foreground">
                The escrow released but the payouts were never written, so the missing
                farmers see nothing on their earnings screen.
              </p>
              <AlertAction kind="resettle" orderId={order.id} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-4">
          <h2 className="font-semibold">Farmers on this order</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Farmer</TableHead>
                  <TableHead>Village</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net paid</TableHead>
                  <TableHead className="text-right">Gain vs mandi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.map((row) => (
                  <TableRow key={row.farmerId}>
                    <TableCell className="font-medium">{row.farmerName}</TableCell>
                    <TableCell className="text-muted-foreground">{row.village}</TableCell>
                    <TableCell className="text-right">
                      {quintals(row.allocatedQuintals)}
                    </TableCell>
                    <TableCell className="text-right">{rupees(row.pricePerQuintal)}/Q</TableCell>
                    <TableCell className="text-right">{rupees(row.grossRupees)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {row.netRupees === null ? (
                        <span className="text-destructive">Not paid</span>
                      ) : (
                        rupees(row.netRupees)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.gainRupees === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-medium text-primary">
                          +{rupees(row.gainRupees)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">The mandi comparison is an estimate.</span>{" "}
            {data.assumptions.traditionalNote}
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-3">
            <h2 className="font-semibold">Contract &amp; escrow</h2>
            {contract === null ? (
              <p className="text-sm text-muted-foreground">No contract generated.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                <Row label="Contract" value={contract.contractNo} mono />
                <Row label="Status" value={contract.status} />
                <Row label="Escrow" value={contract.escrowStatus ?? "—"} />
                <Row label="Amount" value={rupees(contract.amountRupees)} />
                {contract.pdfSha256 ? (
                  <div className="space-y-1 border-t pt-2">
                    <dt className="text-muted-foreground">PDF SHA-256</dt>
                    <dd className="font-mono text-xs break-all">{contract.pdfSha256}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <h2 className="font-semibold">Logistics</h2>
            {shipment === null ? (
              <p className="text-sm text-muted-foreground">No route planned.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                <Row label="Status" value={shipment.status} />
                <Row
                  label="Fleet"
                  value={`${shipment.vehicleCount} × ${shipment.vehicleClass.replace(/_/g, " ")}`}
                />
                <Row label="Stops" value={String(shipment.stops)} />
                <Row label="Distance" value={`${shipment.totalDistanceKm} km`} />
                <Row label="Optimised" value={rupees(shipment.optimisedCostRupees)} />
                <Row label="Separate trips" value={rupees(shipment.naiveCostRupees)} />
                {shipment.naiveCostRupees > 0 ? (
                  <div className="flex justify-between gap-4 border-t pt-2">
                    <dt className="font-medium">Saved</dt>
                    <dd className="font-bold text-success">
                      {rupees(shipment.naiveCostRupees - shipment.optimisedCostRupees)} (
                      {percent(
                        (shipment.naiveCostRupees - shipment.optimisedCostRupees) /
                          shipment.naiveCostRupees,
                      )}
                      )
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <h2 className="font-semibold">Quality check</h2>
            {quality === null ? (
              <p className="text-sm text-muted-foreground">Not inspected.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                <Row label="Status" value={quality.status} />
                <Row label="Grade found" value={quality.gradeAssessed ?? "—"} />
                <Row
                  label="Moisture"
                  value={quality.moisturePercent === null ? "—" : `${quality.moisturePercent}%`}
                />
                {quality.notes ? (
                  <div className="space-y-1 border-t pt-2">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd>{quality.notes}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-semibold ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
