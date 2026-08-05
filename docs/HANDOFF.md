# Handoff — where things stand

**Read `CLAUDE.md` first.** It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles and the canonical Supabase project. This file
is only the *current position* — the things that will be stale in a week.

**This file was rewritten on 2026-08-05 and is a fraction of its previous size.** It had grown
to ~900 lines by accreting a paragraph per session and deleting nothing, so the current
position was buried in the history of how it was reached. Proof of something already verified
belongs in its migration's own §Verification footer; a settled decision belongs in `CLAUDE.md`.
**What stays here is what is still true and still undone.** Prune it as part of landing work,
not as a separate task.

## Before you trust this file

Every claim below is about state that moves without this file moving with it:

```bash
git log --oneline -5 origin/main                  # what actually shipped
git diff --stat origin/main -- docs/HANDOFF.md    # is this file itself unmerged?
```

If the second prints anything, someone edited the handoff and it never reached `main` — which
has happened, and is why a `Stop` hook warns about it (`.claude/hooks/handoff-landed-check.sh`).

---

## The big thing: the app is migrating to a client-rendered shell

**Decided 2026-08-05 with the product owner.** Store presence is a business requirement, and
background location tracking is on the roadmap — which the web platform cannot do on any
browser, because JS is suspended the moment the app backgrounds. The app becomes a
client-rendered bundle inside Capacitor, talking to Supabase directly under the same RLS.

`CLAUDE.md` §Technology Decisions carries the reasoning. The plan is
`openspec/changes/migrate-to-client-rendered-shell/` — 25 requirements, 73 scenarios,
reviewed once and revised. **Read `tasks.md` before doing anything on this.**

Seven task groups, six phases:

**Use `tasks.md`'s group numbers, which is what this table does.** They do not line up with the
phase numbers in the same headings — group 3 is Phase 2 — and an earlier version of this table
renumbered them, which is how "group 2" ended up meaning two different things in one paragraph.

| Group | Phase | | Status |
|---|---|---|---|
| 1 | 1 | Integrity migrations `018`–`026` | **Done.** `018`–`022`, `021`, `026` applied; `023` + `025` apply after this deploys |
| 2 | 1b | Consent prompt (one screen, one user) | **Done 2026-08-06** — `/onboarding/terms`, exercised against the live database |
| 3 | 2 | Make `lib/data/` isomorphic | **Done 2026-08-05** |
| 4 | 3 | Session → device secure storage, auth, recovery | **Done except 4.1/4.2/4.5/4.6** — see below |
| 5 | 4 | Screens, one route group at a time | **← next build.** Infrastructure is built and tested; no screen is converted |
| 6 | 5–6 | Retire the server render path | Not started |
| 7 | — | Verification and handoff | 7.2/7.3/7.5 done; 7.1 green; the rest belongs to groups 5–6 |

**Groups 5 and 6 are one continuous unit and neither is started.** Everything else has landed.

### What is left, precisely

Group 4's remainder is **only the session move**, and it is deliberately last: 4.1 (storage
adapter wired), 4.2 (no tokens in web storage), 4.5 (sign-out destroys local state) and 4.6
(shared device). The seam exists — `src/lib/supabase/session-store.ts`, with the native
secure-store contract, the labelled `localStorage` fallback and `clearSessionStore()` — but
**nothing constructs a client with it yet**, on purpose.

**The plan's sequencing for groups 4–5 was wrong and the corrected order is safer.** `tasks.md`
4.1 puts the session move first, behind a flag, because it assumed group 4 might merge before
group 5. It does not have to. The session cookie `@supabase/ssr` sets is **not** httpOnly —
measured, see below — so a client component reading through `lib/data/` works *today* under the
cookie session. So:

1. **Convert the screens first**, keeping cookie sessions and `proxy.ts` exactly as they are.
   Every intermediate state is a working, walkable app, and `npm run walk` proves it.
2. **Then move the session and the guard together**, in one change, and delete `@supabase/ssr`.

