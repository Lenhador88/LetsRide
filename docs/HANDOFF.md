# Handoff — where things stand

**The Figma snapshot landed on 2026-08-04, and the home screen was rebuilt against it.** That
was the highest-value item in this repo and it is done: `design/` holds 195 frames (298
addressable screens), 140 components and 53 icons, committed. Every future design question is
a local file read — `npm run figma -- tree "<screen>"` — and no rate limit can take that away.

What the pull changed, beyond retiring most of `docs/FIGMA-FIDELITY-TODO.md`:

- **The home screen is a swipeable card deck, not a scrolling feed.** Three cards stacked, the
  two behind fanned at exactly ±2°. It was built as a vertical feed because nobody could see
  the design.
- **The photo is 5:3, not the 4:5 that was guessed.** Card 342×448, radius 8, three tinted
  drop shadows.
- **The active nav tab is near-black, not brand green**, and the bar sits on the page colour
  with a 1px top border. Green was wrong.
- **`Pink/100` is the liked heart** — the one open question in the token table, now settled.
- **The 53 icons are React components** (`npm run figma:components`), so the text-labelled
  like and comment controls are gone.

**Nothing is in flight — start new work from `main`.** Migrations `012` and `013` are still
**not applied** — see *Do this first*, item 1; that did not change.

**What is still unverified is the parts the design cannot settle.** Three home-screen elements
are blocked on schema rather than on Figma — unread badges, photo location, and the
hide/block/report menu — and they are tabulated in `docs/FIGMA-FIDELITY-TODO.md`. The other
screens (create, thread) still carry their inferred composition; the snapshot can now settle
them cheaply.

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

**`001`–`011` are applied. `012` and `013` are written and are NOT** — the repo and the hosted
schema disagree right now, which this project's own rules call drift. That is the top item
below, not a footnote.

The next actions, in the order they are worth doing:

1. **Apply `012` then `013`, in that order.** `012` is a `create or replace function` and is
   safe. **`013` drops `friendships` and destroys data** — run its pre-flight
   (`select count(*) from public.friendships;`, expect 0) and stop if it is not 0. Both were
   written on 2026-08-04 by a session whose Supabase write tool required an approval it did
   not have; both carry the reason in their headers. The RLS suite already applies the whole
   chain to a scratch database on every PR, so they are verified against the chain — just not
   against production.
2. **Supabase is on the free tier and auto-pauses after ~7 days idle.** A paused project
   serves nothing and there is no alert, so the deployed app goes down silently. This needs a
   card, not a commit, and it will bite at the worst possible moment.
3. **Sweep the orphaned Storage objects** — `npm run storage:sweep` (dry run), then
   `-- --delete`. Two objects, 1.15 MB, left by the `/postcards/new` bug fixed in #21. #24
   shipped the tool; whether it has since been *run* could not be checked from this container,
   which cannot reach `supabase.co`. The dry run is free and settles it.
4. ~~**Pull the Figma snapshot.**~~ **Done 2026-08-04** — see the top of this file. The
   sequence below is kept as the refresh procedure, which is now a *monthly* job.
5. **Verify the remaining Postcards screens against the design.** Home is done and
   screenshotted; `/postcards/new` and `/postcards/[id]` still carry their inferred
   composition, and the design has frames for both (`Create postcard`, `Home - Postcards -
   Postcard details`). This is now a diff, not a re-derivation.
6. **Decide the unread model** — the one product question the home screen is waiting on. The
   design badges each filter tile and calls the deck "all new", but nothing tracks what a
   rider has seen. Either a `postcard_views` table (exact, a row per card seen, marks on
   swipe) or a single `profiles.postcards_seen_at` stamp (cheap, but leaving the screen marks
   everything seen). Until then the badge counts postcards in the feed window, which is the
   same number while nothing is marked seen. **`012` and `013` must be applied before this
   becomes `014`.**
7. **Enable leaked-password protection** — one dashboard toggle, and the only outstanding
   security advisor that is not deliberate.

**The card's overflow menu is the next build, and it is now fully specified.** Still callable
and still called by nothing: `hidePostcard`, `unhidePostcard`, `reportPostcard`, `blockRider`,
`unblockRider`, `deletePostcard`. That is one surface — an overflow menu on a card — rather
than six, and the design draws all of it:

