"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContractAction, ContractRecord } from "@fasalx/types";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@fasalx/ui";

import { contractActionRequest, createContractAction } from "@/app/actions";
import { rupees } from "@/lib/format";
import {
  CONTRACT_SEQUENCE,
  CONTRACT_STATE,
  NEXT_ACTION,
  shortHash,
} from "@/lib/contract-format";

/**
 * The escrow, from the buyer's side.
 *
 * Shows the whole lifecycle with the transaction behind each step, because the
 * buyer is the party whose money is locked up and they should be able to check
 * the chain rather than trust this screen. The farmer's view of the same deal
 * deliberately shows none of it — see the farmer app.
 */
export function ContractPanel({
  orderId,
  contract: initial,
}: {
  orderId: string;
  contract: ContractRecord | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [contract, setContract] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string; data?: ContractRecord }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok || !result.data) {
        setError(result.error ?? "Something went wrong");
        return;
      }
      setContract(result.data);
      setDisputing(false);
      setReason("");
      router.refresh();
    });
  }

  if (contract === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Digital contract and escrow</CardTitle>
          <CardDescription>
            Generate the agreement, hash it on-chain, and hold your payment in escrow until
            the produce passes quality check.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            disabled={pending}
            onClick={() => run(() => createContractAction(orderId))}
          >
            {pending ? "Generating…" : "Create contract"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const state = CONTRACT_STATE[contract.status];
  const next = NEXT_ACTION[contract.status];
  const reachedIndex = CONTRACT_SEQUENCE.indexOf(contract.status);
  const canDispute = ["FUNDED", "PICKED_UP", "DELIVERED"].includes(contract.status);

  // One event per state, newest wins, so a retried step shows its latest attempt.
  const eventFor = new Map(contract.events.map((event) => [event.toStatus, event]));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Contract {contract.contractNo}
              <Badge variant={state.variant} className="ml-2">
                {state.label}
              </Badge>
            </CardTitle>
            <CardDescription>{state.detail}</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">In escrow</p>
            <p className="text-xl font-bold">
              {contract.escrow?.status === "LOCKED"
                ? rupees(contract.escrow.amountRupees)
                : contract.escrow?.status === "RELEASED"
                  ? "Released"
                  : rupees(contract.amountRupees)}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {contract.degradedReason ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {contract.degradedReason}
          </p>
        ) : null}

        {/* The document and its hash — what makes "this exact agreement" checkable. */}
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Field label="Contract value" value={rupees(contract.amountRupees)} />
          <Field
            label="Chain"
            value={`${contract.chain.name} (id ${contract.chain.chainId})`}
          />
          {contract.pdfSha256 ? (
            <div className="sm:col-span-2">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                Document hash (SHA-256)
              </dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">
                  {contract.pdfSha256}
                </code>
                {contract.onChain?.contractHash === `0x${contract.pdfSha256}` ? (
                  <Badge variant="success">matches on-chain</Badge>
                ) : contract.onChain ? (
                  <Badge variant="destructive">differs from chain</Badge>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>

        {contract.pdfUrl ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/api/contract-pdf/${contract.id}`} target="_blank" rel="noreferrer">
              View contract document
            </a>
          </Button>
        ) : null}

        {/* Timeline. Future steps are shown greyed so the buyer knows what is coming. */}
        <ol className="space-y-0">
          {CONTRACT_SEQUENCE.map((status, index) => {
            const event = eventFor.get(status);
            const done = index <= reachedIndex && event !== undefined;
            const info = CONTRACT_STATE[status];
            const isLast = index === CONTRACT_SEQUENCE.length - 1;

            return (
              <li key={status} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                      done
                        ? event?.degraded
                          ? "border-warning bg-warning/20 text-warning-foreground"
                          : "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/30 text-muted-foreground/50"
                    }`}
                  >
                    {done ? (event?.degraded ? "!" : "✓") : index + 1}
                  </span>
                  {!isLast ? (
                    <span
                      className={`w-px flex-1 ${done ? "bg-primary/40" : "bg-border"}`}
                      style={{ minHeight: "1.5rem" }}
                    />
                  ) : null}
                </div>

                <div className={`pb-4 ${done ? "" : "opacity-45"}`}>
                  <p className="text-sm font-medium">{info.label}</p>
                  {event ? (
                    <div className="mt-0.5 space-y-0.5">
                      {event.degraded ? (
                        <p className="text-xs text-warning-foreground">
                          {event.note ?? "Recorded locally, not yet on-chain"}
                        </p>
                      ) : event.txHash ? (
                        <p className="text-xs text-muted-foreground">
                          {event.explorerUrl ? (
                            <a
                              href={event.explorerUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono hover:text-primary hover:underline"
                            >
                              {shortHash(event.txHash)}
                            </a>
                          ) : (
                            <code className="font-mono">{shortHash(event.txHash)}</code>
                          )}
                          {event.blockNumber !== null ? ` · block ${event.blockNumber}` : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {contract.status === "DISPUTED" || contract.status === "REFUNDED" ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {CONTRACT_STATE[contract.status].detail}
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

        {disputing ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input
              placeholder="What is wrong with the delivery?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="max-w-sm"
            />
            <Button
              variant="destructive"
              size="sm"
              disabled={pending || reason.trim().length < 3}
              onClick={() => run(() => contractActionRequest(contract.id, "dispute", reason))}
            >
              {pending ? "Raising…" : "Raise dispute"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDisputing(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {next ? (
              <Button
                disabled={pending}
                onClick={() =>
                  run(() => contractActionRequest(contract.id, next.action as ContractAction))
                }
              >
                {pending ? "Working…" : next.label}
              </Button>
            ) : null}
            {canDispute ? (
              <Button variant="outline" size="sm" onClick={() => setDisputing(true)}>
                Raise dispute
              </Button>
            ) : null}
            {contract.status === "DISPUTED" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => run(() => contractActionRequest(contract.id, "refund"))}
              >
                Refund escrow
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
