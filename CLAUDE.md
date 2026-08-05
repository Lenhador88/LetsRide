# LetsRide — Project Context for Claude Agents

> **▶ Starting a session? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) now.** This file holds
> the durable context — stack, decisions, conventions. The handoff holds the *current
> position*: what is half-done, what is blocked, and the exact next action. Neither is
> complete without the other, and only this one gets auto-loaded.

LetsRide is a mobile-first web app for motorcycle riders to organise rides, join clubs, and connect with friends. Built with Next.js 16 App Router, Supabase, and Tailwind v4. Targeting thousands of users — prioritise correctness, security, and clean code over cleverness.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript strict) |
| Styling | Tailwind CSS v4 (CSS-first config, no `tailwind.config.*`) |
| Database / Auth | Supabase (Postgres + RLS + `@supabase/ssr`) |
| Icons | The Figma set, generated to `src/components/icons/generated.tsx` (see Design System). `lucide-react` is **gone** — uninstalled 2026-08-05 with the last v1 page |
| Deployment | Vercel (auto-deploy from `main`) |
| CI | GitHub Actions — type check + lint + unit tests + build, and the RLS suite. Path-scoped; see Branching & CI |

## Technology Decisions

*What* we build is under Architectural Decisions. This is *how* — the tooling questions that
otherwise get answered differently in every epic. Drafted 2026-08-02; edit freely, but edit
here rather than deciding again inside a PR.

**Dependencies are added deliberately.** Eight runtime dependencies today, and that is a
feature — `lucide-react` came out with the last v1 page rather than lingering unused. Before adding one, ask whether a thirty-line helper does the job. No UI component
libraries at all — shadcn, Radix and MUI are out; extend `src/components/ui/*` instead.

**Reads go through `src/lib/data/`. Components never call Supabase directly.** Named, typed
functions — `getRide(id)`, `getClubMembers(clubId)` — that own their query shape. Server
components call them directly; they use the server client internally. This exists because 29
`.from()` calls spread across 14 files means a renamed column is 29 places to find, which is
exactly the trap `003` sets by dropping `full_name`. (Counts move — re-derive with
`git grep -c "\.from('" -- 'src/*.ts' 'src/*.tsx'` rather than trusting this line.)

**Writes go through Server Actions**, one per mutation, in `src/lib/actions/`. In order of
weight:

1. RLS enforces *authorization*, never *validity*. Username charset, T&C acceptance and the
   onboarding completion stamp are integrity rules the client must not own.
2. Auth flows have to set cookies. Server Components cannot; Server Actions and Route
   Handlers can. Login, signup and password reset all need this.
3. `useActionState` gives pending and error states without hand-rolled `useState` triples.

The legacy pattern — a client component calling `supabase.from()` then `router.refresh()` —
is v1. `JoinRideButton` was deleted with the ride detail rebuild and `JoinClubButton` became a
Server Action with the club list — which is what "migrate on contact" looks like in practice.
**Nothing is left.** `/clubs/new` and `/rides/new` were the last two, and both became server
pages with Server Actions on 2026-08-05. This line once called `JoinClubButton` "the last one"
while both of those already existed, so count rather than trust it —
`grep -rn "supabase.from(" src/app/ src/components/` returns nothing. Never add more.

**The render model is moving to the client, and the two boundaries above are what make that
affordable.** The app is being migrated to a client-rendered shell so it can be bundled into a
native iOS/Android build: store presence is a product requirement, and background location
tracking is on the roadmap — which the web platform cannot do at all, on any browser, because
JS is suspended the moment the app backgrounds.

What changes is the **render side**: server components become client components,
`revalidatePath` becomes client-side cache invalidation, cookie sessions become device secure
storage, and `proxy.ts` becomes a client route guard rather than a security boundary. What
does **not** change: `src/lib/data/`, `src/lib/actions/`, or a single RLS policy. The client
talks to Supabase directly under the same policies, with the same publishable key that already
ships in the bundle today — so the security posture is unchanged. **This is decision #8 read
literally, not a departure from it.** The backend stays Supabase; a handful of Edge Functions
arrive later for the jobs needing a secret, a schedule or elevated rights (push delivery, ride
reminders, account deletion).

Re-derive the scope rather than trusting a number here — it grows with every epic:

```bash
git grep -l "" -- 'src/app/**/page.tsx' | wc -l                     # pages
git grep -L "^'use client'" -- 'src/app/**/page.tsx' | wc -l        # ... still server-rendered
git grep -L "^'use client'" -- 'src/components/**/*.tsx' | wc -l    # server components
```

**Note the `^` anchor and keep it.** The unanchored version reports 16 server pages against a
real 18: `clubs/new/page.tsx` and `rides/new/page.tsx` both carry doc comments saying they used
to be `'use client'`, so a bare match counts a file's own description of its migration as the
thing it migrated away from. This is the third time that trap has been hit here — after the
`lucide-react` importer count and the v1-token count — and the first version of *this very
block* had it. A directive is only a directive on line one.

**Two rules apply from now, before the migration starts:**

1. **No new integrity rule may live only in a Zod schema.** Once the client owns the mutation
   path, anything not expressed as a CHECK, trigger or policy is advisory. `003` and `012`
   cover onboarding; `bio`, `bike_model` and `location` are the known gap and want a migration.
2. ~~**Do not build a client-first screen ahead of the migration.**~~ **Lifted 2026-08-05 —
   `lib/data/` is isomorphic.** All 19 read functions resolve their Supabase client through
   `src/lib/supabase/resolve.ts`, so a client component can call them today, unchanged. Two
   things to know before you do.

   **The split is a build-time one, not a runtime one.** `lib/supabase/server.ts` imports
   `next/headers`, which Next refuses to bundle into a client graph — and a `typeof document`
   guard around a dynamic `import()` does **not** rescue it, because the bundler resolves the
   specifier statically regardless of whether the branch can be taken. Measured on Next 16.2.9:
   a `'use client'` page importing one read function fails the build with traces through both
   `[Client Component Browser]` and `[Client Component SSR]`. So the discriminator is the
   **`react-server` export condition**, declared as the `#supabase/data-client` subpath import
   in `package.json`, with halves `resolve.rsc.ts` and `resolve.browser.ts`. Server components,
   Server Actions and Route Handlers get the first; both client layers get the second.

   `proxy.ts` gets the server half too, measured — worth knowing, because it reads `profiles`
   on every authenticated request and is the most likely future caller of this layer.

   **Read in an effect or an event handler, never during render.** A `'use client'` component is
   still server-rendered until Phase 6, and in that pass the browser client has no
   `document.cookie` to find a session in — so a read issued from a component body is anonymous,
   and `anon` holds zero grants, so it fails closed at RLS. `src/lib/data/__tests__/isomorphic.test.ts`
   guards the module graph; nothing can guard this one, which is why it is written down.

**Validation: Zod, one schema per concern, shared by both sides.** Lives in
`src/lib/validation/`. A Server Action receives untrusted `FormData` and must parse it; the
client needs the same rules for live feedback. Two hand-written copies of the username rule
will drift, and the one that drifts silently is the server's. This is the only new runtime
dependency this section introduces. Per rule 1 above, Zod owns the **message**, never the
**guarantee** — the database owns that.

**Forms are hand-rolled** — controlled inputs plus `useActionState`. No React Hook Form or
Formik; the forms in this app are one to three fields.

**Tests:**

| Kind | Tool | Status |
|---|---|---|
| RLS policies | `supabase/tests/` — psql against Postgres 17 | In place; gates every PR that touches `supabase/**` |
| Units — validation, `lib/utils.ts`, `lib/data/` | Vitest — `npm run test:unit` | In place; gates every PR that touches code. Covers `lib/validation/`, `lib/media/`, `getInitials` and `safeNext`; `lib/data/` and `lib/actions/` are not covered yet |
| End-to-end | Playwright | Deferred until a flow is stable enough to be worth maintaining |

