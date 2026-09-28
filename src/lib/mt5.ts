import type { BridgeSnapshot } from "./metaapi";
import type { AssetClass } from "./types";

/** One MT5 position, rebuilt from its deals. Times are broker server time, "YYYY-MM-DDTHH:mm". */
export type Mt5Position = {
  position_id: string;
  symbol: string;
  path?: string;
  type: "buy" | "sell";
  volume: number;
  contract_size: number;
  open_time: string;
  open_price: number;
  close_time: string | null;
  close_price: number | null;
  sl: number | null;
  tp: number | null;
  commission: number;
  swap: number;
  profit: number | null; // realized, before commission and swap; null while open
};

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

function guessContractSize(symbol: string) {
  const c = guessAssetClass(symbol);
  if (c === "forex") return 100_000;
  if (/^XAU/i.test(symbol)) return 100;
  if (/^XAG/i.test(symbol)) return 5_000;
  return 1;
}

/** "2026-07-01 10:05:33.123" → "2026-07-01T10:05" */
export function brokerMinute(t: string) {
  return t.replace(" ", "T").slice(0, 16);
}

const positive = (v: number | undefined) => (v && v > 0 ? v : null);

/**
 * Groups deals into positions. Partial entries/exits are volume-weighted; costs and
 * profit are summed across all deals. Open positions come from the live position list.
 */
export function positionsFromSnapshot(snap: BridgeSnapshot): Mt5Position[] {
  const open = new Map(snap.positions.map((p) => [String(p.id), p]));
  const groups = new Map<string, BridgeSnapshot["deals"]>();
  for (const d of snap.deals) {
    if ((d.type !== "DEAL_TYPE_BUY" && d.type !== "DEAL_TYPE_SELL") || !d.positionId) continue;
    groups.set(d.positionId, [...(groups.get(d.positionId) ?? []), d]);
  }

  const result: Mt5Position[] = [];
  const ids = new Set([...groups.keys(), ...open.keys()]);
  for (const id of ids) {
    const deals = [...(groups.get(id) ?? [])].sort((a, b) => a.brokerTime.localeCompare(b.brokerTime));
    const ins = deals.filter((d) => d.entryType === "DEAL_ENTRY_IN");
    const outs = deals.filter((d) => d.entryType !== "DEAL_ENTRY_IN");
    const live = open.get(id);
    const sum = (xs: typeof deals, f: (d: (typeof deals)[number]) => number) => xs.reduce((a, d) => a + f(d), 0);

    const inVol = sum(ins, (d) => d.volume ?? 0);
    const outVol = sum(outs, (d) => d.volume ?? 0);
    let symbol: string, type: "buy" | "sell", volume: number, openPrice: number, openTime: string;
    if (ins.length && inVol > 0) {
      symbol = ins[0].symbol ?? live?.symbol ?? "";
      type = ins[0].type === "DEAL_TYPE_BUY" ? "buy" : "sell";
      volume = inVol;
      openPrice = sum(ins, (d) => (d.volume ?? 0) * (d.price ?? 0)) / inVol;
      openTime = ins[0].brokerTime;
    } else if (live) {
      symbol = live.symbol;
      type = live.type === "POSITION_TYPE_BUY" ? "buy" : "sell";
      volume = live.volume;
      openPrice = live.openPrice;
      openTime = live.brokerTime;
    } else {
      continue; // exit without a known entry
    }
    if (!symbol || !(openPrice > 0)) continue;

    const closed = !live && outVol > 0;
    const lastOut = outs.at(-1);
    const spec = snap.specs[symbol] ?? {};
    result.push({
      position_id: id,
      symbol,
      path: spec.path,
      type,
      volume: Math.round(volume * 1e6) / 1e6,
      contract_size: spec.contractSize && spec.contractSize > 0 ? spec.contractSize : guessContractSize(symbol),
      open_time: brokerMinute(openTime),
      open_price: openPrice,
      close_time: closed ? brokerMinute(lastOut!.brokerTime) : null,
      close_price: closed ? sum(outs, (d) => (d.volume ?? 0) * (d.price ?? 0)) / outVol : null,
      sl: positive(live ? live.stopLoss : (lastOut?.stopLoss ?? ins[0]?.stopLoss)) ?? positive(ins[0]?.stopLoss),
      tp: positive(live ? live.takeProfit : (lastOut?.takeProfit ?? ins[0]?.takeProfit)) ?? positive(ins[0]?.takeProfit),
      commission: sum(deals, (d) => d.commission ?? 0),
      swap: live ? (live.swap ?? 0) : sum(deals, (d) => d.swap ?? 0),
      profit: closed ? sum(outs, (d) => d.profit ?? 0) : null,
    });
  }
  return result;
}

/** Maps one MT5 position to trade columns. Journal fields (setup, tags, notes, rating) are left alone. */
export function toTradeRow(userId: number, login: string, p: Mt5Position) {
  const closed = p.close_price !== null && p.close_time !== null;
  const costs = p.commission + p.swap; // negative when you pay
  return {
    user_id: userId,
    source: "mt5",
    external_id: `mt5:${login}:${p.position_id}`,
    symbol: p.symbol.toUpperCase().slice(0, 20),
    asset_class: guessAssetClass(p.symbol, p.path),
    side: p.type === "buy" ? "long" : "short",
    quantity: p.volume,
    multiplier: p.contract_size,
    entry_date: p.open_time,
    entry_price: p.open_price,
    exit_date: closed ? p.close_time : null,
    exit_price: closed ? p.close_price : null,
    stop_loss: p.sl,
    take_profit: p.tp,
    fees: Math.round(-costs * 100) / 100,
    broker_pnl: closed && p.profit !== null ? Math.round((p.profit + costs) * 100) / 100 : null,
  };
}
