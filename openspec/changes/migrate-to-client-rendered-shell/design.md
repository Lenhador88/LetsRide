# Design — client-rendered shell

## Context

See `proposal.md` — Why. What follows is the current state that shapes the approach, measured
against `main` on 2026-08-05 rather than quoted from documentation.

| Fact | Value | How to re-derive |
|---|---|---|
| Pages | 23, of which **18 render on the server** | first-line match on `'use client'`, not `git grep -L` |
| Components | 53, of which **26 are server components** | same |
| Read functions | 19 in `src/lib/data/` | `git grep -h '^export async function' -- 'src/lib/data/*.ts' \| wc -l` |
| Action functions | **31** in `src/lib/actions/` | same for `actions` — unanchored reports 33, and the two extras are prose at `src/lib/actions/postcards.ts:14,16` |
| `revalidatePath` call sites | 41, across 8 files | `git grep -c revalidatePath -- 'src/lib/actions/*.ts'` |
| `redirect()` call sites in actions | 12, across 5 files | `git grep -c 'redirect(' -- 'src/lib/actions/*.ts'` |
| Route special files | one `error.tsx`, **zero** `loading.tsx` | `git ls-files 'src/app/**/loading.tsx'` |
| Server-only imports | 3 real `next/headers` importers | first-line/import match, not a bare grep |
| `PUBLIC_PROFILE_COLUMNS` sites | 14 query interpolations across 5 `lib/data/` files | `git grep -c PUBLIC_PROFILE_COLUMNS -- src/` |
| Tables with an INSERT policy | 13 | `pg_policy` where `polcmd = 'a'` |
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

### D1 — The accessor is environment-aware, and the server path survives until Phase 4

Each of the 19 read functions calls `createClient()` from `lib/supabase/server`. The change is
to resolve the Supabase client from a module-level accessor, leaving every signature untouched.

**The accessor returns the server client when there is no `document`, and the browser client
when there is.** An earlier revision said "returns the browser client" full stop, and that does
not survive contact: `createBrowserClient` reads `document.cookie`, there is no `document`
during a server render, and 18 server pages plus 26 server components still call the data layer
throughout Phase 2. With `anon` holding zero grants, every read on every screen would fail.
"Isomorphic" and "browser client" are not the same claim, and the difference is whether the app
runs.

The server branch is deleted in Phase 6 with `lib/supabase/server.ts`, not in Phase 2.

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
bounds; `club_members.role`; `profile_countries` membership; private-club ride visibility; the
onboarding participation gate; the column-privilege revoke. Every one pairs with assertions in
`supabase/tests/rls_test.sql` before it is called done, per `openspec/config.yaml`.

**`profiles.avatar_url` is no longer in this list** — see D5. It removes something 14 query
sites read, so it belongs with the code that reads it.

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