Chromium is pre-installed at `/opt/pw-browsers`; never run `playwright install`.

**Versions.** `package-lock.json` is committed and CI runs `npm ci`, so what ships is already
pinned — this policy governs what moves on a routine `npm install`. Pin exact for anything
the framework or auth depends on: `next`, `eslint-config-next`, `react`, `react-dom`,
`@supabase/ssr`, `@supabase/supabase-js`. Caret is fine for leaves (`clsx`, `tailwind-merge`).
Supabase is on that list because a minor bump that changes cookie handling breaks sessions
silently.

**Dates: `Intl` only, no date library.** All in `src/lib/utils.ts`, and every formatter is
**named for the screen it serves** — `formatPostcardDate`, `formatRideDate`,
`formatRideDateLong`, `formatRideTime` — because each design draws a genuinely different
shape. There is deliberately no generic `formatDate`/`formatDateTime`: both existed, both
hardcoded `en-US`, and by 2026-08-05 they had one caller between them. Deleting them
resolved the two-locale split this section used to describe. Write the screen's own
formatter and let its name say where it belongs.

**Ride times are pinned to `APP_TIME_ZONE`** (`Europe/Amsterdam`). The three `formatRide*`
helpers run in server components, so before that they rendered in the server's zone — UTC on
Vercel — and drew a 20:00 Amsterdam departure as 18:00. It is a documented **interim**: the
correct model is wall-clock at the meeting point, which needs a zone column on `rides`. The
viewer's own zone is not the answer — it renders different strings on server and client,
i.e. a hydration mismatch. `formatRelativeTime` needs no zone (it measures elapsed instants)
and keeps `en-US` because it produces English prose, not a date format.

**`wallClockToUtc` is the write-side half of the same rule.** A `datetime-local` input sends a
zone-less string, and `new Date(that)` resolves in whatever zone the runtime is in — the
browser's in a client component, UTC on Vercel in a server one. The v1 create-ride form did
exactly that, so the same typed time meant different instants for different organizers and
none of them matched what `formatRideTime` drew back. It resolves the string as wall-clock in
`APP_TIME_ZONE`, in two passes so the two DST days a year are right, and its tests assert
offsets rather than strings — `TZ=UTC` in `vitest.config.ts` would let a naive
implementation pass.

**Deliberately undecided** — raise these rather than inventing an answer: error tracking,
analytics, i18n, and email delivery beyond Supabase's built-in auth mails.

## Repo Layout

```
src/
├── app/                    # Next.js App Router pages
│   ├── (app)/              # Authenticated route group — has Navbar
│   │   ├── layout.tsx      # Renders <Navbar /> (fixed bottom tabs); each page renders its own <Header>
│   │   ├── postcards/      # /postcards (the home screen), /postcards/new, /postcards/[id] (one card + its comment thread)
│   │   ├── rides/          # /rides, /rides/new, /rides/[id] (Ride plan), /rides/[id]/crew
│   │   ├── clubs/          # /clubs (Your clubs), /clubs/explore, /clubs/new, /clubs/[id] (Timeline) + /rides, /members, /about
│   │   └── profile/        # /profile
│   ├── auth/               # /auth/login, /auth/signup, /auth/callback (public)
│   ├── legal/              # /legal/terms, /legal/privacy — public, see decision #1
│   ├── layout.tsx          # Root layout (Poppins, v2 light theme)
│   ├── page.tsx            # / — splash resolver: redirects by session (see decision #7)
│   └── globals.css         # Tailwind import + CSS vars + the safe-area / fixed-bar spacing utilities
├── components/
│   ├── ui/                 # AppBackground, Avatar, Banner, Button, ButtonGroup, Card, Checkbox, ContextMenu, ExpandableText, FilterTile, Input, ListUser, Pagination, SectionHeader, Textarea
│   ├── icons/              # generated.tsx — the 53 Figma icons. GENERATED, don't edit
│   ├── layout/             # Navbar (bottom tabs + sticky action), Header (per screen)
│   ├── auth/               # AuthScreen, FormError, ResetPasswordForm
│   ├── rides/              # CreateRideForm, RideCard, RideFilterBar, RideHeader, RidePageMenu, RideAttendanceBar, RideMap
│   ├── clubs/              # ClubCard, ClubDetailHeader, ClubDetailPageMenu, ClubMembershipButton, ClubPageMenu, CreateClubForm, JoinClubButton, MarkClubSeen
│   ├── postcards/          # CommentForm, CommentItem, CommentList, CommentsLink, CreatePostcardForm, LikeButton, MarkFeedSeen, PostcardAction, PostcardCard, PostcardDeck, PostcardFilterBar, PostcardMenu, ShareButton
│   └── profile/            # EditProfileForm, ProfileCountries, ProfileImageUpload, ProfileMenu
├── lib/
│   ├── supabase/
│   │   ├── resolve.ts      # THE data layer's doorway — resolves per graph. Read its header
│   │   ├── resolve.rsc.ts  # its react-server half   } picked by the #supabase/data-client
│   │   ├── resolve.browser.ts # its default half     } condition in package.json
│   │   ├── client.ts       # Browser client — use in 'use client' components
│   │   └── server.ts       # Server client — use in server components / route handlers
│   ├── data/               # Read functions — the only place that queries Supabase
│   ├── actions/            # Server Actions — the only place that writes
│   ├── validation/         # Zod schemas, shared by client and server
│   ├── media/              # Image compression + EXIF stripping, browser-only
│   ├── auth/               # recovery.ts — cookie name shared by callback + action
│   ├── countries.ts        # ISO 3166-1 list; names via Intl.DisplayNames, flags via regional indicators
│   └── utils.ts            # cn(), APP_TIME_ZONE, wallClockToUtc(), googleMapsDirectionsUrl(), formatPostcardDate(), formatRideDate/DateLong/Time(), formatRelativeTime(), getInitials()
├── proxy.ts                # Auth middleware (Next.js 16 uses proxy.ts, not middleware.ts)
└── types/
    └── index.ts            # All shared domain types (Profile, Club, Ride, etc.)
supabase/
├── migrations/             # SQL migrations — append-only, see Supabase Rules
└── tests/                  # RLS policy suite (npm test); README covers its scope
docs/
├── HANDOFF.md              # Current position — read at session start
├── FIGMA-FIDELITY-TODO.md  # Values inferred, not read — verify before trusting the UI
└── specs/                  # Implementation specs (login-onboarding.md)
design/                     # Committed Figma snapshot — READ THIS, don't call the API
├── README.md               # Why it exists, how to refresh it, how to query it
├── manifest.json           # Provenance + counts; `figma:check` compares against it
├── index.json              # Name -> file map for every frame and component
├── tokens.json, TOKENS.md  # Colour + type tokens, geometry census
├── frames/*.json           # One pruned tree per screen
├── components/*.json       # One pruned tree per component set
└── icons/                  # index.json + exported SVGs
scripts/figma/              # The snapshot pipeline (pull -> extract -> query)
openspec/                   # Spec-driven change proposals + config.yaml
.claude/
├── agents/                 # The specialist squad (see The Agent Squad)
├── commands/               # Slash commands (opsx/*)
├── skills/                 # Project skills
├── hooks/                  # handoff-landed-check.sh — Stop hook, see Working Principles
└── settings.json           # Project hook config
```

**The per-directory contents above are a hand-copied `ls` and go stale silently** — the `ui/`
line was edited during the rides epic and still omitted three files, which is worse than
stale, because a freshly-touched line looks verified. Check it rather than trust it:

```bash
for d in src/components/*/; do echo "$d: $(ls "$d" | sed 's/\.tsx\?$//' | tr '\n' ' ')"; done
```

