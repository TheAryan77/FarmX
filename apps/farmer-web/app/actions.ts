"use server";

import type { AuthUser, Listing, RequestOtpResult, VerifyOtpResult } from "@fasalx/types";
import { createListingSchema, requestOtpSchema, verifyOtpSchema } from "@fasalx/validation";
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

    // Role gate at the app boundary: this app signs in FARMER accounts only.
    // Without this, a buyer could authenticate here and land on a dashboard
    // built for someone else.
    if (user.role !== APP_ROLE) {
      return {
        ok: false,
        error:
          `${phone} is a ${user.role.toLowerCase()} account. ` +
          `Open the buyer portal on port 3001 to sign in as Buyer.`,
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

// ---------------------------------------------------------------- listings

export async function createListingAction(input: {
  crop: string;
  grade: string;
  quantityQuintals: string;
  expectedPricePerQuintal: string;
  availableFrom: string;
}): Promise<ActionResult<Listing>> {
  // Same shared schema the API enforces, so the farmer sees the same wording
  // without waiting on a round trip.
  const parsed = createListingSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the details you entered" };
  }

  try {
    const listing = await apiCall<Listing>("/listings", { method: "POST", body: parsed.data });
    revalidatePath("/listings");
    revalidatePath("/dashboard");
    return { ok: true, data: listing };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function deleteListingAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const data = await apiCall<{ id: string }>(`/listings/${id}`, { method: "DELETE" });
    revalidatePath("/listings");
    revalidatePath("/dashboard");
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
