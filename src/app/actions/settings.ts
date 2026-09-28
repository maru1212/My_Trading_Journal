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
  db.prepare("UPDATE users SET name = ?, currency = ?, starting_balance = ? WHERE id = ?").run(
    name, currency, starting_balance, user.id,
  );
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved" };
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as {
    password_hash: string;
  };
  if (!(await verifyPassword(parsed.data.current, row.password_hash))) {
    return { errors: { current: ["Current password is incorrect"] } };
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    await hashPassword(parsed.data.next), user.id,
  );
  return { ok: true, message: "Password updated" };
}
