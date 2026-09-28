export const ASSET_CLASSES = ["stock", "option", "future", "forex", "commodity", "crypto", "other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];
export type Side = "long" | "short";

export type Trade = {
  id: number;
  user_id: number;
  symbol: string;
  asset_class: AssetClass;
  side: Side;
  quantity: number;
  multiplier: number;
  entry_date: string; // "YYYY-MM-DDTHH:mm", in the trader's local time
  entry_price: number;
  exit_date: string | null;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  fees: number;
  setup: string | null;
  tags: string | null; // comma separated
  notes: string | null;
  rating: number | null;
  source: "manual" | "mt5";
  external_id: string | null; // e.g. "mt5:<login>:<position id>"
  broker_pnl: number | null; // net P&L reported by the broker, in account currency
  created_at: string;
  updated_at: string;
};
