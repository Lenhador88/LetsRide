# Handoff — where things stand

Last shipped, 2026-08-03/04: the **Postcards home screen and every interaction behind it** —
`#17` the committed Figma snapshot pipeline, `#18` a startup-context dedup, `#19` the feed and
create screens, `#20` reading Figma's `Retry-After`, `#21` a route that shipped dead, `#22`
migration `011` with comments / hides / reports / blocks, `#23` reads that no longer swallow
errors, `#24` the orphan sweep, `#25` this file's own rewrite.

**In flight: the comments UI** (`#26`, `claude/comments-ui-krjuyl`) — the thread route
`/postcards/[id]`, the composer, and the card's comment control, on `011`'s existing backend.
No schema change. It closes the first and largest part of the gap `#25` named below; **hiding,
reporting, blocking and deleting still have no UI.**

**Nothing in the UI has ever been compared to the design.** Figma was rate limited throughout,
so every composition value is an inferred guess, each one recorded as *chose:* in
`docs/FIGMA-FIDELITY-TODO.md` so verifying is a diff rather than a re-derivation.

Read `CLAUDE.md` first. It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles, and the canonical Supabase project.
This file is only the *current position* — the things that will be stale in a week.

## Before you trust this file

Everything below is a claim about state that moves without this file moving with it. Two
commands settle whether it is current, and they cost seconds:

```bash
git log --oneline -3 origin/main                  # what actually shipped
git diff --stat origin/main -- docs/HANDOFF.md    # is this file itself unmerged?
```

If the second prints anything, someone edited the handoff and it never reached `main` —
which has happened, and is why a `Stop` hook now warns about exactly that
(`.claude/hooks/handoff-landed-check.sh`).

**Prune this file as part of landing work, not as a separate task.** It records the *current
position*, so it accretes by design — every session adds what it just did, and nothing
removes what stopped being current. A one-off cleanup does not hold: this file was deduped by
2,400 tokens on 2026-08-03 and had grown past its starting size by the end of the same day.
When you finish a change, delete the paragraph it made obsolete. Proof of something already
verified belongs in the migration's own §Verification footer, not here; a settled decision
belongs in `CLAUDE.md`. What stays here is what is still true and still undone.

**Database and deployment state cannot be checked from the shell.** `api.github.com` is
refused by the proxy ("GitHub access is not enabled for this session") and `supabase.co` is
blocked, so any `curl`-based check here fails silently and tells you nothing. Use the GitHub,
Supabase and Vercel MCP tools instead — a silent `curl` loop looks identical to a passing one.

---

## Do this first

**Everything through migration `011` is shipped and applied.** `001`–`011` are all live on the
hosted project, and the Postcards backend is complete for every home-screen action.

The next actions, in the order they are worth doing:

1. **Supabase is on the free tier and auto-pauses after ~7 days idle.** A paused project
   serves nothing and there is no alert, so the deployed app goes down silently. This needs a
   card, not a commit, and it will bite at the worst possible moment.
2. **Sweep the orphaned Storage objects** — `npm run storage:sweep` (dry run), then
   `-- --delete`. Two objects, 1.15 MB, left by the `/postcards/new` bug fixed in #21. #24
   shipped the tool; whether it has since been *run* could not be checked from this container,
   which cannot reach `supabase.co`. The dry run is free and settles it.
3. **`npm run figma:pull`, but not before 2026-08-06 12:32 UTC.** Re-probed 2026-08-04: still
   429 on `/v1/files/*` and `/v1/images`, `2d 4h` left, which agrees with the 2026-08-03
   reading to within an hour — it really is one countdown, not a fresh window per attempt.
   Check with `npm run figma:check -- --probe` rather than trying blind. One successful pull
   is the highest-value thing left — see *Building to the design*.
4. **Then verify the Postcards screens against the design**, working through the `chose:`
   entries in `docs/FIGMA-FIDELITY-TODO.md` — now four screens' worth, including the comment
   thread. Every composition value in them is a guess; the tokens are not.