That removes the flag entirely and the "cookie/device-storage split cannot straddle a merge"
hazard with it, because there is never a moment when half the session has moved.

**Group 1 is worth having whether or not the render migration ever happens.** It is the only
one like that: three of its migrations close defects that are live today, because the
publishable key ships in the client bundle and PostgREST accepts any rider's JWT. A Server
Action omitting a column has never been a rule.

### Where group 1 got to — finished, and `021` was two migrations

Applied 2026-08-05, each pre-flighted at apply time: `018_text_bounds`,
`019_club_member_role`, `020_profile_countries_known_code`, `022_private_club_rides`,
`021_onboarding_state_accessors` and `026_password_reset_grant`.

**`021` held a deployment deadlock and was split.** It contained both the accessor functions and
the revoke that makes them necessary, and those must apply at different times relative to the
code deploy — new code on an old database calls a function that does not exist and the guard
bounces every signed-in rider; old code on a new database loses four live paths. Neither
ordering of one file works. Now:

- **`021_onboarding_state_accessors.sql`** — additive only: `my_onboarding_state()`,
  `accept_terms()`, `complete_onboarding(location)`. **Applied.**
- **`025_profile_column_privileges.sql`** — the revoke and the column allowlist. **Unapplied**;
  applies after this change deploys.

That split is also what made `023` and `025` compatible, which they were not before: `023` gated
on stamps `021` removed the only client path to setting, and the answer is that the database
writes them now. `PENDING=023+025 npm test` proves the pair.

**The Postgres trap that shaped all three functions.** Inside a `security definer` function
`current_user` is the *owner*, so `003`'s and `012`'s trigger guards — which both begin
`if current_user <> 'authenticated' then return new` — short-circuit and never run. Every
invariant those triggers carry is restated in the function bodies. CHECK constraints do still
fire. Measured on Postgres 16, with the NOTICE output in `021`'s header.

**Still unapplied, deliberately: `023` and `025`.** Both are in `SKIP_MIGRATIONS`. Apply order
after this merges and Vercel reports READY: **`023`, then `025`.** `list_migrations` reads 24
rows today against 26 files; it reads 26 when both are in.

### One correction to the risk register, measured

`design.md` §Risks opens with "**The refresh token becomes JS-readable**", presented as a
reduction the migration causes and accepts. **It is already JS-readable, today, on `main`.**
`@supabase/ssr` sets `sb-<ref>-auth-token` with `httpOnly=false` — it has to, because the
browser client reads the session back out of `document.cookie`. Measured with a real sign-in:
the cookie is present in `document.cookie` and is the only cookie the app sets besides the
recovery marker.

So the migration does not change refresh-token exposure at all. What it changes is the *store*
— cookie to device storage, which in a native shell is strictly better. The genuine reduction
in this change is elsewhere and smaller: `lr-recovery` **was** httpOnly, and `026` replaces it
with a Supabase-signed claim plus a spent-grants table. The mitigations §Risks lists (no
third-party scripts in the authenticated tree, refresh-token rotation) are still right; the
sentence that motivates them was not.

This also has a happy consequence for sequencing, recorded under *What is left* above: because
a client component can already read the session, the screens can be converted before the
session moves.

### The recovery cookie is gone, and D3's Edge Function was unbuildable

`026` replaces the httpOnly `lr-recovery` cookie. D3 specified an Edge Function that exchanges
the recovery code — **it cannot be built.** `@supabase/ssr` 0.12.4 hardcodes PKCE, so
`resetPasswordForEmail` stores the `code_verifier` in the *client's* own storage and
`exchangeCodeForSession` requires it back; no server can hold it.

What D3 wanted was a proof the client cannot forge, and one already exists: the project mints
**ES256** tokens and GoTrue records `amr: [{method: "recovery"}]` for a recovery session.
PostgREST verifies that signature before opening a transaction and puts the payload in
`auth.jwt()`, so the check is plain SQL — no secret, no service-role key, nothing to deploy but
a migration. Decision #8's second bullet stays shut.