`src/lib/{data,actions,validation,auth}`, `app/auth/*`, `app/onboarding/*` and `app/legal/*`
were all created by the login epic, which is shipped. **Nothing under `app/(app)/*` is v1 any
more** — the last page migrated 2026-08-05. This line tracked the migration screen by screen
and was wrong within a day of each edit; check rather than read it —
`grep -rn "text-white\|zinc-\|orange-500" src/app/ | wc -l`.

## Critical: proxy.ts (not middleware.ts)

Next.js 16 uses `src/proxy.ts` instead of `src/middleware.ts`. The exported function must be named `proxy` (not `middleware`). Do not rename it or add a `middleware.ts` — the framework will break.

**Protection is a denylist of public paths, not an allowlist of protected ones.**
Everything is gated except these, which is what makes decision #1 hold by default —
a new route is protected unless someone deliberately opens it:

```
'/', '/auth/login', '/auth/signup', '/auth/forgot-password',
'/auth/reset-password', '/auth/callback', and '/legal/*'
```

Three further rules:

- **No session + non-public path** → `/auth/login`.
- **Session + onboarding incomplete** → the resume step (`/onboarding/username` or
  `/onboarding/location`), unless already under `/onboarding`. Read from
  `profiles.onboarding_completed_at` on every request; never from `user_metadata`,
  which the client can write.
- **Session + `/auth/login` or `/auth/signup`** → `/postcards` (the home screen; `/dashboard`
  was deleted with the feed that replaced it). Note the two paths:
  bouncing *all* of `/auth/*` breaks password recovery, because Supabase's link
  establishes a session before the reset page loads.

## Supabase Rules

**Always use the right client. There are now three doorways, and the first one is
the one most code wants:**
- **Anything in `src/lib/data/`** → `import { resolveSupabase } from '@/lib/supabase/resolve'`.
  It resolves the right client per graph via the `react-server` export condition, which is what
  makes the layer callable from a client component. **Reaching past it into
  `@/lib/supabase/server` here re-breaks that**, and `src/lib/data/__tests__/isomorphic.test.ts`
  fails loudly if you do.
- Server components, Route Handlers, Server Actions → `import { createClient } from '@/lib/supabase/server'`
- Client components (`'use client'`) → `import { createClient } from '@/lib/supabase/client'`
- Never cross the last two. Never import the server client in a client component.

**RLS is ON for all tables.** Every query runs under the authenticated user's session. You do not need to filter by `user_id` manually — RLS policies enforce ownership. But do add RLS policies in migrations for any new table.

**Schema (key tables):**

| Table | Purpose |
|---|---|
| `profiles` | One per auth user. PK = auth user UUID. Has `username`, `bio`, `bike_model`, `location`, `avatar_path`, `cover_image_path`. `avatar_url` is **dropped by `024` — which is written and NOT YET APPLIED**, so the live database still has the column today. Check with `list_migrations` before acting on this row. `014` had kept it as a fallback rather than dropping it unverified; the verification came back 0 non-NULL on both tables. `src/` already stopped selecting it, and the name survives there as a *field on what `lib/data/` returns*, holding the signed URL. The two `*_path` columns are Storage object paths under `avatars/<uid>/` and `covers/<uid>/`, each pinned to its owner by a CHECK on the row's own `id`. Render them through `resolveAvatarUrls` / `signImagePaths`, never directly. |
| `rides` | Rides with `organizer_id → profiles`, optional `club_id → clubs`. |
| `ride_members` | `(ride_id, user_id)` composite PK. `status`: `going` \| `maybe`. |
| `clubs` | Clubs with `owner_id → profiles`. |
| `club_members` | `(club_id, user_id)` composite PK. `role`: `owner` \| `admin` \| `member`. |
| ~~`friendships`~~ | **Dropped by `013`, applied 2026-08-04.** Gone from the schema and from `src/`. A v1 leftover; the design has no friendship concept. Listed here only so its absence is not mistaken for an oversight. |
| `postcards` | The photo feed / home screen. `author_id → profiles`, optional `club_id → clubs`. **`club_id` IS the audience** — NULL means the app-wide feed, set means that club's members. There is deliberately no `is_public` flag. `image_path` is a Storage object path, never a URL, and must sit under `postcards/<your uid>/`. |
| `postcard_likes` | `(postcard_id, user_id)` composite PK. No denormalised count — the correct count is per-viewer, so it is counted under RLS. |
| `blocks` | `(blocker_id, blocked_id)` composite PK. The row is **directional**, the effect **symmetric**. Never query it from a policy — go through `private.is_blocked(a, b)`, which is `security definer` because the blocked party cannot read the row. |
| `postcard_comments` | A comment has no audience of its own — it **inherits the postcard's**, expressed as an `EXISTS` against `postcards` rather than a second copy of the club predicate. No UPDATE policy and no UPDATE grant: editing is not designed. No denormalised count, same reason as likes. |
| `postcard_hides` | `(postcard_id, user_id)` composite PK. **Per-viewer and one-directional**, unlike `blocks` — a row only ever removes a postcard from its own `user_id`'s feed. It is an input to the `postcards` SELECT policy, so `club_id` is no longer the sole determinant of what a viewer sees. |
| `profile_countries` | `(user_id, country_code)` composite PK, added by `014`. Countries a rider says they have ridden in, **entered manually** — the derived reading is unbuildable, `rides` has no country or coordinates. `country_code` is ISO 3166-1 alpha-2 with a CHECK; there is no `countries` reference table, because the picker's list is the client's and nothing joins against it. SELECT inherits the profiles predicate via `EXISTS`, so blocking works without the word appearing in the policy. |
| `clubs` (media) | `016` adds `avatar_path` and `cover_image_path`, both Storage object paths under `club-avatars/<owner uid>/` and `club-covers/<owner uid>/`. Keyed on the **uploader**, not the club, because the object must land before the club row exists; a CHECK ties each path back to the row's `owner_id`. `avatar_url` was the legacy column nothing wrote; **`024` drops it and is not yet applied**. Five query sites embedded `clubs(id, name, avatar_url)`; the three that draw an image could only ever draw initials, because it was NULL on every row — see `CLUB_EMBED_COLUMNS`. |
| `feed_reads` | The unread model, added by `015`. A **read watermark per audience**, not a row per postcard seen: `(user_id, club_id)` where `club_id` NULL is the app-wide feed, mirroring `postcards.club_id`. Its uniqueness is `unique nulls not distinct` — a plain UNIQUE treats two NULLs as different and would insert a second app-wide row on every visit. Row count is bounded by **membership**, so it never grows with content; the rejected `postcard_views` alternative grows as riders × postcards. Read it through `club_unread_counts()`, a `security invoker` function, so blocks and hides are excluded by the same policies the feed obeys. Only club rows have a writer today — the app-wide row lands with the postcard filter tiles. |
| `postcard_reports` | `unique (reporter_id, postcard_id)` so a repeat report is a no-op rather than a brigading tool. **Write-only in practice**: no admin role exists, so only the reporter can read their own rows and nobody can triage. Recorded as a KNOWN GAP in `011`, not a feature. |

**Migrations:** Add new SQL files to `supabase/migrations/` with incrementing prefix (e.g., `002_add_column.sql`). Never edit existing migrations — always add new ones.

**The canonical project is `letsride`, ref `zwprydcyryvudhurbnye`** (`eu-west-1`). There is
exactly one, and every environment points at it — Vercel's `NEXT_PUBLIC_SUPABASE_URL` and
the GitHub Actions secrets of the same name. A second project named `LetsRide`
(`ylxnicopnaroltebvfnc`) existed briefly, was never referenced by anything, and has been
deleted. Recorded here because it is not secret — the ref ships in the client bundle as
part of the Supabase URL — and because not knowing it cost real time.

