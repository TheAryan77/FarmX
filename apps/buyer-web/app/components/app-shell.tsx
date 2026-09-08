import type { AuthUser } from "@fasalx/types";
import Link from "next/link";
import { Badge, Button } from "@fasalx/ui";

import { signOutAction } from "@/app/actions";

/** Top bar shared by every signed-in buyer page. Desktop-first and compact. */
export function AppShell({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-sm font-semibold tracking-[0.2em] text-primary uppercase">
              FasalX
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="font-medium hover:text-primary">
                Requirements
              </Link>
              <Link href="/supply" className="text-muted-foreground hover:text-primary">
                Supply
              </Link>
              <Link href="/offers" className="text-muted-foreground hover:text-primary">
                Negotiations
              </Link>
              <Link href="/orders" className="text-muted-foreground hover:text-primary">
                Orders
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{user.name}</span>
            <Badge variant="secondary">{user.role}</Badge>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">{children}</main>
    </div>
  );
}
