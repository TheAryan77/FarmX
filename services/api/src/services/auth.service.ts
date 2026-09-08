import type { AuthUser, RequestOtpResult, Role, VerifyOtpResult } from "@fasalx/types";
import { Role as PrismaRole } from "@prisma/client";

import { env } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { signToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

/**
 * Compile-time guard against enum drift: the wire `Role` in @fasalx/types and
 * the Prisma `Role` enum must stay identical. If someone adds a role to the
 * schema without adding it to the shared types, this stops typechecking.
 */
const _roleParity: Record<PrismaRole, Role> = {
  FARMER: "FARMER",
  BUYER: "BUYER",
  FPO: "FPO",
  ADMIN: "ADMIN",
};
void _roleParity;

const OTP_TTL_SECONDS = 300;

interface PendingOtp {
  code: string;
  expiresAt: number;
  attempts: number;
}

/**
 * In-memory OTP store. Mock auth has no SMS provider and no Redis in this
 * stack, so codes live in the process and vanish on restart. Fine for the
 * demo; a real deployment needs a shared store with rate limiting.
 */
const pending = new Map<string, PendingOtp>();

function sixDigits(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Loaded lazily so the message always lists the currently seeded accounts. */
async function knownPhonesHint(): Promise<string> {
  const users = await prisma.user.findMany({
    where: { role: { in: [PrismaRole.FARMER, PrismaRole.BUYER] } },
    select: { phone: true, name: true, role: true },
    orderBy: { role: "asc" },
    take: 4,
  });
  if (users.length === 0) return "No accounts are seeded — run `pnpm db:seed`.";
  return `Try ${users.map((u) => `${u.phone} (${u.name})`).join(" or ")}.`;
}

export async function requestOtp(phone: string): Promise<RequestOtpResult> {
  // Registration is not part of this slice, so an unknown number is rejected
  // with a message that names the accounts that do exist.
  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true, name: true } });
  if (!user) {
    throw HttpError.notFound(
      "USER_NOT_FOUND",
      `No FasalX account for ${phone}. ${await knownPhonesHint()}`,
    );
  }

  const code = sixDigits();
  pending.set(phone, {
    code,
    expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
    attempts: 0,
  });

  console.log(
    `[auth] OTP for ${phone} (${user.name}): ${code}` +
      (env.OTP_ACCEPT_ANY ? "  — dev mode: any 6-digit code will be accepted" : ""),
  );

  return {
    phone,
    expiresInSeconds: OTP_TTL_SECONDS,
    // Surfaced in the response only outside production, so demo-day logins
    // don't require reading the server terminal.
    ...(env.NODE_ENV === "production" ? {} : { devOtp: code }),
  };
}

export async function verifyOtp(phone: string, otp: string): Promise<VerifyOtpResult> {
  const record = pending.get(phone);

  if (!env.OTP_ACCEPT_ANY) {
    if (!record) {
      throw HttpError.badRequest("OTP_NOT_REQUESTED", "Request a new code and try again");
    }
    if (Date.now() > record.expiresAt) {
      pending.delete(phone);
      throw HttpError.badRequest("OTP_EXPIRED", "That code expired — request a new one");
    }
    record.attempts += 1;
    if (record.attempts > 5) {
      pending.delete(phone);
      throw HttpError.badRequest("OTP_TOO_MANY_ATTEMPTS", "Too many attempts — request a new code");
    }
    if (record.code !== otp) {
      throw HttpError.badRequest("OTP_INVALID", "That code is not right");
    }
  }

  pending.delete(phone);

  const user = await findAuthUser({ phone });
  if (!user) {
    throw HttpError.notFound("USER_NOT_FOUND", `No FasalX account for ${phone}`);
  }

  return { token: signToken(user.id, user.role), user };
}

/** Shapes a Prisma user (plus whichever profile matches its role) into AuthUser. */
async function findAuthUser(where: { id: string } | { phone: string }): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where,
    include: {
      farmer: { select: { id: true, district: true } },
      buyer: { select: { id: true, district: true } },
      fpo: { select: { id: true, district: true } },
    },
  });

  if (!user) return null;

  const profile = user.farmer ?? user.buyer ?? user.fpo ?? null;

  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    language: user.language,
    profileId: profile?.id ?? null,
    district: profile?.district ?? null,
  };
}

export async function getCurrentUser(userId: string): Promise<AuthUser> {
  const user = await findAuthUser({ id: userId });
  if (!user) {
    // Token is valid but the row is gone — e.g. signed in across a db:reset.
    throw HttpError.unauthorized("Your account is no longer available — sign in again");
  }
  return user;
}
