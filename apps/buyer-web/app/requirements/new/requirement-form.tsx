"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { istTodayIso } from "@fasalx/validation/date";
import { Button, Input, Label, NativeSelect } from "@fasalx/ui";

import { createRequirementAction } from "@/app/actions";
import { rupees, rupeesCompact } from "@/lib/format";

/** Default deadline: a week out, matching the demo requirement. */
function defaultDeadline(): string {
  const d = new Date(`${istTodayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function RequirementForm({ suggestedPrice }: { suggestedPrice: number | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [grade, setGrade] = useState("A");
  const [quantity, setQuantity] = useState("");
  const [target, setTarget] = useState(suggestedPrice ? String(suggestedPrice) : "");
  const [maxDistance, setMaxDistance] = useState("150");
  const [minLot, setMinLot] = useState("");
  const [deliveryBy, setDeliveryBy] = useState(defaultDeadline());
  const [error, setError] = useState<string | null>(null);

  const quantityNum = Number(quantity);
  const targetNum = Number(target);
  const estimate =
    quantityNum > 0 && targetNum > 0 ? Math.round(quantityNum * targetNum) : null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createRequirementAction({
        crop: "wheat",
        grade,
        quantityQuintals: quantity,
        targetPricePerQuintal: target,
        maxDistanceKm: maxDistance,
        minLotQuintals: minLot,
        deliveryBy,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not create the requirement");
        return;
      }
      router.push(`/requirements/${result.data?.id ?? ""}`);
    });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Commodity" htmlFor="crop">
          <div className="flex h-9 items-center justify-between rounded-md border bg-muted/50 px-3 text-sm">
            <span className="font-medium">Wheat</span>
            <span className="text-xs text-muted-foreground">Only crop in this pilot</span>
          </div>
        </Field>

        <Field label="Quality grade" htmlFor="grade">
          <NativeSelect id="grade" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
          </NativeSelect>
        </Field>

        <Field label="Quantity required" htmlFor="quantity" hint="In quintals">
          <div className="flex items-stretch gap-2">
            <Input
              id="quantity"
              inputMode="decimal"
              autoFocus
              placeholder="500"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, "").slice(0, 8))}
              aria-invalid={error !== null}
            />
            <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
              Q
            </span>
          </div>
        </Field>

        <Field
          label="Target price"
          htmlFor="target"
          hint={
            suggestedPrice
              ? `Mandi rate today is ${rupees(suggestedPrice)}/Q`
              : "Rupees per quintal"
          }
        >
          <div className="flex items-stretch gap-2">
            <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
              ₹
            </span>
            <Input
              id="target"
              inputMode="numeric"
              placeholder="2400"
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={error !== null}
            />
            <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
              /Q
            </span>
          </div>
        </Field>

        <Field label="Collection radius" htmlFor="maxDistance" hint="From your registered location">
          <div className="flex items-stretch gap-2">
            <Input
              id="maxDistance"
              inputMode="numeric"
              placeholder="150"
              value={maxDistance}
              onChange={(e) => setMaxDistance(e.target.value.replace(/\D/g, "").slice(0, 4))}
              aria-invalid={error !== null}
            />
            <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
              km
            </span>
          </div>
        </Field>

        <Field label="Delivery deadline" htmlFor="deliveryBy">
          <Input
            id="deliveryBy"
            type="date"
            value={deliveryBy}
            min={istTodayIso()}
            onChange={(e) => setDeliveryBy(e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Minimum lot size"
        htmlFor="minLot"
        hint="Optional. Excludes lots too small to send a truck for — leave blank to accept any size."
      >
        <div className="flex max-w-xs items-stretch gap-2">
          <Input
            id="minLot"
            inputMode="decimal"
            placeholder="75"
            value={minLot}
            onChange={(e) => setMinLot(e.target.value.replace(/[^0-9.]/g, "").slice(0, 8))}
          />
          <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
            Q
          </span>
        </div>
      </Field>

      {estimate !== null ? (
        <div className="rounded-md border bg-primary/5 px-4 py-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            Procurement value at target
          </p>
          <p className="text-2xl font-bold text-primary">{rupees(estimate)}</p>
          <p className="text-xs text-muted-foreground">
            {rupeesCompact(estimate)} · before logistics and platform charges
          </p>
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

      <div className="flex gap-3">
        <Button type="submit" disabled={pending || !quantity || !target || !maxDistance}>
          {pending ? "Posting…" : "Post requirement"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/dashboard")} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
