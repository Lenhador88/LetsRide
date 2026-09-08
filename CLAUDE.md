# LetsRide — Project Context for Claude Agents

> **▶ Starting a session? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) now.** This file is the
> rulebook. The handoff is the *current position* — five fixed sections, and nothing else. Look-up
> material — the schema, the migration log, the walk, known issues, the CI hand-gate — is under
> [`docs/reference/`](docs/reference/) and is reached by name, never loaded. The dated record of
> what each session did is [`docs/reference/journal.md`](docs/reference/journal.md); nothing
> loads it, and nothing should.

LetsRide is a mobile-first app for motorcycle riders to organise rides, join clubs, and connect
with other riders — client-rendered, and headed for a native iOS/Android build. Next.js 16 App
Router, Supabase, Tailwind v4. Targeting thousands of users — prioritise correctness, security and
clean code over cleverness.

(**"Friends" is not a concept here** — `013` dropped `friendships` and there is no Friends tab.
The social graph is clubs plus blocking. A dropped table gets designed back in by exactly this
route: prose that still names it.)

**This file and the handoff have a size budget, and `scripts/docs/__tests__/context-budget.test.mjs`
enforces it.** Both are loaded by every session, and this one is re-paid by every subagent. A
sentence earns a place here only if it changes what the next session does. A correction, a
measurement, an incident or a story belongs in the commit message, in the reference doc that owns
the topic, or in the journal — **replace a wrong claim; never narrate it.**

## Working With the Product Owner

Two standing instructions that resolve in **opposite** directions.

**Ambiguity → assume and proceed.** Ask only when two readings would produce materially different
work. Otherwise take the most sensible reading, state it in one line, and build.

**Disagreement → stop and wait.** If the request looks like a genuine mistake — the query that
breaks, the row that leaks, the migration that cannot be reversed — say so concretely and do not
build it until there is an answer. Naming, structure and style are never grounds to hold. "This
seems risky" is a mood, not an objection.

**One hold per issue.** If the decision is reaffirmed, build the full request and drop it. Record
the concern once, in the commit message or the handoff. **Never manufacture an objection to look
diligent.**

**When nobody is there to answer** — a scheduled run, a webhook wake — do every part that does not
depend on the disputed decision, leave that part undone, and put the objection where it will be
seen: a PR comment, the commit message, or the handoff. A subagent cannot wait: it surfaces the
objection at the top of its final report and the main thread holds.

**Branch cleanup is an owner action** — `git push origin --delete` answers HTTP 403 here.
`docs/reference/constraints.md` §Branch cleanup has the safety question and the snapshot.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript strict) |
| Styling | Tailwind CSS v4 (CSS-first config, no `tailwind.config.*`) |
| Database / Auth | Supabase (Postgres + RLS + `@supabase/supabase-js`). **`@supabase/ssr` is gone** — the session lives in `src/lib/supabase/session-store.ts` |
| Icons | The Figma set, generated to `src/components/icons/generated.tsx`. `lucide-react` is **gone** |
| Client cache | Hand-rolled, `src/lib/query/` — `useQuery`, `invalidate`, `setQueryData`, `clearQueryCache`. **Not TanStack Query.** `keys.ts` is the contract |
| Deployment | Vercel (auto-deploy from `main`) |
| CI | GitHub Actions — type check + lint + unit tests + build, the Edge Functions' Deno check, the RLS suite, the smoke walk. Path-scoped; see Branching & CI |

## Technology Decisions

*How* we build. Edit here rather than deciding again inside a PR.

**Feature flags need a reason** (owner, 2026-08-19: *"only use toggles if it seems really
necessary, or if I ask for them."*). A flag defaulting off makes the thing behind it untestable, and
a build-time `NEXT_PUBLIC_*` flag is an undeclared DEV/PROD separator. Say in the same comment what
has to become true for the flag to be deleted.

**Dependencies are added deliberately.** **Thirteen** runtime dependencies today, and that is a
feature. Count rather than trust it:
`node -p "Object.keys(require('./package.json').dependencies).length"`. Before adding one, ask
whether a thirty-line helper does the job. No UI component libraries — extend `src/components/ui/*`.

- **Three are observability** — `@sentry/capacitor` + `@sentry/react` (a pinned pair) and
  `posthog-js`. Each is a doorway module in `src/lib/` that nothing else imports the package
  through, enforced by a test. `docs/reference/observability.md` §The dependencies.
- **Three are the native shell's** — `@capacitor/core`, `@aparajita/capacitor-secure-storage` (the
  keychain behind `window.__letsrideSecureStore`) and `@capacitor/push-notifications` (the only
  route to an APNs or FCM token, since the providers hand one to native code alone). Native plugins
  count: each is a permission prompt, a review question and a supply-chain surface, and each needs a
  one-sentence justification (`.claude/agents/native.md`). The last is a doorway too —
  `src/lib/push/registration.ts`, enforced by `src/lib/push/__tests__/doorway.test.ts`, which also
  pins that **only that file may raise the OS notification dialog**: iOS grants one per install.

**Reads go through `src/lib/data/`. Components never call Supabase directly.** Named, typed
functions — `getRide(id)`, `getClubMembers(clubId)` — that own their query shape.
`git grep -c "\.from('" -- 'src/*.ts' 'src/*.tsx'` is the spread.

**Every embed of `profiles` names its foreign key.** PostgREST counts relationships, a junction adds
one, and an unhinted embed answers `PGRST201` / HTTP 300 through every gate green. Membership rows
go through `MEMBER_PROFILE_EMBED` in `lib/data/columns.ts`; `!inner` is a join modifier, not a hint.
`docs/reference/schema.md` §Embed hints has the mechanism.

```bash
npx vitest run src/lib/data/__tests__/embed-hints.test.ts
```

**Writes go through `src/lib/actions/`**, one plain async function per mutation — never a Server
Action, never dissolved back into components:

1. RLS enforces *authorization*, never *validity*. Username charset, T&C acceptance and the
   onboarding stamp are integrity rules the database owns (CHECK, trigger or grant), which is what
   made client-side writes safe. **The participation gate is narrower than "every write"** —
   `docs/reference/schema.md` §The participation gate has the table list and the count query.
2. `useActionState` gives pending and error states, and works the same with a plain async function.

