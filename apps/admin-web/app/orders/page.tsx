import type { AdminOrderRow } from "@fasalx/types";
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
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";
import { ORDER_STATUS, dateTime, quintals, rupees } from "@/lib/format";

export const metadata = { title: "Orders · FasalX Admin" };

export default async function OrdersPage() {
  const result = await loadPage(() => apiCall<AdminOrderRow[]>("/admin/orders"));
  if ("error" in result) return <ErrorPanel title="Cannot load orders" message={result.error} />;

  const { user, data: orders } = result;

  return (
    <AppShell user={user}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground">
          {orders.length} order{orders.length === 1 ? "" : "s"} · newest first
        </p>
      </div>

      <Card>
        <CardContent>
          {orders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No orders yet. They appear once a buyer and farmer agree a price.
            </p>
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
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const label = ORDER_STATUS[order.status] ?? {
                      text: order.status,
                      variant: "muted" as const,
                    };
                    const unpaid = order.status === "SETTLED" && order.settlements === 0;
                    return (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link
                            href={`/orders/${order.id}`}
                            className="font-mono font-medium text-primary hover:underline"
                          >
                            {order.orderNo}
                          </Link>
                        </TableCell>
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
                        <TableCell className="text-sm text-muted-foreground">
                          {dateTime(order.createdAt)}
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
    </AppShell>
  );
}
