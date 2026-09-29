/**
 * Validates the post-login `next` parameter. Returns a same-origin path (pathname +
 * search + hash) or FALLBACK. Pure, so it can run anywhere and be unit-tested.
 *
 * Rejects anything a browser could resolve to another origin: protocol-relative URLs
 * (`//host`), backslashes (browsers treat `\` like `/`), absolute and `javascript:`
 * URLs, whitespace/control characters (browsers strip tabs/newlines from URLs), and
 * percent-encoded variants of those. Decoded forms are only used to *reject*; the value
 * returned is always the browser-parsed form of the original input.
 */

export const FALLBACK = "/dashboard";

const MAX_LENGTH = 2048;
const BASE = "http://next-path.invalid";
// Where sending a freshly signed-in user makes no sense (or would sign them out).
const BLOCKED_PREFIXES = ["/login", "/signup", "/auth/"];

// Raw input: no whitespace or control characters at all (browsers strip tabs/newlines, so
// "/\t/evil.com" would become "//evil.com"), and no backslashes.
const UNSAFE_RAW = /[\u0000-\u001f \u007f-\u009f\\]/; // note the literal space
// Decoded layers: an encoded space ("%20") is ordinary data, but encoded control
// characters and backslashes are not.
const UNSAFE_DECODED = /[\u0000-\u001f\u007f-\u009f\\]/;

function looksSafe(path: string, unsafe = UNSAFE_RAW): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !unsafe.test(path);
}

export function safeNextPath(input: unknown): string {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_LENGTH) return FALLBACK;
  if (!looksSafe(input)) return FALLBACK;

  // Every decoding layer must also look safe (catches %2F%2F, /%5C, %09, double encoding).
  let decoded = input;
  for (let i = 0; i < 5; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return FALLBACK; // malformed percent-encoding
    }
    if (!looksSafe(next, UNSAFE_DECODED)) return FALLBACK;
    if (next === decoded) break;
    decoded = next;
  }

  // Final word goes to the URL parser, mirroring how the browser resolves Location.
  let url: URL;
  try {
    url = new URL(input, BASE);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== BASE) return FALLBACK;

  const path = url.pathname + url.search + url.hash;
  if (!looksSafe(path)) return FALLBACK;
  if (BLOCKED_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p.endsWith("/") ? p : p + "/"))) {
    return FALLBACK;
  }
  return path;
}