A component never calls `supabase.from()`. Keep the second half of the pipe; the bare grep
prints 3, all comments (the comment trap, below):

```bash
grep -rn "supabase\.from(" src/app/ src/components/ | grep -vE ':[0-9]+:\s*(\*|//|/\*)'
```

**The render model is the client.** The app is a client-rendered bundle so it can go into a
native build: store presence is a product requirement, and background location tracking cannot be
done on the web at all. The client talks to Supabase directly under RLS with the publishable key.
**This is decision #8 read literally**: the backend stays Supabase, plus a handful of Edge
Functions for the jobs needing a secret, a schedule or elevated rights.

**The refresh token is JS-readable** — the store is `src/lib/supabase/session-store.ts`, and the
exposure closes only when `window.__letsrideSecureStore` runs over a platform keychain.

**The SSR shell is the one piece of the server render still standing**, and retiring it is the
`native` agent's work. **Retiring it does not lift the *read in an effect* rule — the rule is
permanent**, because `output: 'export'` still runs the prerender pass with no `localStorage` and
no session. Re-derive the scope:

```bash
git ls-files src/app | grep -c 'page\.tsx$'                         # pages
git grep -L "^'use client'" -- 'src/app/**/page.tsx' | wc -l        # ... server-rendered: 0
git grep -L "^'use client'" -- 'src/components/**/*.tsx' | wc -l    # presentational components
```

The third line is not a defect count: a component without `'use client'` joins the client graph
through its importer.

**The comment trap — this repo's most-repeated measurement error.** A file's description of what
it migrated *away from* looks exactly like the thing it migrated away from, so a grep for a retired
pattern counts its own obituaries. Two rules: **a directive is only a directive on line one**
(hence the `^` above), and when counting a retired pattern, exclude comment lines and verify the
filter both ways — that it reads 0 now *and* still catches a real instance.

**No new integrity rule may live only in a Zod schema.** Anything not a CHECK, trigger or policy is
advisory, because a rider can simply not run your validation.

**`lib/data/` and `lib/actions/` are where reads and writes live, and both resolve their client
through `src/lib/supabase/resolve.ts`.** One name, one doorway. **A handful of modules outside
them reach Supabase's TABLES only through an own-row `security definer` RPC, never `.from()`** —
the guard cache, password recovery and push registration today. Those functions do read and write
tables; what makes them safe outside the doorways is that each resolves its subject from the
caller's own verified claims — `auth.uid()`, or for the recovery grant the `session_id` in
`auth.jwt()`, which is what keeps one link to one reset — and carries its own gate, so there is no
query shape for a caller to get wrong. Count rather than trust that list, and note the pathspec: the natural
`-- src/lib/` prints the two doorways too.

```bash
grep -rn "\.rpc(" src/lib/ --include=*.ts | grep -vE "^src/lib/(data|actions)/" | grep -v __tests__
```

**Do not reach for a "just check at runtime" fix to a bundling problem.** Next refuses to bundle
`next/headers` into a client graph whether or not the branch can be taken, and a `typeof document`
guard around a dynamic `import()` does not help.

**Read in an effect or an event handler, never during render.** A `'use client'` component is
still server-rendered on first load, and in that pass a read is anonymous and fails closed at RLS.
`resolve.browser.ts` throws a named error when that happens.
`src/lib/data/__tests__/isomorphic.test.ts` guards the module graph.

**Reads in a client component go through `useQuery`, and every key is spelled in
`src/lib/query/keys.ts`** — an inline key is a bug even when the string is right. `keys.ts` also
owns `filterSegment`.

**Gate a screen on its data, never on `isLoading`.** On the first render there is no data *and* no
fetch in flight. `combineQueries` deliberately exposes no `isLoading`.

**`null` is a decided answer; `undefined` is "not yet".** Only the first is `notFound()`.

**Validation: Zod, one schema per concern**, in `src/lib/validation/`. Zod owns the **message**,
never the **guarantee**. **Forms are hand-rolled** — controlled inputs plus `useActionState`.

**Tests:**

| Kind | Tool | Status |
|---|---|---|
| RLS policies | `supabase/tests/` — psql against Postgres 17 | Gates every PR touching `supabase/**` |
| Units — validation, `lib/utils.ts`, `lib/data/`, `lib/actions/`, the cache, the route guard, the session store | Vitest — `npm run test:unit` | Gates every PR that touches code. `src/lib/auth/guard.ts` (57 cases, replacing the untestable `proxy.ts`). `lib/actions/__tests__/` reads every action module on comment-stripped source to assert each stamp writer invalidates the guard cache and each table writer makes a cache claim. **Forty-nine** component tests exist — `PostcardAction` was the first; count them with `git ls-files 'src/**/*.test.tsx' \| wc -l`. Each pins one thing a refactor reverses in silence, verified both ways. Almost all render through `renderToStaticMarkup` under `environment: 'node'`; **jsdom is the answer only when something needs a mounted effect, a layout, an event or a portal**, and each jsdom test states which in its header — `git grep -l "@vitest-environment jsdom" -- 'src/**/*.test.tsx'` |
| Edge Functions | `deno check`, CI's `functions` job | Type-checks every `index.ts` under Deno when `supabase/functions/**` changes. `tsconfig.json` excludes the directory, so `tsc` never sees the entrypoints |
| Smoke walk | `npm run walk` — playwright-core against DEV | **The only gate that renders anything**: signs in, walks every screen including discovered detail routes, checks the guard's redirects and sign-out. `WALK_FIXTURES=1` creates the rows the detail routes need; a shrunken `N/N` is a skip, not a pass. In CI as the `walk` job, minting its own rider, **skipped until the repository variable `WALK_CI=1` is set** because the Actions secrets name PROD. Not a required check yet (PD-370) |
| End-to-end | Playwright | Deferred as a full suite. The walk asks one question per route — did this render — and asserts behaviour only in named phases, each covering a defect no other gate can see |

Chromium is pre-installed at `/opt/pw-browsers`; never run `playwright install`. **Chromium in this
container cannot reach Supabase** — `scripts/supabase-relay.mjs` is the fix; read its header.

**Versions.** `package-lock.json` is committed and CI runs `npm ci`. Pin exact for `next`,
`eslint-config-next`, `react`, `react-dom`, `@supabase/supabase-js` and **every Capacitor package**.
Caret is fine for leaves.

