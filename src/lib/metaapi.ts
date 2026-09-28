import "server-only";

/**
 * Thin wrapper around the MetaApi cloud SDK (metaapi.cloud). MetaApi runs a MetaTrader
 * terminal in the cloud for each connected account, so we can read history with just
 * login + password + server. Set METAAPI_TOKEN to your MetaApi API token.
 *
 * METAAPI_TOKEN=mock switches to an in-memory fake for local development and tests.
 */

export type BridgeDeal = {
  id: string;
  type: string; // DEAL_TYPE_BUY, DEAL_TYPE_SELL, DEAL_TYPE_BALANCE, ...
  entryType?: string; // DEAL_ENTRY_IN, DEAL_ENTRY_OUT, DEAL_ENTRY_INOUT, DEAL_ENTRY_OUT_BY
  symbol?: string;
  brokerTime: string; // "YYYY-MM-DD HH:mm:ss.SSS", broker timezone
  volume?: number;
  price?: number;
  commission?: number;
  swap?: number;
  profit: number;
  positionId?: string;
  stopLoss?: number;
  takeProfit?: number;
};

export type BridgePosition = {
  id: string | number;
  type: string; // POSITION_TYPE_BUY | POSITION_TYPE_SELL
  symbol: string;
  brokerTime: string;
  openPrice: number;
  volume: number;
  stopLoss?: number;
  takeProfit?: number;
  swap?: number;
  commission?: number;
};

export type BridgeSnapshot = {
  login: string;
  server: string;
  currency: string;
  deals: BridgeDeal[];
  positions: BridgePosition[];
  specs: Record<string, { contractSize?: number; path?: string }>;
};

export type BridgeStatus = { state: string; connectionStatus: string };

export interface Bridge {
  createAccount(input: { login: string; password: string; server: string; name: string }): Promise<string>;
  status(accountId: string): Promise<BridgeStatus>;
  fetch(accountId: string, from: Date): Promise<BridgeSnapshot>;
  remove(accountId: string): Promise<void>;
}

/** A user-facing error (bad password, unknown server, ...). */
export class BridgeError extends Error {}

export function bridgeConfigured() {
  return Boolean(process.env.METAAPI_TOKEN);
}

export async function getBridge(): Promise<Bridge> {
  const token = process.env.METAAPI_TOKEN;
  if (!token) throw new BridgeError("MT5 connection is not set up on the server (METAAPI_TOKEN is missing).");
  if (token === "mock") return (await import("./metaapi-mock")).mockBridge;
  return sdkBridge(token);
}

function friendly(err: unknown): Error {
  const e = err as { message?: string; details?: unknown; status?: number; name?: string };
  const code = typeof e?.details === "string" ? e.details : (e?.details as { code?: string })?.code;
  if (code === "E_AUTH") return new BridgeError("MT5 rejected the login or password. Check them and try again.");
  if (code === "E_SRV_NOT_FOUND") {
    const hint = e.message?.match(/Suggested server names:\s*([^.]+)/)?.[1];
    return new BridgeError(`Server name not found.${hint ? ` Did you mean: ${hint.trim()}?` : " Copy it exactly as shown in MT5 (File → Login to Trade Account)."}`);
  }
  if (code === "E_SERVER_TIMEZONE") return new BridgeError("Couldn't detect your broker's settings. Please try again in a few minutes.");
  if (code === "E_RESOURCE_SLOTS") return new BridgeError("MetaApi needs more resource slots for this account. Check your MetaApi plan.");
  if (e?.status === 401 || e?.name === "UnauthorizedError") return new BridgeError("The server's MetaApi token is invalid. Check METAAPI_TOKEN in Vercel.");
  if (e?.name === "TimeoutError") return new BridgeError("MetaTrader took too long to respond. Try again in a minute.");
  return err instanceof Error ? err : new Error(String(err));
}


function sdkBridge(token: string): Bridge {
  async function withApi<T>(fn: (api: import("metaapi.cloud-sdk/esm-node").default) => Promise<T>): Promise<T> {
    const { default: MetaApi } = await import("metaapi.cloud-sdk/esm-node");
    // Keep retries short: this runs inside a serverless function with a time limit.
    const api = new MetaApi(token, { requestTimeout: 60, retryOpts: { retries: 2, minDelayInSeconds: 1, maxDelayInSeconds: 30 } });
    try {
      return await fn(api);
    } catch (err) {
      throw friendly(err);
    } finally {
      api.close();
    }
  }

  return {
    createAccount: ({ login, password, server, name }) =>
      withApi(async (api) => {
        const account = await api.metatraderAccountApi.createAccount({
          name,
          type: "cloud-g2",
          login,
          password, // an investor (read-only) password is enough
          server,
          platform: "mt5",
          magic: 0,
        });
        return account.id;
      }),

    status: (accountId) =>
      withApi(async (api) => {
        const account = await api.metatraderAccountApi.getAccount(accountId);
        return { state: account.state, connectionStatus: account.connectionStatus };
      }),

    fetch: (accountId, from) =>
      withApi(async (api) => {
        const account = await api.metatraderAccountApi.getAccount(accountId);
        if (account.state !== "DEPLOYED") {
          await account.deploy();
          throw new BridgeError("Your MT5 connection was asleep and is starting up. Try syncing again in a minute.");
        }
        const connection = account.getRPCConnection();
        await connection.connect();
        try {
          await connection.waitSynchronized(120);
          const info = await connection.getAccountInformation();

          const deals: BridgeDeal[] = [];
          const end = new Date(Date.now() + 86_400_000);
          for (let offset = 0; ; offset += 1000) {
            const page = await connection.getDealsByTimeRange(from, end, offset, 1000);
            deals.push(...(page.deals as unknown as BridgeDeal[]));
            if (page.deals.length < 1000) break;
          }
          const positions = (await connection.getPositions()) as unknown as BridgePosition[];

          // Positions opened before `from` but closed after it: fetch their entry deals too.
          const withEntry = new Set(deals.filter((d) => d.entryType === "DEAL_ENTRY_IN").map((d) => d.positionId));
          const missing = [...new Set(deals.map((d) => d.positionId).filter((id): id is string => !!id && !withEntry.has(id)))];
          const seen = new Set(deals.map((d) => d.id));
          for (const id of missing) {
            for (const d of (await connection.getDealsByPosition(id)).deals as unknown as BridgeDeal[]) {
              if (!seen.has(d.id)) deals.push(d);
            }
          }

          const specs: BridgeSnapshot["specs"] = {};
          const symbols = new Set([...deals.map((d) => d.symbol), ...positions.map((p) => p.symbol)].filter(Boolean) as string[]);
          for (const symbol of symbols) {
            try {
              const s = await connection.getSymbolSpecification(symbol);
              specs[symbol] = { contractSize: s.contractSize, path: s.path };
            } catch {
              specs[symbol] = {}; // symbol no longer offered by the broker; we'll guess
            }
          }
          return { login: String(info.login ?? account.login), server: info.server ?? account.server, currency: info.currency, deals, positions, specs };
        } finally {
          await connection.close();
        }
      }),

    remove: (accountId) =>
      withApi(async (api) => {
        try {
          const account = await api.metatraderAccountApi.getAccount(accountId);
          await account.remove();
        } catch (err) {
          if ((err as { status?: number }).status !== 404) throw err;
        }
      }),
  };
}

