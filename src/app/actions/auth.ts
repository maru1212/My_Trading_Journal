"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { echo, loginSchema, signupSchema, type FormState } from "@/lib/validation";

export async function signup(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  const values = echo(formData, ["password"]);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, values };
  const { name, email, password } = parsed.data;

  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
    return { errors: { email: ["An account with this email already exists"] }, values };
  }
  const result = db
    .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
    .run(name, email, await hashPassword(password));
  await createSession(Number(result.lastInsertRowid));
  redirect("/dashboard");
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  const values = echo(formData, ["password"]);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, values };
  const { email, password } = parsed.data;

  const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email) as
    | { id: number; password_hash: string }
    | undefined;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { message: "Incorrect email or password", values };
  }
  await createSession(user.id);
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