**What it does not close, and who closes it.** This gates the app's front door, exactly as the
cookie did — not GoTrue's `PUT /auth/v1/user`, which any live-session holder can call with the
publishable key that ships in the bundle. The platform gate that *would* close it is
`UpdatePasswordRequireCurrentPassword`, whose implementation already checks
`session.IsRecovery()`. **Owner action** — it is a project setting, not something a migration can
reach. Measured against the live project: `PUT /auth/v1/user` with the fixture's existing
password returns `422 same_password`, and that check sits *after* both platform gates, so
reaching it proves both are currently off.

### One Postgres gotcha worth carrying forward

`revoke select, insert, update (col_a, col_b) on t from r` **does not do what it reads like.**
Postgres binds a column list to the immediately preceding privilege only, so that revokes
SELECT table-wide, INSERT table-wide, and UPDATE on two columns — and the last is a no-op
against a table-level grant. It strips more than intended and leaves the target untouched.
Reproduced on this Postgres: table-wide SELECT `f`, unrelated column SELECT `f`, target column
UPDATE `t`. The working shape is revoke-table-level-then-grant-a-column-allowlist.

### Where group 3 got to — done, with two corrections worth carrying

`lib/data/` is isomorphic. All 19 read functions resolve their client through
`src/lib/supabase/resolve.ts`; no signature moved.

**The plan's mechanism does not build, and the replacement is better.** D1 specified a runtime
test — server client when there is no `document`. `lib/supabase/server.ts` imports
`next/headers`, Next refuses to bundle that into a client graph, and a `typeof document` guard
around `await import()` does not help because the bundler resolves the specifier statically
either way. Measured, not assumed: a `'use client'` page importing one read function fails
`next build` with traces through both `[Client Component Browser]` and `[Client Component SSR]`.
The split is now the **`react-server` export condition** (`#supabase/data-client` in
`package.json`, halves `resolve.rsc.ts` / `resolve.browser.ts`). Confirmed by chunk inspection:

```bash
npm run build && grep -rho "src/lib/supabase/resolve\.[a-z]*\.ts" .next/server | sort | uniq -c
grep -rc "next/headers" .next/static | grep -v ":0"   # prints nothing
```

**One rule, and it is enforced after all.** *Read in an effect or an event handler, never during
render.* A `'use client'` component is still server-rendered until Phase 6, and there the browser
client has no session to find. Moving the split from a build error to a build-time *condition*
made that mistake legal to compile, so `resolve.browser.ts` throws a named error when there is no
`document` — static prerendering runs the SSR pass, so the page fails the build with the message
instead of failing closed at RLS in production. Verified by building exactly that page.

**`024` drops `profiles.avatar_url` and `clubs.avatar_url`, and the plan's repair list was six
query sites short.** Three club embeds in `rides.ts`, two in `postcards.ts`, one hand-spelled
profile select — none reachable through `PUBLIC_PROFILE_COLUMNS`. `clubs.avatar_url` was NULL on
every row and always had been, so **the three surfaces that draw a club image could only ever
draw initials**: the ride-detail chip, the ride filter tiles and the postcard filter tiles.
`/clubs/new` has been uploading to `avatar_path` since `016` and only the Clubs screens signed it.
Fixed with `CLUB_EMBED_COLUMNS` and a signing pass at those three.

Two corrections a review made to that paragraph, kept because both were easy to get wrong.
**`RideCard` and `PostcardCard` draw the club as a text chip, not an avatar** — so the rides list
and the postcard deck embed `id, name` and sign nothing; a first pass had the list selecting and
signing an image nothing renders. And it was **latent, not live**: 0 clubs and 0 riders have any
`avatar_path` either, so nothing has yet rendered differently. The defect was reading a column
that could never hold a value.

```sql
select count(*) filter (where avatar_path is not null) from public.clubs;   -- 0 on 2026-08-05
```

