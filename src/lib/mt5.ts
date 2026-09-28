import { z } from "zod";
import type { AssetClass } from "./types";

/** "2026.07.01 10:05", "2026-07-01 10:05:33" or ISO → "2026-07-01T10:05" (broker server time). */
const mt5Time = z
  .string()
  .trim()
  .regex(/^\d{4}[.-]\d{2}[.-]\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/, "Expected YYYY.MM.DD HH:MM")
  .transform((s) => s.replace(/\./g, "-").replace(" ", "T").slice(0, 16));

// MT5 reports "no stop" as 0.
const price = z.number().finite().nullish().transform((v) => (v && v > 0 ? v : null));
const money = z.number().finite().default(0);

export const mt5PositionSchema = z.object({
  position_id: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform(String),
  symbol: z.string().trim().min(1).max(30),
  path: z.string().max(200).optional(),
  type: z.enum(["buy", "sell"]),
  volume: z.number().positive(),
  contract_size: z.number().positive().default(1),
  open_time: mt5Time,
  open_price: z.number().positive(),
  close_time: mt5Time.nullish(),
  close_price: price,
  sl: price,
  tp: price,
  commission: money,
  swap: money,
  fee: money,
  profit: z.number().finite().nullish(),
  comment: z.string().max(200).optional(),
});

export const mt5PayloadSchema = z.object({
  login: z.union([z.string().regex(/^\d+$/), z.number().int()]).transform(String),
  server: z.string().max(100).optional(),
  currency: z.string().max(10).optional(),
  positions: z.array(mt5PositionSchema).max(500),
});

export type Mt5Position = z.infer<typeof mt5PositionSchema>;

export function guessAssetClass(symbol: string, path = ""): AssetClass {
  const s = symbol.toUpperCase();
  const p = path.toLowerCase();
  if (/^(XAU|XAG|XPT|XPD)/.test(s) || /metal|commodit|energ|oil/.test(p) || /^(USOIL|UKOIL|WTI|BRENT|XBR|XTI)/.test(s)) return "commodity";
  if (/crypto/.test(p) || /^(BTC|ETH|LTC|XRP|SOL|DOGE|ADA)/.test(s)) return "crypto";
  if (/forex|fx|currenc/.test(p) || /^[A-Z]{6}([._-]?[A-Z0-9]{0,4})?$/.test(s)) return "forex";
  if (/stock|share|equit/.test(p)) return "stock";
  if (/future/.test(p)) return "future";
  return "other";
}

/** Maps one MT5 position to trade columns. Journal fields (setup, tags, notes, rating) are left alone. */
export function toTradeRow(userId: number, login: string, p: Mt5Position) {
  const closed = p.close_price !== null && p.close_time != null;
  const costs = p.commission + p.swap + p.fee; // negative when you pay
  return {
    user_id: userId,
    source: "mt5",
    external_id: `mt5:${login}:${p.position_id}`,
    symbol: p.symbol.toUpperCase(),
    asset_class: guessAssetClass(p.symbol, p.path),
    side: p.type === "buy" ? "long" : "short",
    quantity: p.volume,
    multiplier: p.contract_size,
    entry_date: p.open_time,
    entry_price: p.open_price,
    exit_date: closed ? p.close_time! : null,
    exit_price: closed ? p.close_price : null,
    stop_loss: p.sl,
    take_profit: p.tp,
    fees: Math.round(-costs * 100) / 100,
    broker_pnl: closed && p.profit != null ? Math.round((p.profit + costs) * 100) / 100 : null,
  };
}
