# LetsRide — Project Context for Claude Agents

> **▶ Starting a session? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) now.** This file holds
> the durable context — stack, decisions, conventions. The handoff holds the *current
> position*: what is half-done, what is blocked, and the exact next action. Neither is
> complete without the other, and only this one gets auto-loaded. Look-up material —
> the schema, the board, the migration log, the walk, known issues — is under
> [`docs/reference/`](docs/reference/) and is reached by name, not loaded.

LetsRide is a mobile-first app for motorcycle riders to organise rides, join clubs, and connect with other riders — client-rendered, and headed for a native iOS/Android build. Built with Next.js 16 App Router, Supabase, and Tailwind v4. Targeting thousands of users — prioritise correctness, security, and clean code over cleverness.

(**"Friends" is not a concept here** — `013` dropped `friendships` on 2026-08-04 and there is no Friends tab. The social graph is clubs plus blocking. A dropped table gets designed back in by exactly this route: prose that still names it.)

## Working With the Product Owner

Two standing instructions. They resolve in **opposite** directions — do not collapse them
into one rule about "checking in".

**Ambiguity → assume and proceed.** Ask a clarifying question only when two readings of the
request would produce materially different work. Otherwise take the most sensible reading,
state it in one line, and build. A stated assumption is cheap to correct; a blocking question
about something with an obvious default just makes the owner the bottleneck.

**Disagreement → stop and wait.** If the request looks like a genuine mistake — not merely
different from what you would have chosen — say so and *do not build it* until there is an
answer. The bar is "this produces a wrong result, and it is cheaper to know now than after the
code exists", not "I have a preference". Naming, structure and style are never grounds to hold.

State the objection concretely: the query that breaks, the row that leaks, the migration that
cannot be reversed, the RSVP that can now be written twice. "This seems risky" is not an
objection, it is a mood.

**One hold per issue.** If the decision is reaffirmed, build the *full* request as asked and
drop it. Do not re-raise it later in the session, and do not quietly narrow the work as a
silent protest. Recording the concern once — in the commit message, or `docs/HANDOFF.md` if
it outlives the change — is enough.

**Never manufacture an objection to look diligent.** Invented pushback is worse than none: it
spends the credibility that the real objections need. If nothing is wrong, build the thing.

**When nobody is there to answer** — a scheduled run, a PR webhook wake, any unattended
session — holding silently means the work does not happen and no one finds out. Do every part
that does not depend on the disputed decision, leave that part undone, and put the objection
where it will actually be seen: a PR comment, the commit message, or the handoff.

**Squad agents cannot wait.** A subagent has no one to ask, so it surfaces the objection at
the top of its final report and the main thread does the holding. An agent that hits a genuine
mistake mid-task reports it — it does not build around it and mention it in passing.

**Branch cleanup is an owner action, and no session can do it anyway** — `git push origin --delete`
answers HTTP 403 here while ordinary pushes succeed. The branches rooted before the 2026-08-04
history rewrite have **no merge base to `development`**, so deleting one destroys the only copy of
what was in flight that day (`PD-143` is the do-not-touch list), and the safety question is
*unmerged content*, which `git cherry` cannot answer for a squash-merged branch. The `merge-tree`
snapshot that can is in `docs/reference/constraints.md` §Branch cleanup.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript strict) |
| Styling | Tailwind CSS v4 (CSS-first config, no `tailwind.config.*`) |
| Database / Auth | Supabase (Postgres + RLS + `@supabase/supabase-js`). **`@supabase/ssr` is gone** — the session lives in `src/lib/supabase/session-store.ts` |
| Icons | The Figma set, generated to `src/components/icons/generated.tsx` (see Design System). `lucide-react` is **gone** |
| Client cache | Hand-rolled, `src/lib/query/` — `useQuery`, `invalidate`, `setQueryData`, `clearQueryCache`. **Not TanStack Query**: this app needs a well-bounded subset and the dependency rule below is deliberate. `keys.ts` is the contract mapping every former `revalidatePath` claim to a cache key |
| Deployment | Vercel (auto-deploy from `main`) |
| CI | GitHub Actions — type check + lint + unit tests + build, the Edge Functions' Deno check, and the RLS suite. Path-scoped; see Branching & CI |

## Technology Decisions

*What* we build is under Architectural Decisions. This is *how* — the tooling questions that
otherwise get answered differently in every epic. Edit freely, but edit here rather than
deciding again inside a PR.

**Feature flags need a reason, and "it felt safer" is not one.** Standing instruction, product
owner 2026-08-19: *"only use toggles if it seems really necessary, or if I ask for them."* The
test is whether something concrete is wrong *right now* that the flag makes safe, and it comes
with the condition that retires it — say in the same comment what has to become true for it to be
deleted. Two costs are easy to miss: a flag defaulting off makes the thing behind it
**untestable** (nothing can reach it, so the walk cannot walk it), and a build-time
`NEXT_PUBLIC_*` flag doubles as an undeclared DEV/PROD separator, because the two are separate
Vercel env scopes.

**Dependencies are added deliberately.** **Twelve** runtime dependencies today, and that is a
feature. Count rather than trust that number:
`node -p "Object.keys(require('./package.json').dependencies).length"`. Before adding one, ask
whether a thirty-line helper does the job. No UI component libraries at all — shadcn, Radix and
MUI are out; extend `src/components/ui/*` instead.

**Three of the twelve are observability (PD-315, PD-353)** — `@sentry/capacitor` + `@sentry/react`
(a pair: the first peers an exact version of the second and falls through to the browser SDK on the
web, so one `init` covers both build shapes) and `posthog-js` (for the one funnel question SQL cannot
reach: which onboarding step turns a rider away). Each is a doorway module in `src/lib/` that nothing
else imports the package through, enforced by a test, because the privacy posture is a property of
the doorway; all three are pinned **exact**, and
`src/lib/analytics/__tests__/client.test.ts` asserts against the installed recorder that password
inputs stay masked. `docs/reference/observability.md` §The dependencies has the reasoning.

**Two of the twelve are the native shell's**, runtime by necessity because app code imports them:
**`@capacitor/core`** (nothing reaches a native API without it) and
**`@aparajita/capacitor-secure-storage`** (the keychain/keystore behind
`window.__letsrideSecureStore` — Capacitor ships no keychain plugin, and `@capacitor/preferences`
is explicitly *not* secure storage). `@capacitor/cli`, `ios` and `android` are devDependencies.
**Native plugins count**: each is a permission prompt, a review question and a supply-chain
surface, and each needs a one-sentence justification like those two (`.claude/agents/native.md`).

**Reads go through `src/lib/data/`. Components never call Supabase directly.** Named, typed
functions — `getRide(id)`, `getClubMembers(clubId)` — that own their query shape, so a renamed
column is one place to find rather than a dozen. Re-derive the spread with
`git grep -c "\.from('" -- 'src/*.ts' 'src/*.tsx'`.

**Every embed of `profiles` names its foreign key, because a migration touching neither the query
nor its policies can break it.** PostgREST counts relationships between two tables, a junction adds
one, and `092` turned four screens into `PGRST201` / HTTP 300 through every gate green — none of
them issues a query. Membership rows go through `MEMBER_PROFILE_EMBED` in `lib/data/columns.ts`, and
`src/lib/data/__tests__/embed-hints.test.ts` refuses an unhinted one — `!inner` is a join modifier,
not a hint. `docs/reference/schema.md` §Embed hints has the mechanism and what counts as a junction:

```bash
npx vitest run src/lib/data/__tests__/embed-hints.test.ts
```

**Writes go through `src/lib/actions/`**, one function per mutation — plain async functions in
the browser, not Server Actions. One place that writes, named and typed per mutation, and it must
never be dissolved back into components, because:

1. RLS enforces *authorization*, never *validity*. Username charset, T&C acceptance and the
   onboarding completion stamp are integrity rules the client must not own; `018`–`027` moved
   them into the database as a CHECK, a trigger or a grant, which is what made client-side
   writes safe in the first place.

   **The participation gate is narrower than "every write"** — `enforce_participation_gate` sits on
   twenty-one tables on DEV and twenty-two on PROD (`101`/PD-373 dropped `club_thread_waves`' gate
   on DEV only, awaiting promotion) and NOT on `profiles` UPDATE, `profile_countries`, `blocks`, `postcard_hides`,
   `feed_reads`, `club_thread_reads`, `push_devices` or any `storage.objects` policy, so an account that never called
   `accept_terms()` can still set a username and upload an avatar. `docs/reference/schema.md`
   §The participation gate has the list, the `push_devices` exception and the count query.
2. `useActionState` gives pending and error states without hand-rolled `useState` triples — and
   it works exactly the same with a plain async function as with a Server Action.

A component never calls `supabase.from()` directly — that was the v1 pattern, paired with
`router.refresh()`. Keep the second half of the pipe; the bare grep prints 3, all comments (see
*the comment trap* below):

```bash
grep -rn "supabase\.from(" src/app/ src/components/ | grep -vE ':[0-9]+:\s*(\*|//|/\*)'
```

**The render model is the client.** The app is a client-rendered bundle so it can go into a
native iOS/Android build: store presence is a product requirement, and background location
tracking is on the roadmap — which the web platform cannot do at all, because JS is suspended the
moment the app backgrounds. The client talks to Supabase directly under the same RLS policies,
with the same publishable key that already shipped in the bundle. **This is decision #8 read
literally**: the backend stays Supabase, and a handful of Edge Functions exist for the jobs needing
a secret, a schedule or elevated rights.