5. **Enable leaked-password protection** — one dashboard toggle, and the only outstanding
   security advisor that is not deliberate.

**The rest of the Postcards interaction UI is the next build.** `#26` took the comments half —
`getPostcardComments`, `addComment` and `deleteComment` now have a screen, and the
`comments_count` the feed had been paying for is displayed. Still callable and still called by
nothing: `hidePostcard`, `unhidePostcard`, `reportPostcard`, `blockRider`, `unblockRider`,
`deletePostcard`. Those are one surface — an overflow menu on a card — rather than six.

Two things to know before starting it, both of which `#26` followed:

- **Extend the existing guesses, do not invent a third style.** Every composition value
  already in the feed, create and thread screens is recorded as *chose:* in
  `docs/FIGMA-FIDELITY-TODO.md`. A menu built to a different rhythm than the card above it is
  worse than one built to the same wrong rhythm, because the second is one find-and-replace
  to correct.
- **The icons still cannot be exported**, so per decision #4 no lookalike is substituted. The
  like and comment controls are text-labelled for that reason; hide and report should match
  them rather than reaching for `lucide-react`.

**The product call in `#25` — whether to build before the Figma window opens — was taken, not
dodged:** `#26` built it, accepting that composition gets done twice. Worth knowing the trade
was made deliberately if the thread comes back looking wrong on 2026-08-06.

**None of the comments UI has been run against the real database.** This container cannot
reach `supabase.co`, so type check, lint, `next build` and 222 unit tests are the whole of its
verification — and the `/postcards/new` incident below is the standing proof that those four
say the code compiles, not that the screen works. Load `/postcards/[id]` on the deployment and
post one comment before calling it done.

**A security advisor fires on `public.moderate_comment` and it is expected — do not "fix" it.**
`authenticated_security_definer_function_executable` flags it as a `SECURITY DEFINER`
function callable via `/rest/v1/rpc/`. That is what it is for: it lets a rider remove a
comment from a harasser they blocked, which RLS alone cannot reach because it filters a
DELETE by what the caller may *read*. Revoking EXECUTE or switching to `SECURITY INVOKER`
would silently restore that hole. Its safety is narrowness — `search_path` pinned, names
schema-qualified, revoked from `public` and `anon`, and the authorization checked *inside*
the function against `auth.uid()`. Asserted both ways in the suite.

**Still not done, and deliberately so:** the `/friends` + `friendships` deletion. Signed off
by the product owner, but it needs a migration to drop the table, so it is a `data` change
rather than a UI one. The Navbar still routes there; deleting the tab without the route
strands the page.

**Comments came back into scope on 2026-08-03**, reversing the earlier "no tables for
comments or shares" decision. `009`'s header still says they are out of scope — that is now
historical. **Shares are still out**, and that is a genuine open question rather than a
deferral: "share" could mean a native share sheet (no backend at all) or a repost (a table,
an audience rule, and an answer for what happens when the original is deleted).

**Migrations `009`, `010` and `011` were each verified live after applying**, not merely
applied — three tables with RLS on, zero policies outside `to authenticated`, zero `anon`
grants, and exactly one SELECT policy per table. That last one is load-bearing: policies for
a command are OR'd, so a single leftover silently undoes the whole predicate. Each migration
carries the reproducible queries in its own §Verification footer; run those rather than
trusting this paragraph.

**The one caveat that outlives all of it:** the Postcards UI has never been compared to the
design. It was built while Figma was rate limited, so aspect ratios, spacing, byline
placement, the whole create flow and now the comment thread are defensible guesses, each
recorded as *chose:* so verification is a diff. It is not finished until someone has looked.

The largest of those guesses, and the one most worth challenging first: **comments live on
their own route rather than inline on the feed card.** That shape is what `011`'s
`revalidatePath('/postcards/${id}')` and the unused `getPostcard()` were both already built
for, but it is a shape nobody has read off the design.

## State

