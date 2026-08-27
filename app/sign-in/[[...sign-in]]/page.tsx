import { SignIn } from "@clerk/nextjs";

import { clerkAppearance } from "@/lib/clerk-appearance";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6 py-16">
      <SignIn appearance={clerkAppearance} routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </main>
  );
}
