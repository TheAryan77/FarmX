import type { ContractRecord, OrderAllocation } from "@fasalx/types";
import { Badge, Card, CardContent } from "@fasalx/ui";

import { rupees, quintals } from "@/lib/format";

/**
 * The escrow, as a farmer should see it.
 *
 * CLAUDE.md is explicit: never expose a hex address or a token amount to the
 * farmer. So this shows one thing — whether their money is secured, in rupees.
 * No transaction hashes, no addresses, no chain name, no wallet. The trust
 * guarantee is what matters to them; the mechanism is not their problem.
 *
 * The figure is *their* share of the order, not the order total. On an
 * aggregated deal the total belongs to four farmers and showing it here would
 * be misleading.
 */

const STEPS: { key: string; label: string }[] = [
  { key: "CREATED", label: "Agreement prepared" },
  { key: "ACCEPTED", label: "Agreement signed" },
  { key: "FUNDED", label: "Payment secured" },
  { key: "PICKED_UP", label: "Produce collected" },
  { key: "DELIVERED", label: "Delivered to buyer" },
  { key: "QC_APPROVED", label: "Quality approved" },
  { key: "RELEASED", label: "Payment sent to you" },
];

export function EscrowCard({
  contract,
  allocation,
}: {
  contract: ContractRecord;
  allocation: OrderAllocation | undefined;
}) {
  const myShare = allocation?.grossAmountRupees ?? contract.amountRupees;
  const reached = STEPS.findIndex((step) => step.key === contract.status);
  const secured = contract.escrow?.status === "LOCKED";
  const paid = contract.escrow?.status === "RELEASED";
  const trouble = contract.status === "DISPUTED" || contract.status === "REFUNDED";

  return (
    <>
      {secured || paid ? (
        <Card
          className={paid ? "border-success/40 bg-success/5" : "border-primary/30 bg-primary/5"}
        >
          <CardContent className="space-y-1">
            <p className="flex items-center gap-2 text-lg font-semibold">
              <span aria-hidden>{paid ? "✓" : "🔒"}</span>
              {paid ? "Payment sent" : "Payment secured"}
            </p>
            <p className="text-4xl font-bold text-primary">{rupees(myShare)}</p>
            <p className="text-base text-muted-foreground">
              {paid
                ? "The buyer's payment has been released to you."
                : "The buyer has paid in advance. This money is held safely and cannot be taken back while the deal is on."}
            </p>
            {allocation ? (
              <p className="pt-1 text-sm text-muted-foreground">
                For your {quintals(allocation.allocatedQuintals)} at{" "}
                {rupees(allocation.pricePerQuintal)} per quintal
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-lg font-semibold">Deal progress</p>
            {trouble ? (
              <Badge variant="destructive" size="lg">
                {contract.status === "DISPUTED" ? "Being checked" : "Cancelled"}
              </Badge>
            ) : null}
          </div>

          <ol className="space-y-0">
            {STEPS.map((step, index) => {
              const done = reached >= 0 && index <= reached;
              const isLast = index === STEPS.length - 1;
              return (
                <li key={step.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1 flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        done
                          ? "bg-primary text-primary-foreground"
                          : "border-2 border-muted text-muted-foreground"
                      }`}
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    {!isLast ? (
                      <span
                        className={`w-0.5 flex-1 ${done ? "bg-primary/40" : "bg-border"}`}
                        style={{ minHeight: "1.25rem" }}
                      />
                    ) : null}
                  </div>
                  <p
                    className={`pb-4 text-lg ${
                      done ? "font-medium" : "text-muted-foreground opacity-60"
                    }`}
                  >
                    {step.label}
                  </p>
                </li>
              );
            })}
          </ol>

          {trouble ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-base">
              {contract.status === "DISPUTED"
                ? "The buyer has raised a question about this delivery. FasalX will contact you."
                : "This deal was cancelled and the buyer's payment was returned."}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