**Dates: `Intl` only, no date library**, all in `src/lib/utils.ts`, every formatter **named for
the screen it serves** (`formatPostcardDate`, `formatRideDate`, …). There is deliberately no
generic `formatDate`.

**A ride's times are wall-clock at its meeting point** — `rides.timezone`, with `APP_TIME_ZONE`
(`Europe/Amsterdam`) as the fallback. Every `formatRide*` helper and `wallClockToUtc` take the zone
as a **required** argument, `null` meaning "we do not know"; the viewer's own zone is never the
answer. `080`'s `enforce_ride_timezone` keeps the typed wall-clock when the zone moves;
`rideZone()` falls back for anything `Intl` cannot format in.

**Deliberately undecided** — raise rather than invent: i18n, and email delivery beyond Supabase's
built-in auth mails. Analytics is decided: `docs/reference/analytics.md`, and failed requests are
readable for 24 hours via `npm run logs:errors` (`docs/reference/observability.md`).

## Repo Layout

**The annotated tree is [`docs/reference/repo-layout.md`](docs/reference/repo-layout.md).** It is
a hand-copied `ls` and goes stale silently, so check rather than trust it:

```bash
for d in src/components/*/; do echo "$d: $(ls "$d" | sed 's/\.tsx\?$//' | tr '\n' ' ')"; done
```

## Critical: the route guard is a client component, not middleware

**`src/proxy.ts` is deleted**, and there is no `middleware.ts`. Routing decisions live in three
places, split so the decision can be tested:

- **`src/lib/auth/guard.ts`** — `resolveDestination(pathname, state)`, a pure function.
  `null` means stay; a string is where to go. 57 cases in `__tests__/guard.test.ts`.
- **`src/lib/auth/guard-cache.ts`** — what the decision reads: the session and the onboarding
  stamps, **held for the page load rather than fetched per route**, with `onAuthStateChange` as
  the single writer for the session half.
- **`src/components/auth/RouteGuard.tsx`** — applies the decision synchronously after the first
  one, and renders the splash only while it genuinely cannot answer. Mounted in the **root**
  layout. **The splash overlays the page once booted; it replaces it only before the first
  decision** — replacing it on every navigation unmounts `(app)/layout.tsx`.

**Any new writer of a stamp the decision reads must invalidate the cache.** There are four
(`signUp`, `acceptTerms`, `setUsername`, `setHomeCountry`), each calling
`invalidateOnboardingState()`; `signOut` calls `clearGuardCache()`.
Count them rather than trust the number — scope the pathspec, or the natural
`-- src/lib/actions/` prints four *lines* summing to **7** (the comment trap, two of them tests):

```bash
git grep -c "invalidateOnboardingState()" -- 'src/lib/actions/*.ts' \
  | grep -v __tests__ | awk -F: '{n += $2} END {print n}'   # 4
```

`src/lib/actions/__tests__/writers-invalidate.test.ts` refuses a new writer that does not, and
**that check is per EXPORTED FUNCTION, not per file** — `onboarding.ts` holds three of the four,
so a file-granular check passes while any one of them keeps its call (measured: with
`setHomeCountry`'s invalidation deleted, the per-file version reported 30/30 green). **The
decision reads three fields and only two are stamps** — `terms_accepted_at`,
`onboarding_completed_at` and `has_username` — so `setUsername`, which writes no stamp since
PD-428, still owes the invalidation. **Necessary, never sufficient**: `guard-cache.ts` carries a
generation counter so a read discards its own answer if the stamps moved underneath it — a new
writer owes the invalidation and nothing more.

**It is not a security boundary.** RLS is. Every rule the guard enforces has a database
counterpart (`003`, `012`, `023`, `025`).

**Protection is a denylist of public paths, not an allowlist of protected ones:**

```
'/', '/auth/login', '/auth/signup', '/auth/forgot-password',
'/auth/reset-password', '/auth/callback', and '/legal/*'
```

Four rules, each with a test naming the trap it avoids:

- **No session + non-public path** → `/auth/login`. `/` is public but empty, so it goes too.
- **Session + onboarding incomplete** → the resume step. Read from `my_onboarding_state()`; never
  from `user_metadata`, which the client can write. Consent is gated ahead of the wizard.
- **Session + `/auth/login` or `/auth/signup`** → `/postcards`. Only those two: bouncing all of
  `/auth/*` breaks password recovery.
- **The stamp read failed** → `/auth/login?error=profile_unavailable`, except on the two auth
  entry paths, where it must fall through. Zero rows is this case, not "un-onboarded".

## Supabase Rules

**Three Edge Functions, deployed to both projects**: `delete-account` (the only place a
service-role key exists — the Auth admin API needs it), `resolve-ride-location` (geocodes a
meeting point and renders its tiles) and `search-places` (proxies the typeahead). Four rules on
`delete-account`, which is why it does not contradict §What Not To Do — **the function is not the
app**: the key lives only in the function's secret store (`src/__tests__/no-service-role-key.test.ts`
is the tripwire); it takes no user id; it verifies the JWT itself; only CI's `functions` job
type-checks it.

**A merge deploys them** — `.github/workflows/deploy-functions.yml` runs on a push to
`development` (→ DEV) or `main` (→ PROD) touching `supabase/functions/**`, waits for Vercel's
Deployment of that sha to be `success`, then deploys. Read the `deploy` **job's** conclusion,
never the run's: without the token the job skips and the run is still green. It fixes future drift
only; a `workflow_dispatch` (`all`, per project) catches up anything already stale. No session
deploys by hand. `docs/reference/ci.md` §Edge Function currency has the three commands; the
`ezbr_sha256` says the two projects agree, and equality is not currency.

**`resolve-ride-location` has an ORDERING rule opposite to a migration's**: it sends
`attribution=none`, so the app's `MapAttribution` must be **serving before the function is
deployed**. A duplicate credit is harmless; an absent one is a licence breach.

**One doorway:** anything in `src/lib/data/` or `src/lib/actions/` imports `resolveSupabase` from
`@/lib/supabase/resolve`. A component that genuinely needs the client itself imports `createClient`
from `@/lib/supabase/client` — a **session or transport** concern only, never a read:

```bash
grep -rln "from '@/lib/supabase/client'" src/ | grep -v "src/lib/supabase/"   # 7
```

