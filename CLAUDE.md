# LetsRide — Project Context for Claude Agents

> **▶ Starting a session? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) now.** This file holds
> the durable context — stack, decisions, conventions. The handoff holds the *current
> position*: what is half-done, what is blocked, and the exact next action. Neither is
> complete without the other, and only this one gets auto-loaded.

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

**Branch cleanup is an owner action, and the branches on the orphaned root must never be
deleted.** The repo's history was rewritten on 2026-08-04, so `main` and `development` root at
`0ea7054` and every branch that had not merged by then sits on a root with **no merge base to
`development` at all** — `git merge` cannot reach those commits, only `git show <sha> -- <path>`
can. Deleting such a branch destroys the only copy of whatever was in flight that day. `PD-143`
carries the do-not-touch list.

**"Is it an orphan" is the wrong safety question.** Orphan-ness explains why a branch is
*unmergeable*; it says nothing about whether its content ever landed, and branches carrying
unlanded work are not all orphans. The property that matters is *unmerged content* — and an
ahead-count or `git cherry` both report every commit of a squash-merged branch as unlanded for
ever, so re-derive it with `merge-tree`, which needs no merge base. **The answer is a snapshot**:
it is stale the moment another session pushes, so run this immediately before deleting anything,
including against the list in `PD-143`:

```bash
devtree=$(git rev-parse origin/development^{tree})
for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin |
           grep -vE '^origin/(development|main|HEAD)$'); do
  res=$(git merge-tree --write-tree origin/development "$b" 2>/dev/null | head -1)
  [ -z "$res" ] && { echo "ORPHAN  $b"; continue; }          # no merge base at all
  [ "$res" != "$devtree" ] && echo "UNMERGED $b"             # merging it would change something
done
```

**No session can delete a branch here** — `git push origin --delete` returns **HTTP 403** from
GitHub while ordinary pushes in the same session succeed, including `--force-with-lease`, and the
GitHub MCP server exposes `create_branch` with no delete counterpart. Do not spend a session
rediscovering this.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript strict) |
| Styling | Tailwind CSS v4 (CSS-first config, no `tailwind.config.*`) |
| Database / Auth | Supabase (Postgres + RLS + `@supabase/supabase-js`). **`@supabase/ssr` is gone** — uninstalled 2026-08-06 with the server render path; the session lives in `src/lib/supabase/session-store.ts` |
| Icons | The Figma set, generated to `src/components/icons/generated.tsx` (see Design System). `lucide-react` is **gone** — uninstalled 2026-08-05 with the last v1 page |
| Client cache | Hand-rolled, `src/lib/query/` — `useQuery`, `invalidate`, `setQueryData`, `clearQueryCache`. **Not TanStack Query**: this app needs a well-bounded subset and the dependency rule below is deliberate. `keys.ts` is the contract mapping all 33 `revalidatePath` claims to cache keys |
| Deployment | Vercel (auto-deploy from `main`) |
| CI | GitHub Actions — type check + lint + unit tests + build, and the RLS suite. Path-scoped; see Branching & CI |

## Technology Decisions

*What* we build is under Architectural Decisions. This is *how* — the tooling questions that
otherwise get answered differently in every epic. Edit freely, but edit here rather than
deciding again inside a PR.

**Dependencies are added deliberately.** **Nine** runtime dependencies today, and that is a
feature — `lucide-react` and `@supabase/ssr` both came out with the code that needed them rather
than lingering unused. Count rather than trust that number:
`node -p "Object.keys(require('./package.json').dependencies).length"`. Before adding one, ask whether a thirty-line helper does the job. No UI component
libraries at all — shadcn, Radix and MUI are out; extend `src/components/ui/*` instead.

**Two of the nine are the native shell's**, and both are runtime by necessity rather than by
preference — app code imports them at runtime, so neither can be a devDependency:

- **`@capacitor/core`** — the shell. Nothing reaches a native API without it.
- **`@aparajita/capacitor-secure-storage`** — the keychain/keystore behind
  `window.__letsrideSecureStore`. Capacitor's own team ships no keychain plugin, and
  `@capacitor/preferences` is `UserDefaults`/`SharedPreferences`, which is explicitly *not*
  secure storage and is the wrong place for a refresh token. This was the only way to reach
  the platform keychain at all.

`@capacitor/cli`, `@capacitor/ios` and `@capacitor/android` are devDependencies. The rule that
**native plugins count** is in `.claude/agents/native.md` and still holds: each one is a
permission prompt, a review question and a supply-chain surface, and each needs a
one-sentence justification like the two above.

**Reads go through `src/lib/data/`. Components never call Supabase directly.** Named, typed
functions — `getRide(id)`, `getClubMembers(clubId)` — that own their query shape. This exists
because `.from()` calls scattered across a dozen files mean a renamed column is a dozen places to
find, which is exactly the trap `003` set by dropping `full_name`. Re-derive the spread with
`git grep -c "\.from('" -- 'src/*.ts' 'src/*.tsx'`.

**Writes go through `src/lib/actions/`**, one function per mutation — plain async functions in
the browser, not Server Actions. The boundary is the point: one place that writes, named and
typed per mutation. Two of the three arguments that created the directory still hold, and the
first is why it must never be dissolved back into components:

1. RLS enforces *authorization*, never *validity*. Username charset, T&C acceptance and the
   onboarding completion stamp are integrity rules the client must not own. `018`–`027` moved
   them into the database as a CHECK, a trigger or a grant, which is what made client-side
   writes safe in the first place. A Server Action omitting a column was never a rule.

   **The participation gate is narrower than "every write", and stating it broader is how a gap
   gets inherited as covered.** `enforce_participation_gate` is on nine tables — `postcards`,
   `clubs`, `rides`, `club_members`, `ride_members`, `postcard_comments`, `postcard_likes`,
   `postcard_reports`, `ride_messages` — and **not** on `profiles` UPDATE, `profile_countries`,
   `blocks`, `postcard_hides`, `feed_reads` or any `storage.objects` policy, which check the path
   prefix only. So an account created by calling GoTrue's `/auth/v1/signup` directly, never
   calling `accept_terms()`, **can still set a username, write a bio and upload an avatar with
   `terms_accepted_at` NULL**. Count it rather than read it, because a table added without one
   looks exactly like this list being right:
   `select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not
   tgisinternal`.
2. `useActionState` gives pending and error states without hand-rolled `useState` triples — and
   it works exactly the same with a plain async function as with a Server Action, which is why
   moving the writes into the browser changed no call site.

   *(A third argument — that auth flows have to set cookies, which only a Server Action or Route
   Handler could do — expired when the browser client started setting its own session. Noted
   because it is the one that otherwise gets re-argued from first principles.)*

A component never calls `supabase.from()` directly — that was the v1 pattern, paired with
`router.refresh()`, and none of it survives. Keep the second half of the pipe; the bare grep
prints 3, all comments (see *the comment trap* below):

```bash
grep -rn "supabase\.from(" src/app/ src/components/ | grep -vE ':[0-9]+:\s*(\*|//|/\*)'
```

**The render model is the client.** The app is a client-rendered bundle so it can go into a
native iOS/Android build: store presence is a product requirement, and background location
tracking is on the roadmap — which the web platform cannot do at all, on any browser, because
JS is suspended the moment the app backgrounds.

The client talks to Supabase directly under the same RLS policies, with the same publishable
key that already shipped in the bundle. **This is decision #8 read literally, not a departure
from it** — the backend stays Supabase, and a handful of Edge Functions arrive for the jobs
needing a secret, a schedule or elevated rights (push delivery, ride reminders, account
deletion).

**The refresh token is JS-readable, and always was** — `@supabase/ssr` set
`sb-<ref>-auth-token` with `httpOnly=false` because the browser client had to read the session
back out of `document.cookie`. The client bundle did not cause this and does not worsen it; the
store moved to `src/lib/supabase/session-store.ts` and the exposure closes for real only when
`window.__letsrideSecureStore` runs over a platform keychain.

**The SSR shell is the one piece of the server render still standing.** Next server-renders
client components on first load, and that goes with the native shell rather than with the
render model — it is the `native` agent's work.

**Retiring that shell does not lift the *read in an effect* rule below — the rule is
permanent.** `output: 'export'` — the only fully-static bundle Next 16 offers, and therefore what
a Capacitor `webDir` is built from — **still runs the same prerender pass, once, at build time**.
What the bundle removes is the *runtime* server, not the pass, so a component body still executes
somewhere with no `localStorage` and no session and `resolve.browser.ts`'s tripwire keeps earning
its place. `.claude/agents/native.md` says the same; do not let the two drift apart.

Re-derive the scope rather than trusting a number here — it grows with every epic:

```bash
git grep -l "" -- 'src/app/**/page.tsx' | wc -l                     # pages
git grep -L "^'use client'" -- 'src/app/**/page.tsx' | wc -l        # ... server-rendered: 0
git grep -L "^'use client'" -- 'src/components/**/*.tsx' | wc -l    # presentational components
```

The third line is **not** a defect count: a component with no `'use client'` is fine, it just
has no client hooks of its own and joins the client graph through its importer.

**The comment trap — this repo's most-repeated measurement error, four times and counting.**
A file's description of what it migrated *away from* looks exactly like the thing it migrated
away from, so any grep for a retired pattern counts its own obituaries. It has produced a wrong
number for the `lucide-react` importer count, the v1-token count, the `supabase.from(` grep
above, and the `^'use client'` anchor here — where the unanchored version read 16 server pages
against a real 18, because two pages carry doc comments saying they used to be `'use client'`.
Two rules follow: **a directive is only a directive on line one** (hence the `^`), and when
counting a retired pattern, exclude comment lines and verify the filter both ways — that it
reads 0 now *and* that it still catches a real instance.

**No new integrity rule may live only in a Zod schema.** Anything not expressed as a CHECK,
trigger or policy is advisory, because a rider can simply not run your validation. `003`, `012`
and `023` cover onboarding and consent; `018` covers the text bounds, including `bio`,
`bike_model` and `location`.

**`lib/data/` and `lib/actions/` are the only places that touch Supabase, and both resolve
their client through `src/lib/supabase/resolve.ts`.** One name, one doorway — which is what made
the render migration a change to one file instead of every `.from()` call site, and is the reason
to keep the indirection now that it resolves to a single implementation.

**Do not reach for a "just check at runtime" fix to a bundling problem.** Next refuses to bundle
`next/headers` into a client graph **whether or not the branch importing it can be taken**, and a
`typeof document` guard around a dynamic `import()` does not help because the bundler resolves
the specifier statically. That is why this split was ever a build-time export condition rather
than a runtime `if`.

**Read in an effect or an event handler, never during render.** A `'use client'` component is
*still server-rendered* by Next on first load, and in that pass the browser client has no
`localStorage` to find a session in — so a read issued from a component body is anonymous, and
`anon` holds zero grants, so it fails closed at RLS. `resolve.browser.ts` throws a named error
when that happens, which turns a silent empty screen into a build failure: static prerendering
runs the SSR pass, so a page that gets it wrong fails `next build` with the message.
`src/lib/data/__tests__/isomorphic.test.ts` guards the module graph for both directories.

**Reads in a client component go through `useQuery`, and every key is spelled in
`src/lib/query/keys.ts`** — a key written inline in a component is a bug even when the string
happens to be right. That file's header carries the table reconciling all 33 `revalidatePath`
claims the actions used to make against the key that replaced each one. `keys.ts` also owns
`filterSegment`, because a feed filter is two fields flattened into one key segment and five
screens plus one action have to build the same string.

**Gate a screen on its data, never on `isLoading`.** `useQuery` starts its fetch in an effect,
so on the first render pass there is no data *and* no fetch in flight — `isLoading` is `false`
and a screen gating on it renders `undefined` where its data should be. `combineQueries`
deliberately does not expose an `isLoading` at all; its header explains why the obvious third
field is missing.

**`null` is a decided answer; `undefined` is "not yet".** Only the first is `notFound()`.
Conflating them shows a 404 flash on every load of a detail screen.

**Validation: Zod, one schema per concern.** Lives in `src/lib/validation/`. It parses
`FormData` at the action boundary and drives live feedback in the form, from one definition
rather than two copies that drift. Per the rule above, Zod owns the **message**, never the
**guarantee** — the database owns that, and now that the client owns the mutation path a Zod
rule with no constraint behind it is a suggestion a rider can decline.

**Forms are hand-rolled** — controlled inputs plus `useActionState`. No React Hook Form or
Formik; the forms in this app are one to three fields.

**Tests:**

| Kind | Tool | Status |
|---|---|---|
| RLS policies | `supabase/tests/` — psql against Postgres 17 | In place; gates every PR that touches `supabase/**` |
| Units — validation, `lib/utils.ts`, `lib/data/`, the cache, the route guard | Vitest — `npm run test:unit` | In place; gates every PR that touches code. Also covers `src/lib/query/`, `src/lib/auth/guard.ts` (36 cases, replacing the untestable `proxy.ts`) and `src/lib/supabase/session-store.ts`. `lib/actions/` still has no direct tests |
| Smoke walk | `npm run walk` — playwright-core against DEV | **The only gate that renders anything.** Signs in, walks every screen including detail routes discovered from the lists, then checks the guard's redirects and that sign-out leaves nothing behind. `tsc`, ESLint, Vitest, `next build` and the RLS suite all stay green through a screen that throws on load — and through a screen nobody can reach, which is what PD-125 shipped. With `WALK_FIXTURES=1` it **creates** the ride and club the detail routes need, through the app's own forms; a shrunken `N/N` is a skip, not a pass. Writes are refused unless the session's own project is on the allowlist |
| End-to-end | Playwright | Still deferred as a full suite — the walk makes no assertions about behaviour, only about whether a screen rendered |

Chromium is pre-installed at `/opt/pw-browsers`; never run `playwright install`.

**Chromium in this container cannot reach Supabase**, and since the browser is now the Supabase
client that takes sign-in and the whole walk with it. `curl -x $HTTPS_PROXY .../auth/v1/health`
returns 401 — tunnel open, host allowed — while the same fetch from a Chromium page launched with
`--proxy-server=$HTTPS_PROXY` hangs until aborted, with no response, no `requestfailed`, and no
entry in the agent proxy's failure log where a genuinely blocked host *does* appear. Bare,
`--ignore-certificate-errors`, `--disable-quic` and `--disable-http2` all hang identically.
`scripts/supabase-relay.mjs` is the fix — read its header before running the walk.

**Versions.** `package-lock.json` is committed and CI runs `npm ci`, so what ships is already
pinned — this policy governs what moves on a routine `npm install`. Pin exact for anything
the framework or auth depends on: `next`, `eslint-config-next`, `react`, `react-dom`,
`@supabase/supabase-js`. Caret is fine for leaves (`clsx`, `tailwind-merge`).
Supabase is on that list because a minor bump that changes **session storage or the auth flow
type** breaks sessions silently.

**Every Capacitor package is pinned exact for that same reason rather than a new one.**
`@aparajita/capacitor-secure-storage` **is** session storage — it holds the refresh token — and a
changed key prefix or default keychain access class would strand every signed-in rider with no
error to read. The other four (`@capacitor/core`, `cli`, `ios`, `android`) are pinned because
Capacitor requires its packages to move together, so a caret on one is a version skew waiting for
whichever `npm install` runs first, and would also silently change what a `cap add` generates.

**Dates: `Intl` only, no date library.** All in `src/lib/utils.ts`, and every formatter is
**named for the screen it serves** — `formatPostcardDate`, `formatRideDate`,
`formatRideDateLong`, `formatRideTime` — because each design draws a genuinely different
shape. There is deliberately no generic `formatDate`/`formatDateTime` — both existed, both
hardcoded `en-US`, and a generic formatter is how a two-locale split gets back in. Write the
screen's own formatter and let its name say where it belongs.

**Ride times are pinned to `APP_TIME_ZONE`** (`Europe/Amsterdam`), and the client render did not
lift that. **The SSR pass still runs on Vercel**, so an unpinned formatter renders the server's
zone into the HTML and the rider's zone on hydration — the viewer's own zone is not the answer
for exactly that reason, it is a hydration mismatch. It stays a documented **interim**: the
correct model is wall-clock at the meeting point, which needs a zone column on `rides`.
`formatRelativeTime` needs no zone (it measures elapsed instants) and keeps `en-US` because it
produces English prose, not a date format.

**`wallClockToUtc` is the write-side half of the same rule.** A `datetime-local` input sends a
zone-less string, and `new Date(that)` resolves in whatever zone the runtime is in — now always
the rider's browser, so the same typed time means a different instant for an organizer in Lisbon
than for one in Berlin, and neither matches what `formatRideTime` draws back. It resolves the
string as wall-clock in `APP_TIME_ZONE`, in two passes so the two DST days a year are right, and
its tests assert offsets rather than strings — `TZ=UTC` in `vitest.config.ts` would let a naive
implementation pass.

**Deliberately undecided** — raise these rather than inventing an answer: error tracking,
analytics, i18n, and email delivery beyond Supabase's built-in auth mails.

## Repo Layout

