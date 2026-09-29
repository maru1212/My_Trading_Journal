import { describe, expect, it } from "vitest";
import { isSignupAllowed, normalizeEmail, signupMode } from "../signup-policy";

describe("signup policy", () => {
  it("is closed by default", () => {
    expect(signupMode({})).toBe("closed");
    expect(isSignupAllowed("me@example.com", {})).toBe(false);
  });

  it("treats blank or junk settings as closed", () => {
    for (const env of [
      { ALLOW_SIGNUP: "" },
      { ALLOW_SIGNUP: "false" },
      { ALLOW_SIGNUP: "1" },
      { ALLOW_SIGNUP: "yes" },
      { ALLOWED_SIGNUP_EMAILS: "" },
      { ALLOWED_SIGNUP_EMAILS: " , ,, " },
    ]) {
      expect(signupMode(env)).toBe("closed");
      expect(isSignupAllowed("me@example.com", env)).toBe(false);
    }
  });

  it("opens only on ALLOW_SIGNUP=true", () => {
    expect(signupMode({ ALLOW_SIGNUP: "true" })).toBe("open");
    expect(signupMode({ ALLOW_SIGNUP: " TRUE " })).toBe("open");
    expect(isSignupAllowed("anyone@example.com", { ALLOW_SIGNUP: "true" })).toBe(true);
  });

  it("ALLOW_SIGNUP=true takes precedence over the allowlist", () => {
    const env = { ALLOW_SIGNUP: "true", ALLOWED_SIGNUP_EMAILS: "me@example.com" };
    expect(signupMode(env)).toBe("open");
    expect(isSignupAllowed("other@example.com", env)).toBe(true);
  });

  it("allowlist admits only listed addresses, normalised", () => {
    const env = { ALLOWED_SIGNUP_EMAILS: " Me@Example.com ,partner@example.com" };
    expect(signupMode(env)).toBe("allowlist");
    expect(isSignupAllowed("me@example.com", env)).toBe(true);
    expect(isSignupAllowed("  ME@EXAMPLE.COM ", env)).toBe(true);
    expect(isSignupAllowed("partner@example.com", env)).toBe(true);
    expect(isSignupAllowed("stranger@example.com", env)).toBe(false);
    expect(isSignupAllowed("me@example.com.evil.com", env)).toBe(false);
    expect(isSignupAllowed("", env)).toBe(false);
  });

  it("normalises like the signup form", () => {
    expect(normalizeEmail("  A.B@Example.COM ")).toBe("a.b@example.com");
  });
});
