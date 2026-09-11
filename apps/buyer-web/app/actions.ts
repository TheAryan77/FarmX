"use server";

import type {
  AggregationProposal,
  AuthUser,
  ChatAnswer,
  ContractAction,
  ContractRecord,
  Order,
  QualityCheck,
  Requirement,
  Shipment,
  RequestOtpResult,
  VerifyOtpResult,
} from "@fasalx/types";
import {
  aggregateOrderSchema,
  chatAskSchema,
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

// ---------------------------------------------------------------- aggregation

export async function aggregateAction(
  requirementId: string,
): Promise<ActionResult<AggregationProposal>> {
  try {
    const proposal = await apiCall<AggregationProposal>("/matching/aggregate", {
      method: "POST",
      body: { requirementId },
    });
    return { ok: true, data: proposal };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function createAggregatedOrderAction(
  requirementId: string,
  settledPricePerQuintal: string,
): Promise<ActionResult<Order>> {
  const parsed = aggregateOrderSchema.safeParse({
    requirementId,
    ...(settledPricePerQuintal ? { settledPricePerQuintal } : {}),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the settled price" };
  }

  try {
    const order = await apiCall<Order>("/orders/aggregate", {
      method: "POST",
      body: parsed.data,
    });
    revalidatePath("/dashboard");
    revalidatePath("/orders");
    return { ok: true, data: order };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ---------------------------------------------------------------- contracts

export async function createContractAction(
  orderId: string,
): Promise<ActionResult<ContractRecord>> {
  try {
    const contract = await apiCall<ContractRecord>("/contracts", {
      method: "POST",
      body: { orderId },
    });
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    return { ok: true, data: contract };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function contractActionRequest(
  contractId: string,
  action: ContractAction,
  reason?: string,
): Promise<ActionResult<ContractRecord>> {
  try {
    const contract = await apiCall<ContractRecord>(`/contracts/${contractId}/${action}`, {
      method: "POST",
      ...(reason === undefined ? {} : { body: { reason } }),
    });
    revalidatePath(`/orders/${contract.orderId}`);
    revalidatePath("/orders");
    return { ok: true, data: contract };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ---------------------------------------------------------------- logistics

export async function optimiseRouteAction(orderId: string): Promise<ActionResult<Shipment>> {
  try {
    const shipment = await apiCall<Shipment>("/logistics/optimize", {
      method: "POST",
      body: { orderId },
    });
    revalidatePath(`/orders/${orderId}`);
    return { ok: true, data: shipment };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ---------------------------------------------------------------- quality

/**
 * Records what arrived. Sent as multipart so an optional proof photo can ride
 * along; the API's shared Zod schema coerces the string fields back.
 */
export async function recordQualityAction(input: {
  orderId: string;
  gradeFound: string;
  moisturePct?: string;
  notes?: string;
}): Promise<ActionResult<QualityCheck>> {
  const form = new FormData();
  form.set("orderId", input.orderId);
  form.set("gradeFound", input.gradeFound);
  if (input.moisturePct) form.set("moisturePct", input.moisturePct);
  if (input.notes) form.set("notes", input.notes);

  try {
    const check = await apiCall<QualityCheck>("/quality", { method: "POST", form });
    revalidatePath(`/orders/${input.orderId}`);
    return { ok: true, data: check };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function approveQualityAction(
  qualityCheckId: string,
  orderId: string,
): Promise<ActionResult<QualityCheck>> {
  try {
    const check = await apiCall<QualityCheck>(`/quality/${qualityCheckId}/approve`, {
      method: "POST",
    });
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    return { ok: true, data: check };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function rejectQualityAction(
  qualityCheckId: string,
  orderId: string,
  reason: string,
): Promise<ActionResult<QualityCheck>> {
  try {
    const check = await apiCall<QualityCheck>(`/quality/${qualityCheckId}/reject`, {
      method: "POST",
      body: { reason },
    });
    revalidatePath(`/orders/${orderId}`);
    return { ok: true, data: check };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ---------------------------------------------------------------- shipment steps

export async function confirmPickupAction(shipmentId: string, orderId: string): Promise<ActionResult<null>> {
  try {
    await apiCall(`/logistics/${shipmentId}/pickup-confirm`, { method: "POST", body: {} });
    revalidatePath(`/orders/${orderId}`);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function confirmDeliveryAction(shipmentId: string, orderId: string): Promise<ActionResult<null>> {
  try {
    await apiCall(`/logistics/${shipmentId}/deliver`, { method: "POST", form: new FormData() });
    revalidatePath(`/orders/${orderId}`);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}


// ------------------------------------------------------------------ assistant

export async function askAssistantAction(
  question: string,
  language: "en" | "hi",
): Promise<ActionResult<ChatAnswer>> {
  const parsed = chatAskSchema.safeParse({ question, language });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Type a question" };
  }

  try {
    const data = await apiCall<ChatAnswer>("/chat", { method: "POST", body: parsed.data });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
