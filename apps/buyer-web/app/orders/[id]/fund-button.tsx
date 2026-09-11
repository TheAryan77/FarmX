"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentIntent } from "@fasalx/types";
import { Button } from "@fasalx/ui";

import { confirmPaymentAction, failPaymentAction, startPaymentAction } from "@/app/actions";
import { rupees } from "@/lib/format";

/**
 * Funding the escrow, through Razorpay in test mode.
 *
 * The chain transition is not this component's to make. It asks the API for an
 * order, hands the browser to Razorpay, and posts the callback back for
 * verification — the escrow locks only if the signature checks out, server
 * side. Nothing here can fund anything on its own, and there is no longer a
 * bare fund route it could call instead.
 */

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** Loads checkout.js once, on demand rather than on every order page. */
function loadCheckout(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("load failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("load failed"));
    document.body.appendChild(script);
  });
}

export function FundButton({
  contractId,
  amountRupees,
  maxSinglePaymentRupees,
  advanceRate,
}: {
  contractId: string;
  amountRupees: number;
  maxSinglePaymentRupees: number;
  advanceRate: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function fund() {
    setError(null);
    setNote(null);
    setBusy(true);

    startTransition(async () => {
      const started = await startPaymentAction(contractId);
      if (!started.ok || !started.data) {
        setError(started.error ?? "Could not start the payment");
        setBusy(false);
        return;
      }
      const intent: PaymentIntent = started.data;

      try {
        await loadCheckout();
      } catch {
        setError("Could not load Razorpay checkout. Check your connection.");
        setBusy(false);
        return;
      }

      const Razorpay = window.Razorpay;
      if (!Razorpay) {
        setError("Razorpay checkout is unavailable.");
        setBusy(false);
        return;
      }

      const checkout = new Razorpay({
        key: intent.keyId,
        amount: intent.amountRupees * 100,
        currency: "INR",
        name: "FasalX",
        description: intent.isAdvance
          ? `Advance for ${intent.contractNo}`
          : `Escrow funding for ${intent.contractNo}`,
        order_id: intent.razorpayOrderId,
        handler: (response: RazorpayResponse) => {
          startTransition(async () => {
            const confirmed = await confirmPaymentAction(contractId, {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            });
            setBusy(false);
            if (!confirmed.ok) {
              setError(confirmed.error ?? "The payment could not be verified");
              return;
            }
            setNote("Payment verified — the escrow is locked.");
            router.refresh();
          });
        },
        modal: {
          // An abandoned checkout is recorded rather than left as a silent gap
          // between an order that says ACCEPTED and a buyer who thinks they paid.
          ondismiss: () => {
            setBusy(false);
            void failPaymentAction(contractId, intent.razorpayOrderId, "Checkout was closed");
          },
        },
        theme: { color: "#2f6f3e" },
      });

      checkout.on("payment.failed", (payload: unknown) => {
        const description =
          (payload as { error?: { description?: string } })?.error?.description ??
          "The payment failed";
        setBusy(false);
        setError(description);
        void failPaymentAction(contractId, intent.razorpayOrderId, description);
      });

      checkout.open();
    });
  }

  const working = pending || busy;
  // Mirrors fundingAmount() on the server, from the same numbers it uses.
  const isAdvance = amountRupees > maxSinglePaymentRupees;
  const charge = isAdvance
    ? Math.min(Math.round(amountRupees * advanceRate), maxSinglePaymentRupees)
    : amountRupees;

  return (
    <div className="space-y-2">
      <Button onClick={fund} disabled={working}>
        {working ? "Opening payment…" : `Pay ${rupees(charge)} to fund escrow`}
      </Button>
      {isAdvance ? (
        <p className="text-xs text-muted-foreground">
          {Math.round(advanceRate * 100)}% advance — a single payment is capped at{" "}
          {rupees(maxSinglePaymentRupees)} and this order is {rupees(amountRupees)}. The balance
          settles on delivery.
        </p>
      ) : null}
      {note ? <p className="text-sm font-medium text-success">{note}</p> : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