**The annotated tree is [`docs/reference/repo-layout.md`](docs/reference/repo-layout.md)** — every
directory under `src/`, `supabase/`, `docs/`, `design/`, `scripts/`, `openspec/` and `.claude/`,
plus `capacitor.config.ts`, with what each holds.

It is a hand-copied `ls` and **goes stale silently**, so check rather than trust it:

```bash
for d in src/components/*/; do echo "$d: $(ls "$d" | sed 's/\.tsx\?$//' | tr '\n' ' ')"; done
```

## Critical: the route guard is a client component, not middleware

**`src/proxy.ts` is deleted** (2026-08-06, with the server render path). Next.js 16 uses
`proxy.ts` rather than `middleware.ts` and this repo *did* — the note is kept because the
framework detail is still true and the file may come back for something else. If it ever does,
the exported function must be named `proxy`, and do not add a `middleware.ts`.

Routing decisions live in **three** places, split so the decision can be tested:

- **`src/lib/auth/guard.ts`** — `resolveDestination(pathname, state)`, a pure function.
  `null` means stay; a string is where to go. 36 cases in `__tests__/guard.test.ts`.
- **`src/lib/auth/guard-cache.ts`** — what the decision reads: the session and the onboarding
  stamps, **held for the page load rather than fetched per route**, with `onAuthStateChange` as
  the single writer for the session half. This is where the reads live now, and the reason it
  exists is that fetching them per navigation cost a round trip to `eu-west-1` behind a
  full-screen splash on every tab tap. Both stamps are immutable for a session's lifetime.
- **`src/components/auth/RouteGuard.tsx`** — applies the decision, **synchronously after the
  first one**, and renders the splash only while it genuinely cannot answer. Mounted in the
  **root** layout, because three of its rules concern paths outside `(app)`.

**The splash overlays the page once booted; it replaces it only before the first decision.**
Replacing it on every navigation is what unmounted `(app)/layout.tsx` — bottom bar and
background gradient included — and made a tab tap read as a page reload.

**Any new writer of a stamp the decision reads must invalidate the cache.** There are four
(`signUp`, `setUsername`, `acceptTerms`, `setLocation`), and each calls
`invalidateOnboardingState()`; `signOut` calls `clearGuardCache()`. Miss one and the rider
finishes a step and is sent straight back into it. `npm run walk` has a phase that measures this
— see `docs/HANDOFF.md` §The walk.

**It is not a security boundary and must never be treated as one.** RLS is. Every rule the
guard enforces has a database counterpart — `023` refuses content writes without a consent
stamp, `003`/`012` own the completion invariants, `025` means the client cannot even read the
two stamps except through a `security definer` accessor. A rider who defeats the guard reaches a
screen whose every query returns nothing.

**Protection is a denylist of public paths, not an allowlist of protected ones.** Everything is
gated except these, which is what makes decision #1 hold by default — a new route is protected
unless someone deliberately opens it:

```
'/', '/auth/login', '/auth/signup', '/auth/forgot-password',
'/auth/reset-password', '/auth/callback', and '/legal/*'
```

Four rules, each with a test naming the trap it avoids:

- **No session + non-public path** → `/auth/login`. `/` is public but empty, so it goes too.
- **Session + onboarding incomplete** → the resume step, unless already there. Read from
  `my_onboarding_state()` on the paths that need it; never from `user_metadata`, which the
  client can write. **Consent is gated ahead of the wizard**, because `023` refuses to stamp
  completion while the consent stamp is NULL.
- **Session + `/auth/login` or `/auth/signup`** → `/postcards`. Note the two paths: bouncing
  *all* of `/auth/*` breaks password recovery, because Supabase's link establishes a session
  before the reset page loads.
- **The stamp read failed** → `/auth/login?error=profile_unavailable`, *except* on the two auth
  entry paths, where it must fall through or it redirects to itself forever — on exactly the
  deploy mismatch the branch exists to survive. Zero rows is this case, not "un-onboarded":
  reading it as un-onboarded sends the rider to a prompt whose submit can never succeed.

## Supabase Rules

**There is exactly one Edge Function, and it is the only place a service-role key exists.**
`supabase/functions/delete-account/` — added 2026-08-06, the first in the repo. Removing an
`auth.users` row needs the Auth admin API, which needs the service-role key; that is decision
#8's **first** reading ("more server compute, same database") and not its third. The function
owns one operation, not the database.

Four rules, and they are the whole reason this does not contradict §What Not To Do's "don't
introduce a service-role key into the app" — **the function is not the app**:

- **The key lives only in the function's secret store.** Not in `src/`, `.env.local.example`,
  Vercel, a fixture or any `NEXT_PUBLIC_*`. `src/__tests__/no-service-role-key.test.ts` is the
  tripwire, and it checks itself: it proves the detector still catches a real key in each
  format, because a guard that has quietly stopped matching passes for ever and looks exactly
  like a clean repo.
- **It takes no user id.** The subject comes from the verified JWT and nowhere else. "We check
  the id matches the caller" is one refactor away from not doing that.
- **It verifies the JWT itself** rather than trusting the gateway — the publishable key is a
  valid JWT and sails past a decode-only check.
- **Nothing type-checks it.** `tsconfig.json` excludes `supabase/functions` because it is Deno
  and `include` is `**/*.ts`; without the exclusion `npx tsc --noEmit` fails and takes CI's
  Type Check job with it. It is the least-guarded code in the repo.

**It is deployed to both projects and `ACTIVE`, as of 2026-08-11** — and it stays an **owner
action**, which is why it is still drift waiting to happen. There is no `supabase` CLI in the
build container and the Supabase MCP server has no deploy tool, so nothing in a session can
redeploy it after an edit to `supabase/functions/delete-account/index.ts`, and CI has no path that
would notice. Check the deploy rather than trusting this line, and check that both projects run
the *same* build:

```
mcp__Supabase__list_edge_functions zwprydcyryvudhurbnye   # PROD
mcp__Supabase__list_edge_functions fpmrimzxadewsaiwpsel   # DEV
# status ACTIVE, verify_jwt true, and ezbr_sha256 equal across the two
```

**There is one doorway now, and almost nothing should reach past it:**
- **Anything in `src/lib/data/` or `src/lib/actions/`** →
  `import { resolveSupabase } from '@/lib/supabase/resolve'`.
  `src/lib/data/__tests__/isomorphic.test.ts` walks the module graph from both directories and
  fails loudly if anything in them reaches a Next server module.
- A component that genuinely needs the client itself — the route guard, the reset screen —
  imports `createClient` from `@/lib/supabase/client`. That is two files, and a third is
  probably a read that belongs in `lib/data/`.
- `@/lib/supabase/server` **no longer exists**. Neither does `@supabase/ssr`.

**RLS is ON for all tables.** Every query runs under the authenticated user's session. You do not need to filter by `user_id` manually — RLS policies enforce ownership. But do add RLS policies in migrations for any new table.

**Schema:** **the per-table contract is [`docs/reference/schema.md`](docs/reference/schema.md)** —
`profiles`, `rides`, `ride_members`, `clubs`, `club_members`, `postcards`, `postcard_likes`,
`postcard_comments`, `postcard_hides`, `postcard_reports`, `blocks`, `profile_countries`,
`feed_reads`, `places`, `ride_messages`, `clubs` (media), and the dropped `friendships`. Read it before touching
any of them: it carries the per-column grants, the cascade behaviour and the audience predicate
for each, and several are counter-intuitive (a club outlives its owner; `postcards.ride_id` is a
tag rather than a second audience; `ride_messages`' audience is an intersection and neither half
alone is it).

**One blocker out of that file belongs here, because the session it stops is one that would never
open it: `places` attribution is an OPEN question.** A census of 527,725 rows names Overture,
meta, Foursquare, Microsoft, AllThePlaces, PinMeTo, DAC and Krick, and **zero** OpenStreetMap — so
the ODbL credit this repo first assumed is wrong, and the commercial sources' terms are unread
(their hosts are egress-blocked). **Settle it before any screen renders a place result.**

**Migrations:** Add new SQL files to `supabase/migrations/` with incrementing prefix (e.g., `002_add_column.sql`). Never edit existing migrations — always add new ones.

**The production project is `letsride`, ref `zwprydcyryvudhurbnye`** (`eu-west-1`). Recorded
here because it is not secret — the ref ships in the client bundle as part of the Supabase URL
— and because not knowing it cost real time.

**There are two projects.** `letsride-dev` is the DEV database: Vercel's
Preview and Development targets and the GitHub Actions secrets point at it, Production points
at `letsride`. **`docs/ENVIRONMENTS.md` is the contract** — which branch maps to which target
to which database, the apply order for a migration, and the settings that are dashboard-only
and therefore drift. Read it before touching either project.

Two consequences worth carrying here rather than only there:

