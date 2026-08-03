import { Navbar } from '@/components/layout/Navbar'
import { AppBackground } from '@/components/ui/AppBackground'

/**
 * Migrated off the v1 `bg-zinc-950` on contact (decision #4). Every screen but
 * the splash sits on `v2 / Component / App Background` — the 135° gradient —
 * so the authenticated shell is where it belongs rather than repeated per page.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppBackground className="flex flex-col">
      <Navbar />
      {/* pt-14 clears the fixed header; pb-24 clears the fixed tab bar, which is
          taller than the v1 four-tab version it replaced. */}
      <main className="flex-1 pt-14 pb-24">{children}</main>
    </AppBackground>
  )
}
