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
| Icons | `lucide-react` — **v1, being replaced** by the Figma icon set (see Design System) |
| Deployment | Vercel (auto-deploy from `main`) |
| CI | GitHub Actions (type check + lint + build + RLS policy suite on every PR) |

## Technology Decisions

*What* we build is under Architectural Decisions. This is *how* — the tooling questions that
otherwise get answered differently in every epic. Drafted 2026-08-02; edit freely, but edit
here rather than deciding again inside a PR.

**Dependencies are added deliberately.** Nine runtime dependencies today, and that is a
feature. Before adding one, ask whether a thirty-line helper does the job. No UI component
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
is v1. `JoinRideButton` and `JoinClubButton` still use it. Migrate on contact, the same way
v1 styling is handled, and never add more.

**Validation: Zod, one schema per concern, shared by both sides.** Lives in
`src/lib/validation/`. A Server Action receives untrusted `FormData` and must parse it; the
client needs the same rules for live feedback. Two hand-written copies of the username rule
will drift, and the one that drifts silently is the server's. This is the only new runtime
dependency this section introduces.

**Forms are hand-rolled** — controlled inputs plus `useActionState`. No React Hook Form or
Formik; the forms in this app are one to three fields.

**Tests:**

| Kind | Tool | Status |
|---|---|---|
| RLS policies | `supabase/tests/` — psql against Postgres 17 | In place, gates every PR |
| Units — validation, `lib/utils.ts`, `lib/data/` | Vitest — `npm run test:unit` | In place, gates every PR. Covers `lib/validation/`, `lib/media/`, `getInitials` and `safeNext`; `lib/data/` and `lib/actions/` are not covered yet |
| End-to-end | Playwright | Deferred until a flow is stable enough to be worth maintaining |

Chromium is pre-installed at `/opt/pw-browsers`; never run `playwright install`.

**Versions.** `package-lock.json` is committed and CI runs `npm ci`, so what ships is already
pinned — this policy governs what moves on a routine `npm install`. Pin exact for anything
the framework or auth depends on: `next`, `eslint-config-next`, `react`, `react-dom`,
`@supabase/ssr`, `@supabase/supabase-js`. Caret is fine for leaves (`clsx`, `tailwind-merge`).
Supabase is on that list because a minor bump that changes cookie handling breaks sessions
silently.

**Dates: `Intl` only, no date library.** `formatDate` / `formatDateTime` in
`src/lib/utils.ts`. Both currently hardcode `en-US`, which is a bug for a European rider app
rather than a decision.

**Deliberately undecided** — raise these rather than inventing an answer: error tracking,
analytics, i18n, and email delivery beyond Supabase's built-in auth mails.

## Repo Layout