| | |
|---|---|
| Migrations | `001`–`011` all applied to the hosted project and verified live. See the ordering note below. |
| Tests | RLS suite 255 assertions (`npm test`) + Vitest **222** tests (`npm run test:unit`, measured 2026-08-04 — this line said 195). Both gate every PR. Count with `npm test 2>&1 \| grep -c "NOTICE:  ok"` — it read 69 for as long as anyone can tell, and the real number on `main` was 37. |
| Workflow | OpenSpec adopted: `/opsx:propose` → `apply` → `archive`. Rules in `openspec/config.yaml`. |
| Design | v2 tokens, Poppins, light theme, and the login primitives landed. `--text-display` is correct — the style it maps to does exist; see the correction below. |
| Spec | `docs/specs/login-onboarding.md` — 25 questions, all with defaults. The data-layer build took the defaults for Q1–Q9, Q11, Q13, Q14, Q23. |
| Squad | Nine agents in `.claude/agents/`. |
| CI | Green: type check, lint, build, RLS suite against Postgres 17. |
| Data | 1 rider, 1 club, 1 ride — all real, created through the deployed app. |

The app looks inconsistent on purpose: `/`, `app/auth/*`, `app/onboarding/*`, `app/legal/*`
and now `app/(app)/postcards/*` are v2, along with the `(app)` shell — its layout and the
Navbar migrated on contact when Home moved to `/postcards`. Rides, clubs, friends and
profile are still v1 `zinc-*`/`orange-500` and migrate with their own epics.

**Migration ordering is not file order.** Two chains were written in parallel and each
recreated the policies the other did. `004`–`007` reached the database before `002` did;
`008` reconciles them by taking `to authenticated` from `002` and the visibility predicates
from `004`. Verified by diffing the live policy set against a database built from the
chain — 22 policies, identical. Do not try to "tidy" the numbering; the end state is
correct and the divergence is recorded deliberately.

**`003_onboarding` is applied** (2026-08-02) and `supabase/tests/run.sh` no longer skips
it — `SKIP_MIGRATIONS` is empty, so CI applies the whole chain. All 29 `full_name`
references are gone; `grep -rn full_name src/` returns nothing.

---

## Figma — read `design/`, don't call the API

**Built 2026-08-03.** The design file now has a committed, offline snapshot under `design/`,
generated by `scripts/figma/`. Read it with `npm run figma -- tree "<screen>"`.
`design/README.md` is the full account; this is the current position.

The root cause of the repeated blocks was not only the rate limit. The previous cache wrote
to `.figma-cache.json`, which is **gitignored**, and this container is rebuilt every session —
so the cache was empty every single time anyone needed it, and every session paid full price
for a file that changes about once a month. The snapshot is committed for exactly that reason.

| Command | Network | Purpose |
|---|---|---|
| `npm run figma -- ls / tree / text / show / tokens / icons` | no | Query the snapshot |
| `npm run figma:check` | one cheap call | Is it stale? Compares `/versions` against `design/manifest.json` |
| `npm run figma:check -- --probe` | 7 cheap calls | Endpoint sweep — use instead of hand-rolling a curl sweep |
| `npm run figma:pull` | **yes** | Refresh — the expensive call. Monthly |
| `npm run figma:icons` | **yes** | Export `Element / Icon / *` as SVG |

**The snapshot is not populated yet, and now we know exactly when it can be.** The pipeline
is built, tested and committed, but every node route was 429 all day on 2026-08-03 — on the
first call of a fresh session, budget nobody here spent. `design/` therefore holds only its
README.

`Retry-After` puts the clearing time at **roughly 2026-08-06 12:30 UTC**. Do not try before
then; do not poll. On or after that, run `npm run figma:pull && npm run figma:icons` and
commit `design/`. That single act retires this section and most of
`docs/FIGMA-FIDELITY-TODO.md`, and lets someone finally check the Postcards screens against
the design they were guessed from.

Measured 2026-08-03 15:22 with `npm run figma:check -- --probe`:

