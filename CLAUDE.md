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
│   ├── auth/               # /auth/login, /auth/signup (public)
│   ├── layout.tsx          # Root layout (Poppins, v2 light theme)
│   ├── page.tsx            # / — public landing page (still v1 dark)
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
│   └── utils.ts            # cn(), formatDate(), formatDateTime(), getInitials()
├── proxy.ts                # Auth middleware (Next.js 16 uses proxy.ts, not middleware.ts)
└── types/
    └── index.ts            # All shared domain types (Profile, Club, Ride, etc.)
supabase/
├── migrations/             # SQL migrations — append-only, see Supabase Rules
└── tests/                  # RLS policy suite (npm test); README covers its scope
docs/
├── HANDOFF.md              # Current position — read at session start
└── specs/                  # Implementation specs (login-onboarding.md)
openspec/                   # Spec-driven change proposals + config.yaml
.claude/
└── agents/                 # The specialist squad (see The Agent Squad)
```

## Critical: proxy.ts (not middleware.ts)

Next.js 16 uses `src/proxy.ts` instead of `src/middleware.ts`. The exported function must be named `proxy` (not `middleware`). Do not rename it or add a `middleware.ts` — the framework will break.

Protected routes (redirect to `/auth/login` if no session): `/dashboard`, `/rides`, `/clubs`, `/friends`, `/profile`.
Auth routes (redirect to `/dashboard` if already signed in): `/auth/*`.

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
| `friendships` | `requester_id`, `addressee_id`, `status`: `pending` \| `accepted`. |

**Migrations:** Add new SQL files to `supabase/migrations/` with incrementing prefix (e.g., `002_add_column.sql`). Never edit existing migrations — always add new ones.

**The canonical project is `letsride`, ref `zwprydcyryvudhurbnye`** (`eu-west-1`). There is
exactly one, and every environment points at it — Vercel's `NEXT_PUBLIC_SUPABASE_URL` and
the GitHub Actions secrets of the same name. A second project named `LetsRide`
(`ylxnicopnaroltebvfnc`) existed briefly, was never referenced by anything, and has been
deleted. Recorded here because it is not secret — the ref ships in the client bundle as
part of the Supabase URL — and because not knowing it cost real time.

**Applied state:** everything except `003_onboarding` is applied. `003` must not be
applied until the `full_name` call sites are fixed in the same change, and
`supabase/tests/run.sh` skips it for that reason — remove it from `SKIP_MIGRATIONS` in
the change that deploys it.

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
- Server pages: plain `async function Page()` — fetch from Supabase directly.
- Client pages/components: `'use client'` at the top.
- Default export for pages, named exports for reusable components.

**Mutation pattern in client components:**
```ts
const supabase = createClient()
await supabase.from('table').insert(...)
router.refresh()  // revalidates server component data without full navigation
```

**UI primitives** (always use these, don't reinvent):
- `<Button>` — variants: `primary` (orange), `secondary`, `ghost`, `danger`. Prop: `loading`.
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

**These tokens are Figma *paint and text styles*, not variables.** That distinction is load
bearing: the Variables REST API is Enterprise-only and returns 403 on this plan, but style
names ship in the `styles` map on any `/v1/files/:key/nodes` response, so the whole token set
is readable. 87% of fills on the Components page reference a named style. Never convert these
to Figma variables — it would move the entire token layer behind the 403.

Everything below was extracted from the file and verified on 2026-08-01. `n` is how many
times the style is used on the Components page — a good proxy for how central it is.

**Colors:**

| Token | Value | n | Use |
|---|---|---|---|
| `Grey/100` | `#1A1A1A` | 275 | Primary text, primary buttons |
| `White/100` | `#FFFFFF` | 222 | Cards, surfaces, text on dark |
| `Grey/80` | `#666666` | 101 | Secondary / muted text, icons |
| `Grey/5` | `#F2ECE6` | 54 | App background (warm cream) |
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

There is no `Poppins/32/Semibold`. This file previously documented one; it does not exist in
Figma. The display sizes are 24/36 and 40/60.

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
in 15 files and is being replaced — don't substitute lookalikes.

**The library scale**, for planning: 52 component sets covering 213 variants, plus 88
standalone components, 2,447 nodes on the Components page.

## Development Workflow

```bash
npm run dev      # start dev server
npm run lint     # eslint
npx tsc --noEmit # type check
npm run build    # production build (requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY)
npm test         # RLS policy suite (needs Postgres + psql; see supabase/tests/README.md)
```

**Environment variables** (never commit these):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

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

**Unapplied migrations are drift.** A migration in the repo that has not run against the
database means the schema in git and the schema in Postgres disagree. Two are outstanding
now. Apply them before adding a third; a queue of unapplied migrations fails in the order
nobody tested.

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
- Don't add new UI libraries (no shadcn, Radix, MUI) — extend the existing custom primitives.
- Don't create a `middleware.ts` — this is Next.js 16, use `proxy.ts`.
- Don't run `playwright install` — Chromium is pre-installed at `/opt/pw-browsers`.
