import type { Order } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardContent } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { ORDER_STATUS, quintals, rupees, shortDate } from "@/lib/format";
import { ErrorPanel } from "@/app/components/error-panel";
import { PageHeader } from "@/app/components/page-header";

export const metadata = { title: "My deals · FasalX Farmer" };

export default async function OrdersPage() {
  if (!(await getSessionToken())) redirect("/login");

  let orders: Order[];
  try {
    orders = await apiCall<Order[]>("/orders/mine");
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load your deals"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 p-5 pb-10">
      <PageHeader
        title="My deals"
        subtitle={orders.length > 0 ? `${orders.length} agreed` : undefined}
      />

      {orders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-3 text-center">
            <p className="text-4xl" aria-hidden>
              🤝
            </p>
            <p className="text-xl font-semibold">No deals yet</p>
            <p className="text-base text-muted-foreground">
              Accept a buyer&apos;s offer and the deal appears here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => {
            const mine = order.allocations[0];
            const status = ORDER_STATUS[order.status] ?? { text: order.status, variant: "muted" as const };
            return (
              <li key={order.id}>
                <Link href={`/orders/${order.id}`} className="block">
                  <Card className="transition-colors hover:border-primary/40">
                    <CardContent className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold">{order.buyer.companyName}</p>
                          <p className="text-sm text-muted-foreground">Deal {order.orderNo}</p>
                        </div>
                        <Badge variant={status.variant} size="lg">
                          {status.text}
                        </Badge>
                      </div>
                      <div className="flex items-end justify-between gap-3 border-t pt-3">
                        <div>
                          <p className="text-sm text-muted-foreground">Your produce</p>
                          <p className="text-xl font-bold">
                            {quintals(mine?.allocatedQuintals ?? 0)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">You receive</p>
                          <p className="text-xl font-bold text-primary">
                            {rupees(mine?.grossAmountRupees ?? 0)}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Deliver by {shortDate(order.deliveryBy)}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