| Endpoint | State |
|---|---|
| `/v1/me` | 200 — proves nothing, stays green through every outage |
| `/v1/files/:key/versions` | 200 — different bucket, which is why `figma:check` works when `figma:pull` cannot |
| `/v1/files/:key`, `/nodes` | **429**, `Retry-After` 2d 21h — gates `figma:pull` |
| `/v1/images/:key` | **429**, `Retry-After` 2d 21h — gates `figma:icons` |
| `/v1/files/:key/styles`, `/components` | 200 but empty (library unpublished) |

**The 429 carries `Retry-After`, and it is in seconds.** Measured 2026-08-03 by sampling it
61 seconds apart and watching it fall by 64 — a real countdown, not a constant, and requests
neither reset nor shorten it. `npm run figma:check -- --probe` now prints the wait per
endpoint and when it clears, so "when can I pull?" has an exact answer.

This retired a belief that had been repeated in three files and cost real time: windows do
**not** "last hours". The live header said **69 hours**. Anyone told to "try again in a few
hours" was going to fail three times and learn nothing.

Two lessons still stand: **the limit is per endpoint family**, so one 429 is never evidence
about another route; and **when both routes to design data are shut, stop and say so** rather
than eyeballing values off a screenshot — register the gap in `docs/FIGMA-FIDELITY-TODO.md`
and build what does not need the design.

Everything extracted from the 2026-08-02 whole-file pull is written up under *Verified
measurements* in `docs/specs/login-onboarding.md`: every string verbatim, component geometry,
fills, and the screen layout. **That section supersedes §Screens wherever they disagree.**

## The login epic — shipped, and what it left behind

Merged and live. All seven routes exist (`/`, the four `auth/*` screens, the two
`onboarding/*` steps), `003` is applied, and every `full_name` reference is gone.

Three decisions were taken on **defaults rather than sign-off**. They are cheap to revisit
now and expensive later, so they are recorded rather than buried:

- **Server Actions for all writes.** There were zero `'use server'` files before this. The
  legacy `supabase.from()` + `router.refresh()` pattern survives only in `JoinRideButton` and
  `JoinClubButton` — migrate those on contact.
- **Zod**, the one new runtime dependency, for schemas shared by client and server.
- **The profile-photo step is deferred** to a `media` follow-up, so onboarding is two steps
  and the wizard shows two dots, not the three drawn.