**RLS is ON for all tables.** Do not filter by `user_id` by hand; do add policies in migrations for
any new table.

**Schema: the per-table contract is [`docs/reference/schema.md`](docs/reference/schema.md).** Read
it before touching any table — several audience predicates are counter-intuitive. **`places` is
RETIRED (`070`)**; the typeahead is a geocoder reached through `search-places`, credited on
`/legal/attributions`.

**Migrations:** new files in `supabase/migrations/` with an incrementing prefix. Never edit an
existing one. **Filename order equals apply order.**

**PROD is `letsride`, ref `zwprydcyryvudhurbnye`; DEV is `letsride-dev`, ref
`fpmrimzxadewsaiwpsel`** (both `eu-west-1`). Vercel's Preview and Development targets point at DEV.
**The GitHub Actions secrets still point at PROD** (PD-371), so nothing in CI writes until they are
repointed. `docs/ENVIRONMENTS.md` is the contract. **Never promote a Vercel preview to production**
— both Supabase variables are inlined at build time and promote does not rebuild. **Check drift
rather than claiming it**: `npm run db:drift` compares migration *names*.

**Applied state: 116 files. DEV is at `116` and PROD at `112` — measured 2026-09-08.** DEV-ahead
is the resting state between a merge and its promotion; promote everything the gap contains, in
filename order, per `docs/ENVIRONMENTS.md` §Migrations, and record each file's ordering in
`docs/reference/migrations.md` §Applied state. Count rather than trust it — `list_migrations`
against both refs, against `ls supabase/migrations/*.sql | wc -l`. **DEV records THREE rows with
no file and PROD none** — the long-standing hand-applied ones. **`113` then `114` is a required
order on the PROD promotion and must not be collapsed**: `114` refuses a NULL country, so applied
ahead of the bundle that writes one it strands every new signup in a wizard with no skip.
`docs/reference/migrations.md` §Applied state has that gate.

**The sequencing rule: additive first, deploy, destructive last — and "additive, so the order does
not matter" is wrong in both directions.** Ask which side fails safe:

- A column a shipped client **WRITES** goes **migration-first** (else `PGRST204`).
- A migration adding a second PostgREST relationship goes **deploy-first** (else HTTP 300 for the
  older bundle).
- A migration whose client switch is exhaustive goes **after the build is confirmed serving** —
  `READY` on the merge sha with `aliasError` null, not "after the merge".
- A destructive file whose removed object no bundle can observe has no unsafe side.
- **Deploy-first wins** when one file wants both; when it genuinely cannot, split the file in two.

**A migration that hangs triggers off an already-shipped write path needs a hand-exercise gate
before it applies** — every affected path exercised on DEV, in a rolled-back transaction, as
`authenticated`, counting the fan-outs' rows.

**`041 → 044 → 046` is a required chain** (`docs/reference/migrations.md` §The ordering chain).
**A migration too large to pass as a string is applied reduced and proved by object diff** — a
recorded statement that does not equal `md5sum` of its file is the NORM; compare the OBJECT
(`docs/reference/migrations.md` §Applying a large file, §What reads as drift).

