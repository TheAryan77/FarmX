"use server";

import type { AuthUser, Requirement, RequestOtpResult, VerifyOtpResult } from "@fasalx/types";
import {
  counterOfferSchema,
  createOfferSchema,
  createRequirementSchema,
  requestOtpSchema,
  verifyOtpSchema,
} from "@fasalx/validation";
import { revalidatePath } from "next/cache";

import { apiCall, ApiRequestError } from "@/lib/api";
import { APP_ROLE, clearSessionToken, setSessionToken } from "@/lib/session";

export interface ActionResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

function toMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return "Something went wrong — please try again";
}

export async function requestOtpAction(phone: string): Promise<ActionResult<RequestOtpResult>> {
  // Validated with the same shared schema the API uses, so the farmer sees the
  // same wording without a round trip.
  const parsed = requestOtpSchema.safeParse({ phone });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the number" };
  }

  try {
    const data = await apiCall<RequestOtpResult>("/auth/request-otp", {
      method: "POST",
      body: parsed.data,
      auth: false,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function verifyOtpAction(
  phone: string,
  otp: string,
): Promise<ActionResult<AuthUser>> {
  const parsed = verifyOtpSchema.safeParse({ phone, otp });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the code" };
  }

  try {
    const { token, user } = await apiCall<VerifyOtpResult>("/auth/verify-otp", {
      method: "POST",
      body: parsed.data,
      auth: false,
    });

    // Role gate at the app boundary: this app signs in BUYER accounts only.
    // Without this, a buyer could authenticate here and land on a dashboard
    // built for someone else.
    if (user.role !== APP_ROLE) {
      return {
        ok: false,
        error:
          `${phone} is a ${user.role.toLowerCase()} account. ` +
          `Open the farmer app on port 3000 to sign in as Farmer.`,
      };
    }

    await setSessionToken(token);
    return { ok: true, data: user };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function signOutAction(): Promise<void> {
  await clearSessionToken();
}

// ---------------------------------------------------------------- requirements

export async function createRequirementAction(input: {
  crop: string;
  grade: string;
  quantityQuintals: string;
  targetPricePerQuintal: string;
  maxDistanceKm: string;
  minLotQuintals?: string;
  deliveryBy: string;
}): Promise<ActionResult<Requirement>> {
  // An empty optional field arrives as "" from the form; drop it rather than
  // letting Zod coerce it to 0.
  const payload = {
    ...input,
    ...(input.minLotQuintals ? { minLotQuintals: input.minLotQuintals } : { minLotQuintals: undefined }),
  };

  const parsed = createRequirementSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details you entered" };
  }

  try {
    const requirement = await apiCall<Requirement>("/requirements", {
      method: "POST",
      body: parsed.data,
    });
    revalidatePath("/dashboard");
    return { ok: true, data: requirement };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ---------------------------------------------------------------- offers

export async function acceptOfferAction(offerId: string): Promise<ActionResult<{ orderId: string }>> {
  try {
    const result = await apiCall<{ order: { id: string } }>(`/offers/${offerId}/accept`, {
      method: "POST",
    });
    revalidatePath("/offers");
    revalidatePath("/orders");
    revalidatePath("/dashboard");
    return { ok: true, data: { orderId: result.order.id } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function counterOfferAction(
  offerId: string,
  pricePerQuintal: string,
): Promise<ActionResult<{ offerId: string }>> {
  const parsed = counterOfferSchema.safeParse({ pricePerQuintal });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the price" };
  }

  try {
    const thread = await apiCall<{ latest: { id: string } }>(`/offers/${offerId}/counter`, {
      method: "POST",
      body: parsed.data,
    });
    revalidatePath("/offers");
    return { ok: true, data: { offerId: thread.latest.id } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function rejectOfferAction(offerId: string): Promise<ActionResult<null>> {
  try {
    await apiCall(`/offers/${offerId}/reject`, { method: "POST" });
    revalidatePath("/offers");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function createOfferAction(input: {
  listingId: string;
  requirementId?: string;
  pricePerQuintal: string;
  quantityQuintals: string;
}): Promise<ActionResult<{ offerId: string }>> {
  const parsed = createOfferSchema.safeParse({
    ...input,
    ...(input.requirementId ? { requirementId: input.requirementId } : {}),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details you entered" };
  }

  try {
    const thread = await apiCall<{ latest: { id: string } }>("/offers", {
      method: "POST",
      body: parsed.data,
    });
    revalidatePath("/offers");
    return { ok: true, data: { offerId: thread.latest.id } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