**Three deliberate deviations from a Done design**, tabulated in the spec for the designer:
`Skip` removed from onboarding (decision #5), step 1 asks for a **username** rather than a
name (decision #7 changed what the field collects after it was drawn — "Name" would invite
input that fails the charset rule), and two dots instead of three.

### Open, needing a decision

- **`terms_accepted_at` is not protected.** `enforce_onboarding_completion()` pins the
  onboarding stamp but leaves the consent stamp writable, so a rider can clear or back-date
  their own. `CLAUDE.md` names T&C acceptance as an integrity rule the client must not own.
  Worse: if email confirmation is ever switched on (decision #6 says revisit before launch),
  `signUp` loses its live session and the consent write is refused outright. The action
  checks its result now; the schema guard is an unwritten migration.
- **`/onboarding/photo` is unbuilt** and needs the `media` agent — Storage bucket, RLS,
  client-side compression, EXIF stripping. When it lands it must **not** re-gate riders who
  already completed onboarding; surface it as a dismissible nudge on the profile screen.

---

## Building to the design — read before starting

`CLAUDE.md`'s token tables are correct and complete. What follows is the shape of the work,
measured on 2026-08-01 rather than estimated.

**"Applying the design" is roughly one fifth restyling and four fifths building product that
does not exist.** The code is 12 routes and 11 components with 139 v1 token occurrences
across 17 files. The design is 6 sections — Login, Home, Rides, Clubs, Inbox, Profile —
backed by 52 component sets, 213 variants, 88 components and 44 icons. The gap is structural,
not cosmetic:

- **The design has no Friends tab.** The five tabs are Home, Rides, Clubs, Inbox, Profile.
  `/friends` is not restyled, it is **deleted**, and `friendships` is a v1 leftover.
  **Signed off by the product owner on 2026-08-02**, along with deleting `/dashboard`.
  Not yet carried out — see *Do this first* for why the order matters.
- **The design's home is Postcards**, a photo feed. The app's home is `/dashboard`. The
  central screen of the product is not built.
- **Inbox and Garage have no routes and no tables.** The schema is `profiles`, `rides`,
  `ride_members`, `clubs`, `club_members`, `friendships`, plus `postcards`, `postcard_likes`
  and `blocks` from `009` — so postcards and blocking now have tables, while messages and
  garage still have nothing. Most of what is left is `data` → `feature`, not CSS.
  (This bullet claimed "nothing behind postcards … or blocks" for a while after `009` landed
  and contradicted §Do this first twenty lines above it. Re-read both before trusting either.)

**Suggested order.** The ratings are impact on shipping a product that matches the design.

| # | Work | Impact | Notes |
|---|---|---|---|
| ~~1~~ | ~~`design-system` — login primitives~~ | — | **Done** for the login set: Button, Input, Checkbox, Pagination, AppBackground. The 44 icons and retiring `lucide-react` are still outstanding |
| ~~2~~ | ~~Login epic~~ | — | **Shipped** — PR #8 |
| 3 | Restyle the 12 existing routes v1 → v2 | 4/10 | Only `app/(app)/*` remains v1 now |
| 4 | **Postcards / Home** | 10/10 | New tables + Storage + EXIF; the core loop |
| 5 | Inbox — DMs, ride chat, notifications | 8/10 | New tables + `realtime` |
| 6 | Trust & safety — block, report, hide | 7/10 | RLS-level; needed before real users |
| 7 | Garage | 5/10 | Self-contained, lowest urgency |
| 8 | `/onboarding/photo` | 3/10 | `media` follow-up deferred out of the login epic |

**Do not restyle screen-by-screen before `design-system` lands.** Twelve routes each
re-deriving tokens is how drift gets baked in. This was a live risk until today: the token
table omitted `Warning/100` `#D92140`, so every `<Button variant="danger">` built against the
old docs would have used the wrong colour.

**Screens per section — measured 2026-08-02**, from the whole-file REST pull. This was
previously listed as the one missing number, "the difference between weeks and months".

| Section | 390px frames |
|---|---|
| Clubs | 65 |
| Rides | 45 |
| Home (Postcards) | 29 |
| Profile | 25 |
| Login | 18 |
| Inbox | 17 |
| **Total** | **199** |

**Read that as frames, not routes.** It counts focus, filled and empty-state variants of the
same screen. The login epic is the calibration: **18 frames became 7 routes**, roughly 2.5:1.
Applying that ratio to the remaining 181 frames suggests something like 70 routes left — so
Clubs and Rides are each a larger build than the entire login epic, and Postcards is not the
biggest section by frame count even though it is the highest-impact one.

---

## The bug that CI could not see — read before trusting a green pipeline

`/postcards/new` shipped dead. It was green on type check, lint, `next build` and 173 unit
tests, and it threw on the first real use:

```
Error: A "use server" file can only export async functions, found object.
routes=/postcards/new
```

`lib/actions/postcards.ts` is a `'use server'` module and exported a plain const
(`emptyPostcardActionState`). That is illegal, and it fails at **module evaluation** the
moment a client component imports it — taking the route down rather than the one value. It
had been latent since `009`/`010` shipped the backend, because nothing imported it until a
screen existed.

Three things worth keeping:

- **`lib/actions/state.ts` already existed to prevent exactly this**, and its header says so.
  `auth.ts` and `onboarding.ts` follow it; `postcards.ts` did not. A documented convention
  with one silent violator is how this class of bug survives review.
- **The whole pipeline is blind to it.** It is not a type error, a lint error or a build
  error — it is a runtime property of the server module graph. `src/__tests__/use-server-exports.test.ts`
  now asserts the rule directly, and was verified by reintroducing the bug and watching it
  fail with the offending line.
- **The upload succeeding while the insert never ran left an orphan**, which is what pinned
  the diagnosis: `createPostcard` deletes the object when the *insert* fails, so an orphan
  surviving proved the action never reached the insert. Storage logs plus a
  `select count(*) from postcards` settled in a minute what guessing would not have.

The general lesson, and the reason "does one real upload succeed" was already written down as
a thing to test first: **a green CI run says the code compiles, not that the screen works.**
Any route that has never been loaded against the real deployment is unverified, whatever the
badge says.

## Known issues, roughly by cost to fix

- ~~**Duplicate usernames break signup.**~~ **Fixed and deployed** — `handle_new_user` no
  longer guesses a username from the email local part, so two `dave@…` addresses no longer
  collide. Username moved into onboarding.
- **Private clubs are unreachable from `/clubs`.** The page filters `is_public`, so a member
  of a private club has no way to navigate to it. Direct links work.
- **No edit or delete UI anywhere.** The `update`/`delete` RLS policies exist and are
  tested, but nothing calls them — you can create a ride and never fix a typo or cancel it.
  Comments are the exception as of `#26`: they can be deleted, though still not edited, which
  `011` forbids by design.
- **`deleteComment` does not revalidate on the `moderate_comment` path** — latent now, real
  the day blocking gets a UI. It reads the postcard id before deleting, under the same RLS
  that hides the row, so for the one case that path exists for (an author removing a blocked
  harasser's comment from their own photo) the id comes back null and the thread never
  refreshes. The delete itself works. Found by review on 2026-08-04 and deliberately not
  patched: the fix is to have `moderate_comment` return the postcard id instead of a boolean,
  which is a migration. Full note at the call site in `src/lib/actions/comments.ts`.
- **Leaked password protection is disabled.** Supabase advisor flags it; a dashboard toggle
  that checks signups against HaveIBeenPwned.
- **Free tier auto-pauses after ~7 days idle**, taking the deployment down with no alerting.
  This already happened once, and restoring it is what reopened the anon hole. Pro before
  anything resembling launch.

---

## Deployment protection — settled

**Vercel SSO now applies to previews only.** Production at `letsrideapp.vercel.app` is
publicly reachable and the link is shareable; preview deployments still sit behind a Vercel
login, so unreleased work is not exposed.

Public production is safe here because access control does not depend on the URL being
secret: `proxy.ts` gates every route outside `/auth/*` behind a session, and `anon` holds no
table privileges at all. A signed-out visitor can reach the landing and auth pages and
nothing else.

---

## The test rider account

Created 2026-08-03 so screens can be exercised without using the product owner's own login.

| | |
|---|---|
| Email | `duskrider@letsride.test` |
| Username | `duskrider` |
| User id | `0f6c4947-7990-475d-9224-2e3011b31923` |
| State | Onboarding complete — lands straight on `/postcards` |

**The password is not in this repo and must never be.** It lives with the product owner; ask
them, or reset it from the Supabase dashboard. If CI ever needs it, it belongs in GitHub
Actions secrets, not in a file.

Two caveats that matter more than they look:

- **`.test` is an RFC 2606 reserved TLD and receives no mail.** Harmless while email
  confirmation is off (decision #6), but the moment confirmation is turned on, this account
  cannot sign up, recover a password, or confirm anything. Revisit it with that decision, not
  after.
- **It was created by SQL insert into `auth.users`, not through the signup flow**, because
  this container cannot reach `supabase.co` — so it proves nothing about signup itself. The
  row shape was mirrored from the one real account and the bcrypt hash was verified with
  `crypt()`, so password login works; everything upstream of the session is untested.

**The app is not public yet.** That is why a real account on the production project is an
acceptable test fixture at all. It stops being acceptable the day real riders sign up —
before launch, either delete it or move testing to a separate Supabase project.

## Known constraints

**`git log %G?` lies about signatures here — do not "fix" commits based on it.** Commit
signing works: `commit.gpgsign` is true and the signer is `/tmp/code-sign`. But
`gpg.ssh.allowedSignersFile` is not configured, so git cannot attempt SSH verification and
reports `%G? = N` — the same value it uses for *unsigned*. Every correctly signed commit
looks unsigned.

Check the header instead, which is the ground truth:

```bash
git cat-file commit <sha> | grep -q '^gpgsig' && echo signed || echo unsigned
```

This cost a pointless `git rebase --exec ... --reset-author` across a whole branch to
"re-sign" commits that already carried valid signatures. The user-global
`~/.claude/stop-hook-git-check.sh` had the same bug baked into it — it has since been fixed
to grep the header, to stop treating `noreply@github.com` (GitHub's signed web-flow identity
on merge commits) as a fault, and to ignore commits already on the default branch. That hook
is outside this repo, so a fresh environment may still carry the old version.

**`origin/HEAD` is not set in this clone.** It is a symbolic ref only `git clone` or an
explicit `set-head` creates. Any script that references it here resolves to nothing and
becomes a silent no-op — which is exactly how two "fixes" to that hook passed review and did
nothing. Fall back to `origin/main` explicitly.

**Figma: read `design/`, and refresh it with the REST API on a PAT — never the MCP server.**
Settled. `design/README.md` carries the whole picture: which endpoints work, why the
Variables API is a permanent 403, why the token layer survives anyway (the file uses paint
styles, and style names ship on every node response), and why converting those styles to
variables would destroy it. The token tables live in `CLAUDE.md` §Design System and, once a
pull lands, in the generated `design/TOKENS.md` — which wins if the two disagree.

`FIGMA_ACCESS_TOKEN` lives only in the session environment and dies with this container if it
is not in the environment config. Only `figma:pull` and `figma:icons` need it; every other
`figma` command reads from disk.

**Eleven `[inferred]` strings remain in `docs/specs/login-onboarding.md`** — button and input
label text the old quota cut off. These are now cheaply verifiable via the REST API and
should be resolved in the login epic rather than carried further.

**Unverified from an earlier session:** the four migrated primitives kept their v1 shapes
(padding, radius, focus treatment). Tokens are correct; geometry is inferred and flagged in
the commit. The Figma pass should verify them.

**The agent proxy blocks outbound HTTPS to `supabase.co` and `vercel.app`.** Verify database
state through the Supabase MCP tools and the deployment through the Vercel MCP tools rather
than `curl`. Note that Vercel's fetch tool authenticates as the account owner, so a 200 from
it is not evidence that a URL is publicly reachable.

---

## Open questions for the product owner

1. **Terms & privacy pages must be publicly readable** — you legally have to show them
   before signup completes. This is a narrow, deliberate exception to "no anonymous access"
   (two static pages on a proxy allowlist, no data access). Not yet approved.
2. **Email confirmation is off.** Deliberate and recorded, but it means anyone can sign up
   with an address they do not control. Must be revisited before public launch.
3. **Branch protection on `main` is not enabled**, and **an agent session cannot enable it** —
   the GitHub MCP server has no branch-protection tool, and the REST endpoint returns 403
   because repo settings are outside what the session's GitHub access grants. It needs a
   human in the repo settings.

   With agents pushing, this is what makes "CI is the safety net" true rather than
   aspirational. Recommended for `main`:

   - Require a pull request before merging (0 approvals is fine for a solo maintainer)
   - Require status checks: **`Type Check, Lint & Build`** and **`RLS Policy Tests`** —
     these are the job `name:` values in `ci.yml`, and a check is only selectable in the UI
     after it has run at least once
   - Require branches to be up to date before merging — this is the one that would have
     caught today's semantic conflict, where two branches each rewrote the same policies
   - Do not allow bypassing the above. Agents push with an owner-level token, so without
     this the rules do not bind the thing they exist to constrain
   - Leave force pushes and deletions disallowed

   If CI ever breaks and blocks an urgent fix, the rule can be toggled off in settings —
   enabling it is not a lock-out.