Suite **3850** assertions — re-derive rather than trust it:
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`. **Compare label sets rather than
counts** when reconciling two runs.

**A function only a non-client role is meant to reach needs an assertion naming the role** —
`has_function_privilege('service_role', …)`, not a call. The RLS suite runs as the table owner,
for whom no barrier exists.

**Three own-row RPCs own the two profile stamps** — `my_onboarding_state()`, `accept_terms()`,
`complete_onboarding(location)` — and each restates the invariants its triggers carry, because
inside a `security definer` function `current_user` is the owner and the
`if current_user <> 'authenticated'` guards never run.

**Security advisors: one WARN per `security definer` RPC in `public` and one INFO per table whose
client grants were revoked outright, and those are chosen.** `115` added a **second WARN class**,
`anon_security_definer_function_executable` (lint `0028`) — one finding, and it is decision #1's
named exception rather than a 39th of the `authenticated_*` class, whose count did not move. The
only outstanding one is `auth_leaked_password_protection`, a dashboard click. Re-derive with `get_advisors(security)`;
`docs/reference/migrations.md` §Security advisors has the per-migration accounting. A one-advisor
difference between the projects is almost always a pending promotion.

**Scope a grant assertion to its grantee**, or use `has_table_privilege`: `postgres` and
`service_role` hold everything by default.

**A new table KEEPS Supabase's default `service_role` grants. Revoking is the exception, for a
restricted-readership sink** — rows the one credential that bypasses RLS must not be able to
enumerate (`076` §3). Three are revoked today, and the criterion is a judgement about the ROWS
with no mechanical test — an earlier mechanical test excluded the two reporting tables and would
have re-opened the exposure. `rls_enabled_no_policy` is a candidate set worth checking, never the
criterion; PD-413 holds the two candidates found unrevoked. Re-run rather than trust any list:

```sql
select count(*) filter (where sr)                          as kept,
       count(*) filter (where not sr)                      as revoked,
       string_agg(relname, ', ' order by relname) filter (where not sr) as revoked_tables
  from (select c.relname, has_table_privilege('service_role', c.oid, 'SELECT') as sr
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname='public' and c.relkind='r') t;
-- 30 kept · 3 revoked · club_thread_reports, postcard_reports, push_devices (2026-09-06).
```

Each revoke carries a grantee-scoped assertion in one of two forms — a savepoint-staged
`has_table_privilege`, or a grantee-scoped `information_schema.role_table_grants` count — and a
grep for one form finds none of the other.

**The project is on the free tier, which auto-pauses after ~7 days idle.** Pro before anything
resembling launch (PD-87).

## Component & Code Conventions

- Client pages/components: `'use client'` on line one. Default export for pages, named exports for
  reusable components.
- **Read pattern** — the query lives in `src/lib/data/`, never in the page; the page calls it
  through `useQuery` with its key from `keys.ts`; `null` is `notFound()`, `undefined` is a skeleton.
- **Mutation pattern** — a plain async function in `src/lib/actions/`, resolving the client, reading
  the user, writing, then `invalidate(keys.x(id))` — the cache claim that replaced `revalidatePath`.
  Two shapes must not come back: `supabase.from()` inside a component followed by
  `router.refresh()`, and a `'use server'` module (`src/__tests__/use-server-exports.test.ts`).
- **UI primitives** (never reinvent): `<Button>` (`primary` is near-black `Grey/100`, `secondary`,
  `ghost`, `danger`; prop `loading`), `<Input>` (`label`, `error`), `<Card>` family, `<Avatar>`
  (`sm`–`xl`, initials fallback).
- **Import alias** `@/*` → `src/*`, never relative `../../`. **Types** live in `src/types/index.ts`.

## Design System

**The v2 token tables, type scale, geometry census and icon set are
[`docs/reference/design-system.md`](docs/reference/design-system.md)**; `design/TOKENS.md` is
generated and wins. Four rules that hold without opening either:

- **Read the design from `design/`, never the Figma API.** `npm run figma -- tree "<screen>"` is
  offline; the API's rate limit is inherited across sessions and has blocked work for hours.
- **Icons come from `@/components/icons/generated`, and that file is generated** — never
  hand-edited.
- **Primary buttons are near-black (`Grey/100` `#1A1A1A`), not green.** The single most-repeated
  mistake against these designs.
- **Writing to Figma takes an explicit ask**, and nothing gates it —
  `grep -rl use_figma .github/workflows/ scripts/docs/registry.mjs .claude/agents/reviewer.md` is 0
  — so traced or borrowed artwork needs its licence settled before it ships.
  `.claude/agents/design-system.md` §Writing to Figma has the conventions.

## Development Workflow

```bash
npm run dev      # start dev server
npm run lint     # eslint
npx tsc --noEmit # type check
npm run build    # production build (requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY)
npm run test:unit # Vitest
npm test         # RLS policy suite (needs Postgres + psql; see supabase/tests/README.md)
npm run functions:check   # deno check on the Edge Functions — needs deno; CI runs it for you

PROD_DATABASE_URL=... DEV_DATABASE_URL=... npm run db:drift   # do repo, DEV and PROD agree?
PGPASSWORD=postgres npm run db:seed:check                     # does the DEV seed still apply?

npm run docs:check                                            # numeric claims vs reality (scripts/docs/registry.mjs)
npx vitest run scripts/docs/__tests__/crossrefs.test.mjs      # do "`file.md` §Section" pointers resolve?

# The only gate that renders anything — docs/reference/running-locally.md §The walk
NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://<dev ref>.supabase.co node scripts/supabase-relay.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NODE_USE_ENV_PROXY=1 npm run dev
npm run walk                     # mints its own rider — no credential needed
WALK_EMAIL=... WALK_PASSWORD=... npm run walk   # a known account, for WALK_FIXTURES reuse
```

**Neither `WALK_EMAIL` nor `WALK_PASSWORD` is required.** Unset, the walk signs a fresh rider up
and deletes it afterwards. `docs/HANDOFF.md` §Test accounts carries the two disposable DEV
fixtures **and their password**, under a carve-out granted for DEV walk fixtures alone.

**Reading the design** — offline, from `design/`: `npm run figma -- ls [pattern]`, `tree`, `text`,
`tokens`, `icons`. Screen names repeat across flows — qualify with the flow. `tree` and `text` hide
layers Figma has toggled off; add `--all` to see them. Refreshing the snapshot is a monthly job
needing the network — `figma:check`, `figma:pull`, `figma:icons`, `figma:components`; a 429 prints
`Retry-After`, a real countdown.

**Environment variables** (never commit): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
and `FIGMA_ACCESS_TOKEN` (only to refresh the snapshot). Copy `.env.local.example` to `.env.local`.

## The Agent Squad

Specialist agents live in `.claude/agents/`. Delegate to them rather than doing everything in the
main thread.

| Agent | Use for |
|---|---|
| `openspec` | Drives the OpenSpec workflow; enumerates every state and every **negative case** |
| `product` | The outside-in view — store listing copy, naming, the funnel, pricing. Writes words, never `src/` |
| `design-system` | v2 tokens, component library, icon set |
| `data` | Migrations, RLS policies, block lists, indexes, schema debugging |
| `feature` | Complete vertical slice — route, page, components, types, wiring |
| `realtime` | Chat, notifications, unread counters, presence |
| `media` | Photo upload, Supabase Storage, compression, **EXIF stripping** |
| `rider-ux` | Offline, geolocation, push UX, static map + deeplink, glove targets |
| `native` | The shell — Capacitor, plugins, permission strings, deep links, signing, store upload, **retiring the SSR pass** |
| `test` | Vitest/Playwright infra and tests, **and running the app against DEV** — the walk, its fixtures |
| `reviewer` | Pre-merge review, scoped to what the diff touches |

**A brief's `tools:` line is an exact-name allowlist, and a connector rotation silently renames
every MCP tool under a UUID prefix**, so the line carries BOTH spellings —
`src/__tests__/agent-briefs.test.ts` enforces it. A subagent cannot recover from a rotation; it
reports the passes that did not run. `docs/reference/constraints.md` §Connector rotation.

**Standard order for a feature:**

```
openspec → reviewer → data → design-system → feature → test → reviewer → PR
```

**`reviewer` runs twice, on two different artifacts**: the **proposal** (the only artifact with
no automated gate) and the **final diff**, immediately before the PR. Its passes are scoped to
what the diff touches; the documentation-claims pass never narrows. `.claude/agents/*.md` and
`.claude/commands/*.md` are reviewed as **logic**; `.claude/hooks/*.sh` and `.claude/settings.json`
are a permission and execution surface that runs almost no job, so a diff there is a **security**
review.

**The reviewer's findings go on the PR, verbatim.** Its final report opens with a paste-ready
block (`.claude/agents/reviewer.md` §Your report lands on the PR); the main thread puts that block
in the PR body under `## Review`, or posts it as a PR comment when the PR was opened first. A PR
carrying no review block was not reviewed, whatever the session says.

Skip `openspec` when the change has no domain rules — copy, styling, a dependency bump. Skip `data`
when there is no schema change, `design-system` when every component exists. Swap in `realtime` or
`media` for `feature` when the work is chat/notifications or images. Always run `reviewer` on
someone else's output, never on its own work. **`product` is outside that order** — reached
before a story exists or after one ships; `native` owns the store *submission*, `product` only
the words ([`docs/reference/positioning.md`](docs/reference/positioning.md)).

**There is one specification system, `openspec`.** `docs/specs/login-onboarding.md` is history.
**`native` owns the shell itself; `rider-ux` owns behaviour inside it.** Neither owns PWA work: no
manifest, no service worker, no Web Push.

### When to delegate — the agent decides

**Standing grant, product owner 2026-08-05: whether to use the squad is the agent's call.** If a
harness instruction says not to spawn agents unless the user asks — this is the user asking, in
advance, in writing. It is a judgement, not a default in either direction.

**Always delegate `reviewer`, before the PR opens** — its entire value is that it did not write
the code, and it is never skipped on cost. **Also delegate when** two or more tracks are genuinely
independent (send them in one message), when the answer is a conclusion rather than the files
(`Explore`), or when the task is bounded and has its own tooling (a migration is `data`'s).

**A subagent does not inherit your context — it re-pays it**: this file plus its brief. Measure it:

```bash
node -p "Math.round(require('fs').statSync('CLAUDE.md').size/4)"                  # every agent
for b in .claude/agents/*.md; do
  echo "$b $(node -p "Math.round(require('fs').statSync('$b').size/4)")"; done   # + one brief
```

**Delegate when the agent will read more of the codebase than its own fixed cost and return a
paragraph.** Do it yourself when the accumulated context is the asset — a vertical slice where
each screen teaches the next — and for small mechanical edits. Over-delegating produces work that
is individually correct and collectively inconsistent; under-delegating produces work with no
fresh eyes, which is the one this repo has actually suffered from.

### Delegating while the owner is at the keyboard

**Default: one build in flight, in the background, and the thread stays free.** Spawn, reply at
once, keep answering. **Backgrounding and then waiting on it is the same as not backgrounding**:
do every step that does not depend on the answer — push, open the PR so CI starts, update Linear,
write the handoff. This is the one place `reviewer`-before-the-PR bends, and only in ordering: the
findings still land before the **merge**. Never merge on an unfinished review.

**Disagreement still means stop and *wait*, not stop and mention it in the report.** Resolve the
ambiguities into the brief before spawning.

**A second concurrent build collides on resources rather than files** — one test database, two
fixed ports, one working tree. `docs/reference/constraints.md` §Two builds at once.

**Agents do not write `CLAUDE.md` or `docs/HANDOFF.md`; the main thread does.**

## Architectural Decisions

Settled. Don't reopen these without an explicit decision to change them.

**1. No anonymous access, with one named exception.** No table grant and no policy grant to
`anon`, ever. `is_public = true` means "visible to any signed-in rider", never "visible to the
internet". **The one exception is EXECUTE on `public.ride_invite_link_public_preview(t)`**
(`115`, PD-430): a single `security definer` function, reachable only by a 128-bit bearer token,
returning **six** columns of exactly one ride — its id, title, start time, zone, meeting point and
organiser username — a strict subset of the eight `091`'s authenticated preview already returns to
any holder of the same token. **Six, not the five a rider sees**: `ride_id` is in the projection as
the screen's cache key. A second such function, a column added to it, or any grant to `anon` on a table or policy
is a **new** decision and not an extension of this one.

**2. Blocking is enforced in RLS, not in the UI.** One `security definer` helper applied across
policies. Blocks are symmetric even though the row is directional. **It cannot reach the one
anonymous surface** — `public.ride_invite_link_public_preview(t)` (`115`, PD-430) has no
`auth.uid()` to test, so a blocked rider who signs out reads the same five fields as any other
holder of that link. That is a property of a bearer token rather than a hole in the block: the
claim, every list and every other read stay gated on `private.is_blocked`. **Any further
anonymous surface reopens this and needs its own argument.**

**3. Maps are a static thumbnail plus a Google Maps deeplink.** No mapping SDK.

**4. v2 is the only design.** v1 (`zinc-*`, `orange-500`, Geist, `lucide-react`) is fully retired:
zero `text-white` in `src/app/`, zero `lucide-react` importers,
zero client-side `supabase.from()` writes, and the dependency uninstalled. What remains of those
strings is comments. Never add more.

**5. Onboarding is required and not skippable.** The route guard redirects an incomplete rider
back into the wizard, and `023` refuses their content writes regardless.

**6. Email confirmation is ON for PROD and OFF for DEV.** A dashboard setting with no file behind
it, so code reads it rather than trusting the sentence — `signUp` branches on `data.session`.
Verify: `curl -s "https://<ref>.supabase.co/auth/v1/settings" -H "apikey: <publishable>"` →
`mailer_autoconfirm`. An unlisted `redirect_to` is *discarded* rather than refused;
`docs/ENVIRONMENTS.md` §The redirect allowlist carries the probe.

**7. Username, not full name.** `profiles.full_name` is dropped; the username is `UNIQUE`.

**8. Supabase with RLS *is* the backend.** More server compute means Route Handlers or Edge
Functions against the same database, or at most a service that forwards the user's JWT. **A
service-role backend that owns the database voids decision #2** and nothing on the roadmap
justifies it. Do not build ports, adapters or a repository interface for a migration nothing has
asked for.

## Working Principles

**Spawning the squad is pre-authorized** (§The Agent Squad); **`reviewer` before every PR is the
non-negotiable one.**

**Default to the session that is already open.** Spawn a second session only when the work is
genuinely independent *and* long enough to earn back the fixed cost.

**Fix the tool, don't route around it.** A workaround that produces the *same artifact* is fine; one
that produces a *lower-fidelity artifact* is debt — say so, mark what was inferred, and leave a
note for the pass that will verify it. **A blocked capability is a request for the product owner,
not a footnote**: test the block, then say what you need them to do, and carry on with everything
the block does not touch.

**Run the SQL. Do not stop to ask.** Standing grant, 2026-08-06: `execute_sql` and
`apply_migration` are pre-authorized, DDL, DML, and against production. **The grant lives in the
Supabase connector**, so `.claude/settings.json` holds no `mcp__Supabase__*` entries — re-adding
them is a regression. If a Supabase call prompts anyway, **report it**; never widen your own
envelope. The `deny` list still wins — pausing, restoring or creating a project, and deploying an
Edge Function stay blocked — and the service-role key is in `autoMode.hard_deny`.

**Notify when the work is done and the owner may not be watching** — one push notification,
`Done ; ) <name of the session>`, after the PR is merged.

**Open with what they must do, and keep the whole reply to a few lines.** The first line is the
ask, or "nothing needed". Ten lines is a normal reply. **Say less.** The reasoning goes in the
commit, the PR and the Linear issue — link it, do not paste it. Do not narrate the step you are
about to take. **While a subagent is running, say nothing unprompted**; the next unprompted words
after a spawn are the result. **Report the things they must ACT on, and nothing else** — if a
paragraph has no action in it, delete it. Three things stay long: the rating block, a blocked
capability, and anything inferred rather than measured.

**Rate every suggestion on five ratings, always in this order**, the score on its own line and its
reason in the paragraph below, separated by a blank `>` line (`scripts/docs/__tests__/registry.test.mjs`
asserts it):

> **Recommendation** 7/10
>
> a dead column that reads as live is a trap for the next session
>
> **Complexity** 3/10
>
> one migration, plus `PUBLIC_PROFILE_COLUMNS`, two types and a resolver
>
> **Urgency** 2/10
>
> nothing forces it; rises if anyone starts trusting the column
>
> **Customer value** 0/10
>
> no rider can see this column or notice it going; the whole gain is to the next session
>
> **This session** N
>
> wants its own branch, and the open PR should land first

**Recommendation** answers *should we*. **Complexity** is effort plus risk plus maintenance.
**Urgency** is *when*, and names the trigger. **Customer value** is what a rider gets, 0–10, written
from outside the codebase — a 0 beside a 9/10 recommendation is ordinary. **This session** is Y or
N, never a number; an owner-only item is N. None of the five are correlated.

**Letter every option — A), B), C) — including a lone one**, ordered by Recommendation descending,
counting up for the whole session. **Say who does each one.** Each opens with a short, specific
title on its own line, then a two-or-three-sentence practical explanation for someone who was not
in the session, then the ratings. **Never write a bare issue id in a chat reply** — *the caption
swipe (PD-224)*, never *PD-224*.

### The debrief shape — Points, Proposals, Question

**For closing out a build and for any reply that puts a decision to them.** The point is the
compression: **Points** — three or four one-liners; **Proposals** — the lettered blocks, skipped
when there is nothing to decide; **Question** — the one thing, phrased so a one-word reply works,
**as the rider's state, never as the mechanism** (name the screen, what the rider did and did not
do, and what each answer stores).

Each option gets its own blockquote, with the letter, title and explanation *outside* the bar:

**A) Drop the dead column.**

Nothing writes `profiles.legacy_rank` and nothing reads it, but the next session building a
profile screen finds it and has to work out whether it matters. One migration and a handful of
type edits; no rider sees any difference.

> **Recommendation** 7/10
>
> a dead column that reads as live is a trap for the next session
>
> **Complexity** 3/10
>
> one migration, plus `PUBLIC_PROFILE_COLUMNS`, two types and a resolver
>
> **Urgency** 2/10
>
> nothing forces it; rises if anyone starts trusting the column
>
> **Customer value** 0/10
>
> no rider can see this column or notice it going
>
> **This session** N
>
> wants its own branch, and the open PR should land first

**B) Enable leaked-password protection.**

Supabase can refuse passwords that have already leaked. It is off on both projects — one dashboard
toggle each, which only you can click.

> **Recommendation** 9/10
>
> the only security advisor that is not deliberate
>
> **Complexity** 1/10
>
> one dashboard toggle
>
> **Urgency** 4/10
>
> low now, high the day real riders sign up
>
> **Customer value** 4/10
>
> what stops a rider reusing a breached password
>
> **This session** N
>
> owner-only

**Committed and pushed is not shipped.** Before ending a session, merge it or say plainly that it
is open and why. **Driving a PR to green is bounded: three attempts, then hand it back** — do not
arm a repeating check-in to come back to it.

**"Counts" has two thresholds.** A session's unit of done is a merged PR on `development`
(`Deployed to DEV`); reaching riders is the promotion to `main` (`Done (in production)`). Never
write "shipped" for the first and mean the second.

**A claim about state needs the command that checks it**, written beside the claim, not beside its
history. A fact gets its verification command; if nothing can check it, it is a decision — record
the decision, not the revisions. Git history is what a file used to say. **Keep a correction only
when a reader would re-derive the wrong version from the same evidence**: name the command a
careful person writes *first* and the plausible wrong answer it returns (the comment trap is the
shape). `.claude/agents/reviewer.md` §The necessity gate enforces this with a line budget.

**Migration drift runs in two directions.** Unapplied is the familiar half. **Applied with no file
behind it** is worse — the RLS suite cannot see it and the next author takes the free number. Check
both directions before picking a number: `list_migrations <ref>` against
`ls supabase/migrations/`.

## Product Scope (from Figma)

**The per-domain build status is [`docs/reference/product-scope.md`](docs/reference/product-scope.md)**
— check the code first and Figma second. **How the app is described to someone who has never heard
of it is [`docs/reference/positioning.md`](docs/reference/positioning.md).** Two decisions rather
than status: **the nav is four tabs** (Home, Rides, Clubs, Profile — Inbox was removed by PD-100),
and **there is no "Friends" tab**.

## Feature Workflow (OpenSpec)

Features with real domain rules — visibility, membership, permissions, a schema change — go through
OpenSpec: `/opsx:propose` → `/opsx:apply` → `/opsx:archive`. Small mechanical changes do not.
Proposals must state the **negative** cases: who must *not* see or do this. Rules live in
`openspec/config.yaml`.

**A change is archived at the wrap-up of the session that ships it, and the Stop hook names the
ones that were not.** `session-wrapup-check.sh` lists every change under `openspec/changes/` whose
`proposal.md` this branch added or whose `tasks.md` gained a ticked box, when the branch also
touched `src/` or `supabase/` — the two signals that the branch built it, so a pointer rewrite
across old changes names nothing. Archive them (`/opsx:archive`) before the PR, or say in the PR
body why one stays open. An unarchived shipped change means the specs no
longer describe the app — `ls openspec/changes | wc -l` against `ls openspec/changes/archive | wc -l`
is the backlog, and it is not this hook's to clear.

## The roadmap lives in Linear

**Full detail is [`docs/reference/linear.md`](docs/reference/linear.md).** Read it before the first
Linear call of a session, and before ANY call touching a Routine. What must be true without it:

- Workspace **`lets-ride`**, team **Pedro & Dave (`PD`)**. **Pass the project id —
  `88f3f224-ecf0-46f0-a032-c86b7a12f81c`** — never the name (it holds a curly apostrophe, and the
  straight-quote version silently matches the deprecated project). Read the field back off the
  response.
- **Do not ask permission to touch Linear** (standing grant, 2026-08-07) — except to delete
  anything a human authored.
- **`Queued (AI)` is the only start signal.** `Development (AI)` claims **one issue**; so does
  `Needs help`. The one queue-wide stop is a `<!-- halt-queue -->` marker.
- **The two `slot-*` labels are the concurrency cap, and the board is the whole lock.**
- **Never type a status name from memory** — `list_issue_statuses team=Pedro & Dave`.
- **An issue opens with the five-rating block; a parked one owes a comparison table.**
- **A story closes when the thing it names exists, not when the part you built does.** Partly
  delivered stays open. "The rest needs an owner action" is not a split.
- **An issue body is a pointer and a reason.** A specification belongs in a proposal.

## Testing

`supabase/tests/` holds the RLS policy suite: the real migration chain against a scratch database,
asserting what each role can reach. **A migration that changes a policy must add an assertion.**
The suite runs on plain Postgres, so it cannot see role grants, exposed RPC endpoints or Supabase
defaults — after applying a migration to a hosted project, also read the security advisors.

## Branching & CI

- **`main` = production, `development` = DEV.** Both auto-deploy to Vercel; feature branches are
  Previews and point at DEV. **`app.letsride.social` is production and `app-dev.letsride.social`
  is `development`**; the apex is the marketing site in a separate project (`PD-34`).
  `docs/ENVIRONMENTS.md` §Domains is the contract. `canonicalOrigin()` in `src/lib/origin.ts`
  returns `NEXT_PUBLIC_CANONICAL_ORIGIN` when set and `window.location.origin` otherwise; the one
  written origin in `src/` is `src/app/layout.tsx`'s build-time `og:image`. **In the native bundle
  the runtime origin is `https://localhost`**, on no redirect allowlist, so `next.config.ts` fails a
  `CAPACITOR_BUILD=1` build when the variable is unset, and a web build when it is set. Three
  commands, none doing another's job:
  `grep -rn "letsrideapp\|vercel\.app\|localhost:3000" src/` is 0, and
  `grep -rn "window.location.origin" src/ --include=*.ts --include=*.tsx | grep -vE ':[0-9]+:\s*(\*|//|/\*)'`
  is 1 — the definition inside `canonicalOrigin()`, nowhere else. The third holds the ceiling on
  the `og:image` literal:
  `grep -rn "letsride\.social" src/ --include=*.ts --include=*.tsx | grep -v "__tests__" | grep -vE ':[0-9]+:\s*(\*|//|/\*)'` is 1.
- **Branch off `development`, and open PRs against `development` — not `main`.** `main` receives
  exactly one kind of PR: the promotion from `development`.
- **Never promote a Vercel preview to production**, and never merge `main` into a feature branch.
  A production hotfix is merged back into `development` immediately.
- **Squash-merge a feature PR; use a merge commit for the promotion**, then fast-forward
  `development` back to `main`.
- **CI is scoped to what a PR can actually break**, decided by a `changes` job:
  - **`Type Check, Lint & Build`** (tsc → ESLint → Vitest → `docs:check --cheap` → `next build`)
    runs unless *every* changed file is under `docs/`, `design/`, `openspec/`, `.claude/` or a
    root `*.md` — a **denylist**, with five carve-outs that run it anyway for their own tripwires
    (count them in the `changes` job). **A PR touching only `.claude/hooks/` runs zero jobs.**
  - **`Edge Functions (Deno type check)`** when `supabase/functions/**` or the workflow changes.
  - **`Smoke walk`** when `src/`, `public/`, `supabase/`, the build config or the workflow
    changes — and only once `WALK_CI=1` exists.
  - **`RLS Policy Tests`** (Postgres 17) when `supabase/**` or the workflow changes.
  - A push to either long-lived branch runs all of them. Jobs are skipped with `if:`, never a
    workflow-level `paths:` filter, because a filtered-out required check blocks the merge forever.
  - **The cheap doc-claims step is not the whole sweep** — `npm run docs:check` locally is.
- Whatever runs must pass before merging. Never push directly to `main` or `development`.

**One PR per session, opened at the wrap-up — and merged in the same session.** Standing
instruction, 2026-08-05. Commit and push freely; the PR is the wrap-up; then drive it to merged.
**Every implemented story ends on DEV** (owner, 2026-08-18) — merging to `development` *is* that
deploy, and the Linear issue says `Deployed to DEV`. Do not wait to be told to merge. A follow-up
PR is fine when a fact only becomes true after the merge. **Restarting a merged branch:**
`git fetch origin development && git checkout -B <branch> origin/development`.

## What Not To Do

- Don't add comments that describe what the code does — only non-obvious WHY.
- Don't add error handling for impossible scenarios — trust Supabase + TypeScript.
- Don't import from `@supabase/supabase-js` directly — use the wrappers in `lib/supabase/`.
- Don't query Supabase from inside a component — reads in `lib/data/`, writes in `lib/actions/`.
- Don't introduce a service-role key into the app. It bypasses every RLS policy; see decision #8.
- Don't add new UI libraries — extend the existing primitives.
- Don't create a `middleware.ts` or a `proxy.ts` — routing decisions belong in
  `src/lib/auth/guard.ts`.
- Don't re-add `@supabase/ssr`, a service worker, or a web app manifest.
- Don't run `playwright install`.
- Don't call the Figma API to answer a design question — read `design/`. Don't poll a 429.
- Don't convert the Figma styles to variables — the Variables API 403s on this plan.
- **Don't create, fire, edit or delete a Routine from a session, and don't build a queue design
  that needs a firing to spawn a session.** Reading one by id is pre-authorized; everything else is
  the owner's, in the Routines UI. A build session archiving ITSELF at the end of its own run stays
  permitted. `docs/reference/linear.md` §The queue is drained by one Routine, on one clock.
