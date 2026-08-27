import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "thismade",
  description: "Internal platform foundation for thismade.",
};

// ClerkProvider wraps every route and requires a real publishableKey to
// prerender, which this build environment doesn't have yet (no Clerk
// account/keys provisioned — see DECISIONS.md "Clerk keyless dev mode").
// Whole-app dynamic rendering until real keys exist; revisit per-route once
// they do.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider afterSignOutUrl="/" signInUrl="/sign-in" signUpUrl="/sign-up">
      <html lang="en" className={fontVariables} suppressHydrationWarning>
        <body>
          <ThemeProvider>{children}</ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
