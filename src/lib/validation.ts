import { z } from "zod";
import { ASSET_CLASSES } from "./types";

const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().finite().nullable(),
);
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v ?? null),
    z.string().trim().max(max).nullable(),
  );
const dateTime = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Use YYYY-MM-DD or YYYY-MM-DDTHH:mm")
  .transform((s) => (s.length === 10 ? `${s}T00:00` : s.slice(0, 16)));

export const tradeSchema = z
  .object({
    symbol: z.string().trim().min(1, "Symbol is required").max(20).transform((s) => s.toUpperCase()),
    asset_class: z.enum(ASSET_CLASSES).default("stock"),
    side: z.enum(["long", "short"]),
    quantity: z.coerce.number().positive("Quantity must be positive"),
    multiplier: z.preprocess((v) => (v === "" || v == null ? 1 : v), z.coerce.number().positive()),
    entry_date: dateTime,
    entry_price: z.coerce.number().positive("Entry price must be positive"),
    exit_date: z.preprocess((v) => (v === "" ? null : v), dateTime.nullable().default(null)),
    exit_price: optionalNumber,
    stop_loss: optionalNumber,
    take_profit: optionalNumber,
    // Signed net costs: positive = paid, negative = net credit (e.g. an MT5 swap credit larger
    // than the commission). Never clamped; P&L subtracts it as-is.
    fees: z.preprocess((v) => (v === "" || v == null ? 0 : v), z.coerce.number().finite()),
    setup: optionalText(60),
    tags: optionalText(200),
    notes: optionalText(5000),
    rating: z.preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.coerce.number().int().min(1).max(5).nullable(),
    ),
  })
  .superRefine((t, ctx) => {
    if (t.exit_price !== null && t.exit_price <= 0) {
      ctx.addIssue({ code: "custom", path: ["exit_price"], message: "Exit price must be positive" });
    }
    if (t.exit_date && t.exit_price === null) {
      ctx.addIssue({ code: "custom", path: ["exit_price"], message: "Add an exit price or clear the exit date" });
    }
    if (t.exit_date && t.exit_date < t.entry_date) {
      ctx.addIssue({ code: "custom", path: ["exit_date"], message: "Exit must be after entry" });
    }
  });

export type TradeInput = z.infer<typeof tradeSchema>;

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const settingsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter code like USD"),
  starting_balance: z.preprocess((v) => (v === "" ? 0 : v), z.coerce.number().min(0)),
});

export const passwordSchema = z.object({
  current: z.string().min(1, "Enter your current password"),
  next: z.string().min(8, "Use at least 8 characters").max(200),
});

export type FieldErrors = Partial<Record<string, string[]>>;
export type FormState =
  | {
      errors?: FieldErrors;
      message?: string;
      ok?: boolean;
      /** Submitted values, echoed back so fields survive React's post-action form reset. */
      values?: Record<string, string>;
    }
  | undefined;

/** Text fields from a form submission, minus secrets and framework fields. */
export function echo(formData: FormData, omit: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData) {
    if (typeof v === "string" && !k.startsWith("$") && !omit.includes(k)) out[k] = v;
  }
  return out;
}
