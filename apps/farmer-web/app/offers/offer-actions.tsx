"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OfferThread } from "@fasalx/types";
import { Button, Input, Label } from "@fasalx/ui";

import { acceptOfferAction, counterOfferAction, rejectOfferAction } from "@/app/actions";
import { rupees } from "@/lib/format";

/**
 * Accept / counter / decline for one negotiation.
 *
 * Which buttons exist is decided by the API (`canAccept`, `canCounter`,
 * `canReject`) rather than re-derived here — the state machine lives in one
 * place, and the farmer app and buyer portal cannot drift apart on it.
 */
export function OfferActions({ thread }: { thread: OfferThread }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "counter" | "confirmReject">("idle");
  const [price, setPrice] = useState(String(thread.listing.expectedPricePerQuintal));
  const [error, setError] = useState<string | null>(null);

  const quantity = thread.latest.quantityQuintals;
  const counterTotal = Number(price) > 0 ? Math.round(Number(price) * quantity) : null;

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

  if (!thread.awaitingYou) return null;

  return (
    <div className="space-y-3 border-t pt-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-base font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}

      {mode === "counter" ? (
        <div className="space-y-3 rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
          <Label htmlFor={`counter-${thread.latest.id}`} className="text-lg font-semibold">
            Ask for your price
          </Label>
          <div className="flex items-stretch gap-2">
            <span className="flex items-center rounded-md border bg-background px-4 text-xl font-semibold text-muted-foreground">
              ₹
            </span>
            <Input
              id={`counter-${thread.latest.id}`}
              inputMode="numeric"
              autoFocus
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="h-16 flex-1 bg-background text-2xl md:text-2xl"
            />
            <span className="flex items-center rounded-md border bg-background px-3 text-base font-semibold text-muted-foreground">
              /Q
            </span>
          </div>
          {counterTotal !== null ? (
            <p className="text-base">
              You would receive <span className="font-bold">{rupees(counterTotal)}</span> for{" "}
              {quantity}Q
            </p>
          ) : null}
          <Button
            type="button"
            size="touch"
            className="w-full text-lg"
            disabled={pending || price.length === 0}
            onClick={() =>
              run(
                () => counterOfferAction(thread.latest.id, price),
                () => setMode("idle"),
              )
            }
          >
            {pending ? "Sending…" : "Send my price"}
          </Button>
          <Button
            type="button"
            size="touch"
            variant="ghost"
            className="w-full text-base"
            onClick={() => setMode("idle")}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      ) : mode === "confirmReject" ? (
        <div className="space-y-3 rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4">
          <p className="text-lg font-semibold">Decline this offer?</p>
          <p className="text-base text-muted-foreground">
            The buyer will be told. Your produce stays listed for others.
          </p>
          <Button
            type="button"
            size="touch"
            variant="destructive"
            className="w-full text-base"
            disabled={pending}
            onClick={() => run(() => rejectOfferAction(thread.latest.id))}
          >
            {pending ? "Declining…" : "Yes, decline"}
          </Button>
          <Button
            type="button"
            size="touch"
            variant="ghost"
            className="w-full text-base"
            onClick={() => setMode("idle")}
            disabled={pending}
          >
            Keep it
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {thread.canAccept ? (
            <Button
              type="button"
              size="touch"
              className="w-full text-lg"
              disabled={pending}
              onClick={() =>
                run(() => acceptOfferAction(thread.latest.id), () => router.push("/orders"))
              }
            >
              {pending ? "Accepting…" : `Accept ${rupees(thread.latest.pricePerQuintal)}/Q`}
            </Button>
          ) : null}

          {thread.canCounter ? (
            <Button
              type="button"
              size="touch"
              variant="outline"
              className="w-full text-lg"
              onClick={() => setMode("counter")}
              disabled={pending}
            >
              Ask for more
            </Button>
          ) : null}

          {thread.canReject ? (
            <Button
              type="button"
              size="touch"
              variant="ghost"
              className="w-full text-base"
              onClick={() => setMode("confirmReject")}
              disabled={pending}
            >
              Decline
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
