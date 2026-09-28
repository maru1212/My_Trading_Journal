import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TradeForm } from "@/components/trade-form";
import { requireUser } from "@/lib/auth";
import { distinctValues, getTrade } from "@/lib/trades";

export const metadata: Metadata = { title: "Edit trade" };

export default async function EditTradePage(props: PageProps<"/trades/[id]/edit">) {
  const user = await requireUser();
  const trade = getTrade(user.id, Number((await props.params).id));
  if (!trade) notFound();
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${trade.symbol} trade`} />
      <TradeForm trade={trade} currency={user.currency} setups={distinctValues(user.id, "setup")} now={trade.entry_date} />
    </div>
  );
}
