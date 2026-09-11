"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@fasalx/ui";

import { refundOrderAction, resettleOrderAction } from "@/app/actions";

/**
 * The button that turns a detected problem into a fixed one.
 *
 * Kept deliberately plain: one action per alert, the result reported in words
 * rather than a toast that disappears, and the page refreshed afterwards so
 * the alert it just resolved actually goes away. An operator should never have
 * to guess whether the thing they pressed worked.
 */
export function AlertAction({
  kind,
  orderId,
}: {
  kind: "resettle" | "refund";
  orderId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const label = kind === "resettle" ? "Write the missing payouts" : "Refund the buyer";
  const busy = kind === "resettle" ? "Writing payouts…" : "Refunding…";

  function run() {
    setResult(null);
    startTransition(async () => {
      const action = kind === "resettle" ? resettleOrderAction : refundOrderAction;
      const outcome = await action(orderId);
      if (!outcome.ok) {
        setResult({ ok: false, text: outcome.error ?? "That did not work" });
        return;
      }
      setResult({ ok: true, text: outcome.data?.message ?? "Done" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" onClick={run} disabled={pending}>
        {pending ? busy : label}
      </Button>
      {result ? (
        <p
          role="status"
          className={`text-sm font-medium ${result.ok ? "text-success" : "text-destructive"}`}
        >
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