**Applied state: `001`–`020` and `022`. `021`, `023` and `024` are written and not applied —
and `021`/`023` are the one case where the "unapplied migrations are drift" rule must not be
followed blindly.** Confirmed 2026-08-05 with `list_migrations`: **21 rows** ending
`private_club_rides`, against **24 files** in `supabase/migrations/`.

`024_drop_legacy_avatar_url` is a different case from the other two: it has no unresolved
decision behind it and is **not** in `SKIP_MIGRATIONS`, so the suite exercises it. It is
unapplied only because dropping a column `main` still selects is an instant outage. Its code
repair is backward-compatible — every changed select was probed against the live schema and is
valid *before* the drop — so the order is **deploy the code, then apply `024`**, never the
reverse.

**Do not apply `021` or `023` without reading its header.** `021_profile_column_privileges` revokes
column grants that `proxy.ts` reads on *every authenticated request* — applying it alone logs
out every rider and makes onboarding impossible to complete. `023_participation_gate` refuses
writes from riders whose consent stamp is NULL, which is all four of them. They are also
mutually incompatible: `023` gates on stamps `021` removes the only path to setting. Both are
listed in `SKIP_MIGRATIONS` in `supabase/tests/run.sh` so the suite models the database that
actually runs, and each has its own pending suite (`PENDING=021`, `PENDING=023`).

This line has been wrong in both directions — it said `016` for a day after `017` landed, then
`017` for an hour after four more did. Run `list_migrations` against `ls supabase/migrations/`
rather than reading it. `016` (club media) was
applied 2026-08-05 and verified live: 6 new `storage.objects` policies (3 each for
`club-avatars/` and `club-covers/`), 15 in total across five upload surfaces, 0 targeting
anything but `authenticated`, 0 UPDATE policies, 4 path CHECKs on `clubs`, and both columns
present. The policies were also exercised against the live project with `curl`: an upload into
your own folder returns 200, into another rider's 400, and a malformed path 400.

**Applied state before that: `001`–`015`.** `015` (`feed_reads`) was
applied 2026-08-05 and verified live: 3 policies, all `to authenticated`, 0 `anon` grants,
`authenticated` holding no DELETE, `indnullsnotdistinct` true, `prosecdef` false on
`club_unread_counts`, RLS on, and the new `rides (club_id, created_at desc)` index present.
`rides` had carried **no index a `club_id` lookup could use** since `001` — only `rides_pkey` —
which the badge's rides half would have turned into a sequential scan on every Clubs load.
(This line said "no indexes at all" until review checked `pg_indexes`; the conclusion held and
the superlative did not.) The advisors report nothing new — the two
outstanding are still `moderate_comment` (deliberate) and the leaked-password toggle. One
footer query in `015` was wrong on the first pass and is worth copying the fix rather than the
mistake: it counted DELETE grants table-wide and read 2 against a correct database, because
`postgres` and `service_role` hold everything by Supabase default. Scope a grant assertion to
its grantee, or use `has_table_privilege`. `014` was applied
2026-08-05 and every number its footer predicts was confirmed live: 9 storage.objects
policies (3 each for `postcards/`, `avatars/`, `covers/`), 0 of them targeting anything but
`authenticated`, 0 UPDATE policies on `storage.objects` or `profile_countries`, 0 `anon`
grants and 0 `authenticated` UPDATE grant on `profile_countries`, both new `profiles`
columns present with 4 path constraints, and RLS enabled. Verify with `list_migrations`
against `ls supabase/migrations/` rather than trusting this paragraph — it is the exact line
that has been wrong before.

**Security advisors after `014`: two, neither introduced by it and neither an accident.**
`moderate_comment` is `security definer` and granted to `authenticated` **by design** —
`011` §1b argues the case at length: the actor cannot read the row they must act on, the
function deletes exactly one comment on a postcard the caller authored, and its narrowness
is the defence. The other is the leaked-password toggle, still the one genuinely outstanding
item and still a dashboard click. `list_migrations` on
2026-08-04 returns thirteen rows ending in `drop_friendships` (`20260804162819`). `012`
(consent stamp guard) and `013` (drop `friendships`) were applied that day after sitting
written-but-unapplied; `013`'s pre-flight returned **0 rows**, so nothing was destroyed, and
every number its footer predicts was confirmed live (`to_regclass` NULL, 0 friendships
policies, total 40 -> 36). Verify with `list_migrations` against `ls supabase/migrations/`
rather than trusting this paragraph, which is exactly the line that has been wrong before: it
said `001`–`010` for a day after `011` landed, and a session obeying *Unapplied migrations are
drift* would have re-run `011` against tables that already exist. `009_postcards_and_blocks`
was applied 2026-08-02 and verified live: 32 policies, all `to authenticated`, exactly one
SELECT policy per table, `anon` holds zero grants, and `private.is_blocked` is absent from
`public` so PostgREST does not publish it. `003_onboarding` was
applied 2026-08-02 and verified against the live database, not just CI: the five negative
cases from its own footer all hold (completion refused while `location` is NULL, completion
one-way once set, reserved / too-short / uppercase usernames all rejected with `23514`),
22 policies exist and every one is `to authenticated`, and `anon` holds zero table grants.
The security advisors report nothing new — only the pre-existing leaked-password toggle.

Verify against the live database rather than trusting this line; it is the exact claim that
was wrong before.

`004`–`007` reached the database before `002` did, because two chains were written in
parallel and each recreated the policies the other did. `008` reconciles them: `to
authenticated` from `002`, the visibility predicates from `004`. Verified by diffing the
live policy set against a database built from the migration chain — they match exactly.
Both databases now agree; the file order and the historical apply order do not, and that
is recorded here rather than left to be rediscovered.

**The project is on the free tier, which auto-pauses after ~7 days idle.** A paused project
serves nothing, so the deployed app goes down with no alert. This needs to be on Pro before
anything resembling launch.

## Component & Code Conventions

**Pages:**
- Server pages: plain `async function Page()` — call a function from `src/lib/data/`.
- Client pages/components: `'use client'` at the top.
- Default export for pages, named exports for reusable components.

**Read pattern** — the query lives in `src/lib/data/`, never in the page:
```ts
// src/lib/data/rides.ts
export async function getRide(id: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('rides').select('*, organizer:profiles(*)').eq('id', id).single()
  return data
}
```

**Mutation pattern** — a Server Action, called from the client component:
```ts
// src/lib/actions/rides.ts
'use server'
export async function joinRide(rideId: string) {
  const supabase = await createClient()
  await supabase.from('ride_members').insert(...)
  revalidatePath(`/rides/${rideId}`)
}
```

The older shape — `supabase.from()` inside a client component followed by `router.refresh()`
— is v1. See Technology Decisions; migrate on contact, don't extend it.

