"use server";

import { revalidatePath } from "next/cache";
import { currentSessionTokenHash, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { changePasswordAndRevokeOtherSessions } from "@/lib/sessions";
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
  const keepTokenHash = await currentSessionTokenHash();
  if (!keepTokenHash) return { message: "Your session has expired. Sign in again." };
  const result = await changePasswordAndRevokeOtherSessions(db(), {
    userId: user.id,
    keepTokenHash,
    currentPassword: parsed.data.current,
    newPassword: parsed.data.next,
  });
  if (result === "wrong-password") return { errors: { current: ["Current password is incorrect"] } };
  if (result === "not-found") return { message: "Account not found." };
  return { ok: true, message: "Password updated. Other devices have been signed out." };
}

