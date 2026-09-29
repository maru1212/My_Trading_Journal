import { describe, expect, it } from "vitest";
import { MOCK_BLOCKED_MESSAGE, NOT_CONFIGURED_MESSAGE, resolveBridgeMode } from "../bridge-mode";

describe("resolveBridgeMode", () => {
  it("reports missing configuration", () => {
    for (const NODE_ENV of ["production", "development", "test", undefined]) {
      expect(resolveBridgeMode({ NODE_ENV })).toEqual({ kind: "error", message: NOT_CONFIGURED_MESSAGE });
      expect(resolveBridgeMode({ NODE_ENV, METAAPI_TOKEN: "  " })).toEqual({ kind: "error", message: NOT_CONFIGURED_MESSAGE });
    }
  });

  it("uses the real SDK for any other token, in every environment", () => {
    for (const NODE_ENV of ["production", "development", "test", undefined]) {
      expect(resolveBridgeMode({ NODE_ENV, METAAPI_TOKEN: "real.jwt.token" })).toEqual({ kind: "sdk", token: "real.jwt.token" });
    }
  });

  it("allows the mock in development and test", () => {
    expect(resolveBridgeMode({ NODE_ENV: "development", METAAPI_TOKEN: "mock" })).toEqual({ kind: "mock" });
    expect(resolveBridgeMode({ NODE_ENV: "test", METAAPI_TOKEN: "mock" })).toEqual({ kind: "mock" });
  });

  it("blocks the mock in production unless ALLOW_MT5_MOCK=true", () => {
    const blocked = { kind: "error", message: MOCK_BLOCKED_MESSAGE };
    expect(resolveBridgeMode({ NODE_ENV: "production", METAAPI_TOKEN: "mock" })).toEqual(blocked);
    for (const ALLOW_MT5_MOCK of ["", "false", "1", "yes", "TRUE-ish"]) {
      expect(resolveBridgeMode({ NODE_ENV: "production", METAAPI_TOKEN: "mock", ALLOW_MT5_MOCK })).toEqual(blocked);
    }
    expect(resolveBridgeMode({ NODE_ENV: "production", METAAPI_TOKEN: "mock", ALLOW_MT5_MOCK: "true" })).toEqual({ kind: "mock" });
    expect(resolveBridgeMode({ NODE_ENV: "production", METAAPI_TOKEN: "mock", ALLOW_MT5_MOCK: " True " })).toEqual({ kind: "mock" });
  });

  it("fails closed when NODE_ENV is missing or unknown", () => {
    const blocked = { kind: "error", message: MOCK_BLOCKED_MESSAGE };
    expect(resolveBridgeMode({ METAAPI_TOKEN: "mock" })).toEqual(blocked);
    expect(resolveBridgeMode({ NODE_ENV: "staging", METAAPI_TOKEN: "mock" })).toEqual(blocked);
    expect(resolveBridgeMode({ METAAPI_TOKEN: "mock", ALLOW_MT5_MOCK: "true" })).toEqual({ kind: "mock" });
  });

  it("never puts the token in an error message", () => {
    const secret = "super-secret-token";
    const r = resolveBridgeMode({ NODE_ENV: "production", METAAPI_TOKEN: secret });
    expect(JSON.stringify(r.kind === "error" ? r.message : "")).not.toContain(secret);
    expect(MOCK_BLOCKED_MESSAGE + NOT_CONFIGURED_MESSAGE).not.toContain(secret);
  });
});
