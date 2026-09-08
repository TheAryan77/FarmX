"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@fasalx/ui";

import { requestOtpAction, verifyOtpAction } from "@/app/actions";

/**
 * Two-step mock-OTP sign in.
 *
 * Sized for a farmer on a cheap Android phone in daylight: 56-64px controls,
 * 18-20px text, numeric keypads, and one decision per screen.
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

  function restart() {
    setStep("phone");
    setOtp("");
    setError(null);
    setDevOtp(null);
  }

  return (
    <div className="space-y-6">
      {step === "phone" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitPhone();
          }}
        >
          <Label htmlFor="phone" className="text-lg font-semibold">
            Mobile number
          </Label>
          <div className="flex items-stretch gap-2">
            <span className="flex items-center rounded-md border bg-muted px-4 text-lg font-medium text-muted-foreground">
              +91
            </span>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              autoFocus
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(digitsOnly(e.target.value, 10))}
              aria-invalid={error !== null}
              className="h-16 flex-1 text-2xl tracking-wider md:text-2xl"
            />
          </div>

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <Button
            type="submit"
            size="touch"
            className="w-full text-lg"
            disabled={pending || phone.length !== 10}
          >
            {pending ? "Sending code…" : "Get code"}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitOtp();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="otp" className="text-lg font-semibold">
              Enter the 6-digit code
            </Label>
            <p className="text-base text-muted-foreground">Sent to +91 {phone}</p>
          </div>

          <Input
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="––––––"
            value={otp}
            onChange={(e) => setOtp(digitsOnly(e.target.value, 6))}
            aria-invalid={error !== null}
            className="h-16 text-center text-3xl tracking-[0.5em] md:text-3xl"
          />

          {devOtp ? (
            <div className="rounded-md border border-dashed bg-muted/60 px-4 py-3 text-base">
              <span className="font-semibold">Demo mode</span> — your code is{" "}
              <span className="font-mono text-lg font-bold tracking-widest">{devOtp}</span>.
              <span className="block text-muted-foreground">
                No SMS is sent; any 6-digit code will work.
              </span>
            </div>
          ) : null}

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <Button
            type="submit"
            size="touch"
            className="w-full text-lg"
            disabled={pending || otp.length !== 6}
          >
            {pending ? "Signing in…" : "Sign in"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="touch"
            className="w-full text-base"
            onClick={restart}
            disabled={pending}
          >
            Change number
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
      className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-base font-medium text-destructive"
    >
      {children}
    </p>
  );
}