**`024` shipped in the order its header demands** — PR #52 merged, Vercel `READY` at `b60618a`,
*then* the drop, 2026-08-05. The reverse is an instant outage, because the code before that
commit still selected the column. Verified after: old selects `42703`, every shipped select
`42501`, advisors unchanged.

**Keep the probe — it needs no session and it is the cheapest schema oracle here.** PostgREST
answers `42703` for a column that does not exist and `42501` for one the role cannot read, so
anonymous `curl` distinguishes the two:

```bash
curl -s "$URL/rest/v1/rides?select=id,club:clubs(id,name,avatar_path)&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

**`021` would have aborted mid-deploy, and no local suite could have caught it.** Its §1 SELECT
grant list named `avatar_url`. `run.sh` applies by filename, so locally `021` runs *before*
`024` and finds the column; on the hosted project it runs *after*, where the grant raises
`42703` and takes the migration down. Removed — required under every reading of `021`'s open
shape question. Proven both ways against a scratch database in the real hosted order.

### Starting group 5 — the surface, re-measured 2026-08-06

Each line is a command, not a number to trust.

| What | Value | Re-derive |
|---|---|---|
| Pages / of which server | 24 / **17** | first-line match, see below |
| Components / of which server | 56 / **27** | same |
| `revalidatePath` call sites | **33**, 8 files | `git grep -o "revalidatePath(" -- 'src/lib/actions/*.ts' \| wc -l` |
| `redirect()` in actions | 14 / 5 files | `git grep -o 'redirect(' -- 'src/lib/actions/*.ts' \| wc -l` |
| Real `next/headers` importers | **2** | `git grep -l -e "^import .*from 'next/headers'" -- 'src/**/*.ts' 'src/**/*.tsx'` |

**That was 3 and is now 2**: `/auth/reset-password` read the recovery cookie and no longer
exists as a server page. The remaining two are `lib/actions/auth.ts` and
`lib/supabase/server.ts` itself. Note the `-e` — without it `git grep` reads the pattern's
`.*from` as a revision and dies, which reads like the file being absent.

```bash
for f in $(git ls-files 'src/app/**/page.tsx'); do head -1 "$f" | grep -q "'use client'" || echo "$f"; done | wc -l
```

**`revalidatePath` is 33, not the 41 in `design.md`, `tasks.md` and the earlier version of this
file.** All three cite `git grep -c`, which counts *lines containing the word* — and 8 of those
are the `import { revalidatePath } from 'next/cache'` line at the top of each of the 8 files.
33 + 8 = 41. This is the same counting trap CLAUDE.md documents three times over (the
`lucide-react` importer count, the v1-token count, the `next/headers` count), reproduced by the
very plan that warns about it. The cache-key contract in `src/lib/query/keys.ts` maps all 33.

**Most of the 27 "server components" need no work.** They carry no `'use client'` directive but
are pure presentational — they join the client graph automatically the moment a client page
imports them. The real work is the 17 pages.

**What already exists for group 5, built and unit-tested but wired to nothing:**

- `src/lib/query/` — `useQuery`, `invalidate`, `setQueryData`, `clearQueryCache`, plus
  `keys.ts`, which is the contract mapping all 33 invalidation claims to cache keys.
- `src/components/ui/Skeleton.tsx` and the four D7 shapes; `ErrorState`, `OfflineState`,
  `useOnlineStatus`.

**Two gotchas the conversion will meet on the first page.** `searchParams` becomes
`useSearchParams()`, which Next requires inside a `<Suspense>` boundary; `params` becomes
`useParams()`. And `lib/data/` must be read **in an effect, never during render** —
`resolve.browser.ts` throws a named error if you get that wrong, which is deliberate.

## Do this first

1. **Apply `023`, then `025`** — in that order, and only once this change has merged and Vercel
   reports READY. Both are written, asserted and in `SKIP_MIGRATIONS`. **Applying `025` before
   the deploy is an instant outage**; applying it before `023` is fine but pointless. Nothing
   goes red if this is forgotten: CI is green either way, and this line is the only signal.
   `list_migrations` reads **24 rows against 26 files** today; it reads 26 when both are in.
   Then `get_advisors` (security) — expect the two known findings plus the `security definer`
   functions `021` and `026` added, which are correct rather than regressions.
2. **Group 5: convert the screens.** Read *Starting group 5* above for the corrected sequencing
   — screens first under cookie sessions, then the session and guard together. The
   infrastructure is built; no screen uses it yet.
3. **Enable `UpdatePasswordRequireCurrentPassword`** in the Supabase dashboard. **Owner action.**
   It is what actually closes the recovery hole `026` can only gate at the app's front door —
   see *The recovery cookie is gone* above. Measured as currently off.
4. **Supabase is on the free tier and auto-pauses after ~7 days idle.** A paused project serves
   nothing, with no alert. **Owner action** — needs Pro before anything resembling launch.
5. **Exercise signup end to end.** Still never done on this database: the owner's account
   predates the consent write, both `.test` fixtures were SQL-inserted because Supabase rejects
   that TLD, and the one real attempt matches `signUp`'s own documented failure path. Needs an
   email domain the owner controls. **Owner action.** Note `npm run walk` now covers everything
   *after* signup, so this is the one remaining unproven path.
6. **Enable leaked-password protection** — one dashboard toggle, still the only outstanding
   security advisor that is not deliberate. **Owner action.**
7. **Sweep the orphaned Storage objects** — `npm run storage:sweep` (dry run), then
   `-- --delete`. Two objects, 1.15 MB, left by a bug fixed in #21. Whether the tool has ever
   been *run* is unknown; the dry run is free and settles it.
8. **Verify the remaining Postcards screens against the design.** `/postcards/new` and
   `/postcards/[id]` still carry inferred composition; the design has frames for both.

## Running things in this container

**Measured 2026-08-05. Re-measure rather than trust — each line is one command.**

| What | How |
|---|---|
| RLS suite | **`PGPASSWORD=postgres npm test`** — without it `psql` prompts and fails, which looks like a broken suite rather than a missing credential. If it says *connection refused*, the cluster is down: `pg_ctlcluster 16 main start`. If it then says *password authentication failed*, the role has no password: `alter user postgres with password 'postgres'`. Neither message reads as its own cause. Local is **Postgres 16**, CI is 17 |
| Pending-migration suites | `PGPASSWORD=postgres PENDING=023 npm test`, same for `025`, and **`PENDING=023+025`** for the pair — the mode that proves the two once-incompatible migrations apply together |
| Assertion count | `PGPASSWORD=postgres npm test 2>&1 \| grep -c "NOTICE:  ok"` — **383** on 2026-08-05 |
| Unit tests | `npm run test:unit` — **397** on 2026-08-05 |
| Dev server | **`NODE_USE_ENV_PROXY=1 npm run dev`** — Node's `fetch` ignores `HTTPS_PROXY`, so every server-side Supabase call fails with a proxy page while `curl` succeeds. The app surfaces that as "That email and password do not match an account", which reads like a credentials problem and is not one |
| `.env.local` | Write `NEXT_PUBLIC_SUPABASE_URL` plus the key from the Supabase MCP `get_publishable_keys`. Gitignored — `git check-ignore -v .env.local` to be sure |
| **Walking the app** | **`WALK_EMAIL=... WALK_PASSWORD=... npm run walk`**, with the dev server already up. Signs in as a real rider and reports every screen that redirected, hit the error boundary or came back empty. This is what task 7.2 asks for, and it is the only gate that renders anything — `tsc`, ESLint, Vitest, `next build` and the RLS suite all stay green through a screen that throws on load |
| Playwright | `npm install --no-save playwright-core` (already a devDependency of nothing — install it before `npm run walk`), `executablePath: /opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Never `playwright install` |
| OpenSpec CLI | `npm run openspec` — `@fission-ai/openspec`, installed 2026-08-05. The bare `openspec` npm name is a 0.0.0 stub |