**The refresh token is JS-readable, and always was** — `@supabase/ssr` set the cookie with
`httpOnly=false` because the browser client had to read the session back. The store is
`src/lib/supabase/session-store.ts`, and the exposure closes for real only when
`window.__letsrideSecureStore` runs over a platform keychain.

**The SSR shell is the one piece of the server render still standing**, and retiring it is the
`native` agent's work. **Retiring it does not lift the *read in an effect* rule below — the rule is
permanent.** `output: 'export'` — what a Capacitor `webDir` is built from — still runs the same
prerender pass once at build time, so a component body still executes somewhere with no
`localStorage` and no session, and `resolve.browser.ts`'s tripwire keeps earning its place.
`.claude/agents/native.md` says the same; do not let the two drift apart.

Re-derive the scope rather than trusting a number here:

```bash
git ls-files src/app | grep -c 'page\.tsx$'                         # pages
git grep -L "^'use client'" -- 'src/app/**/page.tsx' | wc -l        # ... server-rendered: 0
git grep -L "^'use client'" -- 'src/components/**/*.tsx' | wc -l    # presentational components
```

The third line is **not** a defect count: a component with no `'use client'` joins the client
graph through its importer. The first line does not use the `**` glob because git's default
pathspec makes `**` require a further segment, so that glob silently skips `src/app/page.tsx`.

**The comment trap — this repo's most-repeated measurement error.** A file's description of what
it migrated *away from* looks exactly like the thing it migrated away from, so any grep for a
retired pattern counts its own obituaries. Two rules follow: **a directive is only a directive on
line one** (hence the `^` above), and when counting a retired pattern, exclude comment lines and
verify the filter both ways — that it reads 0 now *and* that it still catches a real instance.

**No new integrity rule may live only in a Zod schema.** Anything not expressed as a CHECK,
trigger or policy is advisory, because a rider can simply not run your validation. `003`, `012`
and `023` cover onboarding and consent; `018` covers the text bounds.

**`lib/data/` and `lib/actions/` are the only places that touch Supabase, and both resolve
their client through `src/lib/supabase/resolve.ts`.** One name, one doorway — which is what made
the render migration a change to one file instead of every `.from()` call site.

**Do not reach for a "just check at runtime" fix to a bundling problem.** Next refuses to bundle
`next/headers` into a client graph whether or not the branch importing it can be taken, and a
`typeof document` guard around a dynamic `import()` does not help because the bundler resolves the
specifier statically.

**Read in an effect or an event handler, never during render.** A `'use client'` component is
*still server-rendered* by Next on first load, and in that pass the browser client has no
`localStorage` to find a session in — so a read issued from a component body is anonymous, and
`anon` holds zero grants, so it fails closed at RLS. `resolve.browser.ts` throws a named error
when that happens, which turns a silent empty screen into a build failure.
`src/lib/data/__tests__/isomorphic.test.ts` guards the module graph for both directories.

**Reads in a client component go through `useQuery`, and every key is spelled in
`src/lib/query/keys.ts`** — a key written inline in a component is a bug even when the string
happens to be right. `keys.ts` also owns `filterSegment`, because a feed filter is two fields
flattened into one key segment that five screens and one action have to build identically.

**Gate a screen on its data, never on `isLoading`.** `useQuery` starts its fetch in an effect,
so on the first render pass there is no data *and* no fetch in flight — `isLoading` is `false`
and a screen gating on it renders `undefined` where its data should be. `combineQueries`
deliberately does not expose an `isLoading` at all.

**`null` is a decided answer; `undefined` is "not yet".** Only the first is `notFound()`.
Conflating them shows a 404 flash on every load of a detail screen.

**Validation: Zod, one schema per concern.** Lives in `src/lib/validation/`. It parses
`FormData` at the action boundary and drives live feedback in the form, from one definition.
Zod owns the **message**, never the **guarantee** — the database owns that.

**Forms are hand-rolled** — controlled inputs plus `useActionState`. No React Hook Form or
Formik; the forms in this app are one to three fields.

**Tests:**

| Kind | Tool | Status |
|---|---|---|
| RLS policies | `supabase/tests/` — psql against Postgres 17 | In place; gates every PR that touches `supabase/**` |
| Units — validation, `lib/utils.ts`, `lib/data/`, `lib/actions/`, the cache, the route guard | Vitest — `npm run test:unit` | In place; gates every PR that touches code. Also covers `src/lib/query/`, `src/lib/auth/guard.ts` (54 cases, replacing the untestable `proxy.ts`) and `src/lib/supabase/session-store.ts`. `lib/actions/__tests__/` exercises four actions against a mocked resolver and reads every action module on comment-stripped source to assert each stamp writer invalidates the guard cache and each table writer makes a cache claim. **Twenty-two** component tests exist — `PostcardAction` was the first; count them with `git ls-files 'src/**/*.test.tsx' \| wc -l`. Each pins one thing a refactor reverses in silence, verified both ways per §Working Principles; all render through `renderToStaticMarkup` under `environment: 'node'`, and jsdom is the answer only when something needs a layout or an event |
| Edge Functions | `deno check`, CI's `functions` job | Type-checks every `index.ts` under the runtime it runs in, when `supabase/functions/**` or the workflow changes. `tsconfig.json` excludes the directory, but two helper modules (`gates.ts`, `shape.ts`) are imported by unit tests and `tsc` follows them in — `npx tsc --noEmit --listFiles \| grep supabase/functions` lists them — so the entrypoints are the part only the Deno job reads |
| Smoke walk | `npm run walk` — playwright-core against DEV | **The only gate that renders anything**: signs in, walks every screen including detail routes discovered from the lists, checks the guard's redirects and sign-out, and refuses a create and an edit. Every other gate stays green through a screen that throws on load, or one nobody can reach (PD-125). `WALK_FIXTURES=1` creates the rows the detail routes need; a shrunken `N/N` is a skip, not a pass. **Wired into CI as the `walk` job (2026-09-02)**, minting its own rider (no credential — PD-268), and **skipped until the repository variable `WALK_CI=1` is set**, because the Actions secrets name PROD and the guard step refuses to walk it. Not a required check yet (PD-370) |
| End-to-end | Playwright | Deferred as a full suite. The walk asks one question per route — did this render — and asserts behaviour only in its named phases, each covering a defect no other gate can see. Adding a phase means adding a reason, not broadening a remit |

Chromium is pre-installed at `/opt/pw-browsers`; never run `playwright install`.

**Chromium in this container cannot reach Supabase**, and since the browser is now the Supabase
client that takes sign-in and the whole walk with it — `curl` through the proxy answers, a page
fetch hangs with no response and no entry in the proxy's failure log. `scripts/supabase-relay.mjs`
is the fix — read its header before running the walk.

**Versions.** `package-lock.json` is committed and CI runs `npm ci`, so what ships is already
pinned — this governs what moves on a routine `npm install`. Pin exact for anything the framework
or auth depends on: `next`, `eslint-config-next`, `react`, `react-dom`, `@supabase/supabase-js`
(a minor bump that changes session storage or the auth flow type breaks sessions silently), and
**every Capacitor package** — `@aparajita/capacitor-secure-storage` *is* session storage, and
Capacitor requires its packages to move together. Caret is fine for leaves.

**Dates: `Intl` only, no date library.** All in `src/lib/utils.ts`, and every formatter is
**named for the screen it serves** — `formatPostcardDate`, `formatRideDate`, `formatRideCardDay`,
`formatRideDateLong`, `formatRideTime` — because each design draws a genuinely different shape.
There is deliberately no generic `formatDate` — both existed, both hardcoded `en-US`, and a
generic formatter is how a two-locale split gets back in. `formatStartDistance` and
`formatStartDistanceShort` (PD-340) sit outside the `formatRide*` prefix on purpose: that prefix
carries the zone rule below.

**A ride's times are wall-clock at its meeting point** — `rides.timezone`, `080` — and
`APP_TIME_ZONE` (`Europe/Amsterdam`) is the **fallback**. Every `formatRide*` helper and
`wallClockToUtc` take the zone as a **required** argument, `null` meaning "we do not know"; the
viewer's own zone is never the answer, because the SSR pass renders the server's zone into the HTML
and the rider's on hydration. **The invariant is a database rule** — *the wall-clock the organizer
typed is preserved; the zone says which instant that names* — and `080`'s `enforce_ride_timezone`
shifts `departure_at` whenever a statement moves the zone. `rideZone()` falls back for anything
`Intl` cannot format in, because an unknown `timeZone` throws on every screen the ride appears on.
`wallClockToUtc`'s tests assert offsets rather than strings, because `TZ=UTC` in `vitest.config.ts`
would let a naive implementation pass a string comparison.

**Deliberately undecided** — raise these rather than inventing an answer: i18n, and email
delivery beyond Supabase's built-in auth mails.

**Analytics is not on that list: most of it is already recorded.** `profiles` holds the four
stamps the onboarding funnel needs, so it is four counts against one table —
[`docs/reference/analytics.md`](docs/reference/analytics.md), `scripts/db/analytics.sql`.
**Failed requests are readable too, and for 24 hours only** — `npm run logs:errors`,
[`docs/reference/observability.md`](docs/reference/observability.md). There is no backfill, so a
day nobody reads is gone.

## Repo Layout

