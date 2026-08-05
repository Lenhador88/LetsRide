# Design — client-rendered shell

## Context

See `proposal.md` — Why. What follows is the current state that shapes the approach, measured
against `main` on 2026-08-05 rather than quoted from documentation.

| Fact | Value | How to re-derive |
|---|---|---|
| Pages | 23, of which **18 render on the server** | first-line match on `'use client'`, not `git grep -L` |
| Components | 53, of which **26 are server components** | same |
| Read functions | 19 in `src/lib/data/` | `git grep -c 'export async function' -- 'src/lib/data/*.ts'` |
| Action functions | 33 in `src/lib/actions/` | same for `actions` |
| `revalidatePath` call sites | 41, across 8 files | `git grep -c revalidatePath -- 'src/lib/actions/*.ts'` |
| `redirect()` call sites in actions | 12, across 5 files | `git grep -c 'redirect(' -- 'src/lib/actions/*.ts'` |
| Route special files | one `error.tsx`, **zero** `loading.tsx` | `git ls-files 'src/app/**/loading.tsx'` |
| Server-only imports | 3 real `next/headers` importers | first-line/import match, not a bare grep |
| Migrations | `001`–`017`, all applied, no drift | `list_migrations` vs `ls supabase/migrations/` |

Three constraints shape everything below.

1. **`src/lib/data/` and `src/lib/actions/` keep their names and signatures.** This is the
   whole reason the migration is bounded. It is also already half-true: `columns.ts`,
   `unwrap.ts` and `lib/media/constants.ts` are deliberately import-free so a client component
   can use them, and `lib/media/` is browser-only already.
2. **RLS is untouched by the render change.** The policies do not know which process issued the
   statement. Every migration this change proposes comes from the integrity audit, not from the
   render model.
3. **The design has no answer for the states client rendering introduces.** Zero `offline` or
   `error` frames in a 438-frame snapshot; the two `empty` frames are archived. That is a
   question for the designer, not a gap to fill screen by screen.

## Goals / Non-Goals

**Goals**

- Make `src/lib/data/` isomorphic — same functions, callable from a client component — as the
  first step, because CLAUDE.md forbids building a client-first screen before it.
- Close the integrity gaps that a client-owned mutation path turns from theoretical into
  ordinary, in migrations, with paired RLS assertions.
- Convert the 41 `revalidatePath` claims into cache keys without losing any of them.
- Keep one bundle that runs in a browser and in a webview, so the web app stays testable.

**Non-Goals**

- The Capacitor shell, plugins, permission strings, deep links, signing and store upload.
- Durable offline queuing and conflict resolution.
- Account deletion — the product owner's backlog. It is a **hard dependency for store
  submission**, since both stores require in-app account deletion for an app that creates
  accounts, so it blocks Phase 2 even though it blocks nothing here.
- Realtime subscriptions. The Inbox epic owns that.
- Reopening `APP_TIME_ZONE`, the maps decision, or decision #8.

## Decisions

### D1 — Make the data layer isomorphic by injecting the client, not by duplicating it

Each of the 19 read functions calls `createClient()` from `lib/supabase/server`. The change is
to resolve the Supabase client from a module-level accessor that returns the browser client,
leaving every signature untouched.

*Alternatives.* A `data/server/` and `data/client/` pair doubles 19 functions and guarantees
drift. Passing the client as a first argument changes 19 signatures and every call site, which
is exactly the boundary the proposal says must not move.

### D2 — One session adapter, resolved at runtime, defaulting to the strongest store available

`@supabase/supabase-js` takes a `storage` option. The adapter is chosen once at client
construction: secure store in the native shell, an explicitly-labelled weaker store in a plain
browser. `@supabase/ssr` leaves the runtime path when the last server render does.

*Alternative.* Keeping `@supabase/ssr` and cookies inside the webview appears to preserve the
httpOnly property, but a webview cookie jar is not a secure store, is not encrypted at rest, and
does not survive the platform's own cookie eviction. It buys a familiar API and loses the
guarantee people think it keeps.

### D3 — The recovery grant becomes a server-issued proof, not a client-held flag

The httpOnly `lr-recovery` cookie cannot survive. Of the three replacements considered:

