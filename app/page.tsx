import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="flex items-center justify-between border-b border-border px-6 py-4 sm:px-10">
        <span className="font-mono text-sm tracking-tight text-ink-muted">thismade</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/sign-up">
              Sign up <ArrowRight />
            </Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center gap-6 px-6 py-24 sm:px-10">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs font-mono text-ink-muted">
          <ShieldCheck className="size-3.5 text-confirmation-approved" />
          Platform foundation — Phase 1
        </span>
        <h1 className="font-serif text-5xl leading-tight tracking-tight sm:text-6xl">
          An AI co-founder that runs your business, with you in the loop.
        </h1>
        <p className="max-w-xl text-lg text-ink-muted">
          thismade is the internal platform for founders to hand day-to-day operations to an
          autonomous agent — every consequential action stays visible and confirmable.
        </p>
        <div className="flex items-center gap-3 pt-2">
          <Button size="lg" asChild>
            <Link href="/sign-up">
              Get started <ArrowRight />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