**The annotated tree is [`docs/reference/repo-layout.md`](docs/reference/repo-layout.md)** — every
directory under `src/`, `supabase/`, `docs/`, `design/`, `scripts/`, `openspec/` and `.claude/`,
with what each holds. It is a hand-copied `ls` and **goes stale silently**, so check rather than
trust it:

```bash
for d in src/components/*/; do echo "$d: $(ls "$d" | sed 's/\.tsx\?$//' | tr '\n' ' ')"; done
```

## Critical: the route guard is a client component, not middleware

**`src/proxy.ts` is deleted.** Next.js 16 uses `proxy.ts` rather than `middleware.ts`; if the
file ever comes back for something else, the exported function must be named `proxy`, and do not
add a `middleware.ts`.

Routing decisions live in **three** places, split so the decision can be tested:

- **`src/lib/auth/guard.ts`** — `resolveDestination(pathname, state)`, a pure function.
  `null` means stay; a string is where to go. 54 cases in `__tests__/guard.test.ts`.
- **`src/lib/auth/guard-cache.ts`** — what the decision reads: the session and the onboarding
  stamps, **held for the page load rather than fetched per route**, with `onAuthStateChange` as
  the single writer for the session half. Fetching them per navigation cost a round trip to
  `eu-west-1` behind a full-screen splash on every tab tap. Both stamps are immutable for a
  session's lifetime.
- **`src/components/auth/RouteGuard.tsx`** — applies the decision, **synchronously after the
  first one**, and renders the splash only while it genuinely cannot answer. Mounted in the
  **root** layout, because three of its rules concern paths outside `(app)`.

**The splash overlays the page once booted; it replaces it only before the first decision.**
Replacing it on every navigation unmounts `(app)/layout.tsx` and makes a tab tap read as a reload.

**Any new writer of a stamp the decision reads must invalidate the cache.** There are three
(`signUp`, `setUsername`, `acceptTerms`), and each calls `invalidateOnboardingState()`;
`signOut` calls `clearGuardCache()`. Miss one and the rider finishes a step and is sent straight
back into it. `src/lib/actions/__tests__/writers-invalidate.test.ts` refuses a new stamp writer
that does not, and `npm run walk` has a phase that measures it.

**Necessary, and never sufficient — an invalidation cannot reach a round trip that has already
left.** `signUp` establishes the session, the guard's effect asks `my_onboarding_state()`,
`accept_terms()` commits *while that read is out*, and the read then refills the cache it had just
cleared. `guard-cache.ts` carries a generation counter for this — a read discards its own answer if
the stamps moved underneath it — so a **new** writer owes the invalidation and nothing more.

**An unmatched URL still reaches it.** `not-found.tsx` sits at `(app)/`, so a path outside that
group falls to Next's built-in 404 — which still renders the root layout and the guard, measured
with `next start` and `curl`. So a deleted step's URL in a bookmark redirects rather than
dead-ending.

**It is not a security boundary and must never be treated as one.** RLS is. Every rule the
guard enforces has a database counterpart — `023` refuses content writes without a consent
stamp, `003`/`012` own the completion invariants, `025` means the client cannot even read the
two stamps except through a `security definer` accessor.

**Protection is a denylist of public paths, not an allowlist of protected ones.** Everything is
gated except these, which is what makes decision #1 hold by default:

```
'/', '/auth/login', '/auth/signup', '/auth/forgot-password',
'/auth/reset-password', '/auth/callback', and '/legal/*'
```

Four rules, each with a test naming the trap it avoids:

- **No session + non-public path** → `/auth/login`. `/` is public but empty, so it goes too.
- **Session + onboarding incomplete** → the resume step, unless already there. Read from
  `my_onboarding_state()`; never from `user_metadata`, which the client can write. **Consent is
  gated ahead of the wizard**, because `023` refuses to stamp completion while the consent stamp
  is NULL.
- **Session + `/auth/login` or `/auth/signup`** → `/postcards`. Note the two paths: bouncing
  *all* of `/auth/*` breaks password recovery, because Supabase's link establishes a session
  before the reset page loads.
- **The stamp read failed** → `/auth/login?error=profile_unavailable`, *except* on the two auth
  entry paths, where it must fall through or it redirects to itself forever. Zero rows is this
  case, not "un-onboarded": reading it as un-onboarded sends the rider to a prompt whose submit
  can never succeed.

## Supabase Rules

**There are three Edge Functions and all three are deployed to both projects.** `delete-account`
is the only place a service-role key exists — removing an `auth.users` row needs the Auth admin
API. `resolve-ride-location` geocodes a ride's meeting point and renders its tiles;
`search-places` proxies the place typeahead. Each owns one operation, not the database.

Four rules on `delete-account`, and they are why this does not contradict §What Not To Do's
"don't introduce a service-role key into the app" — **the function is not the app**:

- **The key lives only in the function's secret store.** Not in `src/`, `.env.local.example`,
  Vercel, a fixture or any `NEXT_PUBLIC_*`. `src/__tests__/no-service-role-key.test.ts` is the
  tripwire, and it proves the detector still catches a real key in each format.
- **It takes no user id.** The subject comes from the verified JWT and nowhere else.
- **It verifies the JWT itself** rather than trusting the gateway — the publishable key is a
  valid JWT and sails past a decode-only check.
- **Only CI's `functions` job type-checks it.** `tsconfig.json` excludes `supabase/functions`
  because it is Deno; `npx tsc --noEmit` never sees it.

