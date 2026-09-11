"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@fasalx/ui";

import { setKycAction } from "@/app/actions";

/**
 * Records the outcome of a KYC review.
 *
 * Only the two transitions an operator actually makes are offered — verify and
 * reject — rather than a free choice of all four states. "Not started" and
 * "pending" are things that happen to a farmer, not decisions someone makes
 * about one.
 */
export function KycActions({
  farmerId,
  status,
}: {
  farmerId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set(next: "VERIFIED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const result = await setKycAction(farmerId, next);
      if (!result.ok) {
        setError(result.error ?? "That did not work");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {status !== "VERIFIED" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => set("VERIFIED")}>
          Verify
        </Button>
      ) : null}
      {status !== "REJECTED" ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("REJECTED")}>
          Reject
        </Button>
      ) : null}
      {error ? <span className="text-xs font-medium text-destructive">{error}</span> : null}
    </div>
  );
}
