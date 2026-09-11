import type { AdminListingRow } from "@fasalx/types";
import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fasalx/ui";

import { apiCall } from "@/lib/api";
import { loadPage } from "@/lib/guard";
import { AppShell } from "@/app/components/app-shell";
import { ErrorPanel } from "@/app/components/error-panel";
import { LISTING_STATUS, quintals, rupees, shortDate } from "@/lib/format";

export const metadata = { title: "Listings · FasalX Admin" };

export default async function ListingsPage() {
  const result = await loadPage(() => apiCall<AdminListingRow[]>("/admin/listings"));
  if ("error" in result) return <ErrorPanel title="Cannot load listings" message={result.error} />;

  const { user, data: listings } = result;

  const active = listings.filter((listing) => listing.status === "ACTIVE");
  const availableQuintals =
    Math.round(
      active.reduce(
        (sum, listing) => sum + (listing.quantityQuintals - listing.reservedQuintals),
        0,
      ) * 100,
    ) / 100;

  return (
    <AppShell user={user}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Listings</h1>
        <p className="text-sm text-muted-foreground">
          {listings.length} total · {active.length} active · {quintals(availableQuintals)}{" "}
          uncommitted
        </p>
      </div>

      <Card>
        <CardContent>
          {listings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No produce listed yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Farmer</TableHead>
                    <TableHead>Village</TableHead>
                    <TableHead>Crop</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Committed</TableHead>
                    <TableHead className="text-right">Asking</TableHead>
                    <TableHead>Available from</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listings.map((listing) => {
                    const label = LISTING_STATUS[listing.status] ?? {
                      text: listing.status,
                      variant: "muted" as const,
                    };
                    return (
                      <TableRow key={listing.id}>
                        <TableCell className="font-medium">{listing.farmerName}</TableCell>
                        <TableCell className="text-muted-foreground">{listing.village}</TableCell>
                        <TableCell className="capitalize">{listing.crop}</TableCell>
                        <TableCell>{listing.grade}</TableCell>
                        <TableCell className="text-right">
                          {quintals(listing.quantityQuintals)}
                        </TableCell>
                        <TableCell className="text-right">
                          {listing.reservedQuintals === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            quintals(listing.reservedQuintals)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {rupees(listing.expectedPricePerQuintal)}/Q
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {shortDate(listing.availableFrom)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={label.variant}>{label.text}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
