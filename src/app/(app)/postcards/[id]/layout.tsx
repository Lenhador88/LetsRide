import { staticParamsForNativeShell } from '@/lib/native/static-params'

/**
 * Exists only so `CAPACITOR_BUILD=1` can emit an HTML shell for this segment.
 * It renders its children and nothing else — no wrapper element, no styling.
 *
 * **It has to be a layout, and that is measured rather than assumed.** Putting
 * `generateStaticParams()` on the page itself fails the build:
 *
 *     App pages cannot use both "use client" and export function
 *     "generateStaticParams()".
 *
 * Every one of this app's seven dynamic pages is `'use client'` and reads its id
 * with `useParams()`, so none of them can carry it. A layout is a server module
 * even when every page beneath it is a client one, so it can.
 *
 * See `src/lib/native/static-params.ts` for why the id is a placeholder and what
 * that does and does not buy.
 */
export function generateStaticParams() {
  return staticParamsForNativeShell()
}

export default function PostcardDetailLayout({ children }: { children: React.ReactNode }) {
  return children
}
