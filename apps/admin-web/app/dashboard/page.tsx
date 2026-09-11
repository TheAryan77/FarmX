import type { AdminOverview, AuthUser } from "@fasalx/types";
import { redirect } from "next/navigation";
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

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { AlertAction } from "./alert-actions";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";
import { ORDER_STATUS, dateTime, percent, quintals, rupees, rupeesCompact } from "@/lib/format";

export const metadata = { title: "Operations · FasalX Admin" };

/**
 * The operations console.
 *
 * Ordered by what an operator needs first: anything broken, then whether the
 * platform is doing its job (value reaching farmers), then volume, then the
 * services it all depends on. Every figure is derived server-side from the
 * same rows the farmer and buyer apps read, so this screen cannot drift from
 * what they show.
 */
export default async function DashboardPage() {
  if (!(await getSessionToken())) redirect("/login");

  let user: AuthUser;
  let data: AdminOverview;
  try {
    [user, data] = await Promise.all([
      apiCall<AuthUser>("/auth/me"),
      apiCall<AdminOverview>("/admin/overview"),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load the console"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  const { impact, network, logistics, chain, alerts, pipeline, recentOrders, services } = data;
  const nothingSettled = impact.settledOrders === 0;

  return (
    <AppShell user={user}>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform operations</h1>
          <p className="text-sm text-muted-foreground">
            Wheat · Karnal, Haryana · generated {dateTime(data.generatedAt)}
          </p>
        </div>
      </div>

      {/* Anything broken comes first, before any number worth celebrating. */}
      {alerts.length > 0 ? (
        <section className="space-y-2">
          {alerts.map((alert, index) => (
            <Card
              key={`${alert.code}-${alert.orderId ?? index}`}
              className={
                alert.severity === "critical"
                  ? "border-destructive/50 bg-destructive/5"
                  : "border-warning/50 bg-warning/5"
              }
            >
              <CardContent className="flex items-start gap-3 py-4">
                <Badge variant={alert.severity === "critical" ? "destructive" : "warning"}>
                  {alert.severity === "critical" ? "Critical" : "Warning"}
                </Badge>
                <div className="space-y-2">
                  <p className="font-semibold">{alert.title}</p>
                  <p className="text-sm text-muted-foreground">{alert.detail}</p>
                  {/* Only the alerts an operator can actually act on get a button. */}
                  {alert.orderId && alert.code === "SETTLED_WITHOUT_PAYOUT" ? (
                    <AlertAction kind="resettle" orderId={alert.orderId} />
                  ) : null}
                  {alert.orderId && alert.code === "PARTIAL_PAYOUT" ? (
                    <AlertAction kind="resettle" orderId={alert.orderId} />
                  ) : null}
                  {alert.orderId && alert.code === "ORDER_DISPUTED" ? (
                    <AlertAction kind="refund" orderId={alert.orderId} />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="py-4 text-sm font-medium">
            No operational issues detected.
          </CardContent>
        </Card>
      )}

      {/* The north star, summed across every settled deal. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Value reaching farmers
        </h2>
        {nothingSettled ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No deals have settled yet. These figures appear once an order completes
              quality approval and the escrow releases.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Paid to farmers"
                value={rupeesCompact(impact.paidToFarmersRupees)}
                hint={`${percent(impact.farmerSharePercent, 0)} of ₹${impact.grossValueRupees.toLocaleString("en-IN")} gross`}
                tone="success"
              />
              <Stat
                label="Extra vs mandi estimate"
                value={`+${rupeesCompact(impact.extraVsTraditionalRupees)}`}
                hint={`${percent(impact.averageGainPercent)} more than the traditional channel`}
                tone="primary"
              />
              <Stat
                label="Traded"
                value={quintals(impact.quintalsTraded)}
                hint={`${impact.settledOrders} settled order${impact.settledOrders === 1 ? "" : "s"} · ${impact.farmersPaid} farmer${impact.farmersPaid === 1 ? "" : "s"} paid`}
              />
              <Stat
                label="Deducted"
                value={rupeesCompact(impact.logisticsCostRupees + impact.platformFeeRupees)}
                hint={`${rupees(impact.logisticsCostRupees)} transport · ${rupees(impact.platformFeeRupees)} platform fee`}
              />
            </div>

            <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                The mandi comparison is an estimate.
              </span>{" "}
              {data.assumptions.traditionalNote}
            </p>
          </>
        )}
      </section>

      {/* Volume and the state of the marketplace. */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4">
            <h2 className="font-semibold">Network</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Row label="Farmers" value={String(network.farmers)} />
              <Row label="Buyers" value={String(network.buyers)} />
              <Row label="FPOs" value={String(network.fpos)} />
              <Row label="Active listings" value={String(network.activeListings)} />
              <Row label="Supply listed" value={quintals(network.listedQuintals)} />
              <Row label="Open requirements" value={String(network.openRequirements)} />
              <Row label="Demand open" value={quintals(network.requiredQuintals)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <h2 className="font-semibold">Order pipeline</h2>
            {pipeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {pipeline.map((row) => {
                  const label = ORDER_STATUS[row.status] ?? {
                    text: row.status,
                    variant: "muted" as const,
                  };
                  return (
                    <div key={row.status} className="flex items-center justify-between gap-4">
                      <dt className="flex items-center gap-2">
                        <Badge variant={label.variant}>{label.text}</Badge>
                        <span className="text-muted-foreground">
                          {row.orders} · {quintals(row.quintals)}
                        </span>
                      </dt>
                      <dd className="font-semibold">{rupeesCompact(row.valueRupees)}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Logistics and chain — the two subsystems with their own failure modes. */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4">
            <h2 className="font-semibold">Logistics</h2>
            {logistics.shipments === 0 ? (
              <p className="text-sm text-muted-foreground">No routes planned yet.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                <Row label="Shipments planned" value={String(logistics.shipments)} />
                <Row label="Vehicles dispatched" value={String(logistics.vehiclesDispatched)} />
                <Row label="Optimised cost" value={rupees(logistics.optimisedCostRupees)} />
                <Row
                  label="Separate trips would cost"
                  value={rupees(logistics.baselineCostRupees)}
                />
                <div className="flex items-center justify-between gap-4 border-t pt-2">
                  <dt className="font-medium">Saved by aggregating</dt>
                  <dd className="font-bold text-success">
                    {rupees(logistics.savedRupees)} ({percent(logistics.savedPercent)})
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <h2 className="font-semibold">Escrow</h2>
            {!chain.configured ? (
              <p className="text-sm text-muted-foreground">
                No contract configured. Run <code className="font-mono">pnpm chain</code> then{" "}
                <code className="font-mono">pnpm chain:deploy</code>.
              </p>
            ) : chain.contracts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contracts generated yet.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {chain.contracts.map((row) => (
                  <Row key={row.status} label={row.status} value={String(row.count)} />
                ))}
                <div className="flex items-center justify-between gap-4 border-t pt-2">
                  <dt className="font-medium">Currently locked</dt>
                  <dd className="font-bold">{rupees(chain.escrowLockedRupees)}</dd>
                </div>
                {chain.degradedEvents > 0 ? (
                  <Row
                    label="Recorded off-chain"
                    value={`${chain.degradedEvents} event${chain.degradedEvents === 1 ? "" : "s"}`}
                  />
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Recent orders, with the payout column that makes a silent failure visible. */}
      <Card>
        <CardContent className="space-y-4">
          <h2 className="font-semibold">Recent orders</h2>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Farmers paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.map((order) => {
                    const label = ORDER_STATUS[order.status] ?? {
                      text: order.status,
                      variant: "muted" as const,
                    };
                    // A settled order that paid nobody is the failure this
                    // column exists to expose.
                    const unpaid = order.status === "SETTLED" && order.settlements === 0;
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono font-medium">{order.orderNo}</TableCell>
                        <TableCell>{order.buyerName}</TableCell>
                        <TableCell>
                          <Badge variant={label.variant}>{label.text}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{quintals(order.quintals)}</TableCell>
                        <TableCell className="text-right">
                          {rupees(order.pricePerQuintal)}/Q
                        </TableCell>
                        <TableCell className="text-right">{rupees(order.grossRupees)}</TableCell>
                        <TableCell
                          className={`text-right font-medium ${unpaid ? "text-destructive" : ""}`}
                        >
                          {order.settlements}/{order.farmers}
                          {unpaid ? " ⚠" : ""}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dependencies, probed rather than assumed. */}
      <Card>
        <CardContent className="space-y-4">
          <h2 className="font-semibold">Services</h2>
          <dl className="space-y-2 text-sm">
            {services.map((service) => (
              <div key={service.name} className="flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`inline-block size-2 rounded-full ${service.ok ? "bg-success" : "bg-destructive"}`}
                  />
                  <span className="font-medium">{service.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {service.target}
                  </span>
                </dt>
                <dd className={service.ok ? "text-muted-foreground" : "font-medium text-destructive"}>
                  {service.detail}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "primary";
}) {
  const valueTone =
    tone === "success" ? "text-success" : tone === "primary" ? "text-primary" : undefined;
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-3xl font-bold tracking-tight ${valueTone ?? ""}`}>{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
