import { SignUp } from "@clerk/nextjs";

import { clerkAppearance } from "@/lib/clerk-appearance";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6 py-16">
      <SignUp appearance={clerkAppearance} routing="path" path="/sign-up" signInUrl="/sign-in" />
    </main>
  );
}
