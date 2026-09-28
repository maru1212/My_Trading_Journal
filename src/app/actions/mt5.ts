"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { BridgeError } from "@/lib/metaapi";
import { connectAccount, connectionStatus, disconnect, syncUser } from "@/lib/mt5-sync";
import type { FormState } from "@/lib/validation";

const connectSchema = z.object({
  login: z.string().trim().regex(/^\d{3,15}$/, "Your MT5 login is the account number, digits only"),
  password: z.string().min(1, "Enter your investor (read-only) password").max(100),
  server: z.string().trim().min(2, "Enter the server name exactly as shown in MT5").max(100),
  history_days: z.coerce.number().int().refine((n) => [30, 90, 180, 365, 730].includes(n)).default(90),
});

function message(err: unknown) {
  return err instanceof BridgeError ? err.message : "Something went wrong. Please try again in a minute.";
}

export async function connectMt5(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = connectSchema.safeParse(Object.fromEntries(formData));
  const values = { login: String(formData.get("login") ?? ""), server: String(formData.get("server") ?? ""), history_days: String(formData.get("history_days") ?? "90") };
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, values };
  try {
    await connectAccount(user.id, { login: parsed.data.login, password: parsed.data.password, server: parsed.data.server, historyDays: parsed.data.history_days });
  } catch (err) {
    if (!(err instanceof BridgeError)) console.error("MT5 connect failed", err);
    return { message: message(err), values };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Connecting to your broker…" };
}

export async function getMt5Status(): Promise<{ state?: string; connectionStatus?: string; error?: string }> {
  const user = await requireUser();
  try {
    return (await connectionStatus(user.id)) ?? { error: "Not connected" };
  } catch (err) {
    return { error: message(err) };
  }
}

export async function syncMt5(): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  try {
    const r = await syncUser(user.id);
    revalidatePath("/", "layout");
    return { ok: true, message: r.inserted ? `Synced: ${r.inserted} new trade${r.inserted === 1 ? "" : "s"}, ${r.updated} updated.` : `Up to date (${r.updated} checked).` };
  } catch (err) {
    revalidatePath("/settings");
    return { ok: false, message: message(err) };
  }
}

export async function disconnectMt5(): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  try {
    await disconnect(user.id);
  } catch (err) {
    return { ok: false, message: message(err) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
