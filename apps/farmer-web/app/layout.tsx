import type { AuthUser } from "@fasalx/types";
import type { Metadata, Viewport } from "next";

import { apiCall } from "@/lib/api";
import { APP_ROLE, getSessionToken } from "@/lib/session";
import { Assistant } from "./components/assistant";
import "./globals.css";

export const metadata: Metadata = {
  title: "FasalX Farmer",
  description: "Farmer app — mobile-first PWA",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * The presence of a cookie is not a session — see the login page for the
 * redirect loop that lesson came from.
 *
 * Gating the assistant on the cookie alone floated it over the sign-in screen
 * for anyone holding a token the API no longer accepts, where every question
 * it asked came back "Sign in to continue". So it is verified here, exactly as
 * the login page verifies, and a failure simply means no bubble.
 */
async function signedInFarmer(): Promise<boolean> {
  if (!(await getSessionToken())) return false;
  try {
    const user = await apiCall<AuthUser>("/auth/me");
    return user.role === APP_ROLE;
  } catch {
    return false;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const signedIn = await signedInFarmer();

  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
        {/*
          Hindi by default: every seeded farmer carries `language: "hi"` and
          Karnal is a Hindi-speaking district. The toggle is one tap away and
          can be changed mid-conversation.
        */}
        {signedIn ? <Assistant defaultLanguage="hi" /> : null}
      </body>
    </html>
  );
}
