"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@fasalx/ui";

import { deleteListingAction } from "@/app/actions";

/**
 * Soft-delete with an inline confirm step. A farmer must not lose a listing to
 * one mistaken tap, and a modal is more chrome than this screen needs.
 */
export function RemoveListing({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteListingAction(id);
      if (!result.ok) {
        setError(result.error ?? "Could not remove this listing");
        setConfirming(false);
        return;
      }
      router.push("/listings");
    });
  }

  if (!confirming) {
    return (
      <div className="space-y-3">
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-base font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          size="touch"
          variant="outline"
          className="w-full text-base"
          onClick={() => setConfirming(true)}
        >
          Remove this listing
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4">
      <p className="text-lg font-semibold">Remove this listing?</p>
      <p className="text-base text-muted-foreground">
        Buyers will no longer see it. You can list the produce again any time.
      </p>
      <Button
        type="button"
        size="touch"
        variant="destructive"
        className="w-full text-base"
        onClick={remove}
        disabled={pending}
      >
        {pending ? "Removing…" : "Yes, remove it"}
      </Button>
      <Button
        type="button"
        size="touch"
        variant="ghost"
        className="w-full text-base"
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        Keep it
      </Button>
    </div>
  );
}
