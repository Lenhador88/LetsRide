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

- **Background:** `bg-zinc-950` (root), `bg-zinc-900` (cards)
- **Borders:** `border-zinc-800`
- **Primary/accent:** `orange-500` (buttons, active states, focus rings)
- **Muted text:** `text-zinc-400` / `text-zinc-500`
- **Errors:** `text-red-400` / `border-red-500`
- **Layout:** Single-column, `max-w-lg mx-auto px-4`, mobile-first
- **Fixed Navbar:** Top bar (`h-14`, add `pt-14` to page content) + bottom tab bar (`pb-20`)
- **Safe area:** Use `.pb-safe` utility for bottom padding on mobile notch devices
- Icons: `lucide-react` only

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
