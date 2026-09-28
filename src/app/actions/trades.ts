"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { CSV_COLUMNS, parseCsv } from "@/lib/csv";
import { createTrade, createTrades, deleteTrade, updateTrade } from "@/lib/trades";
import { tradeSchema, type FormState, type TradeInput } from "@/lib/validation";

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveTrade(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = Number(formData.get("id")) || null;
  const parsed = tradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, message: "Please fix the highlighted fields" };
  }

  let tradeId: number;
  if (id) {
    if (!updateTrade(user.id, id, parsed.data)) return { message: "Trade not found" };
    tradeId = id;
  } else {
    tradeId = createTrade(user.id, parsed.data);
  }
  refresh();
  redirect(`/trades/${tradeId}`);
}

export async function removeTrade(formData: FormData) {
  const user = await requireUser();
  deleteTrade(user.id, Number(formData.get("id")));
  refresh();
  redirect("/trades");
}

export async function importTrades(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose a CSV file to import" };
  if (file.size > 5_000_000) return { message: "File is larger than 5 MB" };

  const rows = parseCsv(await file.text());
  if (rows.length < 2) return { message: "The file has no data rows" };

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = ["symbol", "side", "quantity", "entry_date", "entry_price"].filter(
    (c) => !header.includes(c),
  );
  if (missing.length) return { message: `Missing required column(s): ${missing.join(", ")}` };

  const inputs: TradeInput[] = [];
  const problems: string[] = [];
  rows.slice(1).forEach((row, i) => {
    const record: Record<string, string> = {};
    header.forEach((h, j) => {
      if ((CSV_COLUMNS as readonly string[]).includes(h)) record[h] = (row[j] ?? "").trim();
    });
    if (record.side) record.side = record.side.toLowerCase();
    if (record.asset_class) record.asset_class = record.asset_class.toLowerCase();
    else delete record.asset_class;
    const parsed = tradeSchema.safeParse(record);
    if (parsed.success) inputs.push(parsed.data);
    else {
      const [field, msgs] = Object.entries(parsed.error.flatten().fieldErrors)[0] ?? ["row", ["invalid"]];
      problems.push(`Row ${i + 2}: ${field} — ${msgs?.[0]}`);
    }
  });

  if (problems.length) {
    return {
      message: `Nothing imported. ${problems.length} row(s) have problems:\n${problems.slice(0, 8).join("\n")}${
        problems.length > 8 ? "\n…" : ""
      }`,
    };
  }
  const count = createTrades(user.id, inputs);
  refresh();
  return { ok: true, message: `Imported ${count} trade${count === 1 ? "" : "s"}.` };
}
