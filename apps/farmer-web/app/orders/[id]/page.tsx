import type { Order } from "@fasalx/types";
import { redirect } from "next/navigation";
import { Badge, Card, CardContent } from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { ORDER_STATUS, quintals, rupees, shortDate } from "@/lib/format";
import { ErrorPanel } from "@/app/components/error-panel";
import { PageHeader } from "@/app/components/page-header";

export const metadata = { title: "Deal · FasalX Farmer" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionToken())) redirect("/login");
  const { id } = await params;

  let order: Order;
  try {
    order = await apiCall<Order>(`/orders/${id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Deal not found"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
        backHref="/orders"
        backLabel="Back to my deals"
      />
    );
  }

  const status = ORDER_STATUS[order.status] ?? { text: order.status, variant: "muted" as const };
  // A farmer sees the whole order but their own share is what matters to them.
  const mine = order.allocations[0];

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 p-5 pb-10">
      <PageHeader title={`Deal ${order.orderNo}`} backHref="/orders" />

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="space-y-1">
          <p className="text-base text-muted-foreground">You will receive</p>
          <p className="text-4xl font-bold text-primary">
            {rupees(mine?.grossAmountRupees ?? 0)}
          </p>
          <p className="text-base text-muted-foreground">
            {quintals(mine?.allocatedQuintals ?? 0)} at {rupees(mine?.pricePerQuintal ?? 0)} per
            quintal
          </p>
          <p className="pt-1 text-sm text-muted-foreground">
            Before transport and platform charges
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between gap-3 pb-2">
            <p className="text-lg font-semibold">Deal details</p>
            <Badge variant={status.variant} size="lg">
              {status.text}
            </Badge>
          </div>
          <dl className="space-y-1 border-t pt-3 text-lg">
            <Row label="Buyer" value={order.buyer.companyName} />
            <Row label="Crop" value={`${order.crop} · Grade ${order.grade}`} capitalize />
            <Row label="Agreed price" value={`${rupees(order.settledPricePerQuintal)} / quintal`} />
            <Row label="Deliver by" value={shortDate(order.deliveryBy)} />
            {order.isAggregated ? (
              <Row label="Farmers in this deal" value={String(order.allocations.length)} />
            ) : null}
            <Row label="Order total" value={rupees(order.grossAmountRupees)} />
          </dl>
        </CardContent>
      </Card>

      {order.isAggregated && order.allocations.length > 1 ? (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-lg font-semibold">Supplied together with</p>
            <ul className="space-y-1 text-base">
              {order.allocations.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 border-b py-1 last:border-b-0">
                  <span>{a.farmer.name}</span>
                  <span className="font-semibold">{quintals(a.allocatedQuintals)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-base text-muted-foreground">
        Contract, payment and pickup appear here as the deal progresses.
      </p>
    </main>
  );
}

function Row({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={capitalize ? "font-semibold capitalize" : "font-semibold"}>{value}</dd>
    </div>
  );
}