**Network, measured — a blocked host fails as `curl: (56) CONNECT tunnel failed`, not as a
timeout:**

| Host | From the shell | Meaning |
|---|---|---|
| `*.supabase.co` | **401** | **Reachable.** 401 is the correct answer to an unauthenticated REST call |
| `*.vercel.app` | 403 at the proxy | Blocked. Use the Vercel MCP tools |
| `api.github.com` | 403 on `/repos/...` | Effectively refused. Use the GitHub MCP tools |

**Chromium here has no proxy configured**, so `<img>` fetches of Supabase signed URLs never
complete and every photo renders blank, and `XMLHttpRequest` to Storage hangs without ever
firing `onload` or `onerror` — an upload sits on "Uploading…" forever. **Neither is an
application bug.** The same requests return 200 from the shell. Launch Chromium with
`--proxy-server=$HTTPS_PROXY` if images need to render, and verify uploads with `curl`.

---

## Known issues, roughly by cost to fix

- **No edit or delete UI anywhere.** The `update`/`delete` RLS policies exist and are tested,
  but nothing calls them — you can create a ride and never fix a typo or cancel it. Comments
  are the exception: deletable, not editable, which `011` forbids by design.
- **Account deletion is not built.** App Store guideline 5.1.1(v) makes it a hard rejection for
  any app with account creation. On the backlog by owner decision, but it is a **store
  blocker**, and it gets larger once location tracks exist.
