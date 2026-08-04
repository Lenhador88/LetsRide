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
      {/* Both bars are fixed. The header is now per-screen (the design gives each
          one its own title, back affordance and variant), so pages render their
          own `<Header>`; the padding that clears it stays here so no page can
          forget it. `/postcards` overrides the bottom padding — it owns the
          viewport rather than scrolling under the bar. */}
      <main className="pt-header pb-navbar flex-1">{children}</main>
    </AppBackground>
  )
}
