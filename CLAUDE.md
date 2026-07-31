# LetsRide — Project Context for Claude Agents

LetsRide is a mobile-first web app for motorcycle riders to organise rides, join clubs, and connect with friends. Built with Next.js 16 App Router, Supabase, and Tailwind v4. Targeting thousands of users — prioritise correctness, security, and clean code over cleverness.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript strict) |
| Styling | Tailwind CSS v4 (CSS-first config, no `tailwind.config.*`) |
| Database / Auth | Supabase (Postgres + RLS + `@supabase/ssr`) |
| Icons | `lucide-react` |
| Deployment | Vercel (auto-deploy from `main`) |
| CI | GitHub Actions (type check + lint + build on every PR) |

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
│   ├── layout.tsx          # Root layout (Geist font, dark bg)
│   ├── page.tsx            # / — public landing page
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
└── migrations/             # SQL migrations (applied to Supabase project)
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

**Colors** (Figma variable → use):

| Token | Value | Use |
|---|---|---|
| `Grey/5` | `#F2ECE6` | App background (warm cream) |
| `White/100` | `#FFFFFF` | Cards, surfaces |
| `Grey/100` | `#1A1A1A` | Primary text, primary buttons |
| `Grey/80` | `#666666` | Secondary / muted text |
| `Grey/10%` | `#0000001A` | Dividers, subtle borders |
| `Grey/20%` | `#00000033` | Stronger borders |
| `Accent Brand/100` | `#3D996B` | Brand green — accents, success, splash |

Note: primary buttons are **near-black (`Grey/100`)**, not green. Green is an accent, used
sparingly — it is not the button colour.

**Type — Poppins** (there is no other family):

| Token | Size / LH | Weight |
|---|---|---|
| `Poppins/10/Medium` | 10 / 16 | 500 |
| `Poppins/12/Semibold` | 12 / 18 | 600 |
| `Poppins/14/Regular` | 14 / 20 | 400 |
| `Poppins/14/Medium` | 14 / 20 | 500 |
| `Poppins/14/Semibold` | 14 / 20 | 600 |
| `Poppins/16/Regular` | 16 / 24 | 400 |
| `Poppins/16/Medium` | 16 / 24 | 500 |
| `Poppins/32/Semibold` | 32 / 48 | 600 |

**Layout:** 390px mobile frame, single column, mobile-first. Fixed top header + fixed
bottom tab bar. Use `.pb-safe` for notch devices.

**Icons:** a custom set of ~40 (`Element / Icon / *` in Figma) including motorcycle-specific
ones — Bike, Garage, Wrench, Coordinates, Store. `lucide-react` does not cover these and is
being replaced. Pull icons from Figma, don't substitute lookalikes.

## Development Workflow

```bash
npm run dev      # start dev server
npm run lint     # eslint
npx tsc --noEmit # type check
npm run build    # production build (requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY)
```

**Environment variables** (never commit these):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Copy `.env.local.example` to `.env.local` for local development.

## The Agent Squad

Specialist agents live in `.claude/agents/`. Delegate to them rather than doing everything in the main thread.

| Agent | Use for |
|---|---|
| `design-system` | v2 tokens, component library, icon set — **blocks most other work** |
| `data` | Migrations, RLS policies, block lists, indexes, schema debugging |
| `feature` | Complete vertical slice — route, page, components, types, wiring |
| `realtime` | Chat (inbox + per-ride), notifications, unread counters, presence |
| `media` | Photo upload, Supabase Storage, compression, **EXIF stripping** |
| `rider-ux` | PWA, offline, geolocation, push, gloved-hand touch targets |
| `test` | Vitest/Playwright infra and tests |
| `reviewer` | Pre-merge review + mandatory RLS/data-exposure audit |

**Standard order for a feature that needs new schema:**
`data` → `feature` → `test` → `reviewer` → open PR

Skip `data` when no schema changes. Always run `reviewer` on someone else's output, never on its own work — the value is in the fresh eyes.

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

## Branching & CI

- `main` = production. Auto-deploys to Vercel.
- All work on feature branches. Open PRs against `main`.
- CI runs on every PR: TypeScript → ESLint → `next build`. All three must pass before merging.
- Never push directly to `main`.

## What Not To Do

- Don't add comments that just describe what the code does — only add comments for non-obvious WHY.
- Don't add error handling for impossible scenarios — trust Supabase + TypeScript.
- Don't import from `@supabase/supabase-js` directly — always use the wrappers in `lib/supabase/`.
- Don't add new UI libraries (no shadcn, Radix, MUI) — extend the existing custom primitives.
- Don't create a `middleware.ts` — this is Next.js 16, use `proxy.ts`.
- Don't run `playwright install` — Chromium is pre-installed at `/opt/pw-browsers`.
