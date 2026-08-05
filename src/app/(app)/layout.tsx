import { Navbar } from '@/components/layout/Navbar'
import { AppBackground } from '@/components/ui/AppBackground'
import { BannerProvider } from '@/components/ui/Banner'

/**
 * Migrated off the v1 `bg-zinc-950` on contact (decision #4). Every screen but
 * the splash sits on `v2 / Component / App Background` — the 135° gradient —
 * so the authenticated shell is where it belongs rather than repeated per page.
 *
 * `BannerProvider` sits here for the same reason the bars do: a confirmation
 * has to outlive the thing that raised it. Hiding, blocking and deleting all
 * remove the card whose menu triggered them, so a banner owned by that card
 * unmounts before it can be read.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <BannerProvider>
      <AppBackground className="flex flex-col">
        <Navbar />
        {/* Both bars are fixed. The header is now per-screen (the design gives each
            one its own title, back affordance and variant), so pages render their
            own `<Header>`; the padding that clears it stays here so no page can
            forget it. `/postcards` overrides the bottom padding — it owns the
            viewport rather than scrolling under the bar. */}
        <main className="pt-header pb-navbar flex-1">{children}</main>
      </AppBackground>
    </BannerProvider>
  )
}
