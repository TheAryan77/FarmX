"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OfferThread } from "@fasalx/types";
import { Button, Input } from "@fasalx/ui";

import { acceptOfferAction, counterOfferAction, rejectOfferAction } from "@/app/actions";
import { rupees } from "@/lib/format";

/**
 * Accept / counter / decline, compact for the portal.
 *
 * Availability comes from the API's `canAccept` / `canCounter` / `canReject`
 * so the state machine is not re-implemented per client.
 */
export function OfferActions({ thread }: { thread: OfferThread }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [countering, setCountering] = useState(false);
  const [price, setPrice] = useState(String(thread.latest.pricePerQuintal));
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong");
        return;
      }
      done?.();
      router.refresh();
    });
  }

  if (!thread.awaitingYou) return null;

  return (
    <div className="space-y-3 border-t pt-3">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}

      {countering ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-stretch gap-1.5">
            <span className="flex items-center rounded-md border bg-muted px-2 text-sm text-muted-foreground">
              ₹
            </span>
            <Input
              inputMode="numeric"
              autoFocus
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-28"
            />
            <span className="flex items-center rounded-md border bg-muted px-2 text-sm text-muted-foreground">
              /Q
            </span>
          </div>
          <Button
            size="sm"
            disabled={pending || !price}
            onClick={() =>
              run(
                () => counterOfferAction(thread.latest.id, price),
                () => setCountering(false),
              )
            }
          >
            {pending ? "Sending…" : "Send counter"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCountering(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {thread.canAccept ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => acceptOfferAction(thread.latest.id), () => router.push("/orders"))
              }
            >
              {pending ? "Accepting…" : `Accept ${rupees(thread.latest.pricePerQuintal)}/Q`}
            </Button>
          ) : null}
          {thread.canCounter ? (
            <Button size="sm" variant="outline" onClick={() => setCountering(true)} disabled={pending}>
              Counter
            </Button>
          ) : null}
          {thread.canReject ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => rejectOfferAction(thread.latest.id))}
            >
              Decline
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
