import type { AuthUser, RequirementCandidates } from "@fasalx/types";
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
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import {
  daysUntil,
  GRADE_LABEL,
  km,
  radiusKm,
  quintals,
  REQUIREMENT_STATUS,
  rupees,
  rupeesCompact,
  shortDate,
} from "@/lib/format";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";

export const metadata = { title: "Requirement · FasalX Buyer" };

export default async function RequirementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await getSessionToken())) redirect("/login");

  const { id } = await params;

  let user: AuthUser;
  let result: RequirementCandidates;
  try {
    [user, result] = await Promise.all([
      apiCall<AuthUser>("/auth/me"),
      apiCall<RequirementCandidates>(`/requirements/${id}/candidates`),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load this requirement"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  const { requirement, candidates, totalAvailableQuintals, satisfiable, excluded } = result;
  const status = REQUIREMENT_STATUS[requirement.status];
  const days = daysUntil(requirement.deliveryBy);
  const totalExcluded = excluded.wrongGrade + excluded.tooFar + excluded.belowMinLot;

  return (
    <AppShell user={user}>
      <div className="space-y-1">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-primary">
          ← All requirements
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight capitalize">
            {quintals(requirement.quantityQuintals)} {requirement.crop}
          </h1>
          <Badge variant="outline">{GRADE_LABEL[requirement.grade]}</Badge>
          <Badge variant={status.variant}>{status.text}</Badge>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Target price" value={`${rupees(requirement.targetPricePerQuintal)}/Q`} />
        <Stat
          label="Procurement value"
          value={rupeesCompact(requirement.estimatedValueRupees)}
          hint="At target price"
        />
        <Stat
          label="Collection radius"
          value={radiusKm(requirement.maxDistanceKm)}
          hint={`From ${requirement.buyer.district}`}
        />
        <Stat
          label="Delivery deadline"
          value={shortDate(requirement.deliveryBy)}
          hint={days >= 0 ? `${days} ${days === 1 ? "day" : "days"} left` : "Overdue"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fulfilment</CardTitle>
          <CardDescription>
            {quintals(requirement.allocatedQuintals)} of{" "}
            {quintals(requirement.quantityQuintals)} committed ·{" "}
            {quintals(requirement.remainingQuintals)} still to source
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="text-lg font-bold">{requirement.fulfilmentPercent}%</span>
          </div>
          <Progress value={requirement.fulfilmentPercent} className="h-3" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Matching supply</CardTitle>
          <CardDescription>
            {candidates.length} {candidates.length === 1 ? "farmer" : "farmers"} within{" "}
            {radiusKm(requirement.maxDistanceKm)} offering {GRADE_LABEL[requirement.grade]}
            {requirement.minLotQuintals
              ? ` in lots of ${quintals(requirement.minLotQuintals)} or more`
              : ""}
            . Nearest first — ranking by price, distance and reliability comes next.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={satisfiable ? "success" : "warning"} size="lg">
              {satisfiable
                ? `Fillable — ${quintals(totalAvailableQuintals)} available`
                : `Short — only ${quintals(totalAvailableQuintals)} available`}
            </Badge>
            {totalExcluded > 0 ? (
              <span className="text-xs text-muted-foreground">
                {totalExcluded} other {totalExcluded === 1 ? "listing" : "listings"} excluded:{" "}
                {excluded.wrongGrade > 0 ? `${excluded.wrongGrade} wrong grade` : null}
                {excluded.wrongGrade > 0 && (excluded.tooFar > 0 || excluded.belowMinLot > 0)
                  ? ", "
                  : null}
                {excluded.tooFar > 0 ? `${excluded.tooFar} too far` : null}
                {excluded.tooFar > 0 && excluded.belowMinLot > 0 ? ", " : null}
                {excluded.belowMinLot > 0 ? `${excluded.belowMinLot} below minimum lot` : null}
              </span>
            ) : null}
          </div>

          {candidates.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No farmer supply currently fits these constraints. Try widening the collection
              radius, lowering the minimum lot size, or accepting a different grade.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Farmer</TableHead>
                  <TableHead>Village</TableHead>
                  <TableHead className="text-right">Distance</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Asking price</TableHead>
                  <TableHead className="text-right">Lot value</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                  <TableHead>Ready from</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((listing) => {
                  const overTarget =
                    listing.expectedPricePerQuintal > requirement.targetPricePerQuintal;
                  return (
                    <TableRow key={listing.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/listings/${listing.id}?requirementId=${requirement.id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {listing.farmer.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{listing.village}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {km(listing.distanceKm)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {quintals(listing.availableQuintals)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{listing.grade}</Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          overTarget ? "font-semibold text-destructive" : "text-success"
                        }`}
                      >
                        {rupees(listing.expectedPricePerQuintal)}
                        {overTarget ? " ↑" : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rupeesCompact(listing.totalValueRupees)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {listing.farmer.rating.toFixed(1)}
                        <span className="text-muted-foreground">
                          {" "}
                          ({listing.farmer.completedOrders})
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {shortDate(listing.availableFrom)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/listings/${listing.id}?requirementId=${requirement.id}`}>
                            Offer
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-medium">
                    Total available
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {quintals(totalAvailableQuintals)}
                  </TableCell>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Needs {quintals(requirement.remainingQuintals)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}

          <p className="text-xs text-muted-foreground">
            Prices above your target are shown in red. Distances are straight-line from{" "}
            {requirement.buyer.district}.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-0.5">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className="text-xl font-bold tracking-tight">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
