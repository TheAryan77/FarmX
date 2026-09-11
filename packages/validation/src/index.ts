/**
 * Shared FasalX Zod schemas.
 *
 * CLAUDE.md: these are shared by the API and the clients so a rule is stated
 * once. The API validates with them; the apps reuse the same messages so a
 * farmer sees the same wording the server would have produced.
 */

import { z } from "zod";

import { addDaysIso, istTodayIso } from "./date";

// ---------------------------------------------------------------- primitives

// The `error` option covers a missing or non-string value, so a client that
// omits the field gets the same human sentence as one that mistypes it —
// never a raw "expected string, received undefined".

/** Indian mobile numbers are 10 digits starting 6-9. */
export const phoneSchema = z
  .string({ error: "Enter a 10-digit mobile number" })
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number");

export const otpSchema = z
  .string({ error: "Enter the 6-digit code" })
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");

export const gradeSchema = z.enum(["A", "B", "C"], { error: "Choose a grade" });

export const listingStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "RESERVED",
  "PARTIALLY_ALLOCATED",
  "SOLD",
  "EXPIRED",
  "CANCELLED",
]);

/** Stored lowercase so filters never miss on capitalisation. */
export const cropSchema = z
  .string({ error: "Choose a crop" })
  .trim()
  .toLowerCase()
  .min(2, "Choose a crop")
  .max(40, "Crop name is too long");

/**
 * Quantity is in QUINTALS, always — CLAUDE.md forbids mixing units anywhere in
 * the codebase, so there is no unit field to get wrong. Two decimals, matching
 * the Decimal(10,2) column.
 */
export const quantityQuintalsSchema = z
  .coerce.number({ error: "Enter how many quintals you have" })
  .positive("Enter how many quintals you have")
  .max(10000, "Enter 10,000 quintals or less")
  .multipleOf(0.01, "Use at most 2 decimal places");

/** Whole rupees per quintal. Money is never a float — CLAUDE.md. */
export const pricePerQuintalSchema = z
  .coerce.number({ error: "Enter your expected price" })
  .int("Enter a whole number of rupees")
  .min(100, "That price looks too low — enter rupees per quintal")
  .max(100000, "That price looks too high");

/** Calendar date with no time component. */
export const isoDateSchema = z
  .string({ error: "Choose a date" })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Choose a valid date");

// Re-exported so server code has one import site; client components should
// import from "@fasalx/validation/date" to stay clear of Zod.
export { addDaysIso, istTodayIso } from "./date";

/**
 * Harvest availability: from yesterday to a year out. Yesterday rather than
 * today so a few hours of clock skew never blocks a legitimate "available now".
 */
export const availableFromSchema = isoDateSchema
  .refine((v) => v >= addDaysIso(istTodayIso(), -1), "That date has already passed")
  .refine((v) => v <= addDaysIso(istTodayIso(), 365), "Choose a date within the next year");

// ---------------------------------------------------------------- auth

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: otpSchema,
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

// ---------------------------------------------------------------- listings

/**
 * The editable shape of a listing, with no defaults attached.
 *
 * Defaults live only on the create schema. Deriving the update schema from one
 * that carried `.default("wheat")` made `.partial()` still emit a value, so an
 * empty PATCH body parsed to `{ crop: "wheat" }` — it passed the
 * "nothing to update" check and would have silently rewritten the crop.
 */
const listingFields = {
  crop: cropSchema,
  grade: gradeSchema,
  quantityQuintals: quantityQuintalsSchema,
  expectedPricePerQuintal: pricePerQuintalSchema,
  availableFrom: availableFromSchema,
  /** Omitted by the app — the pickup point defaults to the farmer's profile. */
  village: z.string().trim().min(1).max(80).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  notes: z.string().trim().max(500).optional(),
};

export const createListingSchema = z.object({
  ...listingFields,
  crop: cropSchema.default("wheat"),
});

