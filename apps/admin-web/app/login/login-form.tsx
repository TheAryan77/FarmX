"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@fasalx/ui";

import { requestOtpAction, verifyOtpAction } from "@/app/actions";

/**
 * Two-step mock-OTP sign in for the operations console. Identical mechanics to
 * the other two apps — the role gate lives in the server action, not here.
 */
export function LoginForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const digitsOnly = (value: string, max: number) => value.replace(/\D/g, "").slice(0, max);

  function submitPhone() {
    setError(null);
    startTransition(async () => {
      const result = await requestOtpAction(phone);
      if (!result.ok) {
        setError(result.error ?? "Could not send the code");
        return;
      }
      setDevOtp(result.data?.devOtp ?? null);
      setStep("otp");
    });
  }

  function submitOtp() {
    setError(null);
    startTransition(async () => {
      const result = await verifyOtpAction(phone, otp);
      if (!result.ok) {
        setError(result.error ?? "Could not sign you in");
        return;
      }
      router.push("/dashboard");
    });
  }

  return (
    <div className="space-y-4">
      {step === "phone" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitPhone();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="phone">Registered mobile number</Label>
            <div className="flex items-stretch gap-2">
              <span className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                +91
              </span>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                autoFocus
                placeholder="9800000001"
                value={phone}
                onChange={(e) => setPhone(digitsOnly(e.target.value, 10))}
                aria-invalid={error !== null}
                className="flex-1 tracking-wide"
              />
            </div>
          </div>

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <Button type="submit" className="w-full" disabled={pending || phone.length !== 10}>
            {pending ? "Sending code…" : "Continue"}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitOtp();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="otp">Verification code</Label>
            <Input
              id="otp"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="------"
              value={otp}
              onChange={(e) => setOtp(digitsOnly(e.target.value, 6))}
              aria-invalid={error !== null}
              className="text-center tracking-[0.4em]"
            />
            <p className="text-xs text-muted-foreground">Sent to +91 {phone}</p>
          </div>

          {devOtp ? (
            <div className="rounded-md border border-dashed bg-muted/60 px-3 py-2 text-xs">
              <span className="font-semibold">Demo mode</span> — code{" "}
              <span className="font-mono font-bold tracking-widest">{devOtp}</span>. No SMS is
              sent; any 6-digit code is accepted.
            </div>
          ) : null}

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <Button type="submit" className="w-full" disabled={pending || otp.length !== 6}>
            {pending ? "Verifying…" : "Sign in"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setStep("phone");
              setOtp("");
              setError(null);
              setDevOtp(null);
            }}
            disabled={pending}
          >
            Use a different number
          </Button>
        </form>
      )}
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
    >
      {children}
    </p>
  );
}
