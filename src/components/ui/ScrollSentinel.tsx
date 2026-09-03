'use client'

import { useEffect, useRef } from 'react'

/**
 * The repo's first `IntersectionObserver` — `git grep -n IntersectionObserver
 * -- src/` was 0 before this file, per `design.md` §D1 (PD-375). It has
 * exactly one caller today, the club timeline's scroll-triggered paging;
 * `/clubs/detail/threads` and `/notifications` keeping their `Load more`
 * buttons is a decision (PD-375 scopes the mechanism to the club timeline
 * alone), not an oversight this component's existence somehow argues against.
 *
 * An empty `div`, observed by an `IntersectionObserver` created **in an
 * effect** and disconnected in its cleanup — never during render. The reason
 * is the standing one rather than a preference: a `'use client'` component is
 * still executed by the prerender pass that survives `output: 'export'`,
 * where there is no `window`, so a component that built the observer during
 * render would fail the build rather than the browser
 * (`client-render-shell`'s own requirement, restated for a browser API rather
 * than a `lib/data/` read). Under `renderToStaticMarkup`, where no effect
 * runs, the `div` still renders as ordinary markup and no observer is ever
 * constructed — so a component test needs no jsdom.
 *
 * `rootMargin` defaults to `'600px'` — roughly two entry heights of runway on
 * a phone, a tuning constant with no correctness in it — so the fetch starts
 * before the rider actually reaches the end.
 */
export function ScrollSentinel({
  onVisible,
  rootMargin = '600px',
}: {
  onVisible: () => void
  rootMargin?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The callback closes over component state most render, so it goes through
  // a ref rather than the observer's own dependency array — the same shape
  // `useQuery`'s `fetcherRef` uses, and for the identical reason: re-creating
  // the observer on every render this fires would disconnect and reconnect it
  // mid-scroll for no benefit.
  const onVisibleRef = useRef(onVisible)
  useEffect(() => {
    onVisibleRef.current = onVisible
  })

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisibleRef.current()
      },
      { rootMargin }
    )
    observer.observe(node)
    return () => observer.disconnect()
    // `rootMargin` only: the callback is read through the ref above, so it is
    // deliberately not a dependency — see that ref's own comment.
  }, [rootMargin])

  return <div ref={ref} aria-hidden="true" className="h-px w-full" />
}