**UI primitives** (always use these, don't reinvent):
- `<Button>` — variants: `primary` (near-black `Grey/100`), `secondary`, `ghost`, `danger`. Prop: `loading`.
- `<Input>` — props: `label`, `error`.
- `<Card>`, `<CardHeader>`, `<CardTitle>`, `<CardContent>`
- `<Avatar>` — sizes: `sm`, `md`, `lg`, `xl`. Falls back to initials.

**Import alias:** `@/*` → `src/*`. Always use this, never relative imports like `../../`.

**Types:** All domain types live in `src/types/index.ts`. Add new types there, don't inline them.

## Design System

> **⚠️ The code currently does NOT match the design.** The app was built against the
> **v1 (dark)** designs. Figma has since moved to **v2 (light)** — a different theme,
> palette, and typeface. The tokens below are the **target**. Anything in the codebase
> using `zinc-*` or `orange-500` is legacy v1 and is being migrated. Do not add more of it.
>
> Figma: `gDoteM1ow1AZpSEGSNhpc7` — the `v2 / Component / *` library is canonical.
> Ignore `Component / *` (v1, has `Theme=Dark` variants) and anything named `(OLD)`.

**Read the design from `design/`, not from the Figma API.** The snapshot committed there is
generated from the same file and answers layout, geometry, copy and token questions offline —
`npm run figma -- tree "<screen>"`. The API rate limit is per-endpoint, inherited across
sessions, and has blocked work for hours at a time; the snapshot exists so that stops
mattering. Refresh it monthly with `npm run figma:pull`, and if a 429 comes back, stop rather
than poll. Full rationale in `design/README.md`.

The tables below and `design/TOKENS.md` describe the same thing. **When they disagree,
`design/TOKENS.md` is right** — it is generated, these are transcribed.

**These tokens are Figma *paint and text styles*, not variables** — which is the only reason
they are readable at all, and why converting them would be catastrophic. `design/README.md`
explains it; *What Not To Do* carries the rule.

Extracted from the file and verified 2026-08-01. `n` is how often the style is used on the
Components page — a good proxy for how central it is.

**Colors:**

| Token | Value | n | Use |
|---|---|---|---|
| `Grey/100` | `#1A1A1A` | 275 | Primary text, primary buttons |
| `White/100` | `#FFFFFF` | 222 | Cards, surfaces, text on dark |
| `Grey/80` | `#666666` | 101 | Secondary / muted text, icons |
| `Grey/5` | `#F2ECE6` | 54 | App background (warm cream) — but see the gradient note below |
| `Warning/100` | `#D92140` | 39 | Destructive / error — `<Button variant="danger">` |
| `Grey/10%` | `#0000001A` | 16 | Dividers, subtle borders |
| `Accent Brand/100` | `#3D996B` | 14 | Brand green — accents, success, splash |
| `White/10%` | `#FFFFFF1A` | 7 | Overlay on imagery |
| `Accent Brand/110` | `#338059` | 5 | Brand green, darker — pressed / hover |
| `Grey/20%` | `#00000033` | 3 | Stronger borders |
| `White/5%` | `#FFFFFF0D` | 3 | Subtle overlay on imagery |
| `Accent Brand/50%` | `#3D996B80` | 2 | Muted brand |
| `Warning/90` | `#FF3355` | 2 | Error, lighter |
| `Pink/100` | `#F23071` | 2 | **The liked heart, and only that** — `Button / Postcard Action` Type=Like Toggled=True. `--color-like` |
| `Grey/60` | `#808080` | 1 | Near-unused; may be a stray |
| `Grey/70%` | `#000000B3` | 1 | Scrim / overlay |
| `Warning/110` | `#99001A` | 1 | Error, darker |

Note: primary buttons are **near-black (`Grey/100`)**, not green. Green is an accent, used
sparingly — it is not the button colour.

**The app background is a gradient, not a flat fill.** `v2 / Component / App Background` is a
135° linear gradient from `#F2ECE6` (`Grey/5`) to `#CCB8A3`. Every screen in the login epic
instances it except the splash, which is flat `Accent Brand/100` `#3D996B`. `--color-background`
in `globals.css` holds only the flat top colour, which is right for surfaces and wrong for the
page. Measured 2026-08-02.

Twelve `Grey (OLD)/*` and `Accent (OLD)/*` styles are still live *inside* v2 components —
`#808080` (93 uses), `#E6E6E6` (84), `#262626` (59), `#36B289` (31) and others. They are v1.
Do not port them; resolve to the v2 token nearest in intent.

**Type — Poppins** (there is no other family):

| Token | Size / LH | Weight | n |
|---|---|---|---|
| `Poppins/14/Medium` | 14 / 20 | 500 | 102 |
| `Poppins/16/Regular` | 16 / 24 | 400 | 77 |
| `Poppins/14/Semibold` | 14 / 20 | 600 | 69 |
| `Poppins/12/Semibold` | 12 / 18 | 600 | 60 |
| `Poppins/14/Regular` | 14 / 20 | 400 | 57 |
| `Poppins/16/Medium` | 16 / 24 | 500 | 47 |
| `Poppins/10/Medium` | 10 / 16 | 500 | 31 |
| `Poppins/16/Semibold` | 16 / 24 | 600 | 26 |
| `Poppins/12/Regular` | 12 / 18 | 400 | 25 |
| `Poppins/10/Semibold` | 10 / 16 | 600 | 23 |
| `Poppins/12/Medium` | 12 / 18 | 500 | 14 |
| `Poppins/20/Semibold` | 20 / 30 | 600 | 6 |
| `Poppins/18/Semibold` | 18 / 26 | 600 | 5 |
| `Poppins/24/Semibold` | 24 / 36 | 600 | 2 |
| `Poppins/20/Medium` | 20 / 30 | 500 | 1 |
| `Poppins/40/Semibold` | 40 / 60 | 600 | 1 |

**`Poppins/32/Semibold` (32/48, w600) does exist** — style `503:6020`, and it is what every
screen title in the login epic uses. A previous revision of this file claimed it did not,
almost certainly because the counts above were taken from the Components page, where it is
unused; a style can exist in the library without appearing there. Verified 2026-08-02 by
resolving the Login title node, which reports `fontSize 32, lineHeight 48, weight 600`.
`--text-display` in `globals.css` is correct. The other display sizes are 24/36 and 40/60.

**Layout:** 390px mobile frame, single column, mobile-first. Fixed top header + fixed
bottom tab bar. Use `.pb-safe` for notch devices.

**Geometry** (most-used values on the Components page — use these rather than inventing):
corner radius `4` (147), `100` (110, i.e. pill), `8` (85), `5` (52), `12` (15);
padding-left `16` (99), `8` (43), `24` (21); item spacing `8` (86), `4` (66), `16` (40).

**Icons: 53 exported**, under `Element / Icon / *` — more than the 44 counted from the
Components page, which is where that older number came from. They are in `design/icons/` as
SVG and, more usefully, as typed React components:

```bash
npm run figma -- icons        # list them
npm run figma:components      # regenerate src/components/icons/generated.tsx
```

**Import from `@/components/icons/generated`; never hand-edit it.** The generator rewrites
every literal fill to `currentColor`, so an icon takes the colour of the text around it and
the stray legacy `#808080` a few were drawn with disappears at the door. Size with
`className` — `h-6 w-6` is the design's 24px default.

The set includes the motorcycle-specific ones `lucide-react` cannot supply — Bike, Garage,
Wrench, Coordinates, Store — plus Arrow Left/Right/Up, Avatar, Block Account, Calendar, Chat
Bubble, Check, Chevron Down/Right, Clock, Close, Clubs, Delete, Edit, Flag, Globe, Heart
Filled/Outline, Hide, Home, Image, Location Filled/Outline, Lock, Log Out, Mailbox, Menu,
Mute, Options, Paper Plane, Pin, Plus, Plus Circle, Preferences, Profile, Report, Search,
Share.

**`lucide-react` is gone** — uninstalled 2026-08-05 with `/rides/new`, the last v1 page. Don't
re-add it and don't substitute lookalikes. The three matches
`grep -rn lucide-react src/` still returns are prose inside comments; the importer count is
`grep -rl "from 'lucide-react'" src/ | grep -v generated | wc -l` and it is **0**. That command
has reported 15, 12 and 11 at various points, which is why the command is the answer and the
number beside it is the liability.

**The library scale**, for planning: 52 component sets covering 213 variants, plus 88
standalone components, 2,447 nodes on the Components page.

## Development Workflow

```bash
npm run dev      # start dev server
npm run lint     # eslint
npx tsc --noEmit # type check
npm run build    # production build (requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY)
npm run test:unit # Vitest — validation schemas, getInitials, safeNext, the Figma extractor
npm test         # RLS policy suite (needs Postgres + psql; see supabase/tests/README.md)
```

**Reading the design** — offline, from the committed snapshot in `design/`. None of these
touch the network, so none of them can be rate limited:

```bash
npm run figma -- ls [pattern]        # every frame and component
npm run figma -- tree "View all new postcards / Home - Postcards - All new"
npm run figma -- text "v2 / Component / Postcard"    # every string, with its type token
npm run figma -- tokens Grey         # token tables
npm run figma -- icons               # the exported icon set
```

**Screen names repeat across flows** — six frames are called `Home - Postcards - All new`,
one per flow that shows the home screen. Qualify with the flow, as above; an ambiguous name
prints every match with its flow and node id, so the next command is copy-pasteable.

**`tree` and `text` hide layers Figma has toggled off** — a component instance carries every
variant slot it does not use, so the Home header still *contains* the back button it hides.
Add `--all` to see them, marked `[hidden]`. Building from an unfiltered tree is how a back
button ends up on the home screen.

Refreshing it needs the network and is a **monthly** job, not a per-session one:

```bash
npm run figma:check   # one cheap call — is the snapshot even stale?
npm run figma:pull    # the expensive call; extracts automatically
npm run figma:icons   # export Element / Icon / * as SVG
npm run figma:components # SVGs -> React components (offline, run after figma:icons)
npm run figma:check -- --probe   # sweep every endpoint when something looks blocked
```

If `figma:pull` returns 429 it prints `Retry-After` — a real countdown, in seconds, that
requests do not reset. Come back then rather than polling; waits have been measured in days,
not hours. See `design/README.md`.

**Environment variables** (never commit these):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `FIGMA_ACCESS_TOKEN` — only needed to *refresh* the snapshot, never to read it

Copy `.env.local.example` to `.env.local` for local development.

## The Agent Squad

Specialist agents live in `.claude/agents/`. Delegate to them rather than doing everything in the main thread.

| Agent | Use for |
|---|---|
| `openspec` | Drives the OpenSpec workflow; enumerates every state and, above all, every **negative case** |
| `design-system` | v2 tokens, component library, icon set — **blocks most other work** |
| `data` | Migrations, RLS policies, block lists, indexes, schema debugging |
| `feature` | Complete vertical slice — route, page, components, types, wiring |
| `realtime` | Chat (inbox + per-ride), notifications, unread counters, presence |
| `media` | Photo upload, Supabase Storage, compression, **EXIF stripping** |
| `rider-ux` | PWA, offline, geolocation, push, static map + deeplink, glove targets |
| `test` | Vitest/Playwright infra and tests |
| `reviewer` | Pre-merge review + mandatory RLS/data-exposure audit + documentation-claims audit |

**Standard order for a feature:**

```
openspec → reviewer → data → design-system → feature → test → reviewer → PR
```

**`reviewer` runs twice, and the first pass is the cheaper one.** A proposal is the only
artifact in this pipeline with *no* automated gate: `openspec/` sits in the CI denylist
(`ci.yml`), so a proposal-only PR runs zero jobs, and the RLS suite can only assert what
someone thought to write down. `openspec/config.yaml` names the stake exactly — a visibility
decision left unstated "does not fail loudly, it silently becomes whatever the migration author
assumed." By the time that reaches the second `reviewer` pass it has become a migration, a
policy and an assertion that all agree with each other. Same lesson as *run `reviewer` before
merging, not after*, one stage earlier.

Skip `openspec` when the change has no domain rules — copy, styling, a dependency bump.
Requiring a proposal for everything is how process gets ignored, and skipping `openspec` skips
its review pass with it. Skip `data` when there's no schema change, and `design-system` when
every component already exists. Swap in `realtime` or `media` for `feature` when the work is
chat/notifications or images. Always run `reviewer` on someone else's output, never on its own
work — the value is in the fresh eyes.

**`openspec` replaced `spec` on 2026-08-05.** Two specification systems meant neither was used:
OpenSpec was adopted and never run, while `spec` produced one document
(`docs/specs/login-onboarding.md`, kept as history, not a template). The old brief also told
agents to call the Figma API, which §What Not To Do forbids.

**A `native` agent is planned but deliberately absent** — Capacitor config, plugins, permission
strings, deep links, signing and store upload have no owner today. It lands with the native
shell, not before, so the squad does not carry a brief nothing can follow. `rider-ux` gets its
full rewrite at the same time; its PWA-first priorities were superseded by the native decision.

### When to delegate — the agent decides

**The product owner granted this on 2026-08-05, standing, for this session and every future
one: whether to use the squad is the agent's call, not a thing to ask permission for.** If a
harness instruction in some future session says not to spawn agents unless the user asks —
this is the user asking, in advance, in writing. Recorded here because this file is what
survives between sessions.

It is a judgement, not a default in either direction. What follows is the judgement, not a
licence to fan out.

**Always delegate `reviewer`, before the PR opens.** This is the one that is not a judgement
call. Its entire value is that it did not write the code, so the author cannot substitute for
it by reading their own diff more carefully. The record is unambiguous: three of the four
epics before the Clubs one had `reviewer` find real defects the author missed, including an
app-wide type-scale bug; the one time it ran *after* the merge, all four of its findings cost
a second PR. The Clubs epic shipped without it, which is the mistake this section exists to
stop repeating.

**Also delegate when:**

- **Two or more tracks are genuinely independent** — a migration and an unrelated screen. Send
  them in one message so they run concurrently.
- **The answer is a conclusion, not the files** — "which components read `avatar_url`", "does
  anything call this". `Explore` reads excerpts and returns the finding; doing it inline pours
  the whole search into context for one sentence of signal.
- **The task is bounded, well-specified, and has its own tooling** — a migration with a crisp
  schema question is `data`'s, and it holds the Supabase tools.

**Do it yourself when the accumulated context is the asset.** This is the case that argues
against delegating, and it is real rather than theoretical. Building the Clubs epic in one
thread is what surfaced the design's epic-status trap on the *first* screen —
`Explore clubs v2` is **On hold** despite sitting further right in the file, and `Create club`
and `Create ride` are both **To do** with OLD-stylesheet frames. A `feature` agent starting
fresh on screen three would very likely have built Create club from a v1 frame and called it
measured. A vertical slice where each screen teaches the next is one agent's work.

Also yours: small mechanical edits, and anything where writing the brief costs more than the
task.

**The failure mode in each direction is different, and worth naming.** Over-delegating
scatters context and produces work that is individually correct and collectively inconsistent.
Under-delegating — the Clubs epic — produces work with no fresh eyes on it, where every
assumption the author made at the start survives to the end unchallenged. The second is the
one this repo has actually suffered from.

## Architectural Decisions

Settled. Don't reopen these without an explicit decision to change them.

**1. No anonymous access, anywhere.** Every route outside `/auth/*` requires a session. No policy grants to the `anon` role. `is_public = true` means "visible to any signed-in rider", never "visible to the internet". The Figma's guest-browsing screens ("Become a rider" on a club page) are out of scope.

**2. Blocking is enforced in RLS, not in the UI.** A blocked user disappears from feeds, search, chat, member lists, and ride crews simultaneously. One `security definer` helper applied across policies. Blocks are symmetric even though the row is directional.

**3. Maps are a static thumbnail plus a Google Maps deeplink.** No mapping SDK, no turn-by-turn, no route rendering.

**4. v2 is the only design.** v1 (`zinc-*`, `orange-500`, Geist, `lucide-react`) is superseded, and as of 2026-08-05 it is **fully retired**: zero `text-white` in `src/app/`, zero `lucide-react` importers, zero client-side `supabase.from()` writes, and the dependency uninstalled. What remains of those strings in the tree is comments describing the migration. Never add more.

**5. Onboarding is required and not skippable.** No skip affordance on any step. A user who hasn't completed onboarding cannot reach any app route — `proxy.ts` redirects them back into the wizard. The schema carries the incomplete state so an abandoned signup resumes where it left off.

**6. Email confirmation is off, for now.** Signup lands straight in onboarding with a live session. This is a deliberate temporary trade — it permits signing up with an email you don't control — and must be revisited before public launch.

**7. Username, not full name.** `profiles.full_name` is dropped. Onboarding collects a **username**, which is `UNIQUE` — so that step needs live availability checking, a taken error state, and character/length rules. Every place the design shows a person's name (postcard bylines, profile headers, member lists, chat) renders the username.

**8. Supabase with RLS *is* the backend.** Extra server compute goes in Route Handlers or
Edge Functions — never behind a service-role API that owns the database. "A bigger backend"
means one of three things and only the first two are open:

- **More server compute, same database.** Route Handlers or Supabase Edge Functions for work
  the client cannot do: webhooks, image processing and EXIF stripping, push, scheduled jobs.
  Additive, no architectural cost. This is what Postcards and Inbox will need, and it is
  almost certainly the only one we ever need.
- **A separate service that forwards the user's JWT** to Postgres rather than holding a
  service-role key. Costs a network hop, keeps RLS intact. Justified only by something Node
  or Go can do that Postgres and Edge Functions cannot.
- **A service-role backend that owns the database.** This voids decision #2. Every visibility
  rule currently living in the RLS policy set and the assertions that cover it gets
  reimplemented in
  application code — where, per `openspec/config.yaml`, an unstated rule fails silently
  instead of loudly. Nothing on the roadmap justifies it. Reopening it takes an explicit
  decision, not drift.

The `src/lib/data/` and `src/lib/actions/` boundaries earn their place on their own merits,
and they happen to make the second option a change to ~20 functions instead of 17 components.
That is a side effect, not the justification. Do not build ports, adapters or a repository
interface for a migration nothing has asked for.

## Working Principles

**Fix the tool, don't route around it.** This app is being built for the long term. When a
connector is down, a quota is exhausted, or a credential is missing, the default is to
*restore the capability*, not to invent a lower-fidelity substitute and move on.

The line worth holding:

- **Acceptable** — a workaround that produces the *same artifact*. Writing a migration file
  while the database is unreachable is fine: the file was always the deliverable, and it
  gets applied unchanged later.
- **Debt** — a workaround that produces a *lower-fidelity artifact*. Eyeballing colours off
  a screenshot instead of reading `get_variable_defs`, guessing component padding rather
  than reading the Figma frame, or asserting a migration works instead of running it.

When the second kind is genuinely unavoidable, say so explicitly, mark exactly what was
inferred, and leave a note for the pass that will verify it. Never let an inferred value
pass silently as a known one — a guess that isn't labelled becomes a fact nobody rechecks.

**A blocked capability is a request for the product owner, not a footnote.** Most of what
blocks this repo — a network policy, a missing credential, an API quota, a password held by a
human — cannot be restored from inside a session. **Say so the moment you hit it, in your own
voice, as a thing you need them to do.** Then carry on with everything the block does not
touch; do not sit idle waiting for an answer.

The failure mode this exists to prevent is not silence, it is *volume without a request*. On
2026-08-05 a session wrote "this container cannot reach `supabase.co`" five times across a
PR body, a handoff and three replies, never once wrote "please grant it", and only tested the
claim when the owner finally asked what it meant. Access was granted within a minute of being
asked for. Three PRs had merged unverified by then.

Two rules that follow:

- **Test the block before reporting it.** That claim was inherited from these docs and
  repeated for a whole session without a single `curl`. An unverified blocker is just another
  unlabelled guess, and this file's own principle already forbids those.
- **Distinguish the two kinds when you report it.** "I used the Supabase MCP tools instead of
  `curl`" needs no interruption — same artifact. "I could not load the page, so this is
  verified to compile and not verified to work" is a lower-fidelity artifact and needs an
  explicit ask. Only the second kind is escalated, or the signal drowns.

**Notify when the work is done and the owner may not be watching.** Standing request from the
product owner, 2026-08-05: send a push notification when a session's work is finished, in the
form `Done ; ) <name of the session>` — the name being what the session was *about*, so a
notification read on a phone hours later identifies itself without opening anything. One at the
end, not per milestone; a notification they did not need is annoying in a way that accumulates.

**Rate every suggestion on four lines, always in this order.** Whenever you propose optional
work — a refactor, a test, a hardening, a follow-up — close it with this block. Not a sentence
with numbers buried in it; the point is that the reader can skim four lines and still decide.

> **Complexity** 3/10 — one migration, plus `PUBLIC_PROFILE_COLUMNS`, two types and a resolver
> **Urgency** 2/10 — nothing forces it; rises if anyone starts trusting the column
> **Recommendation** 7/10 — a dead column that reads as live is a trap for the next session
> **This session** N — wants its own branch, and the open PR should land first

What each one means:

- **Complexity** — effort plus risk plus the maintenance it adds. Not "is it interesting".
- **Urgency** — *when*, not *whether*. **Name the trigger where one exists**, because most
  urgency here is conditional rather than scheduled: "low now, high the day real riders sign
  up" is the whole content, and the bare number would have hidden it.
- **Recommendation** — how strongly you actually advise doing it, independent of how much fun
  it is to build.
- **This session** — **Y or N, never a number**, plus the half-line of why. It answers "should
  *this* session pick it up next", which is a question about the session rather than about the
  work: what context is already loaded, whether a branch is open, whether it is blocked on an
  answer, and whether it is even the agent's to do. An owner-only item is **N** — "not mine" —
  which is the single most useful thing this line does, because those are exactly the items
  that otherwise sit in a list of build tasks looking actionable.

**None of the four are correlated, and that is the entire reason there are four.** A 1/10
complexity item can be a 9/10 recommendation. A clever 6/10 build can be a 2/10
recommendation. Urgency moves independently of both — the deck-skip bug fixed on 2026-08-05
sat at 6/10 recommendation with near-zero urgency for weeks, then became urgent the moment the
overflow menu shipped the block button that could reach it. Nothing about its complexity or
its value changed; only *when* did.

**This session is the one that moves fastest, and it is the one a stale answer misleads on.**
9/10 recommendation and **N** is a perfectly ordinary pairing — the leaked-password toggle is
a dashboard click nobody in a session can make. So is its inverse: a 3/10 recommendation
worth **Y** because the files are already open and it costs two minutes, where the same item
next week costs an hour of reloading context. Answer it from where the session actually is,
not from how good the idea is.

Rate your own ideas honestly, including low — an unrated suggestion reads as advocacy, and
the reader cannot cheaply decline it. If you would not spend your own afternoon on it, say so
in the number.

**Letter them — A), B), C) — whenever you offer more than one.** A rated list is only half
useful if the reader has to quote a sentence back to pick from it; a letter makes the reply
"do A and C" instead. Number the *choices*, not the paragraphs, and keep one letter per thing
that can be independently said yes to.

