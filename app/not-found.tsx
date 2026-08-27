import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center text-ink">
      <span className="font-mono text-sm text-ink-muted">404</span>
      <h1 className="font-serif text-3xl">This page doesn&apos;t exist.</h1>
      <Button asChild>
        <Link href="/">Back home</Link>
      </Button>
    </main>
  );
}
