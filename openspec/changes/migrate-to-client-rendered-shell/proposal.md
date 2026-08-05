# Migrate the render model to a client-rendered shell

## Why

**Store presence is a business requirement** and background location tracking is on the
roadmap. Neither is reachable from the web platform: an installed PWA is not a store listing,
and no browser on any OS will run JavaScript once the app is backgrounded, which is exactly
when a rider's track needs recording. The app therefore has to become bundleable into a native
Capacitor shell, and a Capacitor shell can only load a client-rendered bundle.

This is decision #8 read literally, not a departure from it. The client talks to Supabase
directly, under the same RLS policies, with the same publishable key that already ships in the
bundle today. What moves is the *render side*; the security posture does not move at all.

**The decision is taken and is not reopened here.** Two alternatives were rejected:

- **A Capacitor shell pointing at the remote Vercel URL.** The app shell becomes a network
  dependency at precisely the moment a rider has no signal and the app has been backgrounded
  for hours. A native build whose first paint requires a round trip is a worse app than the
  website.
- **A React Native rewrite.** Discards the v2 component library, the Figma-measured geometry
  and every route, to solve a problem that is about *where* rendering happens rather than
  *what* renders.

## What Changes

**The boundary that must not move.** `src/lib/data/` and `src/lib/actions/` keep their
function names and signatures. Inside them, only the Supabase client construction changes
(server client → browser client). No RLS policy changes as part of the render migration —
the migrations this change *does* propose are additive integrity constraints, driven by the
audit below, not by the render model.

- Server components become client components. **18 server pages and 26 server components**
  today (`for f in $(git ls-files 'src/app/**/page.tsx'); do [ "$(head -1 "$f")" = "'use client'" ] && echo x; done | wc -l` against the file count — see Impact for why the
  `git grep -L` form undercounts).
- **`revalidatePath` → client-side cache invalidation.** 41 call sites across 8 action files
  (`git grep -c revalidatePath -- 'src/lib/actions/*.ts'`). This is the least glamorous third
  of the work and the part most likely to be under-estimated: each call site is a *statement
  about which screens are now stale*, and that statement has to survive the move.
- **Sessions move from httpOnly cookies (`@supabase/ssr`) to `@supabase/supabase-js` with a
  device secure-storage adapter** — Keychain on iOS, EncryptedSharedPreferences/Keystore on
  Android. Not plain `localStorage`. **BREAKING** for the recovery flow: `/auth/callback` is
  a Route Handler and `updatePassword` gates on an httpOnly cookie a client cannot read.
- **`proxy.ts` becomes a client route guard** — a UX affordance, not a security boundary.
- **New database constraints** for every integrity rule that currently lives only in a Zod
  schema a Server Action parses. Once the client owns the mutation path, a Zod-only rule is
  advisory. The audit that produced them also found three defects that are **live today**, not
  created by this migration, because the publishable key already ships in the bundle and
  PostgREST accepts any rider's JWT: role self-assignment on `club_members`, unbounded text on
  ten columns, and a private club's ride being publicly visible. The migration is where they
  get fixed; it is not where they start.

**Explicitly not in this change:** the Capacitor shell itself (config, plugins, permission
strings, deep links, signing, store upload) is Phase 2 with its own proposal and its own
agent; the offline sync/queue layer is a follow-on this migration *enables* and does not
deliver; **account deletion is on the product owner's backlog** and is noted here only as a
hard dependency for store submission, since both app stores require it for an account-creating
app.

## Capabilities

### New Capabilities

- `client-render-shell`: every authenticated screen renders in the browser/webview from a
  static bundle. Owns the state contract each screen must satisfy — empty, loading, error,
  offline, permission-denied, partial, stale — and the route guard's demotion from security
  boundary to UX affordance.
- `client-session-storage`: session persistence in device secure storage, the replacement for
  the httpOnly recovery marker, sign-out semantics, and what mitigates a JS-readable token.
- `database-enforced-integrity`: every write rule that must hold when the client is the only
  caller. Migrates the Zod-only rules into CHECK constraints and closes the write gaps the
  audit found (`club_members.role`, `profiles.avatar_url`).
- `client-cache-invalidation`: what a screen shows after a mutation, how stale data is
  detected, and what the 41 `revalidatePath` statements become.

### Modified Capabilities

None — `openspec/specs/` is empty. This is OpenSpec's first use in the repo, so every
capability here is new even where the behaviour it describes is old.

## Impact

**Code.** `src/app/**` (all 23 pages), `src/components/**` (53 files, 26 of them server
components today), `src/lib/supabase/{client,server}.ts`, `src/proxy.ts`,
`src/app/auth/callback/route.ts`, `src/lib/auth/recovery.ts`, and the internals — not the
signatures — of 19 functions in `src/lib/data/` and **31** in `src/lib/actions/`.

**Database.** New migrations, append-only from `018`. `001`–`017` are applied and the repo and
the hosted schema agree (`list_migrations` against `ls supabase/migrations/`, run
2026-08-05 — note CLAUDE.md still says `001`–`016`, which is one behind: `017_rides_club_audience` is applied).

**Dependencies.** `@supabase/ssr` leaves the runtime path once nothing renders on the server;
`@supabase/supabase-js` stays and gains a storage adapter. Net dependency count does not rise.

**Tests.** Every new constraint pairs with assertions in `supabase/tests/rls_test.sql`, per
`openspec/config.yaml`. The RLS suite is the only test layer this change strengthens rather
than disturbs — it runs against Postgres and knows nothing about the render model.

**A measurement trap, recorded because it bit this proposal twice.** The scope command in
common use —
`git grep -L "'use client'" -- 'src/app/**/page.tsx'` — reports **16** server pages. The true
figure is **18**: `clubs/new/page.tsx` and `rides/new/page.tsx` are server pages whose *doc
comments* contain the string `'use client'`, so `grep -L` excludes them. Match the first line,
not the file. The same trap makes `git grep -ln next/headers` report four importers where
there are three (`src/lib/data/columns.ts` only mentions it in a comment).

It then bit this document: an earlier revision said **33** action functions, which is the
unanchored count. Anchored, it is **31** — `src/lib/actions/postcards.ts:14,16` are prose
inside a doc comment explaining that a `'use server'` module may only export async functions.
Every count in `design.md`'s table is now `^`-anchored. The lesson is not "be careful"; it is
that the anchored form is the only form worth writing down.
