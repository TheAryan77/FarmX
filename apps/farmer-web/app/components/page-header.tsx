import Link from "next/link";

/** Back link plus title. Kept minimal — the farmer app has no nav chrome. */
export function PageHeader({
  title,
  backHref = "/dashboard",
  subtitle,
}: {
  title: string;
  backHref?: string;
  subtitle?: string;
}) {
  return (
    <header className="space-y-1">
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center text-base font-medium text-muted-foreground"
      >
        ← Back
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {subtitle ? <p className="text-base text-muted-foreground">{subtitle}</p> : null}
    </header>
  );
}