/** Every field optional, but at least one must actually be supplied. */
export const updateListingSchema = z
  .object(listingFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const requirementStatusSchema = z.enum([
  "OPEN",
  "MATCHING",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "CANCELLED",
  "EXPIRED",
]);

/** Delivery deadlines must be ahead of us, and within a planning horizon. */
export const deliveryBySchema = isoDateSchema
  .refine((v) => v >= istTodayIso(), "Choose a delivery date in the future")
  .refine((v) => v <= addDaysIso(istTodayIso(), 365), "Choose a date within the next year");

export const createRequirementSchema = z.object({
  crop: cropSchema.default("wheat"),
  grade: gradeSchema,
  quantityQuintals: quantityQuintalsSchema,
  targetPricePerQuintal: pricePerQuintalSchema,
  maxDistanceKm: z.coerce
    .number({ error: "Enter how far you will collect from" })
    .int("Enter a whole number of kilometres")
    .min(1, "Enter at least 1 km")
    .max(1000, "Enter 1,000 km or less"),
  /**
   * Optional. Keeps a bulk requirement from being filled with a long tail of
   * tiny lots the buyer would have to send a separate truck for.
   */
  minLotQuintals: quantityQuintalsSchema.optional(),
  deliveryBy: deliveryBySchema,
  notes: z.string().trim().max(500).optional(),
});

export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;

export const listingFilterSchema = z.object({
  crop: cropSchema.optional(),
  grade: gradeSchema.optional(),
  district: z.string().trim().min(1).max(60).optional(),
  status: listingStatusSchema.optional(),
  /** Hide lots below a bulk buyer's minimum. Quintals. */
  minQuantityQuintals: quantityQuintalsSchema.optional(),
  /** Only listings within this radius of the caller's location. */
  maxDistanceKm: z.coerce
    .number()
    .int()
    .min(1, "maxDistanceKm must be at least 1")
    .max(1000, "maxDistanceKm cannot be more than 1000")
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit cannot be more than 100")
    .default(50),
  offset: z.coerce.number().int().min(0, "offset cannot be negative").default(0),
});

// ---------------------------------------------------------------- offers

export const offerStatusSchema = z.enum([
  "PENDING",
  "COUNTERED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
]);

/**
 * The build plan calls this field `pricePerUnit`. It is `pricePerQuintal`
 * here: CLAUDE.md forbids mixing units anywhere in the codebase, and a field
 * named "per unit" invites exactly the kg/quintal confusion that ban exists to
 * prevent.
 */
export const createOfferSchema = z.object({
  listingId: z.string({ error: "Choose a listing" }).min(1, "Choose a listing"),
  requirementId: z.string().min(1).optional(),
  pricePerQuintal: pricePerQuintalSchema,
  quantityQuintals: quantityQuintalsSchema,
});

/** A counter restates price, and may restate quantity. */
export const counterOfferSchema = z.object({
  pricePerQuintal: pricePerQuintalSchema,
  quantityQuintals: quantityQuintalsSchema.optional(),
});

export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type CounterOfferInput = z.infer<typeof counterOfferSchema>;

// ---------------------------------------------------------------- matching

export const matchingRunSchema = z.object({
  requirementId: z.string({ error: "Choose a requirement" }).min(1, "Choose a requirement"),
});

export const aggregateOrderSchema = z.object({
  requirementId: z.string({ error: "Choose a requirement" }).min(1, "Choose a requirement"),
  /**
   * One price paid to every selected farmer. Defaults to the quantity-weighted
   * average of their asks, which is what the aggregation proposes; the buyer
   * may settle higher to secure the whole set.
   */
  settledPricePerQuintal: pricePerQuintalSchema.optional(),
});

export type MatchingRunInput = z.infer<typeof matchingRunSchema>;
export type AggregateOrderInput = z.infer<typeof aggregateOrderSchema>;

// ---------------------------------------------------------------- quality

export const qualityCheckSchema = z.object({
  orderId: z.string({ error: "Choose an order" }).min(1, "Choose an order"),
  gradeFound: gradeSchema,
  /** Wheat is traded around 12% moisture; anything outside 0-30 is a typo. */
  moisturePct: z.coerce
    .number({ error: "Enter the moisture reading" })
    .min(0, "Moisture cannot be negative")
    .max(30, "That moisture reading looks wrong")
    .optional(),
  notes: z.string().trim().max(500, "Keep notes under 500 characters").optional(),
});

export const qualityRejectSchema = z.object({
  reason: z
    .string({ error: "Say what is wrong with the delivery" })
    .trim()
    .min(3, "Say what is wrong with the delivery")
    .max(200, "Keep the reason under 200 characters"),
});

export type QualityCheckInput = z.infer<typeof qualityCheckSchema>;
export type QualityRejectInput = z.infer<typeof qualityRejectSchema>;

export const priceQuerySchema = z.object({
  crop: cropSchema.default("wheat"),
  district: z.string().trim().min(1).max(60).default("Karnal"),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type ListingFilterInput = z.infer<typeof listingFilterSchema>;
export type PriceQueryInput = z.infer<typeof priceQuerySchema>;

// ---------------------------------------------------------------- helpers

/** First error message for a field, for rendering next to an input. */
export function firstFieldError(error: z.ZodError, field: string): string | undefined {
  return error.issues.find((i) => i.path[0] === field)?.message;
}

/** The only farmer field an operator may change. */
export const kycStatusSchema = z.object({
  status: z.enum(["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"], {
    error: "Pick a KYC status",
  }),
});

/** One question to the assistant, in one of the two supported languages. */
export const chatAskSchema = z.object({
  question: z
    .string({ error: "Type a question" })
    .trim()
    .min(1, "Type a question")
    .max(500, "Keep the question under 500 characters"),
  language: z.enum(["en", "hi"], { error: "Pick a language" }).default("en"),
});

export type ChatAskInput = z.infer<typeof chatAskSchema>;

/** The Razorpay checkout callback, as the browser hands it back. */
export const confirmPaymentSchema = z.object({
  razorpayOrderId: z.string({ error: "Missing payment order" }).min(1, "Missing payment order"),
  razorpayPaymentId: z.string({ error: "Missing payment id" }).min(1, "Missing payment id"),
  signature: z.string({ error: "Missing signature" }).min(1, "Missing signature"),
});

export const failPaymentSchema = z.object({
  razorpayOrderId: z.string({ error: "Missing payment order" }).min(1, "Missing payment order"),
  reason: z.string().trim().max(200).default("Checkout was not completed"),
});

/** One message between the two parties to an order. */
export const sendMessageSchema = z.object({
  orderId: z.string({ error: "Choose an order" }).min(1, "Choose an order"),
  /** Which farmer's thread. Optional for a farmer — it can only be their own. */
  farmerId: z.string().min(1).optional(),
  body: z
    .string({ error: "Type a message" })
    .trim()
    .min(1, "Type a message")
    .max(1000, "Keep messages under 1,000 characters"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
