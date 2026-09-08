/**
 * Shared FasalX Zod schemas.
 *
 * CLAUDE.md: these are shared by the API and the clients so a rule is stated
 * once. The API validates with them; the apps reuse the same messages so a
 * farmer sees the same wording the server would have produced.
 */

import { z } from "zod";

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

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: otpSchema,
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

/** First error message for a field, for rendering next to an input. */
export function firstFieldError(error: z.ZodError, field: string): string | undefined {
  return error.issues.find((i) => i.path[0] === field)?.message;
}
