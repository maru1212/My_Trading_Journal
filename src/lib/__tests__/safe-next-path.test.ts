import { describe, expect, it } from "vitest";
import { FALLBACK, safeNextPath } from "../safe-next-path";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/trades?symbol=XAUUSD", "/trades?symbol=XAUUSD"],
    ["/trades/42/edit", "/trades/42/edit"],
    ["/analytics?range=30d#setups", "/analytics?range=30d#setups"],
    ["/trades?q=a%20b", "/trades?q=a%20b"],
    ["/a/../trades", "/trades"], // normalised the way the browser would
  ])("accepts internal path %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["protocol-relative", "//example.com"],
    ["protocol-relative with path", "//example.com/dashboard"],
    ["backslash", "/\\example.com"],
    ["leading backslash", "\\example.com"],
    ["mixed slashes", "\\/example.com"],
    ["absolute https", "https://example.com"],
    ["absolute http", "http://example.com/dashboard"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,hi"],
    ["relative without slash", "dashboard"],
    ["encoded //", "%2F%2Fexample.com"],
    ["encoded backslash", "/%5Cexample.com"],
    ["encoded slash after /", "/%2Fexample.com"],
    ["double-encoded //", "/%252F%252Fexample.com"],
    ["double-encoded backslash", "/%255Cexample.com"],
    ["tab", "/\t/example.com"],
    ["newline", "/\n/example.com"],
    ["carriage return", "/\r/example.com"],
    ["null byte", "/dash\u0000board"],
    ["DEL", "/dash\u007fboard"],
    ["encoded tab", "/%09/example.com"],
    ["encoded newline", "/%0A/example.com"],
    ["space", "/ /example.com"],
    ["malformed %", "/trades?q=%"],
    ["malformed %E0", "/%E0%A4%A"],
    ["lone surrogate encoding", "/%ED%A0%80"],
    ["signs the user out", "/auth/clear"],
    ["back to login", "/login?next=/dashboard"],
    ["back to signup", "/signup"],
    ["too long", "/" + "a".repeat(3000)],
  ])("rejects %s", (_name, input) => {
    expect(safeNextPath(input)).toBe(FALLBACK);
  });

  it.each([
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["object", {}],
    ["File-like", new Blob(["/dashboard"])],
  ])("falls back for %s", (_name, input) => {
    expect(safeNextPath(input)).toBe(FALLBACK);
  });

  it("never returns a path that resolves to another origin", () => {
    const attacks = ["//evil.com", "/\\evil.com", "/%5Cevil.com", "%2F%2Fevil.com", "/\t/evil.com", "https:evil.com", "/..//evil.com"];
    for (const a of attacks) {
      const out = safeNextPath(a);
      expect(new URL(out, "https://journal.example").origin).toBe("https://journal.example");
    }
  });
});