| Frame | What it shows |
|---|---|
| `Postcard options` (`2302:5395`) | The sheet: `Hide postcard for me`, `Block account`, `Report post`, Poppins/16/Medium |
| `Postcard hidden banner` (`2303:6009`) | The confirmation after hiding |
| `Account blocked banner` (`2303:6169`), `Post reported banner` (`2303:6300`) | The other two confirmations |

Build it from those frames, not by extending the old guesses — and use the real icons
(`Hide`, `Block Account`, `Report` are all in `src/components/icons/generated.tsx`). The
"no lookalike substitutes" workaround that made the like and comment controls text-labelled
is retired; those controls now carry their real icons.

**None of the comments UI has been run against the real database.** This container cannot
reach `supabase.co`, so type check, lint, `next build` and 229 unit tests are the whole of its
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

**The `/friends` + `friendships` deletion is half done.** The code half landed: the route,
both components, the Navbar tab, the `Friendship` type, the profile page's friend count and
the RLS fixtures are all gone. The schema half is `013`, which is **written and unapplied** —
so the table still exists in production with nothing referencing it. That is the safe order
for a removal (code first, schema second) and it is not finished until `013` runs.

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

**The home screen has now been compared to the design and rebuilt against it**, including a
screenshot at a real 390×844 viewport. `/postcards/new` and `/postcards/[id]` have not — their
composition is still the *chose:* guesses in `docs/FIGMA-FIDELITY-TODO.md`, and the snapshot
settles them cheaply now.

The guess most worth challenging on the thread screen: **comments live on their own route
rather than inline on the card.** The design has `Home - Postcards - Postcard details`
(`1883:22772`) and a `Comment on a postcard` flow — read those before assuming the shape is
right. It was chosen because `011`'s `revalidatePath('/postcards/${id}')` and the unused
`getPostcard()` were already built for it, which is a reason but not evidence.

## State

| | |
|---|---|
| Migrations | `001`–`011` applied and verified live. **`012` and `013` are written and NOT applied** — see *Do this first*. Ordering note below. |
| Tests | RLS suite **263** assertions (`npm test`) + Vitest **229** tests (`npm run test:unit`). Both measured 2026-08-04; this line said 255/195 and then 263/222. Both gate every PR. Count with `npm test 2>&1 \| grep -c "NOTICE:  ok"` — it read 69 for as long as anyone can tell, and the real number on `main` was 37. |
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

**Built 2026-08-03, populated 2026-08-04.** `scripts/figma/` generates a committed, offline
snapshot under `design/`, read with `npm run figma -- tree "<screen>"`. Both the pipeline and
the snapshot are done. `design/README.md` is the full account.

Two things about reading it that are easy to get wrong, both learned the hard way in the same
session:

- **Hidden layers.** Figma keeps toggled-off layers in the file, so a component instance
  carries every variant slot it does not use — the Home header still *contains* the back
  button it hides. `tree`/`text` now omit hidden subtrees by default; `--all` shows them
  marked `[hidden]`.
- **Rotation is not in the bounding box.** A rotated node reports a larger box, which made the
  fanned card stack read as three differently-sized cards. `rotation` is now carried, in
  degrees, clockwise-positive so it drops straight into CSS.

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

## Figma — refreshing the snapshot

**The pull is done. This section is now the *refresh* procedure — a monthly job, not a
per-session one.** It is kept because the cost model has not changed: `figma:pull` and
`figma:icons` are the only two commands that can be rate limited, and a 429 there is measured
in days.

Run it in order and stop where it says stop:

| # | Command | Cost | What it settles |
|---|---|---|---|
| 1 | `npm run figma:check` | 1 cheap call | Is the snapshot stale? Compares `/versions` against `design/manifest.json` |
| 2 | `npm run figma:check -- --probe` | 7 cheap calls | Every endpoint family, with `Retry-After` per route and the plan tier |
| 3 | **read the output** | 0 | **If `/files/:key` or `/nodes` say 429, STOP — do not pull, do not poll.** Come back after the printed clearing time |
| 4 | `npm run figma:pull` | **expensive** | Only if step 3 is clear. Extracts automatically |
| 5 | `npm run figma:icons` | **expensive** | Re-export the icon set as SVG |
| 6 | `npm run figma:components` | 0 | Regenerate the React icon components from those SVGs |
| 7 | commit `design/` | 0 | The snapshot is worthless to the next session unless it is committed |