- **Never promote a Vercel preview to production.** Both Supabase variables are
  `NEXT_PUBLIC_*`, so they are inlined at build time and a build permanently carries whichever
  database it was built against. Vercel's own API docs say promotion *"does not rebuild the
  deployment"*, so promoting a DEV-built preview ships DEV credentials to real riders, with a
  green deploy and no error. Promotion is a git merge that rebuilds.
- **Check drift rather than claiming it.** `npm run db:drift` compares files against both
  databases. It compares migration *names*, never versions or ordering, because the recorded
  version is an apply-time timestamp — PROD's rows run `001`, `004`, `005`, `006`, `007`, `002`
  — while a freshly-replayed DEV records filename order. The same chain, permanently different
  versions.

A third project named `LetsRide` (`ylxnicopnaroltebvfnc`) existed briefly, was never referenced
by anything, and has been deleted. It is unrelated to `letsride-dev`.

**Applied state: 48 files, and DEV and PROD are LEVEL — both at `048`, 2026-08-10.** Do not
read that number here — it has been wrong in both directions. Run `list_migrations` against
`ls supabase/migrations/` instead.

**`041 → 044 → 046` is a required chain and one of its links fails silently.** It is satisfied by
filename order, so a full in-order apply is always correct — the chain matters only to a *partial*
one. `044` grants `insert (… ride_id)`, a column `041` adds, so out of order it **errors**.
`044` and `046` both issue an **absolute** `revoke update` + `grant update (…)` list rather than a
delta, so running `046` first lets `044`'s list — which still names `id` and `author_id` — reinstate
exactly what `046` removes, with **no error and nothing red**.
`docs/reference/migrations.md` §The ordering chain carries both links, and the rollback SQL.

**Applying a migration too large to pass as a string.** `apply_migration` takes SQL as a string
and nothing can pipe a file into it, so a 61 KB file (`036`) has to be reproduced — which risks a
silent transcription error in production DDL. The technique that made it safe, and the one to
reuse: reduce the file to its executing statements **preserving comments inside `$$` bodies**
(stripping those changes `prosrc`), apply the reduction, then **prove it by diffing the resulting
objects against the database that already has the file applied correctly** — `md5(string_agg(...))`
over `pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`, `information_schema.columns`,
`pg_indexes` and the grants. That is *stronger* than comparing the text that produced them.

**The cost, and it reads exactly like drift: PROD's recorded statement for `036`–`040` is the
reduced form, so `md5(statements[1])` on those five will NOT equal `md5sum` of the file.**
Expected. DEV carries one asymmetry of the same class on `034`;
[`docs/reference/migrations.md`](docs/reference/migrations.md) has the reconciliation SQL.

**A migration that hangs triggers off an already-shipped write path needs a hand-exercise gate
before it applies.** `036` is the worked example: six fan-out triggers on five live write paths,
so from the moment it applies every like, comment, RSVP, ride creation and club join runs new code
inside the rider's own transaction — and **a trigger that raises takes that rider's write down with
it**. Exercise every affected path by hand on DEV first, in a rolled-back transaction.

Suite **1213** assertions — re-derive rather than trust it:
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`. **Compare label sets rather than
counts** when reconciling two runs: a count cannot tell a rename from a loss, which is exactly
what `038` did to one of `036`'s assertions.

**`031` exists because `029` shipped a function nothing could call, and that is the reusable
lesson.** `029` put its worker in `private` and revoked EXECUTE from the client roles, assuming
the deletion Edge Function would reach it as `service_role`. It could not: `service_role` holds
no USAGE on `private`, and **PostgREST routes only to `public`**, so supabase-js's
`.schema('private')` is refused before it reaches Postgres. Nothing caught it, because **the RLS
suite runs as the table owner, for whom neither barrier exists.** The assertion that would have
caught it names a *role* — `has_function_privilege('service_role', …)` — rather than calling the
function, and that is the shape to copy whenever a non-client role is meant to reach something.

**The sequencing lesson is the durable part, and it outlives the files that taught it.** `023` and
`025` could not be applied before their code deployed, and `021`'s accessors could not be applied
after. The order that works — **additive first, deploy, destructive last** — is a property of the
split, not of those migrations.

**`021` was split on 2026-08-05 because a single file contained a deployment deadlock**, and that
is the general lesson rather than a one-off: it held both the accessor functions and the revoke
that makes them necessary, and those must apply at *different times relative to the code deploy*.
It is now `021_onboarding_state_accessors.sql` (additive) and `025_profile_column_privileges.sql`
(the revoke). **Filename order equals apply order** — `run.sh` applies by filename, so a file
whose local order differs from its hosted order is a trap this repo has already sprung.
Both are applied; the ordering above is the record of how, not a thing still to do.

**Three own-row RPCs own the two profile stamps**, because `025` takes the client's grant away:
`my_onboarding_state()` (the route guard's one round trip — both stamps plus `has_username`),
`accept_terms()` and `complete_onboarding(location)`. **Each restates the invariants its triggers
carry, and must.** Inside a `security definer` function `current_user` is the *owner*, so `003`'s
and `012`'s guards — which begin `if current_user <> 'authenticated' then return new` —
short-circuit and never run. CHECK constraints do still fire. Measured on Postgres 16.

**Security advisors: nine, and only one is outstanding.** Re-derive rather than trust the number
— `get_advisors(security)` — but the *shape* is durable, because eight of the nine are things
this repo chose, and a bare count cannot tell a session whether a new WARN is expected:

| Count | Advisor | Why it is there |
|---|---|---|
| 7 | `authenticated_security_definer_function_executable` (WARN) | `accept_terms`, `complete_onboarding`, `my_onboarding_state` (`021`, because `025` takes the column grant away), `has_password_reset_grant`, `consume_password_reset_grant` (`026`), `moderate_comment` (`011` §1b), `delete_owned_club` (`043`). Every one is `security definer` **by design**, and each is narrow on purpose — `moderate_comment` deletes exactly one comment on a postcard the caller authored, `delete_owned_club` deletes exactly one club the caller owns. Narrowness is the defence |
| 1 | `rls_enabled_no_policy` on `password_reset_grants` (INFO) | Correct by design: `026` revokes everything on it from `anon` and `authenticated`, so a policy would be the thing that granted reach |
| 1 | `auth_leaked_password_protection` (WARN) | **The only genuinely outstanding one.** A dashboard click, owner-only |

An unexpected advisor is one **not** in that table.

**Scope a grant assertion to its grantee**, or use `has_table_privilege`: a table-wide DELETE-grant
count reads 2 against a correct database, because `postgres` and `service_role` hold everything by
Supabase default. `015`'s footer got this wrong on its first pass.

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
followed by `router.refresh()` (v1), and a `'use server'` module (no module under
`lib/actions/` is one any more — `src/__tests__/use-server-exports.test.ts` is the tripwire if
one returns, because a non-async export from one is legal TypeScript that takes the route down
at runtime).

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
any screen, and read `design/TOKENS.md` in preference to either — that one is generated, the
tables are transcribed.

Three rules that must hold without opening it:

- **Read the design from `design/`, never the Figma API.** `npm run figma -- tree "<screen>"` is
  offline and cannot be rate limited; the API's limit is per-endpoint, inherited across sessions,
  and has blocked work for hours. `design/README.md` has the full rationale.
- **Icons come from `@/components/icons/generated`, and that file is generated** — never
  hand-edited. The generator rewrites every literal fill to `currentColor`.
- **Primary buttons are near-black (`Grey/100` `#1A1A1A`), not green.** Green is an accent used
  sparingly. This is the single most-repeated mistake against these designs.

## Development Workflow

