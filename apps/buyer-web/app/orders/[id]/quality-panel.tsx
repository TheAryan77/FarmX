"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Grade, QualityCheck, SettlementView, Shipment } from "@fasalx/types";
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Input, Label, NativeSelect,
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@fasalx/ui";

import {
  approveQualityAction,
  confirmDeliveryAction,
  confirmPickupAction,
  recordQualityAction,
  rejectQualityAction,
} from "@/app/actions";
import { quintals, rupees, rupeesCompact } from "@/lib/format";

/**
 * Delivery, quality check, and the payout that follows.
 *
 * Approving here is the moment the escrow releases and every farmer's payout
 * is written, so it is deliberately the last step and reads as consequential
 * rather than as another form submit.
 */

const GRADE_ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2 };

export function QualityPanel({
  orderId,
  shipment,
  check: initialCheck,
  settlements,
}: {
  orderId: string;
  shipment: Shipment | null;
  check: QualityCheck | null;
  settlements: SettlementView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [check, setCheck] = useState(initialCheck);
  const [error, setError] = useState<string | null>(null);

  const [gradeFound, setGradeFound] = useState<string>(initialCheck?.gradeFound ?? "A");
  const [moisture, setMoisture] = useState(initialCheck?.moisturePct?.toString() ?? "");
  const [notes, setNotes] = useState(initialCheck?.notes ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong");
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  // Once settled, this panel becomes the payout record.
  if (settlements && settlements.settlements.length > 0) {
    const rows = settlements.settlements;
    const totals = rows.reduce(
      (acc, s) => ({
        gross: acc.gross + s.grossRupees,
        logistics: acc.logistics + s.logisticsShareRupees,
        platform: acc.platform + s.platformFeeRupees,
        net: acc.net + s.netRupees,
        traditional: acc.traditional + s.traditionalEstimateRupees,
        gain: acc.gain + s.farmerGainRupees,
      }),
      { gross: 0, logistics: 0, platform: 0, net: 0, traditional: 0, gain: 0 },
    );

    return (
      <Card className="border-success/40">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                Settled
                <Badge variant="success" className="ml-2">
                  Quality approved · payment released
                </Badge>
              </CardTitle>
              <CardDescription>
                {check?.gradeFound ? `Delivered Grade ${check.gradeFound}` : "Delivered"}
                {check?.moisturePct !== null && check?.moisturePct !== undefined
                  ? ` · ${check.moisturePct}% moisture`
                  : ""}
                {check?.notes ? ` · ${check.notes}` : ""}
              </CardDescription>
            </div>
            <div className="text-right">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">
                Reached farmers
              </p>
              <p className="text-xl font-bold text-success">{rupeesCompact(totals.net)}</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Farmer</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Transport</TableHead>
                <TableHead className="text-right">Platform</TableHead>
                <TableHead className="text-right">Net paid</TableHead>
                <TableHead className="text-right">Mandi est.</TableHead>
                <TableHead className="text-right">Farmer gain</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.farmer.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {quintals(s.allocatedQuintals)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{rupees(s.grossRupees)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    −{rupees(s.logisticsShareRupees)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    −{rupees(s.platformFeeRupees)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {rupees(s.netRupees)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {rupees(s.traditionalEstimateRupees)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-success">
                    +{rupees(s.farmerGainRupees)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {rupees(totals.gross)}
                </TableCell>
                <TableCell className="text-right tabular-nums">−{rupees(totals.logistics)}</TableCell>
                <TableCell className="text-right tabular-nums">−{rupees(totals.platform)}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {rupees(totals.net)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {rupees(totals.traditional)}
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums text-success">
                  +{rupees(totals.gain)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>

          <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">The mandi column is an estimate.</span>{" "}
            {settlements.assumptions.traditionalNote} {settlements.assumptions.logisticsNote}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Before delivery: the pickup and delivery steps.
  if (shipment && shipment.status !== "DELIVERED") {
    const allLoaded = shipment.stops.every((stop) => stop.status === "LOADED");
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery</CardTitle>
          <CardDescription>
            {shipment.status === "IN_TRANSIT"
              ? "All farms collected. Record delivery when the produce arrives."
              : `${shipment.stops.filter((s) => s.status === "LOADED").length} of ${shipment.stops.length} farms collected.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!allLoaded ? (
              <Button
                disabled={pending}
                onClick={() => run(() => confirmPickupAction(shipment.id, orderId))}
              >
                {pending ? "Confirming…" : "Confirm all pickups"}
              </Button>
            ) : null}
            {shipment.status === "IN_TRANSIT" ? (
              <Button
                disabled={pending}
                onClick={() => run(() => confirmDeliveryAction(shipment.id, orderId))}
              >
                {pending ? "Recording…" : "Confirm delivery"}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  const belowSpec =
    check !== null && GRADE_ORDER[check.gradeFound] > GRADE_ORDER[check.gradeAgreed];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Quality check
              {check ? (
                <Badge
                  variant={
                    check.status === "APPROVED"
                      ? "success"
                      : check.status === "REJECTED"
                        ? "destructive"
                        : "warning"
                  }
                  className="ml-2"
                >
                  {check.status.toLowerCase()}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              Approving releases the escrow and pays every farmer on this order.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {check?.status === "REJECTED" ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            Delivery rejected. The escrow is frozen and no payout was made. Refund it from the
            contract panel above once the dispute is settled.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="gradeFound">Grade found</Label>
            <NativeSelect
              id="gradeFound"
              value={gradeFound}
              onChange={(e) => setGradeFound(e.target.value)}
              disabled={check?.status !== undefined && check.status !== "PENDING"}
            >
              <option value="A">Grade A</option>
              <option value="B">Grade B</option>
              <option value="C">Grade C</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="moisture">Moisture %</Label>
            <Input
              id="moisture"
              inputMode="decimal"
              placeholder="11.5"
              value={moisture}
              onChange={(e) => setMoisture(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))}
              disabled={check?.status !== undefined && check.status !== "PENDING"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              placeholder="Clean, well dried"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={check?.status !== undefined && check.status !== "PENDING"}
            />
          </div>
        </div>

        {belowSpec ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            Grade {check?.gradeFound} is below the agreed Grade {check?.gradeAgreed}. Approving
            still pays the full contract price — reject instead if that is not what you want.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}

        {rejecting ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input
              placeholder="Why is the delivery being rejected?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="max-w-md"
            />
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 3 || check === null}
              onClick={() =>
                run(
                  () => rejectQualityAction(check!.id, orderId, reason),
                  () => setRejecting(false),
                )
              }
            >
              {pending ? "Rejecting…" : "Reject delivery"}
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {check === null || check.status === "PENDING" ? (
              <Button
                variant={check === null ? "default" : "outline"}
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await recordQualityAction({
                      orderId,
                      gradeFound,
                      ...(moisture ? { moisturePct: moisture } : {}),
                      ...(notes ? { notes } : {}),
                    });
                    if (result.ok && result.data) setCheck(result.data);
                    return result;
                  })
                }
              >
                {pending ? "Saving…" : check === null ? "Record quality check" : "Update reading"}
              </Button>
            ) : null}

            {check?.status === "PENDING" ? (
              <>
                <Button
                  disabled={pending}
                  onClick={() => run(() => approveQualityAction(check.id, orderId))}
                >
                  {pending ? "Releasing…" : "Approve and release payment"}
                </Button>
                <Button variant="outline" onClick={() => setRejecting(true)} disabled={pending}>
                  Reject delivery
                </Button>
              </>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
