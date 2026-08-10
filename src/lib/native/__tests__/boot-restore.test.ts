import { describe, expect, it } from 'vitest'
import { bootRestoreTarget } from '@/lib/native/boot-restore'
import { PUBLIC_PATHS, resolveDestination } from '@/lib/auth/guard'
import { routes } from '@/lib/routes'

/**
 * The cold-start restore, which is the whole of PD-142's group 3 under the
 * shape that shipped. `boot-restore.ts` carries why it is a pure function; what
 * these cases pin down is the three properties it must not break — no behaviour
 * change on the web, no redirect loop, and no existence oracle.
 */

const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash })

describe('bootRestoreTarget', () => {
  it('does nothing at the root, which is every web page load', () => {
    // The whole web-side safety argument in one case: a deployment serves `/`'s
    // document for `/` and for nothing else, so this is the only shape the web
    // build ever reaches and the answer is always "stay".
    expect(bootRestoreTarget(at('/'))).toBeNull()
  })

  it('does nothing at the root even with a query or a hash on it', () => {
    // `/?error=…` and `/#x` are still `/`'s own document. Restoring here would
    // be a `router.replace` to the URL the router is already on — the shape that
    // makes a guard's splash permanent.
    expect(bootRestoreTarget(at('/', '?from=push'))).toBeNull()
    expect(bootRestoreTarget(at('/', '', '#section'))).toBeNull()
  })

  it('restores a detail deep link with its id intact', () => {
    const id = '8d6e4c1a-2b3f-4a5b-9c8d-1e2f3a4b5c6d'
    expect(bootRestoreTarget(at('/rides/detail', `?id=${id}`))).toBe(routes.ride(id))
    expect(bootRestoreTarget(at('/clubs/detail/members', `?id=${id}`))).toBe(
      routes.clubMembers(id)
    )
  })

  it('restores every other route too, not only the detail ones', () => {
    // A webview process restore can land anywhere the rider was, and the tab
    // roots are where they usually were.
    expect(bootRestoreTarget(at('/postcards'))).toBe('/postcards')
    expect(bootRestoreTarget(at('/legal/privacy'))).toBe('/legal/privacy')
    expect(bootRestoreTarget(at('/onboarding/username'))).toBe('/onboarding/username')
  })

  it('keeps the hash, which is the only part a server never sees', () => {
    expect(bootRestoreTarget(at('/rides/detail', '?id=x', '#crew'))).toBe(
      '/rides/detail?id=x#crew'
    )
  })

  it('never answers with the path it was given at the root, so it cannot loop', () => {
    // A redirect loop needs the target to equal the current URL. The only
    // pathname that could produce that is `/`, and it is the one case that
    // answers null — asserted here rather than left to the reader, because
    // "replace with where you already are" is how `trailingSlash: true` made
    // the guard's splash permanent (design.md §D2).
    for (const path of ['/', '/postcards', '/rides/detail', '/legal/terms']) {
      const target = bootRestoreTarget(at(path))
      expect(target === path && path === '/').toBe(false)
      if (target !== null) expect(target).toBe(path)
    }
  })

  it('consults nothing — no id list, no route list, no database', () => {
    // `native-static-bundle`: a mechanism that resolves a known id and refuses
    // an unknown one is an existence oracle, and it answers before any session
    // is even read. Every one of these is restored identically, including two
    // that name nothing and one that is not a route at all.
    for (const search of [
      '?id=8d6e4c1a-2b3f-4a5b-9c8d-1e2f3a4b5c6d',
      '?id=00000000-0000-0000-0000-000000000000',
      '?id=not-a-uuid',
      '',
    ]) {
      expect(bootRestoreTarget(at('/clubs/detail', search))).toBe(`/clubs/detail${search}`)
    }
    expect(bootRestoreTarget(at('/no/such/route'))).toBe('/no/such/route')
  })
})

describe('the restore does not step past the route guard', () => {
  it('cannot run at all until the guard has allowed the path', () => {
    // Not a property of `bootRestoreTarget` — a property of where it is called.
    // `RouteGuard` renders the splash *instead of* children while it has a
    // destination, so `/`'s page never mounts for a rider the guard is sending
    // elsewhere. This case pins the guard half: a deep link into a protected
    // route with no session resolves to login, so the restore never fires.
    expect(resolveDestination('/rides/detail', { kind: 'anonymous' })).toBe('/auth/login')
    expect(resolveDestination('/clubs/detail/edit', { kind: 'anonymous' })).toBe('/auth/login')
  })

  it('adds no public path — the deep link needs a destination, not an exemption', () => {
    // `.claude/agents/native.md`: "a link into a protected route lands on the
    // guard, not the screen; that is correct behaviour and the link needs a
    // post-auth destination, not a new public path."
    for (const path of Object.values(routes).map((build) => build('x').split('?')[0])) {
      expect(PUBLIC_PATHS, path).not.toContain(path)
    }
  })

  it('leaves an onboarded rider on the deep link, so the restore can happen', () => {
    const onboarded = {
      kind: 'rider' as const,
      terms_accepted_at: '2026-08-01T00:00:00Z',
      onboarding_completed_at: '2026-08-01T00:00:00Z',
      has_username: true,
    }
    expect(resolveDestination('/rides/detail', onboarded)).toBeNull()
    expect(resolveDestination('/clubs/detail/about', onboarded)).toBeNull()
  })
})
