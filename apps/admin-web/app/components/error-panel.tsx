import { Card, CardContent } from "@fasalx/ui";

/** A failure the operator can read, instead of a stack trace or a blank page. */
export function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="space-y-2">
          <h1 className="text-lg font-semibold text-destructive">{title}</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </main>
  );
}