- **Inbox and Garage have no routes and no tables** — two of five nav tabs. A reviewer tapping
  five tabs finds two dead, which is a guideline 4.2 problem in its own right.
- **`createRide` returns a generic message on `23514`.** A rider picking a private club with
  "public" ticked now gets "That ride could not be created." with no explanation. Not reachable
  today (0 private clubs); live the moment someone makes one.
- **`club_members` holds a table-level UPDATE grant nothing uses.** Promotion is blocked only by
  the *absence* of a policy, so RLS filters to zero rows rather than raising. Asserted both ways.
- **`deleteComment` does not revalidate on the `moderate_comment` path** — latent until blocking
  gets more UI. The fix is to have the function return the postcard id instead of a boolean,
  which is a migration. Full note at the call site.
- **`max_riders` has never been enforced** — not by an action, a policy or a trigger, since
  `001`. `018` now bounds the *value* (1–999); nothing counts `ride_members` against it.
- **The swipe deck only moves forward.** A swipe in either direction advances, per the product
  owner, so there is no way back except "Start over".
- **Both RSVP pills fail WCAG AA**, and two more pairings besides — the Maybe pill at 2.54:1,
  `Accent Brand/100` with white at 3.52:1, the ride-host label at 4.10:1, the unselected RSVP
  label at 4.17:1. Left exactly as drawn; remedies costed in `docs/FIGMA-FIDELITY-TODO.md`.
  **A live question for the designer** — the green is used well beyond one screen.

---

## Test accounts

| Email | Username | State |
|---|---|---|
| `duskrider@letsride.test` | `duskrider` | Onboarded. **SQL-inserted**, never signed in |
| `qa-verify@letsride.test` | `verify24321868` | Onboarded, **and consented 2026-08-06** — the first row on this database with a real `terms_accepted_at`, written by the consent prompt through `accept_terms()` rather than by SQL. **SQL-inserted** originally |

**Passwords are not in this repo and must never be.** `duskrider`'s lives with the product
owner; `qa-verify`'s is in the git history of this file and should be treated as burned — which
also makes it the credential `npm run walk` uses, since a burned password on a fixture marked
for deletion is the right thing to hand a smoke test. Pass it in the environment, never on a
command line that gets logged.

Both are acceptable only because the app is **not live**. **Delete both before launch:**

```sql
delete from auth.users where email like '%@letsride.test';
```

