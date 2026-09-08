import type { AuthUser, Requirement } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
} from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import {
  daysUntil,
  GRADE_LABEL,
  radiusKm,
  quintals,
  REQUIREMENT_STATUS,
  rupees,
  rupeesCompact,
  shortDate,
} from "@/lib/format";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";

export const metadata = { title: "Requirements · FasalX Buyer" };

/** Statuses that still need supply. */
const ACTIVE_STATUSES = new Set(["OPEN", "MATCHING", "PARTIALLY_FULFILLED"]);

export default async function DashboardPage() {
  if (!(await getSessionToken())) redirect("/login");

  let user: AuthUser;
  let requirements: Requirement[];
  try {
    [user, requirements] = await Promise.all([
      apiCall<AuthUser>("/auth/me"),
      apiCall<Requirement[]>("/requirements/mine"),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load your requirements"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
        backHref="/dashboard"
        backLabel="Retry"
      />
    );
  }

  const active = requirements.filter((r) => ACTIVE_STATUSES.has(r.status));
  const totalProcurement = active.reduce((sum, r) => sum + r.estimatedValueRupees, 0);
  const totalNeeded = active.reduce((sum, r) => sum + r.quantityQuintals, 0);
  const totalAllocated = active.reduce((sum, r) => sum + r.allocatedQuintals, 0);

  return (
    <AppShell user={user}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Procurement requirements</h1>
          <p className="text-sm text-muted-foreground">
            Post what you need and FasalX aggregates supply direct from farmers.
          </p>
        </div>
        <Button asChild>
          <Link href="/requirements/new">New requirement</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Active requirements" value={String(active.length)} />
        <Stat
          label="Volume required"
          value={quintals(totalNeeded)}
          hint={`${quintals(totalAllocated)} committed`}
        />
        <Stat
          label="Procurement value"
          value={rupeesCompact(totalProcurement)}
          hint="At target prices"
        />
      </div>

      {requirements.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No requirements yet</CardTitle>
            <CardDescription>
              Post a requirement and FasalX will find farmers who can fill it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/requirements/new">Create your first requirement</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {requirements.map((requirement) => (
            <li key={requirement.id}>
              <RequirementCard requirement={requirement} />
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-0.5">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function RequirementCard({ requirement }: { requirement: Requirement }) {
  const status = REQUIREMENT_STATUS[requirement.status];
  const days = daysUntil(requirement.deliveryBy);

  return (
    <Link href={`/requirements/${requirement.id}`} className="block">
      <Card className="transition-colors hover:border-primary/40">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold capitalize">
                  {quintals(requirement.quantityQuintals)} {requirement.crop}
                </h2>
                <Badge variant="outline">{GRADE_LABEL[requirement.grade]}</Badge>
                <Badge variant={status.variant}>{status.text}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Target {rupees(requirement.targetPricePerQuintal)}/Q · within{" "}
                {radiusKm(requirement.maxDistanceKm)}
                {requirement.minLotQuintals
                  ? ` · min lot ${quintals(requirement.minLotQuintals)}`
                  : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">{rupeesCompact(requirement.estimatedValueRupees)}</p>
              <p className="text-xs text-muted-foreground">
                Deliver by {shortDate(requirement.deliveryBy)}
                {days >= 0 ? ` · ${days} ${days === 1 ? "day" : "days"} left` : " · overdue"}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {quintals(requirement.allocatedQuintals)} of{" "}
                {quintals(requirement.quantityQuintals)} committed
              </span>
              <span className="font-semibold">{requirement.fulfilmentPercent}%</span>
            </div>
            <Progress value={requirement.fulfilmentPercent} />
            {requirement.remainingQuintals > 0 ? (
              <p className="text-xs text-muted-foreground">
                {quintals(requirement.remainingQuintals)} still to source
              </p>
            ) : (
              <p className="text-xs font-medium text-success">Fully sourced</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