Two things that make the list actually decidable:

- **Say who does each one.** Some items are the owner's alone — a dashboard toggle, a
  designer question, loading a page against the real database — and mixing them into a list
  of build tasks hides the ones nobody but them can do.
- **A single suggestion needs no letter.** `A)` on its own is ceremony.

**Committed and pushed is not shipped.** Work only counts when it is on `main`. A branch that
is green, pushed and reviewed still changes nothing until it merges — and the gap between
"I opened the PR" and "it landed" is where things get dropped, because every other signal
(clean tree, pushed branch, green CI) already looks finished. Before ending a session, merge
it or say plainly that it is open and why. This is not hypothetical: a handoff rewrite sat in
an unmerged PR while `main` told the next session a shipped epic was half-finished.

**A claim about state needs the command that checks it.** `docs/HANDOFF.md` describes things
that move on their own — what is deployed, what is applied, how many tests there are. Write
those with the one-liner that verifies them, so a stale line costs seconds instead of
misleading someone. Counts especially: `git grep -c` beats a number typed by hand, which has
been wrong here three times (assertion count, dependency count, `.from()` call sites).

**Unapplied migrations are drift.** A migration in the repo that has not run against the
database means the schema in git and the schema in Postgres disagree. Apply them before
adding another; a queue of unapplied migrations fails in the order nobody tested. Check
rather than trust this line — `mcp__Supabase__list_migrations` against the hosted project,
against `ls supabase/migrations/`. (It said "two are outstanding" while the true count was
first zero and then one.)

