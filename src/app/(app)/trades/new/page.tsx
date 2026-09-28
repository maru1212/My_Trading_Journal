import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { TradeForm } from "@/components/trade-form";
import { requireUser } from "@/lib/auth";
import { distinctValues } from "@/lib/trades";

export const metadata: Metadata = { title: "Log trade" };

export default async function NewTradePage() {
  const user = await requireUser();
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return (
    <div className="max-w-4xl">
      <PageHeader title="Log a trade" subtitle="Leave the exit empty to keep the position open." />
      <TradeForm currency={user.currency} setups={distinctValues(user.id, "setup")} now={now.toISOString().slice(0, 16)} />
    </div>
  );
}
