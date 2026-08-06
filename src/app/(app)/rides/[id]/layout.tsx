import { staticParamsForNativeShell } from '@/lib/native/static-params'

/**
 * One layout covers `/rides/[id]` **and** `/rides/[id]/crew` — the params live
 * on the segment, not on the page, so a nested route inherits them. See
 * `src/app/(app)/postcards/[id]/layout.tsx` for why this cannot go on the pages
 * and `src/lib/native/static-params.ts` for why the id is a placeholder.
 */
export function generateStaticParams() {
  return staticParamsForNativeShell()
}

export default function RideDetailLayout({ children }: { children: React.ReactNode }) {
  return children
}
