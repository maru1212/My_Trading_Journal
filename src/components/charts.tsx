"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { formatCompactMoney, formatDate, formatMoney } from "@/lib/format";

const AXIS = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 12 }, tickLine: false };

function TooltipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="tnum rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">{children}</div>
  );
}

function Signed({ value, currency }: { value: number; currency: string }) {
  return (
    <span className={value > 0 ? "text-profit" : value < 0 ? "text-loss" : "text-ink-2"}>
      {formatMoney(value, currency, true)}
    </span>
  );
}

function shortDate(d: string) {
  const [, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${m}/${day}`;
}

export type EquityDatum = { index: number; date: string; symbol: string; pnl: number; equity: number };

export function EquityChart({ data, currency, baseline }: { data: EquityDatum[]; currency: string; baseline: number }) {
  const points = [{ index: 0, date: data[0]?.date ?? "", symbol: "Start", pnl: 0, equity: baseline }, ...data];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="index" {...AXIS} tickFormatter={(i) => (points[i]?.date ? shortDate(points[i].date) : "")} minTickGap={32} />
        <YAxis {...AXIS} axisLine={false} width={64} tickFormatter={(v) => formatCompactMoney(v, currency)} domain={["auto", "auto"]} />
        <ReferenceLine y={baseline} stroke="var(--axis)" strokeDasharray="3 3" />
        <Tooltip
          cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as EquityDatum | undefined;
            if (!active || !p) return null;
            return (
              <TooltipBox>
                <p className="text-muted">{p.index === 0 ? "Starting balance" : `Trade #${p.index} · ${p.symbol} · ${formatDate(p.date)}`}</p>
                <p className="mt-1 font-medium text-ink">{formatMoney(p.equity, currency)}</p>
                {p.index > 0 && <p><Signed value={p.pnl} currency={currency} /></p>}
              </TooltipBox>
            );
          }}
        />
        <Area type="monotone" animationDuration={500} dataKey="equity" stroke="var(--accent)" strokeWidth={2} fill="url(#equityFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export type BarDatum = { label: string; pnl: number; trades: number; winRate?: number };

/** Profit/loss bars, one per category or day. Positive is green, negative red. */
export function PnlBarChart({
  data, currency, height = 240, dateLabels = false, layout = "vertical-bars",
}: {
  data: BarDatum[];
  currency: string;
  height?: number;
  dateLabels?: boolean;
  layout?: "vertical-bars" | "horizontal-bars";
}) {
  const horizontal = layout === "horizontal-bars";
  const tooltip = (
    <Tooltip
      cursor={{ fill: "var(--surface-2)" }}
      content={({ active, payload }) => {
        const p = payload?.[0]?.payload as BarDatum | undefined;
        if (!active || !p) return null;
        return (
          <TooltipBox>
            <p className="text-muted">{dateLabels ? formatDate(p.label) : p.label}</p>
            <p className="mt-1 font-medium"><Signed value={p.pnl} currency={currency} /></p>
            <p className="text-ink-2">
              {p.trades} trade{p.trades === 1 ? "" : "s"}
              {p.winRate !== undefined && ` · ${p.winRate.toFixed(0)}% win`}
            </p>
          </TooltipBox>
        );
      }}
    />
  );
  const cells = data.map((d) => (
    <Cell key={d.label} fill={d.pnl >= 0 ? "var(--profit)" : "var(--loss)"} />
  ));

  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(height, data.length * 32 + 24)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" {...AXIS} tickFormatter={(v) => formatCompactMoney(v, currency)} />
          <YAxis type="category" dataKey="label" {...AXIS} axisLine={false} width={80} tick={{ fill: "var(--ink-2)", fontSize: 12 }} />
          <ReferenceLine x={0} stroke="var(--axis)" />
          {tooltip}
          <Bar dataKey="pnl" animationDuration={500} radius={4} maxBarSize={20}>{cells}</Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="label" {...AXIS} tickFormatter={dateLabels ? shortDate : undefined} minTickGap={16} />
        <YAxis {...AXIS} axisLine={false} width={64} tickFormatter={(v) => formatCompactMoney(v, currency)} />
        <ReferenceLine y={0} stroke="var(--axis)" />
        {tooltip}
        <Bar dataKey="pnl" animationDuration={500} radius={4} maxBarSize={28}>{cells}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