Two caveats: `.test` is an RFC 2606 reserved TLD that receives no mail, so neither account can
sign up, recover a password or confirm anything the day email confirmation is turned on; and
because both were SQL-inserted, **neither proves anything about the signup flow**. If you
create another this way, set `confirmation_token`, `recovery_token`, `email_change` and the
other token columns to `''`, never NULL — GoTrue scans them into non-nullable strings and a
NULL turns every login into "do not match".

There is also one **real** signup (a Gmail address, 2026-08-04) with no consent, no username,
no onboarding and no sign-in. That is the shape of `signUp`'s documented consent-failure path.
See item 3 in *Do this first*.

---

## Open questions for the product owner

1. **Email confirmation is off** (decision #6), so anyone can sign up with an address they do
   not control. Must be revisited before public launch — and it interacts with both `.test`
   accounts above.
2. **Branch protection on `main` is not enabled**, and an agent session cannot enable it — the
   GitHub MCP server has no branch-protection tool and the REST endpoint 403s. Needs a human in
   the repo settings. Recommended: require a PR, require **`Type Check, Lint & Build`** and
   **`RLS Policy Tests`** (the job `name:` values in `ci.yml`), require branches up to date, no
   bypass. With agents pushing, this is what makes "CI is the safety net" true rather than
   aspirational.
3. **The 🟠-prefixed Figma sections** — are they dead explorations that can be deleted? They are
   the OLD stylesheet marked "In progress", which makes them look newer than the `Done` v2 flows
   beside them. Decision #4 says build from `v2 /` and ignore them.
4. **A proposal-review checklist for `reviewer`** was deliberately deferred until a real
   proposal existed. One does now, and its review found twelve findings with no checklist at
   all — so the evidence says the checklist is optional. Revisit only if a later review misses
   something a checklist would have caught.

---

## Which design to build from

**The file annotates every epic with a status, and it is the best planning signal in it.**

```bash
npm run figma -- ls "Annotation / Epic Cover"     # then tree one for its status
```

Two traps, both live:

- **The 🟠-prefixed sections are the OLD stylesheet, not a newer iteration.** Their "In
  progress" status makes them look newer than the `Done` v2 flows. They are not.
- **Status does not track what is built.** Treat `Done` as "the designer considers this
  settled" — which is what you want before spending a day on it — not as a build log.

Read the design from `design/`, never the API: `npm run figma -- tree "<screen>"`. Screen names
repeat across flows, so qualify with the flow. `tree` and `text` hide layers Figma has toggled
off; `--all` shows them. Refreshing the snapshot is a **monthly** job — `npm run figma:check`
first, and if `/files/:key` or `/nodes` return 429, **stop and read `Retry-After`** rather than
polling. It is a real countdown in seconds and waits have been measured in days.

---

## Constraints that will waste your time otherwise

**`git log %G?` lies about signatures here.** Signing works; `gpg.ssh.allowedSignersFile` is
not configured, so git reports `%G? = N` for correctly signed commits. Check the header:

```bash
git cat-file commit <sha> | grep -q '^gpgsig' && echo signed || echo unsigned
```

**`origin/HEAD` is not set in this clone.** Any script referencing it silently no-ops. Fall
back to `origin/main` explicitly.

**`FIGMA_ACCESS_TOKEN` lives only in the session environment** and dies with the container if
it is not in the environment config. Only `figma:pull` and `figma:icons` need it.

**Vercel's MCP fetch tool authenticates as the account owner**, so a 200 from it is not
evidence that a URL is publicly reachable.

**MCP connector names are not stable, and permission rules are matched on them.** This session
watched the Supabase server arrive as `Supabase` and later reconnect as
`mcp__d217aba8-…__execute_sql`; Vercel and Figma did the same. Every
`mcp__Supabase__*` rule in `.claude/settings.json` silently stopped matching at that moment, so
long-approved tools started prompting again. The UUID-scoped mirror lives in
`.claude/settings.local.json`, which is gitignored **because those ids are per-machine** — never
commit them, and expect to re-add them if the ids rotate again. The symptom is a permission
prompt for something the project already allows; the fix is not to widen the project rules.
