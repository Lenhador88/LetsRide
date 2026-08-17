import { Button } from '@/components/ui/Button'

/**
 * The one `notFound()` boundary for every screen under `(app)` — task 4.1.
 *
 * Before this, `notFound()` fell through to Next's built-in 404 UI: unstyled,
 * outside the v2 design system entirely, and the same page for every one of
 * `rides/detail`, `postcards/detail`, `profile/detail` and
 * `clubs/detail/members`'s already-shared `notFound()` calls — which is the
 * right SHAPE (D11's "reveal nothing about existence" already made every
 * cause of a missing row indistinguishable before this file existed) with
 * the wrong WORDS: Next's default says "This page could not be found",
 * which reads as a broken link rather than as an answer.
 *
 * **The copy is deliberately generic across all four causes account
 * deletion adds to the existing two** (never-existed, and a private
 * resource the viewer cannot see): a deleted account, a departed
 * postcard/comment, a block in either direction. `account-erasure-cascade`'s
 * own requirement names the two things this must never say — "you do not
 * have permission" (a different and wrong explanation of the same zero
 * rows) and "this account was deleted" (which discloses a person to someone
 * who may have blocked them) — and this says neither, for any of the six
 * causes, because nothing here can tell them apart and telling them apart
 * is exactly what decision #1 and D11 refuse.
 *
 * Sits at `(app)/not-found.tsx` rather than the app root: it renders inside
 * `(app)/layout.tsx`, so the bottom nav bar and the background gradient stay
 * mounted around it — the same reasoning `(app)/error.tsx` gives for living
 * at this level rather than higher. No header of its own, matching that
 * file: the screen that triggered this is the one thing that is gone, so
 * there is no title, sub-page switcher or back segment left to draw one
 * from.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-foreground">This isn’t available</h1>
      <p className="text-sm text-muted">
        It may have moved, or it may no longer exist.
      </p>
      <Button href="/postcards" size="md" className="mt-2 w-auto">
        Back to Postcards
      </Button>
    </div>
  )
}