## Product Scope (from Figma)

The built app covers a fraction of the design. Five nav tabs — **Home, Rides, Clubs,
Inbox, Profile**. There is no "Friends" tab: `013` dropped the `friendships` table on
2026-08-04, and the route and components went earlier. The social graph is clubs plus
blocking.

| Domain | Status in code |
|---|---|
| **Postcards** — photo feed, likes/comments/shares, club-scoped, is the *home screen* | **Built and verified against the design** as of 2026-08-04: the swipeable card deck and filter bar at `/postcards`, the composer at `/postcards/new`, one card plus its thread at `/postcards/[id]`. The home screen is a **card stack you swipe**, not a scrolling feed. **Share is a link share** (Web Share API, clipboard fallback) — the reading that needs no schema; a repost is still an open product question. Two design elements are blocked on schema, not design: unread badges and photo location. The hide/block/report menu was listed here as a third and that was wrong twice over — it needed no schema (`009` and `011` built every table) and it shipped 2026-08-05. See `docs/FIGMA-FIDELITY-TODO.md` |
| **Inbox** — DMs, per-ride group chat, notifications | Not built |
| **Garage** — user's motorcycles, gear, badges, countries ridden | Not built |
| **Trust & safety** — block account, report post, hide postcard, delete account | **Partially built 2026-08-05.** Block, report and hide ship in the postcard overflow menu, over the RLS that `009`/`011` already had. `unhidePostcard` and `unblockRider` still have no caller, so both are **one-way from the UI** — the design has no "blocked accounts" or "hidden postcards" screen to undo them from. Delete account is not built |
| **Rides** — cover image, static map + Google Maps deeplink, Ride plan / Journal / Crew / Chat, Going/Maybe/No, per-ride chat | Partially built. **`/rides` and `/rides/[id]` are v2 and built from the measured design** (2026-08-04). The detail is **four sub-pages behind a dropdown page switcher, not tabs** — an earlier revision of this line said "Plan/Journal/Crew tabs", which had the right three and the wrong mechanism, and missed that Chat is a fourth reached from the header. **Ride plan and Crew are built; Journal needs `postcards.ride_id` and Chat needs the Inbox epic.** `/rides/new` is v2 as of 2026-08-05 and now offers `club_id`, which no screen had ever set. Cover images and map thumbnails are blocked on schema (no image column, no coordinates), not on design — see `docs/FIGMA-FIDELITY-TODO.md` §Rides list and §Ride detail |
| **Clubs** — public/private, Overview/Rides/Members/Posts tabs | **Built 2026-08-05**, all of it v2. `/clubs` and `/clubs/explore` are two sub-pages behind the header's dropdown, with `List / Club` rows carrying the type chip, the rider collage, the club images and the unread counter. `/clubs/[id]` is four sub-pages — Timeline, Rides, Members, About — built from the **private club** frames, which are the ones marked Done; both public-club epics are On hold. `/clubs/new` is a server page with an image upload (`016`). Two things remain unbuilt and both are logged: the Timeline's **activity feed** (no table behind joins/leaves) and **member invitations with an Admin role** (drawn on the v1 create frame; `club_members.role` has had `admin` since `001` and nothing writes it). Note the flow has two Explore designs — the row list is `Explore clubs — Done`, the 2-up grid is `Explore clubs v2 — On hold`. **Create club has no v2 design** — that epic reads To do, so its composition is ours |

