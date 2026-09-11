"use server";

import type { AuthUser, RequestOtpResult, VerifyOtpResult } from "@fasalx/types";
import { requestOtpSchema, verifyOtpSchema } from "@fasalx/validation";
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

export async function verifyOtpAction(phone: string, otp: string): Promise<ActionResult<AuthUser>> {
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

    // Role gate at the app boundary: this console signs in ADMIN accounts only.
    if (user.role !== APP_ROLE) {
      return {
        ok: false,
        error:
          `${phone} is a ${user.role.toLowerCase()} account. ` +
          `The operations console is for admin accounts only.`,
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

// ------------------------------------------------------------------ repairs

export interface AdminActionResult {
  ok: boolean;
  message: string;
}

/** Writes the payouts a released order should already have. */
export async function resettleOrderAction(orderId: string): Promise<ActionResult<AdminActionResult>> {
  try {
    const data = await apiCall<AdminActionResult>(`/admin/orders/${orderId}/resettle`, {
      method: "POST",
    });
    revalidatePath("/dashboard");
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

/** Refunds the buyer on a disputed order. */
export async function refundOrderAction(orderId: string): Promise<ActionResult<AdminActionResult>> {
  try {
    const data = await apiCall<AdminActionResult>(`/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    revalidatePath("/dashboard");
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

/** Records the outcome of a KYC review. */
export async function setKycAction(
  farmerId: string,
  status: "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED",
): Promise<ActionResult<AdminActionResult>> {
  try {
    const data = await apiCall<AdminActionResult>(`/admin/farmers/${farmerId}/kyc`, {
      method: "PATCH",
      body: { status },
    });
    revalidatePath("/farmers");
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
