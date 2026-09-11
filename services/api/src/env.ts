import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { z } from "zod";

// Env lives in the repo root .env so every workspace reads one file.
//
// fileURLToPath, not URL.pathname: pathname leaves the path percent-encoded,
// so any repo path containing a space or apostrophe — like this one — silently
// resolves to a file that does not exist and every variable reads as undefined.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: path.join(repoRoot, ".env"), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required — see .env.example"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  // Constrained to the `ms` duration format that jsonwebtoken accepts, so the
  // single narrowing cast in lib/jwt.ts is guaranteed correct at runtime.
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+(ms|s|m|h|d|w|y)?$/, 'JWT_EXPIRES_IN must look like "7d", "12h" or "3600"')
    .default("7d"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:3001,http://localhost:3002"),
  AI_SERVICE_URL: z.string().url().default("http://localhost:8000"),

  // ---------------------------------------------------------------- chain
  // Development points at a local Hardhat node; Polygon Amoy is the same
  // shape with different values. All optional, because the marketplace must
  // run before anything is deployed.
  CHAIN_RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  CHAIN_NAME: z.string().default("Hardhat local"),
  CHAIN_EXPLORER_URL: z.string().default(""),
  ESCROW_CONTRACT_ADDRESS: z.string().default(""),

  // Razorpay test mode. Empty in a checkout with no credentials — the payment
  // routes then report themselves unconfigured rather than the API failing to
  // boot.
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  /**
   * Largest single payment to attempt. Razorpay caps order creation at
   * ₹5,00,000, but individual methods cap lower — wallets at ₹10,000 for a
   * non-KYC merchant — so this is tunable per account.
   */
  RAZORPAY_MAX_RUPEES: z.coerce.number().int().positive().default(500_000),
  PLATFORM_PRIVATE_KEY: z.string().default(""),
  BUYER_PRIVATE_KEY: z.string().default(""),
  SETTLEMENT_ADDRESS: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  console.error(`[api] invalid environment:\n${issues.join("\n")}`);
  process.exit(1);
}

const data = parsed.data;

export const env = {
  ...data,
  corsOrigins: data.CORS_ORIGINS.split(",").map((origin) => origin.trim()),
  /**
   * Mock OTP: outside production any 6-digit code signs you in, as specified
   * for the demo. In production the stored code must match exactly.
   */
  OTP_ACCEPT_ANY: data.NODE_ENV !== "production",
} as const;