- **A flag in device storage set after seeing a recovery link.** Rejected. The client writes it,
  so it proves nothing.
- **Require the current password on the reset screen.** Rejected. It defeats the flow's entire
  purpose — the rider is there because they do not know it.
- **Chosen: an Edge Function exchanges the recovery code and returns a short-lived, single-use
  grant the password update requires.** It keeps the property today's cookie has — the ability
  to reset is spent by the reset — with the secret on the server side. This is the first of the
  three or four Edge Functions the roadmap ever needs, and it arrives for a reason rather than
  as scaffolding.

### D4 — Constraints go in `018`+, one migration per concern, each with assertions

Append-only from `018`. Split by concern so a single failure does not block the rest: text
bounds; `club_members.role`; `profiles.avatar_url`; `profile_countries` membership; the
onboarding participation gate. Every one pairs with assertions in `supabase/tests/rls_test.sql`
before it is called done, per `openspec/config.yaml`.

**The onboarding gate is the one with a real design choice in it.** A `WITH CHECK` addition on
six INSERT policies is six policy edits to keep in step; a `BEFORE INSERT` trigger calling a
`security definer` helper is one rule in one place. The helper reads the caller's own
`profiles` row, which the caller can already read, so it is `security definer` for stability
rather than for privilege — a narrower case than `moderate_comment`, which the advisors already
accept.

*Alternative considered and rejected:* leaving the gate to the client guard and accepting that
decision #5 becomes advisory. That is precisely the "unstated negative becomes whatever the
author assumed" failure `openspec/config.yaml` exists to prevent, and here it would not even be
unstated — it would be knowingly dropped.

### D5 — `profiles.avatar_url` is dropped rather than constrained

`014` kept it because nobody could prove it was NULL everywhere. That is now provable with one
query against the live project, and if it is empty the column should go: constraining a column
nothing writes is a maintenance burden defending a feature that does not exist. If it is not
empty, the values are migrated into `avatar_path` where they can be, and the column is dropped
after. Either way `resolveAvatarUrls` loses its fallback branch and the data layer keeps its
one promise — *`avatar_url` is a URL you can put in `src`* — as a purely derived value.

### D6 — Column exposure is closed with a view, not a column-level REVOKE

`terms_accepted_at` and `onboarding_completed_at` must be readable on the caller's own row and
on nobody else's. Column privileges cannot express "own row only", so a `REVOKE` breaks the
guard's own read. A `security invoker` view exposing `PUBLIC_PROFILE_COLUMNS` for other riders,
with own-row reads going to `profiles` directly, expresses it exactly and keeps the RLS
predicate as the single source of row visibility.

*Alternative.* Leave it as an application-layer projection, as today. Rejected on the grounds
that the whole point of this change is that application-layer projections stop being
guarantees.

### D7 — Loading states are one treatment applied to four screen shapes

Deck, list, detail, form. The design specifies none of them, so building 23 bespoke ones would
be 23 guesses to unpick when the designer answers. One treatment per shape is four.

### D8 — The route guard keeps its denylist shape

A denylist of public paths, as `proxy.ts` has today, so a new route is guarded by default. The
guard's job shrinks to "do not render a screen the rider cannot use"; every rule it enforces
must already be guaranteed in Postgres.

## Risks / Trade-offs

- **The refresh token becomes JS-readable.** → Secure storage rather than `localStorage`, a
  webview CSP admitting only the app origin and the Supabase origin, no third-party scripts in
  the authenticated tree, and refresh-token rotation. Stated plainly: this is a genuine
  reduction from httpOnly, accepted because a native build has no alternative, and it is the
  reason the no-third-party-script rule becomes a hard rule rather than a preference.
- **41 invalidation claims migrated by hand.** → Migrate action-file by action-file with the
  old `revalidatePath` list in the diff, so a reviewer can see which routes each one replaced.
  The failure mode is silent staleness, which no test currently catches.
- **The integrity migrations can reject data that already exists.** → Every constraint gets a
  pre-flight count of violating rows before it is written, the way `013` did. A `NOT VALID`
  constraint validated separately is available if any count is non-zero.
