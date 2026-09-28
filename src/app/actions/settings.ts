"use server";

import { revalidatePath } from "next/cache";
import { hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { echo, passwordSchema, settingsSchema, type FormState } from "@/lib/validation";

export async function updateSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  const values = echo(formData);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, values };
  const { name, currency, starting_balance } = parsed.data;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency });
  } catch {
    return { errors: { currency: ["Unknown currency code"] }, values };
  }
  await db()`
    update users set name = ${name}, currency = ${currency}, starting_balance = ${starting_balance}
     where id = ${user.id}`;
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved" };
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const sql = db();
  const [row] = await sql<{ password_hash: string }[]>`select password_hash from users where id = ${user.id}`;
  if (!(await verifyPassword(parsed.data.current, row.password_hash))) {
    return { errors: { current: ["Current password is incorrect"] } };
  }
  await sql`update users set password_hash = ${await hashPassword(parsed.data.next)} where id = ${user.id}`;
  return { ok: true, message: "Password updated" };
}