**A merge deploys them** — product owner 2026-09-02, *"deploy on every merge, you should be
autonomous on that."* `.github/workflows/deploy-functions.yml` runs on a push to `development`
(→ DEV) or `main` (→ PROD) that touches `supabase/functions/**`, type-checks, **waits for Vercel's
GitHub Deployment of that sha in that branch's environment to be `success`** (the PD-236 ordering
below, mechanised — the bare `Vercel` commit status cannot tell a Production build from a Preview
of the same sha after a promotion's fast-forward), then deploys every function; a
`workflow_dispatch` deploys one or all to a chosen project from any sha without the wait.
**Nothing deploys until the `SUPABASE_ACCESS_TOKEN` secret exists (PD-369)** — the job is skipped
with a warning, not red — so until that lands an edit under `supabase/functions/` is still drift
from the moment it merges. **It fixes future drift only**: a push deploys only when it touches a
function, so what was stale the day it landed (`resolve-ride-location` on both projects, behind
PD-236's marker fix) stays stale until one manual dispatch per project catches it up. No session deploys by hand: there is no `supabase` CLI in
the build container, and the MCP server's `deploy_edge_function` stays on `.claude/settings.json`'s
`deny` list.
**Version numbers differ per project and always will** (they count deploys), so the `ezbr_sha256`
is what says the two projects agree, and equality is not currency: compare `updated_at` against the
last commit under `supabase/functions/<name>/`. `docs/reference/ci.md` §Edge Function currency has
the three commands.

**One redeploy has an ORDERING rule, and it runs the opposite way to a migration's.** PD-236 makes
the deployed `resolve-ride-location` send `attribution=none`, so the app's own `MapAttribution`
becomes the only thing discharging the licence — the app must be **serving before the function is
deployed**, never after. A duplicate credit is harmless; an absent one is a breach. The
additive-first rule is about which side fails safe, not about a fixed order.

**One doorway, and almost nothing should reach past it:**
- **Anything in `src/lib/data/` or `src/lib/actions/`** →
  `import { resolveSupabase } from '@/lib/supabase/resolve'`.
  `src/lib/data/__tests__/isomorphic.test.ts` fails if anything there reaches a Next server module.
- A component or helper that genuinely needs the client itself imports `createClient` from
  `@/lib/supabase/client`. What earns a place on that list is a **session or transport**
  concern — the guard cache, the auth routes that exchange an emailed credential, the Storage
  upload, the Realtime subscriptions — never a read. Count them rather than trust a number:

  ```bash
  grep -rln "from '@/lib/supabase/client'" src/ | grep -v "src/lib/supabase/"   # 7
  ```
- `@/lib/supabase/server` **no longer exists**. Neither does `@supabase/ssr`.

**RLS is ON for all tables.** Every query runs under the authenticated user's session. You do
not need to filter by `user_id` manually — RLS policies enforce ownership. But do add RLS policies
in migrations for any new table.

**Schema:** **the per-table contract is [`docs/reference/schema.md`](docs/reference/schema.md).**
Read it before touching any table: it carries the per-column grants, the cascade behaviour and
the audience predicate for each, and several are counter-intuitive (a club outlives its owner;
`postcards.ride_id` is a tag rather than a second audience; `ride_messages`' audience is an
intersection and neither half alone is it; a club's audience is the membership helper ALONE).

**`places` — the self-hosted Overture index the typeahead used to search — is RETIRED (`070`,
PD-273) and gone from both projects.** It was 96% of everything this app stored. The typeahead is a
geocoder reached through `search-places`; `/legal/attributions` credits Geoapify and
OpenStreetMap, an unconditional credit that covers tiles and search alike.

**Migrations:** Add new SQL files to `supabase/migrations/` with incrementing prefix. Never edit
existing migrations — always add new ones. **Filename order equals apply order** — `run.sh`
applies by filename, so a file whose local order differs from its hosted order is a trap this repo
has already sprung (`021` was split into `021` and `025` for exactly that).

**The production project is `letsride`, ref `zwprydcyryvudhurbnye`** (`eu-west-1`). **The DEV
project is `letsride-dev`, ref `fpmrimzxadewsaiwpsel`**: Vercel's Preview and Development targets
point at it. **The GitHub Actions secrets still point at PROD** — measured 2026-09-02 by the walk
job's guard step, which classifies the URL on every run; `docs/ENVIRONMENTS.md` §Owner setup item
5 is the repoint, and nothing in CI writes until it lands. **`docs/ENVIRONMENTS.md` is the contract** — which
branch maps to which target to which database, the apply order for a migration, and the settings
that are dashboard-only and therefore drift. Two consequences worth carrying here:

- **Never promote a Vercel preview to production.** Both Supabase variables are
  `NEXT_PUBLIC_*`, inlined at build time, and Vercel's promote *"does not rebuild the
  deployment"* — so it ships DEV credentials to riders with a green deploy. Promotion is a git
  merge that rebuilds.
- **Check drift rather than claiming it.** `npm run db:drift` compares migration *names*, never
  versions, because the recorded version is an apply-time timestamp and PROD's are not in
  filename order.

**Applied state: 101 files. DEV is at `101` and PROD at `100` — measured 2026-09-03. The gap is
`101` alone, awaiting promotion.** Count rather than trust it: `list_migrations` against both refs,
against `ls supabase/migrations/*.sql | wc -l`. DEV also records three hand-applied rows with no
file, so its row count reads high; every file IS applied, which is the direction that matters.
**Level is the exception, not the resting state** — DEV-ahead is where a migration lives between
its merge and its promotion. Promote everything the gap contains, in filename order, per
`docs/ENVIRONMENTS.md` §Migrations, and record each promotion's ordering in
`docs/reference/migrations.md` §Applied state, which holds the per-file log.

**The sequencing rule: additive first, deploy, destructive last — and "additive, so the order
does not matter" is wrong in both directions.** The rule asks which side fails safe:

- A column a shipped client **WRITES** goes **migration-first** — a newer bundle against the old
  database gets `PGRST204` (`096`, feedback submission down for the length of the gap).
- A migration that adds a second PostgREST relationship goes **deploy-first** — an older bundle's
  unhinted embed answers HTTP 300 the moment it applies (`092`, four screens dead on DEV).
- A migration whose client switch is exhaustive goes **after the build is confirmed serving** —
  not "after the merge": `READY` on the merge sha with `aliasError` null. DEV once applied a
  destructive file 102 seconds after the merge, out from under a Preview still calling the
  function it dropped.
- A destructive file whose removed object no bundle can observe has no unsafe side (`090`).

**A migration that hangs triggers off an already-shipped write path needs a hand-exercise gate
before it applies** — from the moment it applies every write on that path runs new code inside the
rider's own transaction, and a trigger that raises takes that write down with it. Exercise every
affected path by hand on DEV first, in a rolled-back transaction, as `authenticated`, counting the
fan-outs' rows rather than assuming them.

**`041 → 044 → 046` is a required chain and one link fails silently** — `044` and `046` both
issue an absolute `revoke` + `grant` list, so running `046` first lets `044` reinstate what `046`
removes with nothing red. `docs/reference/migrations.md` §The ordering chain carries both links.

**A migration too large to pass as a string is applied reduced and proved by object diff**, so a
recorded statement that does not equal `md5sum` of its file is the NORM on both projects and reads
exactly like drift. Compare the OBJECT, never the recorded text —
[`docs/reference/migrations.md`](docs/reference/migrations.md) §Applying a large file has the
procedure, and §What reads as drift the reconciliation SQL.

Suite **3280** assertions — re-derive rather than trust it:
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`. **Compare label sets rather than
counts** when reconciling two runs: a count cannot tell a rename from a loss.

**A function only a non-client role is meant to reach needs an assertion naming the role.**
`029` put its worker in `private` and revoked EXECUTE from the client roles, assuming the deletion
Edge Function would reach it as `service_role`. It could not: `service_role` holds no EXECUTE on
anything in `private`, and PostgREST routes only to `public`. Nothing caught it, because **the RLS
suite runs as the table owner, for whom neither barrier exists.** The assertion that would have is
`has_function_privilege('service_role', …)`, not a call.

**Three own-row RPCs own the two profile stamps**, because `025` takes the client's grant away:
`my_onboarding_state()`, `accept_terms()` and `complete_onboarding(location)`. **Each restates
the invariants its triggers carry, and must**: inside a `security definer` function `current_user`
is the *owner*, so `003`'s and `012`'s guards — which begin `if current_user <> 'authenticated'` —
never run. `complete_onboarding` also joins the caller to the club carrying `clubs.is_default`
(`058`), inside a `when others` block, because a raise there would roll the completion stamp back
and decision #5 gives a rider with a NULL stamp no way out of the wizard.

**Security advisors: thirty-seven on both projects, and only one is outstanding** —
`auth_leaked_password_protection`, a dashboard click. The other thirty-six are things this repo
chose: one `authenticated_security_definer_function_executable` WARN per `security definer` RPC in
`public` (each narrow by design — takes a row id, never a rider id, one raise site), and two
`rls_enabled_no_policy` INFOs on tables whose grants were revoked outright. **A migration adding
two such functions adds two**, and one whose functions live in `private` adds none. Re-derive with
`get_advisors(security)`; `docs/reference/migrations.md` §Security advisors has the per-migration
accounting and the count query. An unexpected advisor is one not in that table; a one-advisor
difference between the projects is almost always a pending promotion.

**Scope a grant assertion to its grantee**, or use `has_table_privilege`: a table-wide
DELETE-grant count reads 2 against a correct database, because `postgres` and `service_role` hold
everything by Supabase default.

**The project is on the free tier, which auto-pauses after ~7 days idle.** A paused project
serves nothing, so the deployed app goes down with no alert. This needs to be on Pro before
anything resembling launch.

## Component & Code Conventions

**Pages:**
- Client pages/components: `'use client'` at the top.
- Default export for pages, named exports for reusable components.

**Read pattern** — the query lives in `src/lib/data/`, never in the page:
```ts
// src/lib/data/rides.ts
export async function getRide(id: string): Promise<RideDetail | null> {
  const supabase = await resolveSupabase()
  const { data } = await supabase.from('rides').select(RIDE_SELECT).eq('id', id).single()
  return data
}
```

**The page calls it through `useQuery`, with its key from `keys.ts`** — never during render:
```tsx
'use client'
const { data: ride } = useQuery(keys.ride(id), () => getRide(id))
if (ride === null) notFound()      // null is decided; undefined is "not yet"
if (!ride) return <RideSkeleton /> // gate on the data, never on isLoading
```

**Mutation pattern** — a plain async function, called from the component:
```ts
// src/lib/actions/rides.ts
export async function setRideAttendance(rideId: string, attendance: RideAttendance) {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to RSVP.' }
  // ...upsert or delete...
  invalidate(keys.ride(rideId))    // the cache claim that replaced revalidatePath
  return {}
}
```

Two shapes that are **not** this and must not come back: `supabase.from()` inside a component
followed by `router.refresh()` (v1), and a `'use server'` module —
`src/__tests__/use-server-exports.test.ts` is the tripwire if one returns.

**UI primitives** (always use these, don't reinvent):
- `<Button>` — variants: `primary` (near-black `Grey/100`), `secondary`, `ghost`, `danger`. Prop: `loading`.
- `<Input>` — props: `label`, `error`.
- `<Card>`, `<CardHeader>`, `<CardTitle>`, `<CardContent>`
- `<Avatar>` — sizes: `sm`, `md`, `lg`, `xl`. Falls back to initials.

**Import alias:** `@/*` → `src/*`. Always use this, never relative imports like `../../`.

**Types:** All domain types live in `src/types/index.ts`. Add new types there, don't inline them.

## Design System

**The v2 token tables, the type scale, the geometry census and the icon set are
[`docs/reference/design-system.md`](docs/reference/design-system.md).** Read it before building
any screen, and read `design/TOKENS.md` in preference to either — that one is generated.

Four rules that must hold without opening it:

- **Read the design from `design/`, never the Figma API.** `npm run figma -- tree "<screen>"` is
  offline and cannot be rate limited; the API's limit is per-endpoint, inherited across sessions,
  and has blocked work for hours. `design/README.md` has the full rationale.
- **Icons come from `@/components/icons/generated`, and that file is generated** — never
  hand-edited. The generator rewrites every literal fill to `currentColor`.
- **Primary buttons are near-black (`Grey/100` `#1A1A1A`), not green.** Green is an accent used
  sparingly. This is the single most-repeated mistake against these designs.
- **Writing to Figma is possible, and it takes an explicit ask.** `use_figma` is on
  `design-system`'s toolset; a write is not a licence to *read* over the API. **Nothing anywhere
  gates it** — check rather than trust that, because the day a reviewer pass or a registry claim
  appears the justification stops being true:

  ```bash
  grep -rl use_figma .github/workflows/ scripts/docs/registry.mjs .claude/agents/reviewer.md   # 0
  ```

  So a component created in a session lands in the canonical design unreviewed, and the next
  `figma:pull` bakes it into the snapshot, `generated.tsx` and the store build. **Traced or
  borrowed artwork therefore needs its licence settled before it ships**; `places` is the
  precedent for what an assumed one costs. `.claude/agents/design-system.md` §Writing to Figma
  carries the conventions and the provenance rule.

## Development Workflow

```bash
npm run dev      # start dev server
npm run lint     # eslint
npx tsc --noEmit # type check
npm run build    # production build (requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY)
npm run test:unit # Vitest — validation, the query cache, the route guard, the actions, the session store
npm test         # RLS policy suite (needs Postgres + psql; see supabase/tests/README.md)
npm run functions:check   # deno check on the Edge Functions — needs deno; CI runs it for you

# Do the repo, DEV and PROD agree on the migration chain? See docs/ENVIRONMENTS.md
PROD_DATABASE_URL=postgresql://... DEV_DATABASE_URL=postgresql://... npm run db:drift
PGPASSWORD=postgres npm run db:seed:check   # does the DEV seed still apply, and still refuse?

# Do the numeric claims in CLAUDE.md / docs / .claude/agents still match reality?
# See scripts/docs/registry.mjs for the declared list — PD-155
npm run docs:check

# Do the repo's "`file.md` §Section" pointers still resolve? Runs inside test:unit,
# not docs:check — scripts/docs/crossrefs.mjs. Moving a section is what breaks these.
npx vitest run scripts/docs/__tests__/crossrefs.test.mjs

# The only gate that renders anything — see supabase-relay.mjs's header first,
# and docs/reference/running-locally.md §The walk for the whole procedure
NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://<dev ref>.supabase.co node scripts/supabase-relay.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NODE_USE_ENV_PROXY=1 npm run dev
npm run walk                     # MINTS ITS OWN RIDER — no credential needed (PD-268)
WALK_EMAIL=... WALK_PASSWORD=... npm run walk   # a KNOWN account, for WALK_FIXTURES reuse
```

**Neither `WALK_EMAIL` nor `WALK_PASSWORD` is required, and reading them as required is how a
session reports the walk blocked when it is not** — which happened on 2026-09-01. Unset, the walk
signs a fresh rider up through the app's own forms and deletes it afterwards; DEV's
`mailer_autoconfirm` is what allows it. Set, they name a known account, which is what
`WALK_FIXTURES` needs to reuse run over run — `docs/HANDOFF.md` §Test accounts carries the two
disposable ones **and their password**, under a carve-out granted for DEV walk fixtures alone.

**Reading the design** — offline, from the committed snapshot in `design/`:

```bash
npm run figma -- ls [pattern]        # every frame and component
npm run figma -- tree "View all new postcards / Home - Postcards - All new"
npm run figma -- text "v2 / Component / Postcard"    # every string, with its type token
npm run figma -- tokens Grey         # token tables
npm run figma -- icons               # the exported icon set
```

**Screen names repeat across flows** — qualify with the flow as above; an ambiguous name prints
every match with its flow and node id. **`tree` and `text` hide layers Figma has toggled off** —
add `--all` to see them, marked `[hidden]`. Building from an unfiltered tree is how a back button
ends up on the home screen.

Refreshing it is a **monthly** job that needs the network — `npm run figma:check` (cheap: is it
stale?), `figma:pull`, `figma:icons`, `figma:components` (offline, after icons), and
`figma:check -- --probe` when something looks blocked. A 429 prints `Retry-After`, a real countdown
that requests do not reset — come back then rather than polling.

**Environment variables** (never commit these): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `FIGMA_ACCESS_TOKEN` — only needed to *refresh* the snapshot.
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
| `rider-ux` | Offline, geolocation, push UX, static map + deeplink, glove targets |
| `native` | The shell — Capacitor, plugins, permission strings, deep links, signing, store upload, store guidelines |
| `test` | Vitest/Playwright infra and tests, **and running the app against DEV** — the walk, its fixtures, anything needing a real browser |
| `reviewer` | Pre-merge review. Which passes run is scoped to what the diff touches — RLS/data-exposure on `src/` or `supabase/`, documentation-claims on everything including docs-only diffs |

**A brief's `tools:` line is an exact-name allowlist, and a connector rotation silently renames
every MCP tool under a UUID prefix.** `InputValidationError` means the schema arrived deferred —
`ToolSearch select:<name>` and call it; `No such tool available` means the name is absent. The fix is
the `tools:` line carrying BOTH spellings, which `src/__tests__/agent-briefs.test.ts` enforces along
with a §Reaching Supabase block on every brief reaching Supabase. A subagent cannot recover from a
rotation on its own (its `ToolSearch` is filtered by its own line), so it reports the passes that did
not run; restoring the call is the owner's. `docs/reference/constraints.md` §Connector rotation has
the mechanics.

**Standard order for a feature:**

```
openspec → reviewer → data → design-system → feature → test → reviewer → PR
```

**`reviewer` runs twice, on two different artifacts**: the **proposal** — the only artifact in the
pipeline with no automated gate, since `openspec/` sits in the CI denylist and a visibility decision
left unstated *"silently becomes whatever the migration author assumed"* — and the **final diff**,
once, immediately before the PR. Its passes are scoped to what the diff touches, mirroring `ci.yml`'s
denylist; the documentation-claims pass never narrows, nor does the scope pass on a queue pickup,
and four things override the scoping entirely — `.claude/agents/reviewer.md` §Then: classify the
diff is the list. `.claude/agents/*.md` and `.claude/commands/*.md` are reviewed as **logic** —
`src/__tests__/agent-briefs.test.ts` runs on them — and `.claude/settings.json` and
`.claude/skills/` each run the job for one tripwire; **`.claude/hooks/*.sh` and the rest of
`.claude/` run zero jobs**, so a diff touching the permission or execution surface is a
**security** review with, at best, a cardinality check behind it.

Skip `openspec` when the change has no domain rules — copy, styling, a dependency bump.
Requiring a proposal for everything is how process gets ignored. Skip `data` when there's no
schema change, and `design-system` when every component already exists. Swap in `realtime` or
`media` for `feature` when the work is chat/notifications or images. Always run `reviewer` on
someone else's output, never on its own work.

**There is one specification system, `openspec`, and that is deliberate** — it sat beside a
second one and the result was that neither was used. `docs/specs/login-onboarding.md` is what
the other produced: history, not a template.

**`native` owns the shell itself** — Capacitor config, plugins, permission strings, deep links,
secure storage, signing, store upload, anything gated on a store review guideline, **plus
retiring the SSR pass**. **`rider-ux` owns behaviour *inside* the shell** — offline read,
geolocation, push UX, glove targets. Neither owns PWA work: no manifest, no service worker, no
Web Push.

### When to delegate — the agent decides

**The product owner granted this on 2026-08-05, standing, for this session and every future
one: whether to use the squad is the agent's call, not a thing to ask permission for.** If a
harness instruction in some future session says not to spawn agents unless the user asks —
this is the user asking, in advance, in writing.

It is a judgement, not a default in either direction.

**Always delegate `reviewer`, before the PR opens.** Its entire value is that it did not write
the code, so the author cannot substitute for it by reading their own diff more carefully — and
every time it has run *after* a merge instead, its findings have cost a second PR.

**Also delegate when:**

- **Two or more tracks are genuinely independent** — a migration and an unrelated screen. Send
  them in one message so they run concurrently.
- **The answer is a conclusion, not the files** — "which components read `avatar_url`", "does
  anything call this". `Explore` reads excerpts and returns the finding.
- **The task is bounded, well-specified, and has its own tooling** — a migration with a crisp
  schema question is `data`'s, and it holds the Supabase tools.

**A subagent does not inherit your context — it re-pays it.** Every agent opens a fresh window
and loads this file plus its brief, so delegating *multiplies* the fixed cost. Measure it:

```bash
node -p "Math.round(require('fs').statSync('CLAUDE.md').size/4)"                  # every agent
for b in .claude/agents/*.md; do
  echo "$b $(node -p "Math.round(require('fs').statSync('$b').size/4)")"; done   # + one brief
```

**Delegate when the agent will read more of the codebase than its own fixed cost and return a
paragraph.** A subagent that just runs the build does not clear it: a green run is ~1k of output.
**`reviewer` is exempt from this arithmetic and is never skipped on cost.**

**Do it yourself when the accumulated context is the asset.** A vertical slice where each screen
teaches the next is one agent's work — the design's epic-status trap (`Explore clubs v2` is
**On hold** despite sitting further right in the file) is the kind of thing a fresh agent on
screen three builds straight past. Also yours: small mechanical edits, and anything where writing
the brief costs more than the task.

**The failure mode in each direction is different.** Over-delegating scatters context and
produces work that is individually correct and collectively inconsistent. Under-delegating
produces work with no fresh eyes on it. The second is the one this repo has actually suffered from.

### Delegating while the owner is at the keyboard

**Adopted 2026-08-11.** The grant above answers *whether* to delegate. This answers the case where
the owner is present and asking about other stories.

**Default: one build in flight, in the background, and the thread stays free.** Spawn the agent,
reply at once, and keep answering questions about other stories while it runs. What this buys is
**availability, not throughput**. The queue runs alongside this mode: an hourly firing may hand a
story to a build session while this conversation is live, and `queue-run.md` §The board is the
lock holds the collision between two *builds* with two Linear labels and a declared territory.

**Backgrounding it and then waiting on it is the same as not backgrounding it.** The point of the
background is the *thread*, not the agent. While one runs, do every step that does not depend on
its answer: push, open the PR so CI starts, update Linear, write the handoff. The completion
notification re-invokes you, so there is nothing to wait for and nothing to poll. This is the one
place `reviewer`-before-the-PR bends, and only in ordering: the findings still land before the
**merge**. Never merge on an unfinished review.

**The one real quality regression: the owner sees an assumption only after it has been built on.**
§Working With the Product Owner still governs, **including the half that is easiest to lose here:
disagreement means stop and *wait*, not stop and mention it in the report.** Resolve the
ambiguities into the brief before spawning.

**A second concurrent build is not free, and the collisions are resources rather than files** —
one test database (`run.sh` opens with `drop database if exists`), two fixed ports (the relay's
`:3001`, the walk's `:3000` — a second dev server slides to the next port and the walk reports the
FIRST tree green), and one working tree the main thread also writes. All three are overridable
(`TEST_DB=`, `RELAY_PORT=`, `WALK_BASE=`, `isolation: "worktree"`); the port half is the dangerous
one because it passes. `docs/reference/constraints.md` §Two builds at once has the detail.

**Agents do not write `CLAUDE.md` or `docs/HANDOFF.md`; the main thread does**, once the reports
are in. That also keeps the git index single-writer.

## Architectural Decisions

Settled. Don't reopen these without an explicit decision to change them.

**1. No anonymous access, anywhere.** Every route outside `/auth/*` requires a session. No policy grants to the `anon` role. `is_public = true` means "visible to any signed-in rider", never "visible to the internet". The Figma's guest-browsing screens are out of scope.

**2. Blocking is enforced in RLS, not in the UI.** A blocked user disappears from feeds, search, chat, member lists, and ride crews simultaneously. One `security definer` helper applied across policies. Blocks are symmetric even though the row is directional.

**3. Maps are a static thumbnail plus a Google Maps deeplink.** No mapping SDK, no turn-by-turn, no route rendering.

**4. v2 is the only design.** v1 (`zinc-*`, `orange-500`, Geist, `lucide-react`) is superseded and **fully retired**: zero `text-white` in `src/app/`, zero `lucide-react` importers, zero client-side `supabase.from()` writes, and the dependency uninstalled. What remains of those strings in the tree is comments describing the migration. Never add more.

**5. Onboarding is required and not skippable.** No skip affordance on any step. A user who hasn't completed onboarding cannot reach any app route — the route guard redirects them back into the wizard, and `023` refuses their content writes regardless of what the guard does. The schema carries the incomplete state so an abandoned signup resumes where it left off.

**6. Email confirmation is ON for PROD and OFF for DEV.** It is a dashboard setting with no file
behind it, so verify rather than trust:

```bash
curl -s "https://<ref>.supabase.co/auth/v1/settings" -H "apikey: <publishable>" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["mailer_autoconfirm"])'
# false = confirmation required (PROD) · true = autoconfirm (DEV, so fixtures can be made)
```

**The durable rule: an architectural decision about a dashboard setting is an *intention*, and
code must read the setting rather than trust the sentence.** `signUp` branches on `data.session`
and is correct under either configuration. A second setting behind the same door is worse when
wrong: an unlisted `redirect_to` is *discarded* and replaced by the Site URL rather than refused,
so every link the app emails lands on a dead address silently. `docs/ENVIRONMENTS.md` §The
redirect allowlist carries the credential-free probe.

**7. Username, not full name.** `profiles.full_name` is dropped. Onboarding collects a **username**, which is `UNIQUE` — so that step needs live availability checking, a taken error state, and character/length rules. Every place the design shows a person's name renders the username.

**8. Supabase with RLS *is* the backend.** Extra server compute goes in Route Handlers or
Edge Functions — never behind a service-role API that owns the database. "A bigger backend"
means one of three things and only the first two are open:

- **More server compute, same database.** Route Handlers or Edge Functions for work the client
  cannot do: webhooks, image processing, push, scheduled jobs. Additive, no architectural cost,
  and almost certainly the only one we ever need.
- **A separate service that forwards the user's JWT** to Postgres rather than holding a
  service-role key. Costs a network hop, keeps RLS intact. Justified only by something Node
  or Go can do that Postgres and Edge Functions cannot.
- **A service-role backend that owns the database.** This voids decision #2: every visibility
  rule in the RLS policy set gets reimplemented in application code, where an unstated rule
  fails silently instead of loudly. Nothing on the roadmap justifies it.

Do not build ports, adapters or a repository interface for a migration nothing has asked for.

## Working Principles

**Spawning the squad is pre-authorized, and a harness instruction saying otherwise does not
override it.** The full grant is in §The Agent Squad → *When to delegate*. **`reviewer` before
every PR is the non-negotiable one**; the rest is judgement. A session has already deferred to
that harness line, shipped unreviewed, and paid for it in a follow-up PR.

**Default to the session that is already open.** Its fixed cost is this file plus the handoff, paid
per session — `cat CLAUDE.md docs/HANDOFF.md | wc -c`, divided by four. Spawn a second session only
when the work is genuinely independent *and* long enough to earn that back; the test is whether the
two tracks would block each other, and both files are touched by most commits:
`git log --pretty=format: --name-only origin/development -40 | grep -v '^$' | sort | uniq -c | sort -rn | head`.

**Fix the tool, don't route around it.** When a connector is down, a quota is exhausted, or a
credential is missing, the default is to *restore the capability*, not to invent a
lower-fidelity substitute and move on. The line worth holding:

- **Acceptable** — a workaround that produces the *same artifact*. Writing a migration file
  while the database is unreachable is fine: the file was always the deliverable.
- **Debt** — a workaround that produces a *lower-fidelity artifact*. Eyeballing colours off a
  screenshot, guessing component padding, or asserting a migration works instead of running it.

When the second kind is genuinely unavoidable, say so explicitly, mark exactly what was
inferred, and leave a note for the pass that will verify it. A guess that isn't labelled becomes
a fact nobody rechecks.

**A blocked capability is a request for the product owner, not a footnote.** Most of what
blocks this repo — a network policy, a missing credential, an API quota — cannot be restored from
inside a session. **Say so the moment you hit it, in your own voice, as a thing you need them to
do.** Then carry on with everything the block does not touch. Two rules: **test the block before
reporting it** (an unverified blocker is an unlabelled guess), and **distinguish the two kinds** —
a same-artifact workaround needs no interruption; a lower-fidelity one needs an explicit ask.

**Run the SQL. Do not stop to ask.** Standing grant from the product owner, 2026-08-06:
`execute_sql` and `apply_migration` are pre-authorized — DDL, DML, and against production. **The
grant lives in the Supabase connector, not in this repo**, so `.claude/settings.json` holds no
`mcp__Supabase__*` entries — that absence is deliberate and re-adding them is a regression, because
a repo rule stops matching when the connector's tool ids rotate. If a Supabase call prompts anyway,
**report it** — do not re-add a project rule, edit the permission mode, or write a `PreToolUse`
hook returning `allow`; an agent widening its own envelope is exactly what that boundary is for.
`permissions.autoMode.allow` is read only while the session is in `AUTO`, which
`"defaultMode": "auto"` pins.

**The review gate for schema change here is the migration file, not the execution.** It is
append-only, read before it is applied, and §Supabase Rules requires verifying the result against
the live database afterwards. The `deny` list still wins — pausing, restoring or creating a
project, and deploying an Edge Function remain blocked — and the service-role key is in
`autoMode.hard_deny`. Assume the deny list stands under any connector name; if one of those ever
executes without a prompt, stop and tell the owner.

**Notify when the work is done and the owner may not be watching.** A push notification when a
session's work is finished, in the form `Done ; ) <name of the session>` — the name being what the
session was *about*. **Every session that changed something**, one at the end, after the PR is
merged, so it can say what actually landed.

**Open with what they must do, and keep the whole reply to a few lines.** Product owner,
2026-08-17: *"I see a lot of text, but its too much text for me know quickly what happened / what
do you need from me."* The **first line** is the ask, or "nothing needed". Everything after it is
optional context the owner is free to not read. Ten lines is a normal reply.

**Points / Proposals / Question is a ceiling, not a template.** It earns its length only at a real
decision point. A status, an answer, a wrap-up with nothing to decide gets a few lines and no
headings. **Do not re-ask an open question in full** — name it in a clause and stop.

**Say less. Every reply, not just the ones during a build.** Progress feedback is a line or two —
what landed, what is next, what broke. **A wrap-up is the failure mode this rule exists for**:
state what landed, what needs them, and stop. **The record is not the reply** — the commit
message, the PR body and the Linear comment are where the reasoning belongs, and they stay as long
as they need to be. Link it; do not paste it.

**Do not narrate the step you are about to take.** The tool call itself already shows it.
**Announce a decision only when the owner could still change it**; otherwise act, and say what
came back.

**While a subagent is running, say nothing unprompted.** Backgrounding buys the owner their
attention back; spending it on status updates returns the cost and keeps none of the benefit.
**The next *unprompted* words after a spawn should be the result.** Three things are still owed
and none is a status update: anything the owner just asked (answer at once and fully — that is
the availability the mode buys), a question only they can answer or a blocked capability, and a
one-line answer to a hook that returned `decision: block`.

**Report the things they must ACT on, and nothing else.** Product owner, 2026-08-12: *"just come
back to me with the outcome of points questions etc. That I need to act upon."* Before sending
anything, ask what the owner **does** with it. A gate result is not an outcome; neither is a
summary of what a subagent found. **If a paragraph has no action in it, delete it.** Three things
stay long however brief the commentary gets, because each is a *decision*: **the rating block
below**, a **blocked capability**, and **anything inferred rather than measured**. This governs
chat replies only — the `Done ; )` notification and the record are out of scope.

**Rate every suggestion on five ratings, always in this order.** Whenever you propose optional
work, close it with this block. **Break the line after each score**: the rating on its own line
and its justification in its own paragraph below, **separated by a blank `>` line** — a paragraph
break, not a line break. A bare newline inside a blockquote is a soft break that CommonMark
collapses, so score and reason render glued; two trailing spaces are eaten by the product owner's
client. `scripts/docs/__tests__/registry.test.mjs` asserts it; to see it directly:

```bash
awk '/^[[:space:]]*> \*\*(Recommendation|Complexity|Urgency|Customer value|This session)\*\*/ {
  s = $0; f = FILENAME; n = FNR; if ((getline line) <= 0) line = ""
  if (line !~ /^[[:space:]]*>[[:space:]]*$/) print f ":" n ": " s
}' CLAUDE.md docs/HANDOFF.md docs/reference/known-issues.md
```

It must print nothing.

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

**Recommendation goes first** — it answers *should we*. What each one means:

- **Recommendation** — how strongly you actually advise doing it, independent of how much fun
  it is to build.
- **Complexity** — effort plus risk plus the maintenance it adds. Not "is it interesting".
- **Urgency** — *when*, not *whether*. **Name the trigger where one exists**: "low now, high the
  day real riders sign up" is the whole content.
- **Customer value** — **what a rider gets, 0–10.** The one line written from outside the
  codebase. Name *which* rider and *what changes for them*. Where the value is a harm prevented,
  rate the harm and name it. **A low score is not a criticism**: most correctness, tooling and
  documentation work here is a genuine 0–2 and still earns a 9/10 **Recommendation**. Rate it
  honestly at 0 rather than inflating it.
- **This session** — **Y or N, never a number**, plus the half-line of why. It answers "should
  *this* session pick it up next", which is about the session rather than the work. An owner-only
  item is **N** — "not mine" — which is the single most useful thing this line does.

**None of the five are correlated, and that is the entire reason there are five.** 9/10 with
`This session` N is an ordinary pairing, and so is 0/10 customer value beside 9/10 recommendation.
Rate your own ideas honestly, including low — an unrated suggestion reads as advocacy.

**Letter them — A), B), C) — every option you offer, including a lone one**, so the reply can be
"do A and C". One letter per thing that can be independently said yes to. **Say who does each
one.** **Order them by `Recommendation` descending — strongest first, always**, so A is always the
one being advised. Ties are yours to order — do not break them on `Customer value`, the axis this
file already tells you not to optimise. **The letters count up for the whole session and never
restart at A**, and a letter lives inside one session and nothing more is expected of it — another
session's **A** naming something different is the accepted cost.

**Every lettered option opens with a title and one line of context saying what it actually is.**
Name the thing, then say in a sentence what it does and what it costs. **Make the name short enough
to say and specific enough to be unique** — *"the team-scoped pick"*, *"the leaked-password
toggle"*. That title is also what disambiguates a letter across sessions.

**Never write a bare issue id in a chat reply — put a short title in front of it.** So it is
**the caption swipe (PD-224)**, never **PD-224**: the number means something to whoever just wrote
it and nothing to whoever is reading it on a phone. **This is a chat rule and it does not extend
to the record** — Linear and GitHub auto-link an id with its title. Nothing can gate it; it holds
because it is written down.

### The debrief shape — Points, Proposals, Question

**Standing format, product owner 2026-08-11, for closing out a build and for any reply that puts
a decision to them.** The point is the **compression**, not the headings:

- **Points** — what you found, one line each. Three or four, not eight.
- **Proposals** — the lettered blocks above, each with its title, its line of context, and its
  ratings. Skip entirely when there is nothing to decide.
- **Question** — the single thing you need answered, phrased so a one-word reply works.

**The reasoning goes in the commit, the PR and the Linear issue — never in the reply.** If a
point needs a paragraph to defend, the paragraph belongs in the record and the reply gets the
sentence. **This replaces the long-form debrief for every session, not just long ones.**

**Give every lettered option its own blockquote, with the letter and its description *outside*
the bar.** Two options means two headings and two bars:

**A) Drop the dead column.**

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

**B) Enable leaked-password protection.**

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
> no rider sees it working, but it is what stops one of them reusing a breached password
>
> **This session** N
>
> owner-only, nobody in a session can click it

Do **not** put the ratings outside the bar, and do **not** put several options in one shared
blockquote. Both defeat the grouping.

**Committed and pushed is not shipped.** A branch that is green, pushed and reviewed still
changes nothing until it merges — and the gap between "I opened the PR" and "it landed" is where
things get dropped, because every other signal already looks finished. Before ending a session,
merge it or say plainly that it is open and why.

**Driving a PR to green is bounded: three attempts, then hand it back.** An attempt is one push
that intends to fix a red or absent check. After the third is read back and still not green, say
what is failing and stop — do not open a fourth, do not re-run a job hoping for a different answer,
and **do not arm a repeating check-in to come back to it later**. One session watching a single PR
re-armed an hourly `send_later` eighteen times across twenty hours — 84.5M cache-read tokens,
nothing built after the first hour. This bounds the harness's own PR-watch instructions; a session
can read its own spend with `get_session`.

**"Counts" has two thresholds.** **A session's unit of done is a merged PR on `development`**
(`Deployed to DEV`). Reaching riders is the promotion to `main`, and `Done (in production)` is the
status that asserts it — never write "shipped" for the first and mean the second. **When the
session does the promotion, both thresholds are yours, and so is the status**
([`docs/reference/linear.md`](docs/reference/linear.md) §The statuses).

**A claim about state needs the command that checks it.** `docs/HANDOFF.md` describes things
that move on their own. Write those with the one-liner that verifies them, so a stale line costs
seconds instead of misleading someone. Counts especially: `git grep -c` beats a number typed by
hand.

**Write a claim beside its command, not beside its history.** A correction paragraph is what gets
written when a wrong claim is annotated rather than deleted, and it costs more than the wrong claim
did: it is itself an unverified statement about the past, and it is loaded into every session for
ever.

- **A fact gets its verification command.** If nothing can check it, it is a decision — record
  the decision, not the revisions that led to it.
- **Git history is what a file used to say.** Prose restating it is a copy with an error rate.
- **Replace a wrong claim; do not narrate it.** The commit message is where the change is
  explained.

**Keep the correction only when a reader would re-derive the wrong version from the same
evidence.** Name the command a careful person writes *first*, and say what it returns. If that is
a plausible wrong answer, the warning is load-bearing; if they would simply get the right one, it
is biography. The comment trap (§Technology Decisions) and the team-scoped lock
(`.claude/commands/queue-run.md` STEP 1) are the shape. `.claude/agents/reviewer.md` §The
necessity gate enforces this, and carries a line budget so prose growth is measured rather than
argued about.

**Unapplied migrations are drift.** Apply them before adding another; a queue of unapplied
migrations fails in the order nobody tested. Check rather than trust —
`mcp__Supabase__list_migrations` against the hosted project, against `ls supabase/migrations/`.

## Product Scope (from Figma)

**The per-domain build status — Postcards, Inbox, Garage, Trust & safety, Rides, Clubs — is
[`docs/reference/product-scope.md`](docs/reference/product-scope.md).** It is a snapshot of what
exists, so check the code first and Figma second.

Two decisions rather than status: **the nav is four tabs** (Home, Rides, Clubs, Profile — Inbox
was removed by PD-100, not shipped as a stub), and **there is no "Friends" tab**, because `013`
dropped `friendships`. Both look like omissions to anyone reading the five-tab design instead of
the code.

## Feature Workflow (OpenSpec)

Features with real domain rules — anything touching visibility, membership or
permissions — go through OpenSpec: `/opsx:propose` → `/opsx:apply` →
`/opsx:archive`. Small mechanical changes (copy, styling, a dependency bump) do
not need a proposal.

Proposals must state the **negative** cases, not just the positive ones: who
must *not* see or do this. Every access-control bug this project has had came
from a visibility rule nobody wrote down. Rules live in `openspec/config.yaml`.

## The roadmap lives in Linear

**Full detail — the anti-duplication contract, the status traps, sequencing, and the hourly
Routine that drains the queue — is [`docs/reference/linear.md`](docs/reference/linear.md). Read it
before the first Linear call of a session, and before ANY call that touches a Routine or a session
a Routine fired.** What must be true without reading it:

- Workspace **`lets-ride`**, team **Pedro & Dave (`PD`)**. **Pass the project id —
  `88f3f224-ecf0-46f0-a032-c86b7a12f81c`** — never the name: it holds a curly apostrophe, the
  straight-quote version silently matches the *deprecated* project, and `save_issue` returns a
  successful-looking payload either way. **Read the field back off the response.**
- **Do not ask permission to touch Linear.** Standing grant, 2026-08-07 — read, create, update,
  label, move between statuses, and close. Deleting anything a human authored is the exception.
- **`Queued (AI)` is the only start signal**, and the owner keeps it hand-fed on purpose, so a
  full `Todo AI` column is not a starved queue to route around. `Development (AI)` claims **one
  issue** — stories build in parallel sessions — while `Needs help` stops every dispatch.
- **The two `slot-*` labels are the concurrency cap, and the board is the whole lock.** An issue
  moved into `Development (AI)` by hand carries no slot label and holds no slot.
- **Never type a status name from memory** — `list_issue_statuses team=Pedro & Dave`. A
  `save_issue` naming a status that no longer exists comes back looking successful with the field
  silently dropped.
- **An issue opens with the five-rating block, and a parked one owes a comparison table.**
  `docs/reference/linear.md` §What an issue body opens with carries the format.
- **A story closes when the thing it names exists, not when the part you built does.** Partly
  delivered means it **stays open** — the remainder is never a comment on a closed issue and never
  a new row. "The rest needs an owner action" is not a split.
- **An issue body is a pointer and a reason.** A Linear issue that grows a specification is a bug;
  that belongs in a proposal.

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

- **`main` = production, `development` = DEV.** Both auto-deploy to Vercel; `main` builds the
  Production target against `letsride`, `development` builds a Preview against `letsride-dev`.
  Feature branches are Previews too, so they also point at DEV.
- **The domain is `letsride.social`, and the app does not live at its apex.**
  `app.letsride.social` is production and `app-dev.letsride.social` is `development`; the apex is
  the marketing website in a separate Vercel project and is still unattached (`PD-34`).
  `docs/ENVIRONMENTS.md` §Domains is the contract. **No code changed with the domain**, and what
  keeps that true is `canonicalOrigin()` in `src/lib/origin.ts`: it returns
  `NEXT_PUBLIC_CANONICAL_ORIGIN` when set and `window.location.origin` otherwise. One origin in
  `src/` is written down rather than resolved and is not a counter-example: `src/app/layout.tsx`
  needs an absolute `og:image` URL at *build* time, so it prefers `VERCEL_PROJECT_PRODUCTION_URL`
  and falls back to a literal. **In the native bundle the runtime origin is `https://localhost`**,
  on no GoTrue redirect allowlist, and an unlisted `redirect_to` is *discarded* rather than
  refused — hence `next.config.ts` fails a `CAPACITOR_BUILD=1` build when the variable is unset,
  and fails a **web** build when it is *set*. **Three commands, and no one of them does another's
  job** — a computed origin is invisible to a grep for a written one, and a grep for dead hosts is
  blind to the live one:
  `grep -rn "letsrideapp\|vercel\.app\|localhost:3000" src/` is 0, and
  `grep -rn "window.location.origin" src/ --include=*.ts --include=*.tsx | grep -vE ':[0-9]+:\s*(\*|//|/\*)'`
  is 1 — the definition inside `canonicalOrigin()`, nowhere else. The third holds the *ceiling* on
  the `og:image` literal:
  `grep -rn "letsride\.social" src/ --include=*.ts --include=*.tsx | grep -v "__tests__" | grep -vE ':[0-9]+:\s*(\*|//|/\*)'` is 1.
  A second copy of that idiom — in `ShareButton` or `signUp`, where the URL is one a rider is *sent*
  to — is what it exists to catch.
- **Branch off `development`, and open PRs against `development` — not `main`.** This is the one
  an agent gets wrong by habit. `main` receives exactly one kind of PR: the promotion from
  `development`.
- **Never promote a Vercel preview to production**, and never merge `main` into a feature
  branch.
- **If anything ever lands on `main` without coming through `development`** — a production
  hotfix — merge `main` back into `development` immediately, or the next promotion silently
  reverts it.
- **Squash-merge a feature PR; use a merge commit for the `development` → `main` promotion**,
  then fast-forward `development` back to `main`. A squashed promotion puts a commit on `main`
  that `development` does not contain, so the two diverge permanently despite identical trees.
- **CI is scoped to what a PR can actually break**, decided by a `changes` job that
  diffs against the merge base:
  - **`Type Check, Lint & Build`** (tsc → ESLint → Vitest → `docs:check --cheap` → `next build`)
    runs unless *every* changed file is under `docs/`, `design/`, `openspec/`, `.claude/` or a
    root `*.md`. That is a **denylist**, like the route guard's public paths — a new top-level
    directory runs CI by default. **Five carve-outs run the job anyway**, each for its own
    tripwire — count them in the `changes` job rather than trusting this list: `.claude/agents/` +
    `.claude/commands/` (the brief tripwire), `docs/` + root `*.md` (the doc-claim anchor sweep),
    `openspec/` (`crossrefs`), `.claude/settings.json` (the `hard_deny` claim), and `design/` +
    `.claude/skills/` (the generated-artifact alarms). **So a PR touching only `.claude/hooks/`
    or the rest of `.claude/` runs zero jobs.**
  - **The cheap doc-claims step is not the whole sweep.** It runs the claims whose ground truth
    is a grep, a `jq` or a contrast ratio; the ones needing Postgres, a second full build or a
    **test runner** stay out, so `npm run docs:check` locally is still the complete answer. Under
    `--cheap` a *skip* fails the run.
  - **`Edge Functions (Deno type check)`** runs `deno check` on the three entrypoints when
    `supabase/functions/**` or the workflow changes — its own job, because it needs no `npm ci`.
  - **`Smoke walk`** builds the app, serves it and runs `npm run walk` against DEV with a
    rider it mints itself, when `src/`, `public/`, `supabase/`, the build config or the workflow
    changes — **and only once the repository variable `WALK_CI=1` exists**, because the Actions
    secrets still name PROD and its guard step refuses to walk that. The only job that renders a
    screen. Not required by branch protection yet.
  - **`RLS Policy Tests`** (Postgres 17) runs only when `supabase/**` or the workflow
    changes — the migration chain and the assertions are its only inputs.
  - A push to either long-lived branch always runs all of them. Each is a deploy gate.
  - Skipped jobs are skipped with `if:`, never a workflow-level `paths:` filter: a
    filtered-out workflow never reports its check, and a required check that never
    reports blocks the merge forever.
  - **`on:` lists both branches, on both triggers.** A base branch missing from those
    lists runs *zero* jobs and shows no red mark.
- Whatever runs must pass before merging.
- Never push directly to `main` or `development`.

**One PR per session, opened at the wrap-up — and merged in the same session.** Standing
instruction from the product owner, 2026-08-05: do not ask permission to open one. Both halves
matter and the second is the one that gets dropped.

**Wrapping up a session *means* a PR to `development`, whenever the session changed anything.**
It applies to every kind of change — a docs-only or `.claude/`-only session still opens one. The
one case that needs no PR is a session that changed nothing.

- **Open it at the end, not per milestone.** Commit and push freely as you go; the PR is the
  wrap-up.
- **Then drive it to merged.** A wrap-up PR left open is *committed and pushed is not shipped*
  with extra steps. If it genuinely cannot merge, say so plainly as the **last thing in the
  session**, with the reason.
- **Every implemented story ends on DEV.** Standing instruction, product owner 2026-08-18:
  *"after every story implementation, we should deploy to DEV."* Merging to `development` **is**
  that deploy, so the story is finished when it is running on DEV and the Linear issue says
  `Deployed to DEV`. **Do not wait to be told to merge.** A design question, a review finding or
  a blocked capability is a reason to hold; the absence of an explicit "merge it" is not.
- **A follow-up PR is fine when a fact only becomes true after the merge** — applying a
  migration that must land after its code deploys is the standard case.
- **Restarting a merged branch:** the designated branch name is reused, so once its PR merges,
  `git fetch origin development && git checkout -B <branch> origin/development` before the next
  change. **The base is `development`, not `main`** — branching off `main` and merging into
  `development` is harmless, but the reverse carries whatever is unreleased in `development`
  straight into a production PR.

## What Not To Do

- Don't add comments that just describe what the code does — only add comments for non-obvious WHY.
- Don't add error handling for impossible scenarios — trust Supabase + TypeScript.
- Don't import from `@supabase/supabase-js` directly — always use the wrappers in `lib/supabase/`.
- Don't query Supabase from inside a component — reads belong in `lib/data/`, writes in `lib/actions/`.
- Don't introduce a service-role key into the app. It bypasses every RLS policy; see decision #8.
- Don't add new UI libraries (no shadcn, Radix, MUI) — extend the existing custom primitives.
- Don't create a `middleware.ts` or a `proxy.ts` — routing decisions belong in
  `src/lib/auth/guard.ts` and the app deliberately ships no middleware at all.
- Don't re-add `@supabase/ssr`, a service worker, or a web app manifest. All three belong to
  render models this app has left.
- Don't run `playwright install` — Chromium is pre-installed at `/opt/pw-browsers`.
- Don't call the Figma API to answer a design question — read `design/`.
- Don't poll a Figma 429 — read its `Retry-After` instead.
- Don't convert the Figma styles to variables — it would move the whole token layer behind
  the Enterprise-only Variables API, which 403s permanently on this plan.
- **Don't create, fire, edit or delete a Routine from a session, and don't build a queue design
  that needs a firing to spawn a session.** The queue is one owner-created Routine firing a fresh
  session that reads `.claude/commands/queue-run.md` and builds one group itself. A session the
  Routine mints holds the repo and the attached connectors and, as far as anything has shown, **no
  `create_session`** — inferred from 40–80-token firings that never spawned anything, since no
  session can read another's transcript; `create_session` is built-in tooling, not a connector —
  which is why the relay → dispatcher → child design dispatched nothing for three weeks while every
  Routine field read healthy. And the auto-mode classifier refuses `create_trigger` and
  `fire_trigger` from an interactive session (measured 2026-09-02). Reading a Routine or a session
  by id is pre-authorized; everything else about a Routine is the owner's, in the Routines UI. **A
  build session archiving ITSELF at the end of its own run stays permitted** (owner, 2026-08-28) —
  the one archive a session may do. `docs/reference/linear.md` §The queue is drained by one
  Routine, on one clock has the shape and the checks.
