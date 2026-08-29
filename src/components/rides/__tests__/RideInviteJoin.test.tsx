import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Stands in for a provider rather than for behaviour: the screen calls
// `useRouter` to leave for the ride it just joined, and that throws outside a
// Next tree. Nothing here navigates, and no effect runs under a static render.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))

// Counted rather than stubbed away. A static render runs no effects, so this
// standing at zero says only that nothing claims *during render* — the source
// assertions below are what cover the effect and listener paths.
const claim = vi.fn()
vi.mock('@/lib/actions/ride-invite-links', () => ({
  claimRideInviteLink: claim,
  createRideInviteLink: vi.fn(),
  revokeRideInviteLink: vi.fn(),
}))

const { RideInviteJoin } = await import('@/components/rides/RideInviteJoin')

/**
 * **Comment-stripped, and that is not tidiness** — it is CLAUDE.md's
 * most-repeated measurement error, in miniature. The component's own docstring
 * says "there is no `useEffect` in this file", so a bare `toContain('useEffect')`
 * matches its own obituary and fails against a correct file. Every assertion
 * below reads the executing source.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const SOURCE = stripComments(
  readFileSync(
    path.resolve(fileURLToPath(new URL('../RideInviteJoin.tsx', import.meta.url))),
    'utf8'
  )
)

/**
 * **The claim is a tap, always** — `091`, PD-330, and the one contract on this
 * screen that no assertion in `supabase/tests/` could ever hold.
 *
 * A stash is a string in a browser, and the rider who *signs in* is not
 * necessarily the rider who *opened the link*. An abandoned sign-up followed by
 * somebody else signing into the same tab, plus a claim issued the moment a
 * session appears, joins **that second rider** to a private ride they were never
 * told about — with a `ride_members` row and a `ride_joined` notification naming
 * them. At the database layer that is a perfectly **valid** claim: the caller is
 * authenticated, onboarded and unblocked, and the token is live. No policy,
 * trigger or RLS assertion can distinguish it from the intended one. Only the
 * client contract can, so only a test of the client can keep it.
 *
 * Two halves, because neither is sufficient:
 *
 * - **The render half** proves no claim is issued while the screen paints, in
 *   the two states a shortcut would be written into — signed out, and a live
 *   preview sitting in front of a rider who has not tapped.
 * - **The source half** proves it for the paths a static render cannot reach.
 *   `renderToStaticMarkup` runs no effects at all, so a `useEffect` that claims
 *   would pass the render half in silence. The file therefore carries **no
 *   `useEffect` and no `onAuthStateChange`**, and exactly one call site, inside
 *   the click handler.
 *
 * `environment: 'node'`, like every other component test here — no layout, no
 * events, and no way to press the button. What is asserted is that the button
 * *is* the only thing wired to it.
 */
describe('RideInviteJoin — a claim is a tap and nothing else', () => {
  it('issues no claim while rendering, with or without a session', () => {
    claim.mockClear()
    // `token: undefined` is the page still resolving it; `null` is a bare
    // /rides/join. Neither may reach the RPC, and neither may a signed-out
    // visitor — `useSignedIn` answers `undefined` under a static render, which
    // is the not-yet state.
    renderToStaticMarkup(<RideInviteJoin token={undefined} />)
    renderToStaticMarkup(<RideInviteJoin token={null} />)
    renderToStaticMarkup(<RideInviteJoin token={'a'.repeat(32)} />)
    expect(claim).not.toHaveBeenCalled()
  })

  it('wires the claim to exactly one call site, inside the tap handler', () => {
    const calls = SOURCE.match(/claimRideInviteLink\(/g) ?? []
    // One call. Not the import — that line is `claimRideInviteLink }` with no
    // paren — so a second match means a second caller.
    expect(calls).toHaveLength(1)

    // The handler the Join button's `onClick` names, and the call inside it.
    const handler = SOURCE.slice(SOURCE.indexOf('function join()'))
    expect(handler).toContain('claimRideInviteLink(')
    expect(SOURCE).toContain('onClick={join}')
  })

  it('contains no effect and no session listener that could spend the token', () => {
    // The structural half of the rule. An effect here would be invisible to the
    // render assertion above, and `onAuthStateChange` is the specific shortcut
    // `design.md` §A claim is always a tap refuses permanently.
    expect(SOURCE).not.toContain('useEffect')
    expect(SOURCE).not.toContain('onAuthStateChange')
  })
})

/**
 * **A visitor with no session sees no ride, from any source.**
 *
 * The route is public so the page can hold a credential across the auth round
 * trip, never so it can show anything — and the tempting version of this screen
 * is the one that names the ride to make the link feel worth following. The
 * copy must therefore be identical for a live token and a dead one, because the
 * screen cannot tell them apart without asking the database and it does not ask.
 *
 * Under a static render `useSignedIn` answers `undefined`, which is the
 * not-yet state and draws the skeleton — so what this asserts is the weaker,
 * still worth having, property that no ride data reaches the markup in the
 * states reachable here, whatever token is handed in.
 */
describe('RideInviteJoin — nothing about the ride escapes without a session', () => {
  it('renders no ride data for any token it is handed', () => {
    for (const token of [undefined, null, 'b'.repeat(32)] as const) {
      const html = renderToStaticMarkup(<RideInviteJoin token={token} />)
      // The preview's own fields never reach a screen that has not read one.
      expect(html).not.toContain('is organizing')
      expect(html).not.toContain('Join this ride')
    }
  })
})
