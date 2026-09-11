import type {
  AuthUser,
  ContractRecord,
  MessageThread,
  Order,
  PaymentSettings,
  QualityCheck,
  SettlementView,
  Shipment,
} from "@fasalx/types";
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
import { MessagePanel } from "./message-panel";
import { LogisticsPanel } from "./logistics-panel";
import { QualityPanel } from "./quality-panel";

export const metadata = { title: "Order · FasalX Buyer" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionToken())) redirect("/login");
  const { id } = await params;

  let user: AuthUser;
  let order: Order;
  let contract: ContractRecord | null = null;
  let shipment: Shipment | null = null;
  let quality: QualityCheck | null = null;
  let settlements: SettlementView | null = null;
  let payments: PaymentSettings | null = null;
  let threads: MessageThread[] = [];
  try {
    [user, order, contract, shipment, quality, settlements, payments, threads] =
      await Promise.all([
      apiCall<AuthUser>("/auth/me"),
      apiCall<Order>(`/orders/${id}`),
      // Missing contract, shipment, QC or settlement is all normal — each is
      // created from this screen in turn.
      apiCall<ContractRecord | null>(`/contracts/for-order/${id}`).catch(() => null),
      apiCall<Shipment | null>(`/logistics/for-order/${id}`).catch(() => null),
      apiCall<QualityCheck | null>(`/quality/for-order/${id}`).catch(() => null),
      apiCall<SettlementView | null>(`/settlements/for-order/${id}`).catch(() => null),
      // Limits come from the API so the fund button cannot disagree with what
      // the server will actually charge.
      apiCall<PaymentSettings>("/payments/status").catch(() => null),
      apiCall<MessageThread[]>(`/messages/for-order/${id}`).catch(() => []),
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

      {/*
        Each panel seeds local state from its server prop for optimistic
        updates. React keeps that state across re-renders, so after an action
        in one panel refreshes the page, the others would keep showing what
        they were first given. Keying them on the server status remounts only
        the ones whose data actually moved.
      */}
      <ContractPanel
        key={`contract-${contract?.id ?? "none"}-${contract?.status ?? "none"}`}
        orderId={order.id}
        contract={contract}
        payments={payments}
      />

      <LogisticsPanel
        key={`logistics-${shipment?.id ?? "none"}-${shipment?.status ?? "none"}`}
        orderId={order.id}
        shipment={shipment}
      />

      {shipment ? (
        <QualityPanel
          key={`quality-${quality?.id ?? "none"}-${quality?.status ?? "none"}-${settlements?.settlements.length ?? 0}`}
          orderId={order.id}
          shipment={shipment}
          check={quality}
          settlements={settlements}
        />
      ) : null}

      {/* Direct contact with the suppliers on this order. Phone numbers appear
          here and nowhere else in the buyer app — see message-panel.tsx. */}
      {threads.length > 0 ? (
        <MessagePanel
          key={`messages-${threads.reduce((n, t) => n + t.messages.length, 0)}`}
          orderId={order.id}
          threads={threads}
        />
      ) : null}
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