Step 2 is what makes this deliberate rather than hopeful, and it is cheap precisely because
the limit is **per endpoint family** — `/versions` and `/me` stay green through an outage on
`/nodes`, which is why the probe can answer "is the door open" without touching the door.

**On 2026-08-04, after the plan upgrade, all seven probed 200** — including the two that had
been 429 with a multi-day `Retry-After` the day before. So the upgrade did clear the running
countdown, which was genuinely unknown until it was tested. The pull cost one request and
returned 27.4 MB.

### Two things the upgrade did not fix

- **The library is unpublished**, so `/styles` and `/components` return 200 with empty bodies.
  That is a publish action inside Figma, not a plan gate. Not blocking, and the pull proved
  it: 87% of fills reference a named style and those names ship in the `styles` map of every
  node response, which is where `design/tokens.json` comes from.
- **The MCP server is still the wrong path.** `design/README.md` settled this — refresh over
  REST on a PAT. Do not spend a pull through MCP tool calls.

**The 429 carries `Retry-After`, and it is in seconds.** Measured 2026-08-03 by sampling it 61
seconds apart and watching it fall by 64 — a real countdown, not a constant, and requests
neither reset nor shorten it. This retired a belief repeated in three files and costing real
time: windows do **not** "last hours". The live header said **69 hours**.

Two lessons still stand: **the limit is per endpoint family**, so one 429 is never evidence
about another route; and **when both routes to design data are shut, stop and say so** rather
than eyeballing values off a screenshot.

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

- ~~**`terms_accepted_at` is not protected.**~~ **Written as `012`, not yet applied.** The
  guard pins the stamp once set and replaces the client's value with server time on the first
  write, so it cannot be cleared, back-dated, or chosen. Five assertions cover it. The
  *second* half of this item still stands: if email confirmation is ever switched on
  (decision #6), `signUp` loses its live session and the consent write is refused outright.
  The action checks its result; nothing yet retries it.
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
  `/friends` is not restyled, it is **deleted**. Signed off 2026-08-02 and **carried out**:
  the code half is gone, and the table drop is `013`, written and awaiting apply. See the
  half-done note in *Do this first*.
- **The design's home is Postcards** — and as of 2026-08-04 it is built to the design: a
  swipeable card deck with a rider/club filter bar at `/postcards`. `/dashboard` is gone.
- **Inbox and Garage have no routes and no tables.** The schema is `profiles`, `rides`,
  `ride_members`, `clubs`, `club_members`, plus `postcards`, `postcard_likes` and `blocks`
  from `009` and `postcard_comments`, `postcard_hides` and `postcard_reports` from `011` —
  so postcards, blocking and moderation now have tables, while messages and
  garage still have nothing. (`friendships` is still there too, until `013` applies; nothing
  reads it.) Most of what is left is `data` → `feature`, not CSS.
  (This bullet claimed "nothing behind postcards … or blocks" for a while after `009` landed
  and contradicted §Do this first twenty lines above it. Re-read both before trusting either.)

**Suggested order.** The ratings are impact on shipping a product that matches the design.

| # | Work | Impact | Notes |
|---|---|---|---|
| ~~1~~ | ~~`design-system` — login primitives~~ | — | **Done.** Button, Input, Checkbox, Pagination, AppBackground, plus Header, Navbar and the 53 icons as of 2026-08-04. Retiring the last `lucide-react` imports goes with the v1 pages |
| ~~2~~ | ~~Login epic~~ | — | **Shipped** — PR #8 |
| 3 | Restyle the 12 existing routes v1 → v2 | 4/10 | Only `app/(app)/*` remains v1 now |
| ~~4~~ | ~~**Postcards / Home**~~ | — | **Built to the design 2026-08-04.** What is left is the overflow menu and the unread model, both listed in *Do this first* |
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
