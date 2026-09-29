import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SignupForm } from "@/components/auth-forms";
import { signupMode } from "@/lib/signup-policy";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  // Read the sign-up settings per request, not once at build time.
  await connection();
  if (signupMode() === "closed") {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">Sign-ups are closed</h1>
        <p className="text-sm text-ink-2">This journal is private. New accounts can&apos;t be created.</p>
        <Link href="/login" className="btn-primary w-full">Sign in</Link>
      </div>
    );
  }
  return <SignupForm />;
}