- **The onboarding gate could strand a rider mid-wizard.** → It restricts writes only; reads are
  untouched, and the two onboarding writes are updates to the rider's own `profiles` row, which
  the gate does not cover. **There is one live un-onboarded rider** (1 of 4 profiles,
  `username` NULL, 2026-08-05) and they own zero postcards, clubs, rides, memberships and
  comments — so the gate has nothing to reject retroactively, and the pre-flight is the query
  that proves it rather than the assumption that it must be so.
- **The web app gets slower to first paint.** → Accepted. The native shell is the target and it
  ships its bundle locally; the web build is the development and testing surface.
- **The free-tier project auto-pauses after ~7 days idle.** → Unchanged by this work, but a
  native app whose backend is asleep fails harder than a website that is down. Pro before
  anything resembling a store submission.

## Migration Plan

Six phases, each independently landable and each leaving the app working.

1. **Integrity migrations (`018`+) with RLS assertions.** No application change. Lands first
   because it is the only part that is valuable even if the render migration were cancelled.
2. **Make `src/lib/data/` isomorphic.** Signatures unchanged; CLAUDE.md names this as the
   migration's first step and forbids client-first screens before it.
3. **Session and auth.** Storage adapter, the recovery grant Edge Function, sign-out clearing
   local state, `/auth/*` screens.
4. **Screens, one route group at a time.** Postcards, rides, clubs, profile. Each converts its
   pages and components, adds its states, and moves its actions' invalidation together, so no
   screen is half-migrated across a merge.
5. **Retire `proxy.ts` as a boundary.** Only after every rule it holds has a database
   counterpart — which is phase 1's job, and is why this is late.
6. **Delete the server render path.** `lib/supabase/server.ts`, the callback Route Handler,
   `@supabase/ssr`.

**Rollback.** Phases 2–6 are ordinary reverts. Phase 1 is not: migrations are append-only, so a
constraint that proves too strict is relaxed by a further migration, never by editing `018`.

## Open Questions

Each carries a recommended default so the build is never blocked on an answer. **PO** = product
owner only; **Designer** = the design owner; **Eng** = decidable in the work.

| # | Question | Recommended default | Blocking? | Who |
|---|---|---|---|---|
| Q1 | What do loading, error and offline look like? The snapshot has no frame for any of them. | Build one neutral treatment per screen shape using existing v2 tokens; do not invent per-screen art. | No | Designer |
| Q2 | Does a private club a rider cannot see read as "unavailable" or as not-found? | "Unavailable", revealing nothing about existence — matching how a malformed id already behaves. | No | Designer + PO |
| Q3 | ~~Is `profiles.avatar_url` NULL everywhere? Decides drop vs constrain (D5).~~ **Answered 2026-08-05**: 0 of 4 `profiles` and 0 of 2 `clubs` rows carry a non-NULL `avatar_url`, and 0 profiles carry an `avatar_path` either. D5's drop is safe with no data migration. | Drop the column in `018`. Re-run the count at apply time — it is a live database and the answer can change. | No — resolved | Eng |
| Q4 | Do the Zod-chosen bounds for `clubs` and `rides` become the real limits? They were never measured from a design. | Adopt them exactly as written; changing a limit is a later migration, and inventing new numbers now doubles the guesswork. | No | PO |
| Q5 | How long may cached postcard images live on the device, and are they encrypted at rest? | Evict on sign-out and on leaving the club; do not extend the 1-hour signed-URL TTL. Encryption at rest is a Phase 2 question. | No | PO (privacy) |
| Q6 | Does the app support more than one signed-in rider per device? | No. One session; sign-out destroys everything local. | No | PO |
| Q7 | Should the client guard degrade gracefully when the session cannot be restored offline? | Yes — a cached session that has not expired lets the shell render; every read still fails closed at RLS. | No | Eng |
| Q8 | Is a plain-browser build still a supported product, or only a development surface? | Development and testing surface only, with the weaker token storage stated. | No | PO |
| Q9 | Account deletion — needed for store submission, on the backlog. | Not in this change. Raise it as its own proposal before Phase 2 starts, because the store will not accept the build without it. | No, here | PO |
| Q10 | Does `club_members.role` ever get an UPDATE path, or does promotion stay impossible? | Stays impossible until the invitations feature designs it. Record the absence rather than adding a policy nothing calls. | No | PO |
