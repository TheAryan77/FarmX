import type { AuthUser, ContractRecord, Order } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { ORDER_STATUS, km, quintals, rupees, rupeesCompact, shortDate } from "@/lib/format";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";
import { ContractPanel } from "./contract-panel";

export const metadata = { title: "Order · FasalX Buyer" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionToken())) redirect("/login");
  const { id } = await params;

  let user: AuthUser;
  let order: Order;
  let contract: ContractRecord | null = null;
  try {
    [user, order, contract] = await Promise.all([
      apiCall<AuthUser>("/auth/me"),
      apiCall<Order>(`/orders/${id}`),
      // A missing contract is normal — the buyer creates it from this screen.
      apiCall<ContractRecord | null>(`/contracts/for-order/${id}`).catch(() => null),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Order not found"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
        backHref="/orders"
        backLabel="Back to orders"
      />
    );
  }

  const status = ORDER_STATUS[order.status] ?? { text: order.status, variant: "muted" as const };

  return (
    <AppShell user={user}>
      <div className="space-y-1">
        <Link href="/orders" className="text-sm text-muted-foreground hover:text-primary">
          ← All orders
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Order {order.orderNo}</h1>
          <Badge variant="outline">Grade {order.grade}</Badge>
          <Badge variant={status.variant}>{status.text}</Badge>
          {order.isAggregated ? <Badge variant="secondary">Aggregated</Badge> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Quantity" value={quintals(order.totalQuintals)} />
        <Stat label="Settled price" value={`${rupees(order.settledPricePerQuintal)}/Q`} />
        <Stat label="Order value" value={rupeesCompact(order.grossAmountRupees)} hint={rupees(order.grossAmountRupees)} />
        <Stat label="Deliver by" value={shortDate(order.deliveryBy)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Supply allocation</CardTitle>
          <CardDescription>
            {order.allocations.length === 1
              ? "A single farmer supplies this order."
              : `${order.allocations.length} farmers supply this order.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Farmer</TableHead>
                <TableHead>Village</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Distance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.allocations.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.farmer.name}</TableCell>
                  <TableCell className="text-muted-foreground">{a.farmer.village}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{quintals(a.allocatedQuintals)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rupees(a.pricePerQuintal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rupees(a.grossAmountRupees)}</TableCell>
                  <TableCell className="text-right tabular-nums">{km(a.distanceKm)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">Total</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{quintals(order.totalQuintals)}</TableCell>
                <TableCell />
                <TableCell className="text-right font-bold tabular-nums">{rupees(order.grossAmountRupees)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      <ContractPanel orderId={order.id} contract={contract} />

      <p className="text-xs text-muted-foreground">
        Logistics and per-farmer settlement attach to this order in later steps.
      </p>
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-0.5">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className="text-xl font-bold tracking-tight">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
