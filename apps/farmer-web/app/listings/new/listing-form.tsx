"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { istTodayIso } from "@fasalx/validation/date";
import { Button, Input, Label, cn } from "@fasalx/ui";

import { createListingAction } from "@/app/actions";
import { rupees } from "@/lib/format";

const GRADES = [
  { value: "A", label: "A", hint: "Best" },
  { value: "B", label: "B", hint: "Average" },
  { value: "C", label: "C", hint: "Low" },
] as const;

interface Props {
  /** Prefilled from the farmer's profile — the form does not ask for location. */
  village: string;
  district: string;
  suggestedPrice: number | null;
}

/**
 * Sell Produce.
 *
 * The unit is a fixed label, not a field. CLAUDE.md forbids mixing kg and
 * quintal anywhere, so there is deliberately no unit selector to get wrong —
 * the "1 quintal = 100 kg" line is a reading aid only and is never stored.
 * Crop is locked to wheat for the pilot and shown as read-only rather than a
 * one-option dropdown.
 */
export function ListingForm({ village, district, suggestedPrice }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [grade, setGrade] = useState<string>("A");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState(suggestedPrice ? String(suggestedPrice) : "");
  const [availableFrom, setAvailableFrom] = useState(istTodayIso());
  const [error, setError] = useState<string | null>(null);

  const quantityNum = Number(quantity);
  const priceNum = Number(price);
  const estimate =
    Number.isFinite(quantityNum) && Number.isFinite(priceNum) && quantityNum > 0 && priceNum > 0
      ? Math.round(quantityNum * priceNum)
      : null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createListingAction({
        crop: "wheat",
        grade,
        quantityQuintals: quantity,
        expectedPricePerQuintal: price,
        availableFrom,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not save your listing");
        return;
      }
      router.push("/listings?created=1");
    });
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* Crop — locked to wheat for the Karnal pilot. */}
      <div className="space-y-2">
        <Label className="text-lg font-semibold">Crop</Label>
        <div className="flex items-center justify-between rounded-md border bg-muted/50 px-4 py-4">
          <span className="text-xl font-semibold">🌾 Wheat</span>
          <span className="text-sm text-muted-foreground">Only crop in this pilot</span>
        </div>
      </div>

      {/* Quantity — quintals, always. */}
      <div className="space-y-2">
        <Label htmlFor="quantity" className="text-lg font-semibold">
          How much do you have?
        </Label>
        <div className="flex items-stretch gap-2">
          <Input
            id="quantity"
            name="quantity"
            inputMode="decimal"
            autoFocus
            placeholder="50"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, "").slice(0, 8))}
            aria-invalid={error !== null}
            className="h-16 flex-1 text-2xl md:text-2xl"
          />
          <span className="flex min-w-24 items-center justify-center rounded-md border bg-muted px-4 text-lg font-semibold text-muted-foreground">
            quintal
          </span>
        </div>
        <p className="text-sm text-muted-foreground">1 quintal = 100 kg</p>
      </div>

      {/* Grade — big buttons, not a dropdown. */}
      <div className="space-y-2">
        <Label className="text-lg font-semibold">Quality grade</Label>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Quality grade">
          {GRADES.map((g) => {
            const selected = grade === g.value;
            return (
              <button
                key={g.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setGrade(g.value)}
                className={cn(
                  "flex h-16 flex-col items-center justify-center rounded-lg border-2 transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:bg-accent",
                )}
              >
                <span className="text-xl font-bold">{g.label}</span>
                <span
                  className={cn(
                    "text-xs",
                    selected ? "text-primary-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {g.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Price */}
      <div className="space-y-2">
        <Label htmlFor="price" className="text-lg font-semibold">
          Your expected price
        </Label>
        <div className="flex items-stretch gap-2">
          <span className="flex items-center rounded-md border bg-muted px-4 text-xl font-semibold text-muted-foreground">
            ₹
          </span>
          <Input
            id="price"
            name="price"
            inputMode="numeric"
            placeholder="2400"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-invalid={error !== null}
            className="h-16 flex-1 text-2xl md:text-2xl"
          />
          <span className="flex min-w-24 items-center justify-center rounded-md border bg-muted px-4 text-lg font-semibold text-muted-foreground">
            / quintal
          </span>
        </div>
        {suggestedPrice ? (
          <p className="text-sm text-muted-foreground">
            Today&apos;s mandi rate is {rupees(suggestedPrice)} per quintal
          </p>
        ) : null}
      </div>

      {/* Available from */}
      <div className="space-y-2">
        <Label htmlFor="availableFrom" className="text-lg font-semibold">
          Ready from
        </Label>
        <Input
          id="availableFrom"
          name="availableFrom"
          type="date"
          value={availableFrom}
          min={istTodayIso()}
          onChange={(e) => setAvailableFrom(e.target.value)}
          className="h-16 text-xl md:text-xl"
        />
      </div>

      {/* Location — prefilled, not asked. */}
      <div className="space-y-2">
        <Label className="text-lg font-semibold">Pickup from</Label>
        <div className="rounded-md border bg-muted/50 px-4 py-4">
          <p className="text-xl font-semibold">{village}</p>
          <p className="text-base text-muted-foreground">{district}, Haryana</p>
        </div>
      </div>

      {estimate !== null ? (
        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-4 py-4">
          <p className="text-base text-muted-foreground">You could receive about</p>
          <p className="text-3xl font-bold text-primary">{rupees(estimate)}</p>
          <p className="text-sm text-muted-foreground">
            Before transport and platform charges
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-base font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="touch"
        className="w-full text-lg"
        disabled={pending || quantity.length === 0 || price.length === 0}
      >
        {pending ? "Listing…" : "List my produce"}
      </Button>
    </form>
  );
}
