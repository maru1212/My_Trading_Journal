import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { Nav } from "@/components/nav";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-5">
          <Logo href="/dashboard" />
          <Link href="/trades/new" className="btn-primary px-3 py-1.5 md:hidden">+ Trade</Link>
        </div>
        <div className="px-3 pb-3 md:flex-1 md:pb-0">
          <Link href="/trades/new" className="btn-primary mb-4 hidden w-full md:flex">+ Log trade</Link>
          <Nav />
        </div>
        <div className="hidden border-t border-line p-4 md:block">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
          <form action={logout} className="mt-3">
            <button className="text-xs text-ink-2 hover:text-ink">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
