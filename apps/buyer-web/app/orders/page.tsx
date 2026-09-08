import type { AuthUser, Order } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { ORDER_STATUS, quintals, rupees, rupeesCompact, shortDate } from "@/lib/format";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";

export const metadata = { title: "Orders · FasalX Buyer" };

export default async function OrdersPage() {
  if (!(await getSessionToken())) redirect("/login");

  let user: AuthUser;
  let orders: Order[];
  try {
    [user, orders] = await Promise.all([
      apiCall<AuthUser>("/auth/me"),
      apiCall<Order[]>("/orders/mine"),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load your orders"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  const totalValue = orders.reduce((sum, o) => sum + o.grossAmountRupees, 0);
  const totalQuintals = orders.reduce((sum, o) => sum + o.totalQuintals, 0);

  return (
    <AppShell user={user}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground">
          {orders.length > 0
            ? `${orders.length} order${orders.length === 1 ? "" : "s"} · ${quintals(totalQuintals)} · ${rupeesCompact(totalValue)}`
            : "Accepted negotiations become orders."}
        </p>
      </div>

      {orders.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No orders yet</CardTitle>
            <CardDescription>Accept a farmer&apos;s price and the order appears here.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Settled price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Deliver by</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const status = ORDER_STATUS[order.status] ?? { text: order.status, variant: "muted" as const };
                  const suppliers =
                    order.allocations.length === 1
                      ? (order.allocations[0]?.farmer.name ?? "—")
                      : `${order.allocations.length} farmers`;
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        <Link href={`/orders/${order.id}`} className="hover:text-primary hover:underline">
                          {order.orderNo}
                        </Link>
                      </TableCell>
                      <TableCell>{suppliers}</TableCell>
                      <TableCell className="text-right tabular-nums">{quintals(order.totalQuintals)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupees(order.settledPricePerQuintal)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{rupees(order.grossAmountRupees)}</TableCell>
                      <TableCell className="text-muted-foreground">{shortDate(order.deliveryBy)}</TableCell>
                      <TableCell><Badge variant={status.variant}>{status.text}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
