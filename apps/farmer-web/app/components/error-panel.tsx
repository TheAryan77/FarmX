import Link from "next/link";
import { Button, Card, CardContent } from "@fasalx/ui";

/**
 * Every fetch failure in the farmer app lands here rather than on a stack
 * trace or a blank screen — CLAUDE.md's demo-hardening requirement, applied as
 * we go rather than retrofitted in session 12.
 */
export function ErrorPanel({
  title,
  message,
  backHref = "/dashboard",
  backLabel = "Back to home",
}: {
  title: string;
  message: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-5">
      <Card className="border-destructive/30">
        <CardContent className="space-y-2">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-lg text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
      <Button asChild size="touch" variant="outline" className="w-full text-base">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </main>
  );
}
