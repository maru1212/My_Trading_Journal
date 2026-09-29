import Link from "next/link";
import { Logo } from "@/components/logo";
import { getCurrentUser } from "@/lib/auth";
import { signupMode } from "@/lib/signup-policy";

const FEATURES = [
  { title: "Log every trade", body: "Stocks, options, futures, forex and crypto. Entries, exits, stops, fees, setups, tags and notes in one form." },
  { title: "P&L that's actually right", body: "Net P&L after fees, contract multipliers, R-multiples and % return, calculated for every trade." },
  { title: "Stats that matter", body: "Win rate, profit factor, expectancy, average win vs loss, max drawdown, streaks and hold time." },
  { title: "Equity curve & calendar", body: "Watch your account grow trade by trade, and see every green and red day on a monthly calendar." },
  { title: "Find your edge", body: "Break results down by setup, symbol, tag, weekday, hour of day and long vs short." },
  { title: "Import & export", body: "Bring trades in from a CSV and take them out again at any time. Your data stays yours." },
];

const BARS = [34, -12, 22, 48, -26, 15, 30, -8, 40, 18, -20, 52, 26, -14, 36];

export default async function Home() {
  const user = await getCurrentUser();
  // Registration links only when anyone may register; allowlisted users go to /signup directly.
  const canSignUp = signupMode() === "open";
  const cta = user ? "/dashboard" : canSignUp ? "/signup" : "/login";
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          {user ? (
            <Link href="/dashboard" className="btn-primary">Open dashboard</Link>
          ) : (
            <>
              <Link href="/login" className={canSignUp ? "btn-ghost border-transparent" : "btn-primary"}>Sign in</Link>
              {canSignUp && <Link href="/signup" className="btn-primary">Get started</Link>}
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-12 pb-16 text-center sm:px-6 sm:pt-20">
          <p className="mx-auto mb-5 w-fit rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2">
            The trading journal for disciplined traders
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
            Know exactly why you win and why you lose.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-ink-2">
            Log your trades, track your P&amp;L, and turn your history into an edge you can measure.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href={cta} className="btn-primary px-5 py-2.5 text-base">
              {user ? "Go to dashboard" : canSignUp ? "Start journaling free" : "Sign in"}
            </Link>
            {!user && canSignUp && <Link href="/login" className="btn-ghost px-5 py-2.5 text-base">Sign in</Link>}
          </div>

          <div className="card mx-auto mt-14 max-w-4xl p-4 text-left shadow-2xl shadow-black/10 sm:p-6" aria-hidden="true">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["Net P&L", "+$12,480.50", "text-profit"], ["Win rate", "58.3%", ""], ["Profit factor", "1.92", ""], ["Expectancy", "+$104.00", "text-profit"]].map(([l, v, cls]) => (
                <div key={l} className="rounded-lg border border-line p-3">
                  <p className="text-xs text-ink-2">{l}</p>
                  <p className={`tnum mt-1 text-lg font-semibold ${cls}`}>{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex h-40 items-center gap-1.5 rounded-lg border border-line px-3">
              {BARS.map((b, i) => (
                <div key={i} className="flex h-full flex-1 flex-col justify-center">
                  <div className="flex h-1/2 items-end">{b > 0 && <div className="w-full rounded-t bg-profit-fill" style={{ height: `${b * 1.6}%` }} />}</div>
                  <div className="flex h-1/2 items-start border-t border-line">{b < 0 && <div className="w-full rounded-b bg-loss-fill" style={{ height: `${-b * 1.6}%` }} />}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-px px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="p-5">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Your next trade deserves a review.</h2>
          <p className="mt-3 text-ink-2">{canSignUp ? "Set up takes under a minute." : "Sign in to open your journal."}</p>
          <Link href={cta} className="btn-primary mt-6 px-5 py-2.5 text-base">
            {user ? "Open dashboard" : canSignUp ? "Create your journal" : "Sign in"}
          </Link>
        </section>
      </main>

      <footer className="border-t border-line py-8 text-center text-xs text-muted">
        © {new Date().getFullYear()} TradeLog. Not financial advice.
      </footer>
    </div>
  );
}