**Which tables the gate names, and which it does not.** Thirteen tables carry an INSERT policy;
the gate names eight. Content and moderation records are gated: `postcards`, `clubs`, `rides`,
`club_members`, `ride_members`, `postcard_comments`, `postcard_likes` and — decided explicitly
rather than left silent — `postcard_reports`. A report names another rider in a record nobody can
triage, and with email confirmation off (decision #6) an account can be created with an address
nobody controls, so an un-onboarded rider filing reports is the cheapest abuse path in the
schema. The five omissions are per-viewer and produce nothing another rider sees: `blocks`,
`postcard_hides`, `feed_reads`, `profile_countries`, and `profiles` itself, which is the row the
wizard writes.

**The same migration closes `012`'s recorded BEFORE INSERT gap.** `012` §KNOWN LIMIT notes its
consent guard is a BEFORE **UPDATE** trigger, unreachable today only because `handle_new_user`
guarantees the row exists so a rider's own INSERT dies on `23505` — and names account deletion
as the event that makes it reachable. This change builds BEFORE INSERT machinery across eight
tables and names account deletion as a Phase 2 dependency, so declining to add the `TG_OP`-guarded
arm here would mean leaving a known hole open while standing next to it with the tools out. The
assertion `012` could not write becomes writable the moment the trigger exists.

### D5 — `profiles.avatar_url` is dropped rather than constrained, and the drop ships with its code repair

`014` kept it because nobody could prove it was NULL everywhere. That is now proven — 0 non-NULL
rows across `profiles` and `clubs` — so the column goes: constraining a column nothing writes is
a maintenance burden defending a feature that does not exist. `resolveAvatarUrls` loses its
fallback branch and the data layer keeps its one promise — *`avatar_url` is a URL you can put in
`src`* — as a purely derived value.

**The drop is not a standalone migration and has moved out of Phase 1.** `PUBLIC_PROFILE_COLUMNS`
names the column and is interpolated into 14 query sites across five `lib/data/` files. Applying
the drop alone makes PostgREST return `42703`, `unwrap` throws by design, and every authenticated
screen lands on the error boundary — on a single Supabase project that every environment points
at, with Vercel auto-deploying from `main`. It ships as one unit with the `PUBLIC_PROFILE_COLUMNS`
edit in Phase 2, which is the only phase where the migration and the code that reads it move
together.

This is the general rule for this change and not a special case: **a migration that removes
something the application reads is not an independent migration.** Phase 1 keeps its
"no application change" property precisely because everything left in it is additive.

### D6 — Column exposure is closed by REVOKE plus a `security definer` accessor, not by a view

`terms_accepted_at` and `onboarding_completed_at` must be readable on the caller's own row and
on nobody else's.

**A view alongside the table was the earlier answer and it is wrong.** `public.profiles` stays
published by PostgREST and `authenticated` keeps column-level SELECT on both columns —
confirmed against `information_schema.column_privileges`, where `authenticated` currently holds
SELECT, INSERT *and* UPDATE on each. A view beside the table restricts nothing; anyone can query
the table. It is the application-layer projection this design says it is replacing, moved into
SQL and no stronger for it.

So: `revoke select (terms_accepted_at, onboarding_completed_at) on public.profiles from
authenticated`, and give the two legitimate own-row readers — the route guard and the onboarding
resume step — a `security definer` accessor returning the caller's own stamps and nothing else.
The objection that killed this option was that a REVOKE is not row-aware; the accessor is what
supplies the row-awareness the grant cannot express. INSERT and UPDATE on the two columns go the
same way, since `012`'s trigger already overrides whatever the client sends.

*Alternative.* Move both stamps to a side table with a `user_id = auth.uid()` policy. Cleaner in
the abstract and a data migration on live columns in practice, with `012`'s trigger and `003`'s
guard both to rewrite. Available if the accessor proves awkward; not worth it first.

The accessor is narrower than `moderate_comment`, which the security advisors already accept: it
reads two columns of the caller's own row and takes no arguments.

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
  constraint validated separately is available if any count is non-zero. Two pre-flights are
  already run: private-club rides is 0 violating rows of 3, and the consent gate is **4 of 4
  riders in violation**, which is Q11 rather than a `NOT VALID`.
- **A migration that removes something the app reads will take production down.** → Phase 1 is
  defined as additive-only, and the one removal (`avatar_url`) ships with its code repair in
  phase 2. There is one Supabase project, every environment points at it, and `main`
  auto-deploys — so "apply the migration, fix the code next" is not a sequence that exists here.
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

Six phases. **Only phase 1 is independently landable; phases 2–4 are one continuous unit** and
an earlier revision claiming otherwise was wrong in two places at once, both of which would have
taken production down on a single Supabase project that Vercel auto-deploys from `main`.

What was wrong, recorded because the sequencing is the risky part of this change and a corrected
plan with no memory of the correction invites the same mistake:

- Phase 2 handed the data layer a browser client while 18 server pages and 26 server components
  still called it. No `document` during SSR, `anon` holds zero grants, every read fails. D1 now
  specifies an environment-aware accessor, which is what makes phase 2 landable at all.
- Phase 3 moved the session to device storage while `proxy.ts` still read `request.cookies` —
  every request redirects to login and signing in bounces straight back.

So:

1. **Integrity migrations (`018`+) with RLS assertions.** No application change, and everything
   in it is additive — nothing removes a column, table or grant the app currently reads. Lands
   first because it is the only part that is valuable even if the render migration were
   cancelled. This property is the phase's definition, not a description of it.
2. **Make `src/lib/data/` isomorphic** with the environment-aware accessor, and land the
   `avatar_url` drop together with its `PUBLIC_PROFILE_COLUMNS` repair (D5). Server rendering
   still works throughout. CLAUDE.md names this as the migration's first step and forbids
   client-first screens before it.
3. **Session and auth**, behind a flag that keeps cookie sessions live until the guard moves.
   Storage adapter, the recovery grant Edge Function, sign-out clearing local state, `/auth/*`
   screens.
4. **Screens, one route group at a time** — postcards, rides, clubs, profile — each converting
   its pages, components, states and invalidation together. **The route guard moves with the
   first group**, because the cookie/device-storage split cannot straddle a merge.
5. **Retire `proxy.ts` as a boundary.** Only after every rule it holds has a database
   counterpart — which is phase 1's job, and is why this is late.
6. **Delete the server render path.** `lib/supabase/server.ts`, the accessor's server branch,
   the callback Route Handler, `@supabase/ssr`.

**Every phase boundary is a deploy to production.** The test for whether a phase is done is not
"does it compile" but "would `main` still serve every screen if this were the last thing
merged".

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
| Q11 | ~~**No rider on this database has a consent record**, so the gate would lock out every existing rider.~~ **Answered 2026-08-05 by the product owner.** | **No backfill** — a fabricated consent record is worse than a missing one, and `012` already argues that evidence a party can write is not evidence. The gate ships. Q12 collapsed the population: of 4 accounts, **2 are `.test` fixtures** already marked for deletion before launch, **1 is an abandoned signup** that never onboarded and therefore cannot participate anyway, and **1 is the product owner**, who re-accepts. So this is a single consent prompt for a rider whose stamp is NULL — not a rollout, and not a re-consent *flow*. It must exist before 1.12 becomes blocking. | No — resolved | PO |
| Q12 | ~~Why is `terms_accepted_at` NULL for riders who signed up through an action that writes it?~~ **Answered 2026-08-05: provenance, not a broken write.** | The owner signed up 2026-07-31, two days before `003_onboarding` applied — no consent write existed yet. `duskrider` and `qa-verify` were SQL-inserted into `auth.users` and never went through `signUp`; both are documented as such in `docs/HANDOFF.md`. The fourth (2026-08-04) has no consent, no username, no onboarding **and no sign-in**, which is the exact shape of `signUp`'s own documented failure path — it writes the stamp immediately after `auth.signUp()` and returns an error if the write is refused. **The finding underneath: no rider has ever completed the current signup flow on this database**, so the one path every rider takes is unproven end to end. Needs an email domain the owner controls, which is why it has never been done. | No — resolved | Eng, then PO to exercise |