```
src/
├── app/                    # Next.js App Router pages
│   ├── (app)/              # Authenticated route group — has Navbar
│   │   ├── layout.tsx      # Renders <Navbar /> (fixed top + fixed bottom tabs)
│   │   ├── dashboard/      # /dashboard
│   │   ├── rides/          # /rides, /rides/new, /rides/[id]
│   │   ├── clubs/          # /clubs, /clubs/new, /clubs/[id]
│   │   ├── friends/        # /friends
│   │   └── profile/        # /profile
│   ├── auth/               # /auth/login, /auth/signup, /auth/callback (public)
│   ├── legal/              # /legal/terms, /legal/privacy — public, see decision #1
│   ├── layout.tsx          # Root layout (Poppins, v2 light theme)
│   ├── page.tsx            # / — splash resolver: redirects by session (see decision #7)
│   └── globals.css         # Tailwind import + CSS vars + .pb-safe
├── components/
│   ├── ui/                 # Button, Input, Card, Avatar
│   ├── layout/             # Navbar
│   ├── rides/              # JoinRideButton
│   ├── clubs/              # JoinClubButton
│   ├── friends/            # FriendActions, SearchRiders
│   └── profile/            # EditProfileForm, SignOutButton
├── lib/
│   ├── supabase/
│   │   ├── client.ts       # Browser client — use in 'use client' components
│   │   └── server.ts       # Server client — use in server components / route handlers
│   ├── data/               # Read functions — the only place that queries Supabase
│   ├── actions/            # Server Actions — the only place that writes
│   ├── validation/         # Zod schemas, shared by client and server
│   ├── media/              # Image compression + EXIF stripping, browser-only
│   ├── auth/               # recovery.ts — cookie name shared by callback + action
│   └── utils.ts            # cn(), formatDate(), formatDateTime(), getInitials()
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

`src/lib/{data,actions,validation,auth}`, `app/auth/*`, `app/onboarding/*` and `app/legal/*`
were all created by the login epic, which is shipped. What is still v1 is everything under
`app/(app)/*`.

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
- **Session + `/auth/login` or `/auth/signup`** → `/dashboard`. Note the two paths:
  bouncing *all* of `/auth/*` breaks password recovery, because Supabase's link
  establishes a session before the reset page loads.

## Supabase Rules

**Always use the right client:**
- Server components, Route Handlers, Server Actions → `import { createClient } from '@/lib/supabase/server'`
- Client components (`'use client'`) → `import { createClient } from '@/lib/supabase/client'`
- Never cross these. Never import the server client in a client component.

**RLS is ON for all tables.** Every query runs under the authenticated user's session. You do not need to filter by `user_id` manually — RLS policies enforce ownership. But do add RLS policies in migrations for any new table.

**Schema (key tables):**

| Table | Purpose |
|---|---|
| `profiles` | One per auth user. PK = auth user UUID. Has `username`, `full_name`, `bio`, `bike_model`, `avatar_url`. |
| `rides` | Rides with `organizer_id → profiles`, optional `club_id → clubs`. |
| `ride_members` | `(ride_id, user_id)` composite PK. `status`: `going` \| `maybe`. |
| `clubs` | Clubs with `owner_id → profiles`. |
| `club_members` | `(club_id, user_id)` composite PK. `role`: `owner` \| `admin` \| `member`. |
| `friendships` | `requester_id`, `addressee_id`, `status`: `pending` \| `accepted`. v1 leftover — signed off for deletion. |
| `postcards` | The photo feed / home screen. `author_id → profiles`, optional `club_id → clubs`. **`club_id` IS the audience** — NULL means the app-wide feed, set means that club's members. There is deliberately no `is_public` flag. `image_path` is a Storage object path, never a URL, and must sit under `postcards/<your uid>/`. |
| `postcard_likes` | `(postcard_id, user_id)` composite PK. No denormalised count — the correct count is per-viewer, so it is counted under RLS. |
| `blocks` | `(blocker_id, blocked_id)` composite PK. The row is **directional**, the effect **symmetric**. Never query it from a policy — go through `private.is_blocked(a, b)`, which is `security definer` because the blocked party cannot read the row. |

**Migrations:** Add new SQL files to `supabase/migrations/` with incrementing prefix (e.g., `002_add_column.sql`). Never edit existing migrations — always add new ones.

**The canonical project is `letsride`, ref `zwprydcyryvudhurbnye`** (`eu-west-1`). There is
exactly one, and every environment points at it — Vercel's `NEXT_PUBLIC_SUPABASE_URL` and
the GitHub Actions secrets of the same name. A second project named `LetsRide`
(`ylxnicopnaroltebvfnc`) existed briefly, was never referenced by anything, and has been
deleted. Recorded here because it is not secret — the ref ships in the client bundle as
part of the Supabase URL — and because not knowing it cost real time.

**Applied state: `001`–`010` are all applied to the hosted project.** `009_postcards_and_blocks`
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
| `Pink/100` | `#F23071` | 2 | Purpose not established — check before using |
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

**Icons: 44**, under `Element / Icon / *`, confirmed present. Includes the
motorcycle-specific ones `lucide-react` cannot supply — Bike, Garage, Wrench, Coordinates,
Store — plus Arrow Left/Right/Up, Avatar, Block Account, Calendar, Chat Bubble, Check,
Chevron Down/Right, Clock, Close, Clubs, Delete, Edit, Flag, Globe, Heart Filled/Outline,
Hide, Home, Image, Location Filled/Outline, Lock, Log Out, Mailbox, Menu, Mute, Options,
Paper Plane, Pin, Plus, Plus Circle, Preferences, Profile, Report, Search, Share.
Export them as SVG via `/v1/images/:key?ids=…&format=svg`. `lucide-react` is still imported
in 12 files and is being replaced — don't substitute lookalikes.
(`git grep -l lucide-react -- 'src/*' | wc -l` — this said 15 until it was measured.)

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
npm run figma -- tree "Home / Feed"  # structure, sizes and tokens, one line per node
npm run figma -- text "Home / Feed"  # every string, with its type token
npm run figma -- tokens Grey         # token tables
```

Refreshing it needs the network and is a **monthly** job, not a per-session one:

```bash
npm run figma:check   # one cheap call — is the snapshot even stale?
npm run figma:pull    # the expensive call; extracts automatically
npm run figma:icons   # export Element / Icon / * as SVG
npm run figma:check -- --probe   # sweep every endpoint when something looks blocked
```

If `figma:pull` returns 429, stop — do not poll. See `design/README.md`.

**Environment variables** (never commit these):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `FIGMA_ACCESS_TOKEN` — only needed to *refresh* the snapshot, never to read it

Copy `.env.local.example` to `.env.local` for local development.

## The Agent Squad

Specialist agents live in `.claude/agents/`. Delegate to them rather than doing everything in the main thread.

| Agent | Use for |
|---|---|
| `spec` | Turns a Figma flow into a buildable spec; lists undefined cases as questions |
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
spec → data → design-system → feature → test → reviewer → PR
```

Skip `spec` when the flow is already specced, `data` when there's no schema change, and `design-system` when every component already exists. Swap in `realtime` or `media` for `feature` when the work is chat/notifications or images. Always run `reviewer` on someone else's output, never on its own work — the value is in the fresh eyes.

## Architectural Decisions

Settled. Don't reopen these without an explicit decision to change them.

**1. No anonymous access, anywhere.** Every route outside `/auth/*` requires a session. No policy grants to the `anon` role. `is_public = true` means "visible to any signed-in rider", never "visible to the internet". The Figma's guest-browsing screens ("Become a rider" on a club page) are out of scope.

**2. Blocking is enforced in RLS, not in the UI.** A blocked user disappears from feeds, search, chat, member lists, and ride crews simultaneously. One `security definer` helper applied across policies. Blocks are symmetric even though the row is directional.

**3. Maps are a static thumbnail plus a Google Maps deeplink.** No mapping SDK, no turn-by-turn, no route rendering.

**4. v2 is the only design.** v1 (`zinc-*`, `orange-500`, Geist, `lucide-react`) is superseded. Migrate on contact; never add more.

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
  rule currently living in 35 policies and 186 test assertions gets reimplemented in
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

**Rate every suggestion: complexity 0-10, recommendation 0-10.** Whenever you propose
optional work — a refactor, a test, a hardening, a follow-up — give both numbers and one line
of reasoning. Complexity is effort plus risk plus the maintenance it adds. Recommendation is
how strongly you actually advise doing it, independent of how interesting it is to build.

The two are not correlated, and saying so is the point: a 1/10 complexity item can be a 9/10
recommendation, and a clever 6/10 build can be a 2/10 recommendation. Rate your own ideas
honestly, including low — an unrated suggestion reads as advocacy, and the reader cannot
cheaply decline it. If you would not spend your own afternoon on it, say so in the number.

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
Inbox, Profile**. There is no "Friends" tab; the `friendships` table is a v1 leftover.

| Domain | Status in code |
|---|---|
| **Postcards** — photo feed, likes/comments/shares, club-scoped, is the *home screen* | Not built |
| **Inbox** — DMs, per-ride group chat, notifications | Not built |
| **Garage** — user's motorcycles, gear, badges, countries ridden | Not built |
| **Trust & safety** — block account, report post, hide postcard, delete account | Not built |
| **Rides** — cover image, static map + Google Maps deeplink, Plan/Journal/Crew tabs, Going/Maybe/No, per-ride chat | Partially built |
| **Clubs** — public/private, Overview/Rides/Members/Posts tabs | Partially built |

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
- CI runs on every PR: TypeScript → ESLint → `next build`, plus the RLS policy
  suite against Postgres 17. All must pass before merging.
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
- Don't poll a Figma 429. Windows last hours and the budget is inherited across sessions.
- Don't convert the Figma styles to variables — it would move the whole token layer behind
  the Enterprise-only Variables API, which 403s permanently on this plan.
