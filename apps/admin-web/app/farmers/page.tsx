import type { AdminFarmerRow } from "@fasalx/types";
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
import { KYC_STATUS, quintals, rupees } from "@/lib/format";
import { KycActions } from "./kyc-actions";

export const metadata = { title: "Farmers · FasalX Admin" };

export default async function FarmersPage() {
  const result = await loadPage(() => apiCall<AdminFarmerRow[]>("/admin/farmers"));
  if ("error" in result) return <ErrorPanel title="Cannot load farmers" message={result.error} />;

  const { user, data: farmers } = result;
  const paid = farmers.filter((farmer) => farmer.earnedRupees > 0).length;

  return (
    <AppShell user={user}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Farmers</h1>
        <p className="text-sm text-muted-foreground">
          {farmers.length} registered · {paid} paid so far · ranked by earnings
        </p>
      </div>

      <Card>
        <CardContent>
          {farmers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No farmers registered yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Farmer</TableHead>
                    <TableHead>Village</TableHead>
                    <TableHead className="text-right">Rating</TableHead>
                    <TableHead className="text-right">Listed</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Gain vs mandi</TableHead>
                    <TableHead>KYC</TableHead>
                    <TableHead className="text-right">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {farmers.map((farmer) => {
                    const kyc = KYC_STATUS[farmer.kycStatus] ?? {
                      text: farmer.kycStatus,
                      variant: "muted" as const,
                    };
                    return (
                      <TableRow key={farmer.id}>
                        <TableCell>
                          <span className="font-medium">{farmer.name}</span>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {farmer.phone}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{farmer.village}</TableCell>
                        <TableCell className="text-right">
                          {farmer.rating.toFixed(1)}
                          <span className="text-muted-foreground"> ({farmer.completedOrders})</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {farmer.activeListings === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            quintals(farmer.listedQuintals)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {farmer.soldQuintals === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            quintals(farmer.soldQuintals)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {farmer.earnedRupees === 0 ? (
                            <span className="font-normal text-muted-foreground">—</span>
                          ) : (
                            rupees(farmer.earnedRupees)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {farmer.gainRupees === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="font-medium text-primary">
                              +{rupees(farmer.gainRupees)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={kyc.variant}>{kyc.text}</Badge>
                        </TableCell>
                        <TableCell>
                          <KycActions farmerId={farmer.id} status={farmer.kycStatus} />
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
