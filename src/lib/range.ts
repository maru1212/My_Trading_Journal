export const RANGES = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today() {
  return iso(new Date());
}

export function parseRange(value: unknown): RangeKey {
  return RANGES.some((r) => r.key === value) ? (value as RangeKey) : "all";
}

/** Inclusive start date for a range, or undefined for all time. */
export function rangeStart(range: RangeKey): string | undefined {
  const now = new Date();
  switch (range) {
    case "7d":
    case "30d":
    case "90d": {
      const d = new Date(now);
      d.setDate(d.getDate() - (parseInt(range) - 1));
      return iso(d);
    }
    case "ytd":
      return `${now.getFullYear()}-01-01`;
    default:
      return undefined;
  }
}
