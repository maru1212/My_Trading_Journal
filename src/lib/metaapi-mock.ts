import "server-only";
import { BridgeError, type Bridge, type BridgeDeal, type BridgeSnapshot } from "./metaapi";

/**
 * Fake MetaApi used when METAAPI_TOKEN=mock, so the MT5 flow can be tried without a real
 * account. Password "wrong" fails login; server "Nope" is unknown.
 */
const accounts = new Map<string, { login: string; server: string; polls: number }>();

function deal(d: Partial<BridgeDeal> & Pick<BridgeDeal, "id" | "brokerTime">): BridgeDeal {
  return { type: "DEAL_TYPE_BUY", entryType: "DEAL_ENTRY_IN", profit: 0, commission: 0, swap: 0, ...d };
}

export const mockBridge: Bridge = {
  async createAccount({ login, password, server }) {
    if (password === "wrong") throw new BridgeError("MT5 rejected the login or password. Check them and try again.");
    if (server === "Nope") throw new BridgeError("Server name not found. Did you mean: ICMarketsSC-Demo?");
    const id = `mock-${login}-${Date.now()}`;
    accounts.set(id, { login, server, polls: 0 });
    return id;
  },
  async status(id) {
    const a = accounts.get(id);
    if (!a) return { state: "DEPLOYED", connectionStatus: "CONNECTED" };
    a.polls++;
    return a.polls < 2 ? { state: "DEPLOYING", connectionStatus: "DISCONNECTED" } : { state: "DEPLOYED", connectionStatus: "CONNECTED" };
  },
  async fetch(id): Promise<BridgeSnapshot> {
    const a = accounts.get(id) ?? { login: id.split("-")[1] ?? "5001", server: "ICMarketsSC-Demo" };
    return {
      login: a.login,
      server: a.server,
      currency: "USD",
      deals: [
        deal({ id: "1", type: "DEAL_TYPE_BALANCE", entryType: undefined, brokerTime: "2026-09-01 00:00:00.000", profit: 10000 }),
        // EURUSD long 1 lot, closed in two halves
        deal({ id: "2", positionId: "7001", symbol: "EURUSD", volume: 1, price: 1.1, brokerTime: "2026-09-21 09:10:00.000", commission: -3.5, stopLoss: 1.098 }),
        deal({ id: "3", positionId: "7001", symbol: "EURUSD", type: "DEAL_TYPE_SELL", entryType: "DEAL_ENTRY_OUT", volume: 0.5, price: 1.102, brokerTime: "2026-09-21 11:00:00.000", profit: 100, commission: -1.75 }),
        deal({ id: "4", positionId: "7001", symbol: "EURUSD", type: "DEAL_TYPE_SELL", entryType: "DEAL_ENTRY_OUT", volume: 0.5, price: 1.104, brokerTime: "2026-09-21 13:30:00.000", profit: 200, commission: -1.75 }),
        // Gold short 0.5 lot
        deal({ id: "5", positionId: "7002", symbol: "XAUUSD", type: "DEAL_TYPE_SELL", volume: 0.5, price: 2650.5, brokerTime: "2026-09-22 14:00:00.000", commission: -3.5, stopLoss: 2660.5 }),
        deal({ id: "6", positionId: "7002", symbol: "XAUUSD", type: "DEAL_TYPE_BUY", entryType: "DEAL_ENTRY_OUT", volume: 0.5, price: 2640.5, brokerTime: "2026-09-22 16:45:00.000", profit: 500, swap: -2 }),
        // GBPUSD long, still open
        deal({ id: "7", positionId: "7003", symbol: "GBPUSD", volume: 0.3, price: 1.33, brokerTime: "2026-09-25 08:00:00.000", commission: -2.1 }),
      ],
      positions: [{ id: 7003, type: "POSITION_TYPE_BUY", symbol: "GBPUSD", brokerTime: "2026-09-25 08:00:00.000", openPrice: 1.33, volume: 0.3, stopLoss: 1.327, takeProfit: 1.336, swap: -0.8 }],
      specs: { EURUSD: { contractSize: 100000, path: "Forex\\Majors\\EURUSD" }, XAUUSD: { contractSize: 100, path: "Metals\\XAUUSD" }, GBPUSD: { contractSize: 100000, path: "Forex\\Majors\\GBPUSD" } },
    };
  },
  async remove(id) {
    accounts.delete(id);
  },
};
