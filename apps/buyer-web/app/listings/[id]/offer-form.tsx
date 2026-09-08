"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@fasalx/ui";

import { createOfferAction } from "@/app/actions";
import { quintals, rupees } from "@/lib/format";

export function OfferForm({
  listingId,
  requirementId,
  availableQuintals,
  askingPrice,
}: {
  listingId: string;
  requirementId?: string;
  availableQuintals: number;
  askingPrice: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [price, setPrice] = useState(String(askingPrice));
  const [quantity, setQuantity] = useState(String(availableQuintals));
  const [error, setError] = useState<string | null>(null);

  const priceNum = Number(price);
  const quantityNum = Number(quantity);
  const total = priceNum > 0 && quantityNum > 0 ? Math.round(priceNum * quantityNum) : null;
  const delta = priceNum > 0 ? priceNum - askingPrice : 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createOfferAction({
        listingId,
        ...(requirementId ? { requirementId } : {}),
        pricePerQuintal: price,
        quantityQuintals: quantity,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not send the offer");
        return;
      }
      router.push("/offers");
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="price">Your price</Label>
          <div className="flex items-stretch gap-2">
            <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
              ₹
            </span>
            <Input
              id="price"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={error !== null}
            />
            <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
              /Q
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Farmer is asking {rupees(askingPrice)}/Q
            {delta !== 0
              ? ` · you are ${delta > 0 ? "above" : "below"} by ${rupees(Math.abs(delta))}`
              : ""}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="quantity">Quantity</Label>
          <div className="flex items-stretch gap-2">
            <Input
              id="quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, "").slice(0, 8))}
              aria-invalid={error !== null}
            />
            <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
              Q
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {quintals(availableQuintals)} available
          </p>
        </div>
      </div>

      {total !== null ? (
        <div className="rounded-md border bg-primary/5 px-4 py-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Offer value</p>
          <p className="text-2xl font-bold text-primary">{rupees(total)}</p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || !price || !quantity}>
        {pending ? "Sending…" : "Send offer"}
      </Button>
    </form>
  );
}
