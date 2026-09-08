import type { AuthUser, ListingPage } from "@fasalx/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@fasalx/ui";

import { apiCall, ApiRequestError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { GRADE_LABEL, km, quintals, rupees, rupeesCompact, shortDate } from "@/lib/format";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";

export const metadata = { title: "Supply · FasalX Buyer" };

const GRADES = ["A", "B", "C"] as const;

/**
 * Browse every listing on the platform, not just what matches a requirement.
 *
 * A requirement's candidate table is filtered by that requirement's own
 * constraints, so supply it rejects — a lot below the minimum size, say — is
 * invisible there. A buyer still needs to be able to find and deal with it.
 */
export default async function SupplyPage({
  searchParams,
}: {
  searchParams: Promise<{ grade?: string; maxDistanceKm?: string }>;
}) {
  if (!(await getSessionToken())) redirect("/login");

  const { grade, maxDistanceKm } = await searchParams;
  const query = new URLSearchParams({ crop: "wheat", limit: "100" });
  if (grade) query.set("grade", grade);
  if (maxDistanceKm) query.set("maxDistanceKm", maxDistanceKm);

  let user: AuthUser;
  let page: ListingPage;
  try {
    [user, page] = await Promise.all([
      apiCall<AuthUser>("/auth/me"),
      apiCall<ListingPage>(`/listings?${query.toString()}`),
    ]);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/login");
    return (
      <ErrorPanel
        title="Cannot load supply"
        message={err instanceof ApiRequestError ? err.message : "Please try again"}
      />
    );
  }

  // Nearest first — the API returns newest first for anonymous callers.
  const listings = [...page.listings].sort(
    (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
  );
  const totalAvailable = listings.reduce((sum, l) => sum + l.availableQuintals, 0);

  const href = (next: { grade?: string; maxDistanceKm?: string }) => {
    const q = new URLSearchParams();
    const g = next.grade ?? grade;
    const d = next.maxDistanceKm ?? maxDistanceKm;
    if (g) q.set("grade", g);
    if (d) q.set("maxDistanceKm", d);
    return `/supply${q.toString() ? `?${q.toString()}` : ""}`;
  };

  return (
    <AppShell user={user}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Available supply</h1>
        <p className="text-sm text-muted-foreground">
          {page.total} listing{page.total === 1 ? "" : "s"} · {quintals(totalAvailable)} available ·
          distances from {user.district ?? "your location"}
        </p>
      </div>

      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-base">Filter</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant={grade ? "ghost" : "secondary"}>
              <Link href={href({ grade: "" })}>All grades</Link>
            </Button>
            {GRADES.map((g) => (
              <Button key={g} asChild size="sm" variant={grade === g ? "secondary" : "ghost"}>
                <Link href={href({ grade: g })}>{GRADE_LABEL[g]}</Link>
              </Button>
            ))}
            <span className="mx-1 text-muted-foreground">·</span>
            <Button asChild size="sm" variant={maxDistanceKm ? "ghost" : "secondary"}>
              <Link href={href({ maxDistanceKm: "" })}>Any distance</Link>
            </Button>
            {["25", "50", "150"].map((d) => (
              <Button key={d} asChild size="sm" variant={maxDistanceKm === d ? "secondary" : "ghost"}>
                <Link href={href({ maxDistanceKm: d })}>Within {d} km</Link>
              </Button>
            ))}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listings.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No listings match these filters.
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
                  <TableHead>Ready from</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      <Link href={`/listings/${l.id}`} className="hover:text-primary hover:underline">
                        {l.farmer.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{l.village}</TableCell>
                    <TableCell className="text-right tabular-nums">{km(l.distanceKm)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {quintals(l.availableQuintals)}
                    </TableCell>
                    <TableCell><Badge variant="outline">{l.grade}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rupees(l.expectedPricePerQuintal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rupeesCompact(l.totalValueRupees)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {shortDate(l.availableFrom)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/listings/${l.id}`}>Offer</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
