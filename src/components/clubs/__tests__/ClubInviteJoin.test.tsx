import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Stands in for a provider rather than for behaviour: the screen calls
// `useRouter` to leave for the club it just joined, and that throws outside a
// Next tree. Nothing here navigates, and no effect runs under a static render.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))

// Counted rather than stubbed away. A static render runs no effects, so this
// standing at zero says only that nothing claims *during render* — the source
// assertions below are what cover the effect and listener paths.
const claim = vi.fn()
vi.mock('@/lib/actions/club-invite-links', () => ({
  claimClubInviteLink: claim,
  createClubInviteLink: vi.fn(),
  revokeClubInviteLink: vi.fn(),
}))

const { ClubInviteJoin } = await import('@/components/clubs/ClubInviteJoin')

/**
 * **Comment-stripped, and that is not tidiness** — `RideInviteJoin.test.tsx`'s
 * own trap, copied exactly. The component's docstring says "there is no
 * `useEffect` in this file", so a bare `toContain('useEffect')` matches its
 * own obituary and fails against a correct file. Every assertion below reads
 * the executing source.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const SOURCE = stripComments(
  readFileSync(
    path.resolve(fileURLToPath(new URL('../ClubInviteJoin.tsx', import.meta.url))),
    'utf8'
  )
)

/**
 * **The claim is a tap, always** — `091`'s rule, generalised by `093`,
 * PD-360, and the one contract on this screen no assertion in
 * `supabase/tests/` could ever hold. See `RideInviteJoin.test.tsx`'s own
 * header for the full argument, which transfers whole: a stash is a string in
 * a browser, and the rider who signs in is not necessarily the rider who
 * opened the link.
 *
 * Two halves, because neither is sufficient — the render half proves no claim
 * is issued while the screen paints, and the source half proves it for the
 * paths a static render cannot reach at all.
 */
describe('ClubInviteJoin — a claim is a tap and nothing else', () => {
  it('issues no claim while rendering, with or without a session', () => {
    claim.mockClear()
    renderToStaticMarkup(<ClubInviteJoin token={undefined} />)
    renderToStaticMarkup(<ClubInviteJoin token={null} />)
    renderToStaticMarkup(<ClubInviteJoin token={'a'.repeat(32)} />)
    expect(claim).not.toHaveBeenCalled()
  })

  it('wires the claim to exactly one call site, inside the tap handler', () => {
    const calls = SOURCE.match(/claimClubInviteLink\(/g) ?? []
    // One call. Not the import — that line is `claimClubInviteLink }` with no
    // paren — so a second match means a second caller.
    expect(calls).toHaveLength(1)

    const handler = SOURCE.slice(SOURCE.indexOf('function join()'))
    expect(handler).toContain('claimClubInviteLink(')
    expect(SOURCE).toContain('onClick={join}')
  })

  it('contains no effect and no session listener that could spend the token', () => {
    expect(SOURCE).not.toContain('useEffect')
    expect(SOURCE).not.toContain('onAuthStateChange')
  })
})

/**
 * **A visitor with no session sees no club, from any source.**
 *
 * `/clubs/join` is public so the page can hold a credential across the auth
 * round trip, never so it can show anything — the copy must be identical for
 * a live token and a dead one, because the screen cannot tell them apart
 * without asking the database and it does not ask.
 */
describe('ClubInviteJoin — nothing about the club escapes without a session', () => {
  it('renders no club data for any token it is handed', () => {
    for (const token of [undefined, null, 'b'.repeat(32)] as const) {
      const html = renderToStaticMarkup(<ClubInviteJoin token={token} />)
      expect(html).not.toContain('Join club')
      expect(html).not.toContain('Private club')
    }
  })
})
