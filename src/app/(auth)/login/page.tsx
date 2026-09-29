import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";
import { signupMode } from "@/lib/signup-policy";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} showSignupLink={signupMode() === "open"} />;
}
