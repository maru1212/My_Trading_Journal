export function formatMoney(value: number | null | undefined, currency = "USD", signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Math.abs(value));
  if (value < 0) return `−${s}`;
  return signed && value > 0 ? `+${s}` : s;
}

export function formatCompactMoney(value: number, currency = "USD") {
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: Math.abs(value) < 1000 ? 0 : 1,
  }).format(Math.abs(value));
  return value < 0 ? `−${s}` : s;
}

export function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function formatPct(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatDuration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

export function formatDate(value: string | null) {
  if (!value) return "—";
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return time && time !== "00:00" ? `${label} ${time}` : label;
}

/** Tailwind text class for a P&L value. */
export function pnlClass(value: number | null | undefined) {
  if (!value) return "text-muted";
  return value > 0 ? "text-profit" : "text-loss";
}