```bash
npm run dev      # start dev server
npm run lint     # eslint
npx tsc --noEmit # type check
npm run build    # production build (requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY)
npm run test:unit # Vitest — validation, the query cache, the route guard, the session store
npm test         # RLS policy suite (needs Postgres + psql; see supabase/tests/README.md)

# Do the repo, DEV and PROD agree on the migration chain? See docs/ENVIRONMENTS.md
PROD_DATABASE_URL=postgresql://... DEV_DATABASE_URL=postgresql://... npm run db:drift
PGPASSWORD=postgres npm run db:seed:check   # does the DEV seed still apply, and still refuse?

# Do the numeric claims in CLAUDE.md / docs / .claude/agents still match reality?
# See scripts/docs/registry.mjs for the declared list — PD-155
npm run docs:check

# Do the repo's "`file.md` §Section" pointers still resolve? Runs inside test:unit,
# not docs:check — scripts/docs/crossrefs.mjs. Moving a section is what breaks these.
npx vitest run scripts/docs/__tests__/crossrefs.test.mjs

# The only gate that renders anything — see supabase-relay.mjs's header first
NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://<dev ref>.supabase.co node scripts/supabase-relay.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NODE_USE_ENV_PROXY=1 npm run dev
WALK_EMAIL=... WALK_PASSWORD=... npm run walk
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

**Screen names repeat across flows** — six frames are called `Home - Postcards - All new`, so
qualify with the flow as above. An ambiguous name prints every match with its flow and node id,
so the next command is copy-pasteable.

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
| `rider-ux` | Offline, geolocation, push UX, static map + deeplink, glove targets |
| `native` | The shell — Capacitor, plugins, permission strings, deep links, signing, store upload, store guidelines |
| `test` | Vitest/Playwright infra and tests, **and running the app against DEV** — the walk, its fixtures, anything needing a real browser |
| `reviewer` | Pre-merge review. Which passes run is scoped to what the diff touches (2026-08-08) — RLS/data-exposure on `src/` or `supabase/`, documentation-claims on everything including docs-only diffs |

**A brief's `tools:` line is an exact-name allowlist, and an entry on it is neither guaranteed
loaded nor guaranteed present.** Reading one failure as the other invents a blocker:
`InputValidationError` means the schema arrived **deferred** — `ToolSearch select:<name>` *and
then call it*, as `.claude/commands/queue-pickup.md` STEP 0 does. `No such tool available` means
the name is **absent**, which is what a rotation does: on 2026-08-08 every MCP server
re-registered under a UUID prefix and `mcp__Supabase__*` stopped resolving, silently, an absent
tool being no error. A keyword search (`+execute_sql supabase`) tells them apart and **buys
diagnosis, not recovery** — probed 2026-08-09, a tool absent from the allowlist is refused
outright, so a UUID-prefixed name it finds is very likely refused too (untested against a real
rotation). **The fix is therefore the *report***, an agent naming the passes that did not run;
restoring the call is the owner's. Every brief reaching **Supabase** carries `ToolSearch` and a
§Reaching Supabase block (`reviewer`'s leads its file as §First), and a new one needing the
database gets both; `design-system` is out, its connector being Figma and its answers coming from
the committed `design/` snapshot with the API forbidden.
`src/__tests__/agent-briefs.test.ts` enforces it — `grep -L ToolSearch` cannot, since every such
block names the tool in prose and reads clean with the entry stripped.

**Standard order for a feature:**

```
openspec → reviewer → data → design-system → feature → test → reviewer → PR
```

**`reviewer` runs twice, on two different artifacts.** The first pass reads the **proposal** —
the only artifact in this pipeline with *no* automated gate, since `openspec/` sits in the CI
denylist and the RLS suite can only assert what someone thought to write down.
`openspec/config.yaml` names the stake exactly: a visibility decision left unstated *"does not
fail loudly, it silently becomes whatever the migration author assumed."* The second pass reads
the **final diff**, once, immediately before the PR — never twice, because a pass taken before a
step that commits is superseded by construction.

**Each pass is scoped to what the diff touches**, mirroring `ci.yml`'s denylist: the
data-exposure and client-bundle passes cannot fire on a diff confined to `docs/`, `design/`,
`openspec/`, `.claude/` or a root `*.md`, and roughly half of this repo's commits are exactly
that. The documentation-claims pass does *not* narrow — a docs-only diff is entirely claims — and
neither does the scope pass on anything from a queue pickup. **Four things override the scoping
entirely** and `.claude/agents/reviewer.md` §Then: classify the diff is the list: a diff that **removes** a
guard, the two `.claude/` cases below, and contrast on any new colour pairing.

`.claude/agents/*.md` and `.claude/commands/*.md` are reviewed as **logic** rather than prose —
those two are carved out of `ci.yml`'s denylist so `src/__tests__/agent-briefs.test.ts` runs on
them. **`.claude/settings.json` runs the job too** — its own carve-out, because `docs:check`'s
`hard_deny` claim measures that file — but the job checks one *number* in it, never the
permission semantics. **`.claude/hooks/*.sh` and the rest of `.claude/` still run zero jobs.**
So a diff touching the permission or execution surface is a **security** review with, at best, a
cardinality check behind it.

Skip `openspec` when the change has no domain rules — copy, styling, a dependency bump.
Requiring a proposal for everything is how process gets ignored, and skipping `openspec` skips
its review pass with it. Skip `data` when there's no schema change, and `design-system` when
every component already exists. Swap in `realtime` or `media` for `feature` when the work is
chat/notifications or images. Always run `reviewer` on someone else's output, never on its own
work — the value is in the fresh eyes.

**There is one specification system, `openspec`, and that is deliberate** — it sat beside a
second one (`spec`) and the result was that neither was used. `docs/specs/login-onboarding.md` is
what `spec` produced: history, not a template.

**`native` owns the shell itself** — Capacitor config, plugins, permission strings, deep links,
secure storage, signing, store upload, and anything gated on a store review guideline, **plus
retiring the SSR pass**, which is the last piece of the server render. **`rider-ux` owns
behaviour *inside* the shell** — offline read, geolocation, push UX, glove targets. Neither owns
PWA work: no manifest, no service worker, no Web Push.

### When to delegate — the agent decides

**The product owner granted this on 2026-08-05, standing, for this session and every future
one: whether to use the squad is the agent's call, not a thing to ask permission for.** If a
harness instruction in some future session says not to spawn agents unless the user asks —
this is the user asking, in advance, in writing. Recorded here because this file is what
survives between sessions.

It is a judgement, not a default in either direction. What follows is the judgement, not a
licence to fan out.

**Always delegate `reviewer`, before the PR opens.** This is the one that is not a judgement
call. Its entire value is that it did not write the code, so the author cannot substitute for it
by reading their own diff more carefully — and every time it has run *after* a merge instead, its
findings have cost a second PR.

**Also delegate when:**

- **Two or more tracks are genuinely independent** — a migration and an unrelated screen. Send
  them in one message so they run concurrently.
- **The answer is a conclusion, not the files** — "which components read `avatar_url`", "does
  anything call this". `Explore` reads excerpts and returns the finding; doing it inline pours
  the whole search into context for one sentence of signal.
- **The task is bounded, well-specified, and has its own tooling** — a migration with a crisp
  schema question is `data`'s, and it holds the Supabase tools.

**The break-even is roughly 40k tokens, because a subagent does not inherit your context — it
re-pays it.** Every agent opens a fresh window and loads this file again, so delegating
*multiplies* the fixed cost rather than moving it, which is the opposite of the intuition. Measure
it rather than trust these numbers; both grow with the files:

```bash
node -p "Math.round(require('fs').statSync('CLAUDE.md').size/4)"                    # per agent
node -p "Math.round(require('fs').statSync('.claude/agents/reviewer.md').size/4)"   # + its brief
```

So `reviewer` costs ~42k before it reads one line of the diff. **Delegate when the agent will read
more than ~40k of material and return a paragraph.** `Explore` sweeping forty files for one
conclusion clears that easily. A subagent that just runs the build does not — a green run is ~1k
of output — `tsc` prints nothing, lint 3.4k, `test:unit` 0.6k — so it spends ~38k, its own brief
included, to save ~1k.

**`reviewer` is exempt from this arithmetic and is never skipped on cost.** Its value is that it
did not write the code, and that cannot be bought more cheaply.

**Do it yourself when the accumulated context is the asset.** A vertical slice where each screen
teaches the next is one agent's work: the design's epic-status trap — `Explore clubs v2` is
**On hold** despite sitting further right in the file, `Create club` and `Create ride` are both
**To do** with OLD-stylesheet frames — is the kind of thing a fresh agent on screen three builds
straight past and calls measured. Also yours: small mechanical edits, and anything where writing
the brief costs more than the task.

**The failure mode in each direction is different.** Over-delegating scatters context and
produces work that is individually correct and collectively inconsistent. Under-delegating
produces work with no fresh eyes on it, where every assumption the author made at the start
survives to the end unchallenged. The second is the one this repo has actually suffered from.

## Architectural Decisions

Settled. Don't reopen these without an explicit decision to change them.

**1. No anonymous access, anywhere.** Every route outside `/auth/*` requires a session. No policy grants to the `anon` role. `is_public = true` means "visible to any signed-in rider", never "visible to the internet". The Figma's guest-browsing screens ("Become a rider" on a club page) are out of scope.

**2. Blocking is enforced in RLS, not in the UI.** A blocked user disappears from feeds, search, chat, member lists, and ride crews simultaneously. One `security definer` helper applied across policies. Blocks are symmetric even though the row is directional.

**3. Maps are a static thumbnail plus a Google Maps deeplink.** No mapping SDK, no turn-by-turn, no route rendering.

**4. v2 is the only design.** v1 (`zinc-*`, `orange-500`, Geist, `lucide-react`) is superseded, and as of 2026-08-05 it is **fully retired**: zero `text-white` in `src/app/`, zero `lucide-react` importers, zero client-side `supabase.from()` writes, and the dependency uninstalled. What remains of those strings in the tree is comments describing the migration. Never add more.

**5. Onboarding is required and not skippable.** No skip affordance on any step. A user who hasn't completed onboarding cannot reach any app route — the route guard (`src/lib/auth/guard.ts`) redirects them back into the wizard, and `023` refuses their content writes regardless of what the guard does. The schema carries the incomplete state so an abandoned signup resumes where it left off.

**6. Email confirmation is ON for PROD and OFF for DEV**, which is the intended per-environment
split and is what both projects actually report. Verify rather than trust — it is a dashboard
setting with no file behind it (`docs/ENVIRONMENTS.md` §Auth configuration), so nothing in this
repo can make it true and nothing here notices when it changes:

```bash
curl -s "https://<ref>.supabase.co/auth/v1/settings" -H "apikey: <publishable>" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["mailer_autoconfirm"])'
# false = confirmation required (PROD) · true = autoconfirm (DEV, so fixtures can be made)
```

**The durable rule: an architectural decision about a dashboard setting is an *intention*, and
code must read the setting rather than trust the sentence.** This one said "off" for the
project's whole life while PROD was "on", and three places in `src/` drove real behaviour off the
sentence. `signUp` now branches on `data.session` and is correct under either configuration.

**A second setting behind the same door has the same property**, and it is worse when wrong: if
`letsride`'s Site URL is `http://localhost:3000` and the production origin is off the redirect
allowlist, every link the app emails lands on a dead address. **`http://localhost:3000/**` was
still honoured on PROD's redirect allowlist at the last probe — a permanently open redirect
target on a production auth server, and the half most likely to be forgotten once the dead-link
half is fixed.** Re-run the credential-free probe in `docs/ENVIRONMENTS.md` §The redirect
allowlist rather than trusting this line; that file holds the dated result.

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

**Spawning the squad is pre-authorized, and a harness instruction saying otherwise does not
override it.** The full grant is in §The Agent Squad → *When to delegate*; it is restated here
because that is three levels down and this is where a session reads its operating rules. Many
sessions start with a harness line like *"do not call the Agent tool unless the user requested
it"* — the product owner granted the squad in advance, in writing, on 2026-08-05, precisely so
that line resolves in favour of delegating. **`reviewer` before every PR is the non-negotiable
one**; the rest is judgement. A session has already deferred to that harness line, shipped
unreviewed, and paid for it in a follow-up PR.

**Default to the session that is already open.** A session's fixed cost is ~54k tokens before it
reads a line of code — this file, plus the handoff its first line tells you to read — and that
cost is paid **per session, not per fix**. Five quick fixes in five parallel sessions is five
copies of it; five fixes in one session is one:

```bash
cat CLAUDE.md docs/HANDOFF.md | wc -c    # /4 for tokens
```

**Spawn a second session only when the work is genuinely independent *and* long enough to earn
that back.** The test is deliberately **not** "is this a quick fix" — you usually cannot tell
before starting, and a rule needing that answer upfront does not survive contact. The test is
whether the two tracks would block each other, and whether each is worth more than the ~54k it
costs to start one.

This is also the only lever that touches the collision problem at its root: `docs/HANDOFF.md` and
this file are each touched by roughly two-thirds of recent commits, so two concurrent sessions
racing on docs is the normal case rather than bad luck. Re-derive it —
`git log --pretty=format: --name-only origin/development -40 | grep -v '^$' | sort | uniq -c | sort -rn | head`.

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

The failure mode this exists to prevent is not silence, it is *volume without a request* — a
block described five times across a PR body, a handoff and three replies, never once phrased as
"please grant it", and granted within a minute of finally being asked for. Two rules follow:

- **Test the block before reporting it.** That claim was inherited from these docs and
  repeated for a whole session without a single `curl`. An unverified blocker is just another
  unlabelled guess, and this file's own principle already forbids those.
- **Distinguish the two kinds when you report it.** "I used the Supabase MCP tools instead of
  `curl`" needs no interruption — same artifact. "I could not load the page, so this is
  verified to compile and not verified to work" is a lower-fidelity artifact and needs an
  explicit ask. Only the second kind is escalated, or the signal drowns.

**Run the SQL. Do not stop to ask.** Standing grant from the product owner, 2026-08-06:
`execute_sql` and `apply_migration` are pre-authorized — DDL, DML, and against production.

**The grant lives in the Supabase connector, not in this repo**, so `.claude/settings.json`
holds no `mcp__Supabase__*` entries and no `autoMode.allow` prose rule for them. **That absence
is deliberate and re-adding them is a regression** — `settings.json` carries a rule saying so,
because the obvious "helpful" repair is to put them back. Two mechanisms for one grant is how one
of them goes stale (same lesson as the two specification systems), and a connector-level setting
cannot stop matching when the connector's tool ids rotate — which is exactly what the
`mcp__Supabase__*` rules did (`docs/HANDOFF.md` §Constraints).

**The connector setting is the owner's, and no session can read or change it.** So if a Supabase
call prompts anyway, the answer is to **report it** — not to re-add a project rule, not to edit
the permission mode, and not to write a `PreToolUse` hook returning `permissionDecision: allow`.
The harness refuses those last two on purpose: an agent widening its own envelope is exactly what
that boundary is for. Do not route around them via Bash either.

**What is left in `.claude/settings.json` is the restrictions plus the non-Supabase grants**, and
those still depend on the mode: `permissions.autoMode.allow` is read **only while the session is
in `AUTO`**, which `"defaultMode": "auto"` pins — `jq -r '.permissions.defaultMode'
.claude/settings.json`. **Anything added there inherits that dependency**, which is the durable
half of a note that used to be about Supabase.

**The review gate for schema change here is the migration file, not the execution.** That is
what makes the grant safe rather than lax, and it is the reason to keep writing the file first:
it is append-only, it is read before it is applied, and §Supabase Rules already requires
verifying the result against the live database afterwards. A confirmation prompt between those
two caught nothing. The `deny` list is untouched and still wins — pausing, restoring or creating
a project, and deploying an Edge Function, all remain blocked — and the service-role key is in
`autoMode.hard_deny`, which is the one boundary no amount of user intent clears.

**Whether a connector-level always-allow leaves that `deny` list standing is untested, and no
session can test it.** Assume it does, act as if those four are blocked under any connector name
— and if one of them ever executes without a prompt, stop and tell the owner rather than reading
the absence of a prompt as permission.

**Notify when the work is done and the owner may not be watching.** Standing request from the
product owner: a push notification when a session's work is finished, in the form
`Done ; ) <name of the session>` — the name being what the session was *about*, so a notification
read on a phone hours later identifies itself without opening anything. **Every session that
changed something, not just the long ones.** One at the end, after the PR is merged, so it can
say what actually landed; a notification they did not need is annoying in a way that accumulates.
`.claude/hooks/session-wrapup-check.sh` is a backstop rather than the trigger — it can only fire
once the branch is committed, pushed and ahead of `development`.

**Say less. Every reply, not just the ones during a build.** Progress feedback is a line or
two — what landed, what is next, what broke. Not a recap of the reasoning, not a restatement of
the plan, not a summary of a file that was just read. The owner is watching the work happen;
narrating it twice buries the one line that actually needed reading.

**This rule used to say "while building", and that scoping is what made it fail.** Product
owner, 2026-08-10: *"can you be more to the point and a bit shorter when talking to me? this is
important."* The narration during the work had been short; the **close-out reports** were not —
a merged PR would come back as a dozen paragraphs re-explaining findings already written into
the commit message, the PR body and the Linear comment. Three copies of the same reasoning, and
the owner reads the one on their phone. **A wrap-up is the failure mode this rule exists for**,
not an exception to it: state what landed, what needs them, and stop.

**The record is not the reply.** The commit message, the PR body and the Linear comment are
where the reasoning belongs, and they stay as long as they need to be. Do not also paste it
into chat — link it. If something is worth saying twice it is worth saying once, in the place
that survives the session.

Three things stay long however brief the commentary gets, because each is a *decision* rather
than a status: **the rating block below**, a **blocked capability** (the owner has to act on it,
so the ask needs spelling out), and **anything inferred rather than measured**. Brevity is about
the narration, never about the record.

**Rate every suggestion on five ratings, always in this order.** Whenever you propose optional
work — a refactor, a test, a hardening, a follow-up — close it with this block. Not a sentence
with numbers buried in it; the point is that the reader can skim five scores and still decide.

**Break the line after each score.** The rating goes on its own line and its justification in its
own paragraph below, so every entry is two paragraphs and the entries are separated the same way.
The number and the reason are two different things a reader scans for — the numbers to triage, the
reasons only for the ones that survive triage — and running them together on one line makes the
block read as prose and defeats the skim it exists for.

**The separator is a blank `>` line — a paragraph break, not a line break.** A bare newline
inside a blockquote is a *soft* break: CommonMark and GitHub both collapse it to a space, so the
block renders as `**Recommendation** 7/10 a dead column that…`, score and reason abutting with no
separator at all. Two trailing spaces fix that **only where a hard break is honoured**, which is
not everywhere these get read — the product owner's client eats them, so the format was silently
broken in the one place it is read most. A blank `>` line is a paragraph break: every renderer
honours it, it survives a whitespace-trimming editor, and it is visible in a diff.

`scripts/docs/__tests__/registry.test.mjs` asserts it, which is why there is no command to run
here by hand — the check rides the CI job that a docs diff already triggers. To see it directly:

```bash
awk '/^[[:space:]]*> \*\*(Recommendation|Complexity|Urgency|Customer value|This session)\*\*/ {
  s = $0; f = FILENAME; n = FNR; if ((getline line) <= 0) line = ""
  if (line !~ /^[[:space:]]*>[[:space:]]*$/) print f ":" n ": " s
}' CLAUDE.md docs/HANDOFF.md
```

It must print nothing. Each hit is a score line whose reason will render glued to it.

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

**Recommendation goes first** — it is the line that answers *should we*, so it is the one being
looked for; the other four exist to justify it. What each one means:

- **Recommendation** — how strongly you actually advise doing it, independent of how much fun
  it is to build.
- **Complexity** — effort plus risk plus the maintenance it adds. Not "is it interesting".
- **Urgency** — *when*, not *whether*. **Name the trigger where one exists**, because most
  urgency here is conditional rather than scheduled: "low now, high the day real riders sign
  up" is the whole content, and the bare number would have hidden it.
- **Customer value** — **what a rider gets, 0–10.** The one line written from outside the
  codebase, and the only one that asks whether anybody outside this repo would notice. Name
  *which* rider and *what changes for them*: "an organizer can finally cancel a ride" is the
  content; "improves the product" is not. Where the value is a harm prevented rather than a
  feature gained, rate the harm and name it — "stops any author pinning themselves to the top
  of every feed" is a real 6, not a 0.

  **A low score is not a criticism, and this is the line most likely to be misread as one.**
  Most correctness, tooling, migration and documentation work here is a genuine 0–2 and still
  earns a 9/10 **Recommendation**, because it protects riders instead of reaching them. Rate it
  honestly at 0 rather than inflating it to justify the work — **Recommendation** already does
  that job, and a customer-value number that never goes low tells the reader nothing.
- **This session** — **Y or N, never a number**, plus the half-line of why. It answers "should
  *this* session pick it up next", which is about the session rather than the work: what context
  is loaded, whether a branch is open, whether it is blocked on an answer, and whether it is even
  the agent's to do. An owner-only item is **N** — "not mine" — which is the single most useful
  thing this line does, because those are exactly the items that otherwise sit in a list of build
  tasks looking actionable.

**None of the five are correlated, and that is the entire reason there are five.** A 1/10
complexity item can be a 9/10 recommendation; a clever 6/10 build can be a 2/10 one. **9/10 with
`This session` N is an ordinary pairing**, not a contradiction — the leaked-password toggle is a
dashboard click nobody in a session can make. So is its inverse: a 3/10 worth **Y** because the
files are already open and it costs two minutes. **A 0/10 customer value beside a 9/10
recommendation is equally ordinary** — a revoked grant no rider will ever notice is exactly that
pairing, and reading the low number as a reason to decline inverts what the line is for. Answer
`This session` from where the session actually is, not from how good the idea is.

Rate your own ideas honestly, including low — an unrated suggestion reads as advocacy, and the
reader cannot cheaply decline it. If you would not spend your own afternoon on it, say so in the
number.

**Letter them — A), B), C) — whenever you offer more than one**, so the reply can be "do A and
C" instead of a quoted sentence. One letter per thing that can be independently said yes to; a
single suggestion needs no letter. **Say who does each one** — an owner-only item mixed into a
list of build tasks hides the one nobody but them can do.

**Give every lettered option its own blockquote, with the letter and its description *outside*
the bar.** The bar groups the ratings so a reader scanning three options can see where each one
ends; the description is the thing being chosen between, and inside the bar it reads as a sixth
rating instead of a heading. Two options means two headings and two bars:

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
things get dropped, because every other signal (clean tree, pushed branch, green CI) already
looks finished. Before ending a session, merge it or say plainly that it is open and why. This
is not hypothetical: a handoff rewrite sat in an unmerged PR while `main` told the next session
a shipped epic was half-finished.

**"Counts" has two thresholds, and which of them is yours depends on what you were asked to do.**
**A session's unit of done is a merged PR on `development`**, which is where a queue firing ends
(`Deployed to DEV`). Reaching riders is the promotion to `main`, and `Done (in production)` is the
status that asserts it — never write "shipped" for the first and mean the second.

**When the session does the promotion, both thresholds are yours, and so is the status.** Standing
instruction from the product owner, 2026-08-10 — the full wording and the reasoning are in
[`docs/reference/linear.md`](docs/reference/linear.md) §The statuses. The short version: finishing a deploy includes saying on
the board that it happened, and that is not something to hand back.

**A claim about state needs the command that checks it.** `docs/HANDOFF.md` describes things
that move on their own — what is deployed, what is applied, how many tests there are. Write
those with the one-liner that verifies them, so a stale line costs seconds instead of
misleading someone. Counts especially: `git grep -c` beats a number typed by hand, which has
been wrong here three times (assertion count, dependency count, `.from()` call sites).

**Write a claim beside its command, not beside its history.** This extends the rule above and
replaces the house style it grew into — stating a fact, then explaining what the file used to
say instead. A correction paragraph is what gets written when a wrong claim is annotated rather
than deleted, and it costs more than the wrong claim did: it is itself an unverified statement
about the past, it is loaded into every session for ever, and the next revision corrects *it*.

- **A fact gets its verification command.** If nothing can check it, it is a decision — record
  the decision, not the revisions that led to it.
- **Git history is what a file used to say.** `git log -p -- CLAUDE.md` and `git blame` are
  complete, dated, and cost nothing until someone asks. Prose restating them is a copy with an
  error rate.
- **Replace a wrong claim; do not narrate it.** The commit message is where the change is
  explained, and it is the one place a reader already knows to look for it.

**Keep the correction only when a reader would re-derive the wrong version from the same
evidence.** That is the test, and it is much narrower than "someone was once wrong here": name
the command a careful person writes *first*, and say what it returns. If that is a plausible
wrong answer, the warning is load-bearing. If they would simply get the right one, it is
biography. Three worked examples of the shape — apply the test to the passage in front of you
rather than checking it against this list, which is not exhaustive:

- **The comment trap** (§Technology Decisions) — a grep for a retired pattern counts its own
  obituaries, so the obvious command returns a wrong number that looks measured.
- **`^`-anchored `git grep -L`** (same paragraph) — unanchored, a doc comment mentioning
  `'use client'` counts as the directive, so real server-rendered pages drop out of the list.
- **The team-scoped lock** (`.claude/commands/queue-pickup.md` STEP 1) — a team-scoped
  `list_issues` is the natural query and is held permanently by years-old issues outside this
  project.

`.claude/agents/reviewer.md` §The necessity gate enforces this, and carries a line budget so
prose growth is measured rather than argued about.

**Unapplied migrations are drift.** A migration in the repo that has not run against the
database means the schema in git and the schema in Postgres disagree. Apply them before adding
another; a queue of unapplied migrations fails in the order nobody tested. Check rather than
trust this line — `mcp__Supabase__list_migrations` against the hosted project, against
`ls supabase/migrations/`.

## Product Scope (from Figma)

**The per-domain build status — Postcards, Inbox, Garage, Trust & safety, Rides, Clubs — is
[`docs/reference/product-scope.md`](docs/reference/product-scope.md).** It is a snapshot of what
exists, so check the code first and Figma second.

Two things that belong here rather than there, because they are decisions rather than status:
**the nav is four tabs** (Home, Rides, Clubs, Profile — Inbox was removed by PD-100, not shipped
as a stub), and **there is no "Friends" tab**, because `013` dropped `friendships` on 2026-08-04.
Both look like omissions to anyone reading the five-tab design instead of the code.

## Feature Workflow (OpenSpec)

Features with real domain rules — anything touching visibility, membership or
permissions — go through OpenSpec: `/opsx:propose` → `/opsx:apply` →
`/opsx:archive`. Small mechanical changes (copy, styling, a dependency bump) do
not need a proposal; requiring one for everything is how process gets ignored.

Proposals must state the **negative** cases, not just the positive ones: who
must *not* see or do this. Every access-control bug this project has had came
from a visibility rule nobody wrote down. Rules live in `openspec/config.yaml`.

## The roadmap lives in Linear

**Full detail — the anti-duplication contract, the status traps, sequencing, the queue Routine and
its two triggers — is [`docs/reference/linear.md`](docs/reference/linear.md). Read it before the
first Linear call of a session, and before ANY call that touches the queue Routine, its triggers
or the Development session** — those are CCR calls rather than Linear ones, so "before a Linear
call" would never have fired for them. What must be true without reading it:

- Workspace **`lets-ride`**, team **Pedro & Dave (`PD`)**. **Pass the project id —
  `88f3f224-ecf0-46f0-a032-c86b7a12f81c`** — never the name: it holds a curly apostrophe, the
  straight-quote version silently matches the *deprecated* project or drops the field, and
  `save_issue` returns a successful-looking payload either way. **Read the field back off the
  response.**
- **Do not ask permission to touch Linear.** Standing grant, 2026-08-07 — read, create, update,
  label, move between statuses, and close. Deleting anything a human authored is the exception.
- **`Queued (AI)` is the only start signal**, and `Development (AI)` + `Needs help` is a
  *two-name* concurrency lock. Both traps are spelled out in the reference; the wider reading of
  either freezes the queue while looking healthy.
- **Never type a status name from memory** — `list_issue_statuses team=Pedro & Dave`. A
  `save_issue` naming a status that no longer exists comes back looking successful with the field
  silently dropped.
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
  Production target against the `letsride` project, `development` builds a Preview against
  `letsride-dev`. Feature branches are Previews too, so they also point at DEV.
- **The domain is `letsride.social`, bought 2026-08-07, and the app does not live at its apex.**
  `app.letsride.social` is production, `app-dev.letsride.social` is `development`, and the apex
  is the marketing website in a **separate Vercel project that is not this repo**. Nothing is
  attached yet and the `*.vercel.app` URLs still work; `docs/ENVIRONMENTS.md` §Domains is the
  contract, including the one ordering rule (attach and confirm the host *before* moving
  Supabase's Site URL) and why the apex redirect must be a 307 rather than a 301. **No code
  changes with the domain** — `ShareButton`, `signUp` and `requestPasswordReset` all build URLs
  from `window.location.origin`, so a hardcoded origin anywhere in `src/` is a bug that would
  only surface in email: `grep -rn "letsrideapp\|vercel\.app\|localhost:3000" src/` is 0.
- **Branch off `development`, and open PRs against `development` — not `main`.** This is the one
  an agent gets wrong by habit. `main` receives exactly one kind of PR: the promotion from
  `development`, which is what ships to riders.
- **Never promote a Vercel preview to production**, and never merge `main` into a feature
  branch. Full reasoning in `docs/ENVIRONMENTS.md`; the short version is that
  `NEXT_PUBLIC_SUPABASE_*` is inlined at build time and Vercel's promote does not rebuild.
- **If anything ever lands on `main` without coming through `development`** — a production
  hotfix — merge `main` back into `development` immediately, or the next promotion silently
  reverts it.
- **Squash-merge a feature PR; use a merge commit for the `development` → `main` promotion**,
  then fast-forward `development` back to `main`. A squashed promotion puts a commit on `main`
  that `development` does not contain, so the two diverge permanently despite identical trees,
  and every later promotion re-shows commits that already shipped.
- **CI is scoped to what a PR can actually break**, decided by a `changes` job that
  diffs against the merge base:
  - **`Type Check, Lint & Build`** (tsc → ESLint → Vitest → `docs:check --cheap` → `next build`)
    runs unless
    *every* changed file is under `docs/`, `design/`, `openspec/`, `.claude/` or a root `*.md`.
    That is a **denylist**, like the route guard's public paths — a new top-level directory runs
    CI by default, so forgetting to list something costs one green run rather than a missed
    break. **Four carve-outs run the job anyway**, each for its own tripwire — count them in the
    `changes` job rather than trusting this list, which has already been a carve-out behind:
    `.claude/agents/` + `.claude/commands/` (`src/__tests__/agent-briefs.test.ts`, because a
    brief is executable process that no other job reads), `docs/` + root `*.md`
    (`scripts/docs/__tests__/registry.test.mjs`, because `docs:check`'s anchors depend on exact
    wording), `openspec/` (`crossrefs.test.mjs`, because a third of the repo's section pointers
    live there), and `.claude/settings.json` (the `hard_deny` claim measures that file, and a
    permissions diff touches nothing else). **So a PR touching only `design/`, `.claude/hooks/`
    or the rest of `.claude/` runs zero jobs.**
  - **The cheap doc-claims step is not the whole sweep.** It runs the claims whose ground truth
    is a grep, a `jq` or a contrast ratio — 21 of 33. The ones needing Postgres, a second full
    build or a **test runner** stay out, so `npm run docs:check` locally is still the complete
    answer. That last exclusion was learned rather than designed: the two claims that spawn
    `vitest` on one file passed locally — including under `CI=true GITHUB_ACTIONS=true` — and
    failed twice on the runner, so they carry their own `kind` and are excluded by name. **A
    claim whose ground truth is another tool's human-readable output does not belong in the
    cheap set.** Under `--cheap` a *skip* fails the run, which is what makes that boundary
    matter: every claim in that set measures with a grep, so a skip is a broken command rather
    than a missing service.
  - **`RLS Policy Tests`** (Postgres 17) runs only when `supabase/**` or the workflow
    changes — the migration chain and the assertions are its only inputs.
  - A push to either long-lived branch always runs both. Each is a deploy gate.
  - Skipped jobs are skipped with `if:`, never a workflow-level `paths:` filter: a
    filtered-out workflow never reports its check, and a required check that never
    reports blocks the merge forever.
  - **`on:` lists both branches, on both triggers.** A base branch missing from those
    lists runs *zero* jobs and shows no red mark — a workflow that never triggers reports
    nothing at all, which is indistinguishable from a PR that had nothing to check.
- Whatever runs must pass before merging.
- Never push directly to `main` or `development`.

**One PR per session, opened at the wrap-up — and merged in the same session.** Standing
instruction from the product owner, 2026-08-05: do not ask permission to open one. Both halves
matter and the second is the one that gets dropped.

**Wrapping up a session *means* a PR to `development`, whenever the session changed anything.**
The product owner's definition rather than a step: if the tree differs from `development`, the
session is not wrapped up until that difference is a PR. It applies to every kind of change, not
only features — a docs-only or `.claude/`-only session still opens one, and those are still the
cheapest to get green. The one case that needs no PR is a session that changed nothing.

- **Open it at the end, not per milestone.** A session is usually one coherent unit of work, and
  a PR per commit fragments the reasoning across reviews that each see a third of it. Commit and
  push freely as you go; the PR is the wrap-up.
- **Then drive it to merged.** *Committed and pushed is not shipped* — see Working Principles —
  and a wrap-up PR left open is that failure mode with extra steps, because every other signal
  (clean tree, green CI, pushed branch) already looks finished. If it genuinely cannot merge,
  say so plainly as the **last thing in the session**, with the reason.
- **A follow-up PR is fine when a fact only becomes true after the merge.** Applying a migration
  that must land after its code deploys is the standard case: the "applied" line cannot be
  written truthfully in the PR that deploys the code.
- **Restarting a merged branch:** the designated branch name is reused, so once its PR merges,
  `git fetch origin development && git checkout -B <branch> origin/development` before the next
  change. Never stack new commits on merged history. **Note the base is `development`, not
  `main`** — branching a feature off `main` and merging it into `development` is harmless, but
  the reverse carries whatever is sitting unreleased in `development` straight into a
  production PR.

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
- **Don't delete `trig_01Gzy8eCiaXUUa1knvJnNpwy`** — the disabled fallback Routine. Its three
  connectors were attached by hand and `create_trigger` refuses the `connectors` parameter for
  this organization, so no session can recreate it; `update_trigger enabled: true` restores it
  whole. `…WJkMV` is the cheap hourly one, `…Gzy8e` is the irreplaceable one — keep them straight
  in both directions. Detail in [`docs/reference/linear.md`](docs/reference/linear.md).
- **Don't archive or abandon the Development session** (`session_01B2mxc642tG8vZ15wysQpqM`).
  Archiving it stops the queue silently with no error anywhere, and `update_trigger` has no
  `persistent_session_id` parameter, so recovery needs a third trigger bound to a new session.