**Blocking is a schema concern, not a feature.** A blocked user must disappear from feeds,
chat, search, and ride crews simultaneously. It belongs in RLS policies, and every review
must check it.

Maps are a **static thumbnail plus a Google Maps deeplink** — no Mapbox, no turn-by-turn,
no route rendering. Do not add a mapping SDK.

## Feature Workflow (OpenSpec)

Features with real domain rules — anything touching visibility, membership or
permissions — go through OpenSpec: `/opsx:propose` → `/opsx:apply` →
`/opsx:archive`. Small mechanical changes (copy, styling, a dependency bump) do
not need a proposal; requiring one for everything is how process gets ignored.

Proposals must state the **negative** cases, not just the positive ones: who
must *not* see or do this. Every access-control bug this project has had came
from a visibility rule nobody wrote down. Rules live in `openspec/config.yaml`.

## Testing

`supabase/tests/` holds the RLS policy suite. It applies the real migration
chain to a scratch database and asserts what each role can reach.

- **A migration that changes a policy must add an assertion.** A policy change
  with no new assertion is not finished.
- The suite runs on plain Postgres, so it cannot see environment-specific
  problems — role grants, exposed RPC endpoints, Supabase defaults. After
  applying a migration to the hosted project, also check the Supabase security
  advisors. A migration once passed locally and stayed broken in production
  because of exactly this gap.

## Branching & CI

- `main` = production. Auto-deploys to Vercel.
- All work on feature branches. Open PRs against `main`.
- **CI is scoped to what a PR can actually break**, decided by a `changes` job that
  diffs against the merge base:
  - **`Type Check, Lint & Build`** (tsc → ESLint → Vitest → `next build`) runs unless
    *every* changed file is under `docs/`, `design/`, `openspec/`, `.claude/` or a
    root `*.md`. That is a **denylist**, like `proxy.ts`'s public paths — a new
    top-level directory runs CI by default, so forgetting to list something costs
    one green run rather than a missed break.
  - **`RLS Policy Tests`** (Postgres 17) runs only when `supabase/**` or the workflow
    changes — the migration chain and the assertions are its only inputs.
  - A push to `main` always runs both. It is the deploy gate and it is rare.
  - Skipped jobs are skipped with `if:`, never a workflow-level `paths:` filter: a
    filtered-out workflow never reports its check, and a required check that never
    reports blocks the merge forever.
- Whatever runs must pass before merging.
- Never push directly to `main`.

## What Not To Do

- Don't add comments that just describe what the code does — only add comments for non-obvious WHY.
- Don't add error handling for impossible scenarios — trust Supabase + TypeScript.
- Don't import from `@supabase/supabase-js` directly — always use the wrappers in `lib/supabase/`.
- Don't query Supabase from inside a component — reads belong in `lib/data/`, writes in `lib/actions/`.
- Don't introduce a service-role key into the app. It bypasses every RLS policy; see decision #8.
- Don't add new UI libraries (no shadcn, Radix, MUI) — extend the existing custom primitives.
- Don't create a `middleware.ts` — this is Next.js 16, use `proxy.ts`.
- Don't run `playwright install` — Chromium is pre-installed at `/opt/pw-browsers`.
- Don't call the Figma API to answer a design question — read `design/`. Refreshing the
  snapshot is a deliberate monthly job, not something a feature task does.
- Don't poll a Figma 429 — read its `Retry-After` instead. It is a real countdown in seconds
  that requests do not reset, and waits have been measured in days.
- Don't convert the Figma styles to variables — it would move the whole token layer behind
  the Enterprise-only Variables API, which 403s permanently on this plan.
