import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../env.js";
import { HttpError } from "./errors.js";

/**
 * Razorpay, test mode.
 *
 * CLAUDE.md puts real INR escrow out of scope, so this is a simulated rail:
 * test credentials, no real money. Its job in the flow is to make funding feel
 * like a payment rather than a button, while the chain keeps being the trust
 * record.
 *
 * Talks to the REST API directly rather than pulling in the SDK. Two calls are
 * needed — create an order, verify a signature — and the second is a HMAC that
 * node:crypto already does.
 */

const API = "https://api.razorpay.com/v1";

/**
 * Razorpay refuses a single order above ₹5,00,000. Measured, not assumed:
 * 50,000,000 paise is accepted and 50,000,001 is rejected with
 * "Amount exceeds maximum amount allowed."
 *
 * The demo's aggregated order is ₹12,10,000, so it cannot be charged whole.
 * Rather than quietly charging less than the screen says, anything above the
 * ceiling is collected as a labelled advance — see `fundingAmount` below.
 */
export const RAZORPAY_MAX_RUPEES = 500_000;

/** Share of the order collected up front when the total exceeds the ceiling. */
export const ADVANCE_RATE = 0.1;

export interface FundingAmount {
  rupees: number;
  isAdvance: boolean;
}

/**
 * What to actually charge for an order of this size.
 *
 * Under the ceiling the buyer pays in full. Above it they pay a percentage
 * advance, which is both under the cap and how bulk agricultural procurement
 * commonly works — the balance settles on delivery. The flag travels with it
 * so no screen can imply the whole sum was collected.
 */
export function fundingAmount(orderRupees: number): FundingAmount {
  if (orderRupees <= RAZORPAY_MAX_RUPEES) {
    return { rupees: orderRupees, isAdvance: false };
  }
  const advance = Math.round(orderRupees * ADVANCE_RATE);
  // A 10% advance on a very large order could itself exceed the ceiling.
  return { rupees: Math.min(advance, RAZORPAY_MAX_RUPEES), isAdvance: true };
}

export function isConfigured(): boolean {
  return env.RAZORPAY_KEY_ID !== "" && env.RAZORPAY_KEY_SECRET !== "";
}

function authHeader(): string {
  const raw = `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/** Creates a Razorpay order. `rupees` is whole rupees; Razorpay wants paise. */
export async function createRazorpayOrder(
  rupees: number,
  receipt: string,
): Promise<RazorpayOrder> {
  if (!isConfigured()) {
    throw new HttpError(
      503,
      "PAYMENTS_UNCONFIGURED",
      "Payments are not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { authorization: authHeader(), "content-type": "application/json" },
      body: JSON.stringify({
        amount: rupees * 100,
        currency: "INR",
        // Razorpay caps the receipt at 40 characters.
        receipt: receipt.slice(0, 40),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(
      503,
      "PAYMENTS_UNREACHABLE",
      "Could not reach Razorpay. Check the network and try again.",
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { id?: string; amount?: number; currency?: string; status?: string; error?: { description?: string } }
    | null;

  if (!response.ok || !body?.id) {
    // Razorpay's description is safe to show: it describes the request, and
    // the credentials travel in a header rather than the body.
    throw new HttpError(
      502,
      "PAYMENT_ORDER_FAILED",
      body?.error?.description ?? "Razorpay could not create the payment order",
    );
  }

  return {
    id: body.id,
    amount: body.amount ?? rupees * 100,
    currency: body.currency ?? "INR",
    status: body.status ?? "created",
  };
}

/**
 * Verifies the checkout callback.
 *
 * The signature is `HMAC-SHA256(order_id|payment_id, key_secret)`. Without
 * this check anyone could post a made-up payment id and have the escrow lock,
 * so it is the whole security of the flow — and it is compared in constant
 * time, because a naive `===` on a hex digest leaks how much of it matched.
 */
export function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): boolean {
  const expected = createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  const given = Buffer.from(signature, "utf8");
  const mine = Buffer.from(expected, "utf8");
  if (given.length !== mine.length) return false;
  return timingSafeEqual(given, mine);
}
