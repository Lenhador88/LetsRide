# View another rider's profile

## Why

A postcard byline names its author and that name goes nowhere. The product owner asked for it
directly (2026-08-14): *"can we make the avatar and name of the poster within the postcard a link
to the respective profile? And if there postcards belongs to a club, same?"*

The club half is already built — `PostcardCard` links the club name to `routes.club(...)`
(commit `1acf956`, on this branch). The rider half cannot be built the same way, because
**there is no route that renders another rider.** `/profile` is own-profile only, and
`src/lib/data/profile.ts` has no `getProfile(userId)`. This change adds that screen and the links
that reach it.

The reason this needs a proposal rather than a straight build is not the screen — it is the
**projection**. Today a rider learns four columns about another rider (`PUBLIC_PROFILE_COLUMNS`
— `id, username, avatar_path, bike_model`). The design's header draws a bio, a cover banner and a
country flag, which widens that to seven columns. **No grant changes and no migration is needed to
do it** — `025` already grants `authenticated` every one of those columns — so this widening is a
one-line edit that no test, policy or advisor would flag. That is exactly the class of change
`openspec/config.yaml` exists to catch: a visibility decision that *"does not fail loudly, it
silently becomes whatever the migration author assumed."*

## What Changes

- **A new route, `/profile/detail?id=<uuid>`**, rendering another rider: cover banner, avatar,
  username, country flags, bio, and their postcard timeline.
- **A new read**, `getProfile(userId)` in `src/lib/data/profile.ts`, going through
  `resolveSupabase` like every other read.
- **A new column allowlist**, `VIEWED_PROFILE_COLUMNS`, naming exactly the columns one rider may
  learn about another. This is the substantive change; see Impact.
- **A new query key**, `queryKeys.profile.detail(userId)`.
- **The postcard byline avatar and username become a link** to that route, in `PostcardCard`.
- **The self-view redirects** to `/profile` rather than rendering a second owner screen.
- **No migration.** Verified against DEV (`fpmrimzxadewsaiwpsel`) — see `design.md` §D1. The
  `profiles` SELECT policy, the `025` column grants, the `profile_countries` policy and the
  `postcards` policy already produce exactly the required rows and columns.
- **Four things the design draws are deliberately NOT built**, and are specified as absent rather
  than left to a builder's judgement: **Follow**, **followers count**, **motorcycles count**, and
  the **Timeline/Garage switcher**. The last requirement in
  `specs/rider-profile-viewing/spec.md` carries them, with the reason each is absent.

  (Deliberately not a `§` citation. Every OpenSpec requirement heading begins with the literal
  word `Requirement:`, so a file-qualified pointer at one is **ambiguous by construction** —
  `scripts/docs/crossrefs.mjs` matches on leading words and cannot tell nine of them apart.
  Naming the surfaces here, where they are already listed, beats a pointer that goes stale or
  turns the cross-reference gate red.)

## Capabilities

### New Capabilities

- `rider-profile-viewing`: who may see another rider's profile screen, what it shows of them,
  what it must never show, and how it behaves in each of its states.

### Modified Capabilities

- `database-enforced-integrity`: adds a requirement governing **projection widening** — that a
  screen shipping more columns of another rider's row than the shared-context allowlist must
  name each added column and state why it is safe. The existing requirement *Every role's reach
  into a rider's identity SHALL be stated* enumerates the reach paths as *"a club roster, a ride
  crew, a postcard byline or Explore"*; a dedicated profile screen is a fifth path and a wider
  projection than any of those four.

**Three standing capabilities were read and are NOT modified**, stated so the omission is a
checked result rather than an unexamined one:

- `client-render-shell` — its requirements already bind every screen, including this one.
  *Permission-denied and empty SHALL be told apart* and its scenario *A blocked rider sees an
  ordinary absence* **already decide this change's blocked case**; the new spec complies rather
  than restating it differently.
- `client-cache-invalidation` — *Counts SHALL stay per-viewer* already governs the postcard count,
  and `blockRider`/`unblockRider` already invalidate everything, which is what evicts a cached
  profile whose subject the viewer may no longer see.
- `client-session-storage` — unchanged; the new route is protected by the guard's denylist by
  default.

## Impact

**Code**

- `src/app/(app)/profile/detail/page.tsx` — new.
- `src/lib/data/profile.ts` — `getProfile(userId)`.
- `src/lib/data/columns.ts` — `VIEWED_PROFILE_COLUMNS`.
- `src/lib/data/__tests__/columns.test.ts` — a new assertion that the new constant is a **subset**
  of `025`'s grant list and contains neither stamp. The existing
  `expect(constant).toEqual(granted)` pins `OWN_PROFILE_COLUMNS` and must keep passing untouched.
- `src/lib/routes.ts` — `detailPaths.profile` and `routes.profile(id)`.
- `src/lib/query/keys.ts` — `profile.detail(userId)`.
- `src/components/postcards/PostcardCard.tsx` — avatar and username become one link.
- `src/lib/validation/` — `profileIdSchema`, matching `rideIdSchema`/`clubIdSchema`.

**Database** — none. No migration, no policy change, no grant change.

**Tests** — no new RLS assertions are *required*, because no policy changes and the suite already
pins every audience claim this screen leans on: NULL-username invisibility (`rls_test.sql:135`),
symmetric blocking (`:592`–`:600`), and the two stamps being unreadable (`:264`+). One assertion
is added as hardening, because this change makes a previously incidental reach load-bearing: that
a rider **sharing no club** with the subject can still read them.

**Risk** — the screen reads a rider who is not the viewer, which is a surface the app has not had
before. The dangerous direction is not the row (RLS decides it) but the **projection** and the
**absent features**: a builder reading the Figma header literally would ship a Follow button, and
`013` dropped `friendships` precisely so that concept does not exist.
