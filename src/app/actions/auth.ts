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

  const sql = db();
  const [existing] = await sql`select 1 from users where lower(email) = ${email}`;
  if (existing) {
    return { errors: { email: ["An account with this email already exists"] }, values };
  }
  const [user] = await sql<{ id: number }[]>`
    insert into users (name, email, password_hash)
    values (${name}, ${email}, ${await hashPassword(password)})
    returning id`;
  await createSession(user.id);
  redirect("/dashboard");
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  const values = echo(formData, ["password"]);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, values };
  const { email, password } = parsed.data;

  const [user] = await db()<{ id: number; password_hash: string }[]>`
    select id, password_hash from users where lower(email) = ${email}`;
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
