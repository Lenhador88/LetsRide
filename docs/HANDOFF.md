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

**Nothing is in flight — start new work from `main`.** Migrations `012` and `013` were applied
on 2026-08-04, so **the repo and the hosted schema agree for the first time since `011`**.

**What is still unverified is the parts the design cannot settle.** Two home-screen elements
are blocked on schema rather than on Figma — **unread badges** and **photo location** — and
they are tabulated in `docs/FIGMA-FIDELITY-TODO.md`. This line used to name a third, the
hide/block/report menu; that was wrong on both counts. It was never blocked on schema —
`009` and `011` created every table it needed — and it was **built on 2026-08-05**. The other
screens (create, thread) still carry their inferred composition; the snapshot can now settle
them cheaply.

Read `CLAUDE.md` first. It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles, and the canonical Supabase project.
This file is only the *current position* — the things that will be stale in a week.

## Which design to build from — read before starting any screen

**The file annotates every epic with a status, and it is the best planning signal in
it.** 67 epic covers, 40 of them `Done`. Read it with:

```bash
npm run figma -- ls "Annotation / Epic Cover"     # then tree one for its status
```

**Two traps, both live:**

- **The 🟠-prefixed sections are the OLD stylesheet, not a newer iteration.** `🟠 List of
  rides`, `🟠 Ride details as host`, `🟠 Ride details as participant`, `🟠 Garage`, `🟠 v4`
  are drawn in `Grey (OLD)/*` with un-prefixed `Component / *` instances. The `Rides / *`
  sections beside them use `v2 / Component / *` and are marked `Done`. Their "In progress"
  status makes them look *newer* than the Done v2 flows; they are not. Decision #4 stands —
  build from the `v2 /` sections and ignore these.
- **Status does not track what is built.** `Home / View all new postcards` is marked
  `In progress` and has been built (2026-08-04); `Rides / View all rides` is marked `Done`
  and has not. Treat `Done` as "the designer considers this settled", which is exactly what
  you want before spending a day on it — not as a build log.

Worth asking the product owner: whether the 🟠 sections are dead explorations that can be
deleted from the file, and whether the `In progress` on the Postcards flows means more
change is coming to the screen just built.

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

**What the shell can and cannot reach — measured 2026-08-05, not inherited.** The previous
version of this paragraph said `supabase.co` was blocked; the product owner granted it on
request, and it is now open. Re-measure rather than trust this table — each line is one
`curl -o /dev/null -w "%{http_code}"`:

| Host | From the shell | Meaning |
|---|---|---|
| `*.supabase.co` | **401** | **Reachable.** 401 is the correct answer to an unauthenticated REST call, not a block |
| `*.vercel.app` | `CONNECT tunnel failed, 403` | Still blocked at the proxy. Use the Vercel MCP tools |
| `api.github.com` | 200 on `/`, **403** on `/repos/...` | Effectively refused. Use the GitHub MCP tools |

A blocked host fails as `curl: (56) CONNECT tunnel failed` — **not** as a timeout or an empty
body, so a check that "returns nothing" is telling you something. The distinction matters:
a silent `curl` loop looks identical to a passing one only if you throw the exit code away.

## Running the app against the real database — done 2026-08-05, and it found two bugs

**A session can drive the whole app from this container.** It had never been done; the first
attempt found two defects that every green CI run had missed. The recipe, because each step
cost a wrong diagnosis first:

1. **`.env.local`** — write `NEXT_PUBLIC_SUPABASE_URL` plus the anon key from the Supabase MCP
   `get_publishable_keys`. It is gitignored (`git check-ignore -v .env.local` to be sure).
2. **`NODE_USE_ENV_PROXY=1 npm run dev`** — **the one that matters.** Node's `fetch` ignores
   `HTTPS_PROXY`, so every server-side Supabase call fails with a proxy page (`Host not
   in…`) while `curl` succeeds. The app surfaces that as "That email and password do not
   match an account", which reads like a credentials problem and is not one. Node 22 supports
   the flag; `--use-env-proxy` works too.
3. **A rider.** Supabase's email validator **rejects `.test` *and* `example.com`** at
   `/auth/v1/signup`, so signup cannot be exercised without a domain you own — which is also
   why `duskrider` could only ever have been created by SQL. Insert into `auth.users` with
   `crypt(...)`, and **set `confirmation_token`, `recovery_token`, `email_change` and the
   other token columns to `''`, never NULL** — GoTrue scans them into non-nullable strings
   and a NULL turns every login into "do not match".
4. **Playwright**: `npm install --no-save playwright-core` (leaves `package.json` and the
   lockfile alone), `executablePath: /opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

**`qa-verify@letsride.test` / `QaVerify-2026-Aa1!`** is the account this created —
`efc542b8-8286-48eb-8b16-26b652e43d5a`, onboarded as `verify24321868`. Acceptable only
because the app is **not live**; delete it before launch:
`delete from auth.users where email = 'qa-verify@letsride.test';`

**One trap in the harness, not the app: Chromium in this container cannot reach
`supabase.co` at all, and `--proxy-server=$HTTPS_PROXY` does not fix it.** An earlier version
of this paragraph said it did; it does not. Measured 2026-08-05 while building the club image
upload:

- `<img>` fetches of signed URLs fail `net::ERR_ABORTED`, so every photo renders blank.
- **`XMLHttpRequest` to Storage hangs and never settles** — neither `onload` nor `onerror`
  fires — so any upload started from a browser here sits on "Uploading…" forever. That looks
  exactly like an application bug and is not one.

The same requests succeed from the shell: an upload returns **200**, a signed URL returns
**200 with bytes**. So **verify browser-initiated uploads with `curl` against the live
project**, and treat a hung upload in Playwright as the harness. What *can* be checked in the
browser is that the page renders the right signed URL into the DOM, which is the half the
server owns.

---

## Do this first

**`001`–`014` are applied. There is no drift.** `014` went in on 2026-08-05, *before* its
PR merged rather than after — the ordering mattered, because `/profile` selects all three of
the things it adds and would have 500'd for every rider in the window between. Every number
its footer predicts was confirmed live; see CLAUDE.md §Supabase Rules for the list.

The next actions, in the order they are worth doing:

1. ~~**Apply `012` then `013`.**~~ **Done 2026-08-04.** `013`'s pre-flight returned **0 rows**,
   so nothing was destroyed — that settled the open question of whether the deleted
   `SearchRiders.tsx` "Add" button had ever written a friendship. It had not. Every number
   `013`'s footer predicts was confirmed live: `to_regclass` NULL, 0 friendships policies,
   total 40 -> 36, every policy still `to authenticated`, `anon` still holding zero grants,
   and the advisors reporting no new findings.
2. **Supabase is on the free tier and auto-pauses after ~7 days idle.** A paused project
   serves nothing and there is no alert, so the deployed app goes down silently. This needs a
   card, not a commit, and it will bite at the worst possible moment.
3. **Drop `profiles.avatar_url` in `015`.** Measured against the live project on
   2026-08-05: **0 of 3 rows carry a value.** The column has never been written by this
   repo, `014` replaced it with `avatar_path`, and the evidence the drop needs now exists.
   It is a coordinated change — the column is in `PUBLIC_PROFILE_COLUMNS`, in the `Profile`
   and `PublicProfile` types, and is the fallback `resolveAvatarUrls` writes into — so it
   wants its own migration plus those edits, which is exactly why it was not bolted onto
   `014`.
4. **Sweep the orphaned Storage objects** — `npm run storage:sweep` (dry run), then
   `-- --delete`. Two objects, 1.15 MB, left by the `/postcards/new` bug fixed in #21. #24
   shipped the tool; whether it has since been *run* could not be checked from this container,
   which could not reach `supabase.co` at the time. **It can now** — the dry run is free
   and settles it.
5. ~~**Pull the Figma snapshot.**~~ **Done 2026-08-04** — see the top of this file. The
   sequence below is kept as the refresh procedure, which is now a *monthly* job.
6. **Verify the remaining Postcards screens against the design.** Home is done and
   screenshotted; `/postcards/new` and `/postcards/[id]` still carry their inferred
   composition, and the design has frames for both (`Create postcard`, `Home - Postcards -
   Postcard details`). This is now a diff, not a re-derivation.
7. ~~**Decide the unread model.**~~ **Decided and built as `015`, 2026-08-05.** Neither option
   this line offered survived: `profiles.postcards_seen_at` cannot express a badge *per club*,
   which the club list draws, and `postcard_views` is the only shape whose storage grows as
   riders × content, with an anti-join per badge and a pruning job this project has no cron
   for. `feed_reads` is a **per-audience watermark** instead — one row per (rider, audience
   joined), bounded by membership rather than by content. The product owner's call on what it
   counts was **any activity**: postcards plus rides.

   What is left of this item is the **postcard side**. `015` created the app-wide row shape
   (`club_id is null`) and nothing writes it yet, so the filter tiles still count postcards in
   the feed window. That is now a screen's worth of work, not a schema decision — and the
   `nulls not distinct` constraint the app-wide row depends on is already in place and
   asserted.
8. **Enable leaked-password protection** — one dashboard toggle, and the only outstanding
   security advisor that is not deliberate.

~~**The suggested next build is the rides list.**~~ **Built 2026-08-04** — `/rides` is v2, from
the measured design, with the three filters (`Your rides`, `All rides`, one tile per club).
It needed **no migration**, as predicted. What it left behind:

- **`getRides()` did not exist.** This file said it did. `src/lib/data/rides.ts` is new — the
  v1 page queried Supabase inline, which is what made the next point invisible.
- **The v1 page filtered `.eq('is_public', true)` in application code, and that was a bug.**
  The `rides` SELECT policy already unions public with "organised by you" and "in a club you
  belong to", so the filter *subtracted* from it: a member of a private club could not see
  their own club's rides. Fixed by deleting the filter. Worth checking `/clubs` for the same
  shape — it has a known "private clubs are unreachable" defect below that smells identical.
- **The `List / Ride` image strip has no data behind it** — no image column, no coordinates.
  It renders as the design's container plus the location pin. That and eight other gaps are
  registered in `docs/FIGMA-FIDELITY-TODO.md` §Rides list; three of them are questions for
  the designer, not tasks.
- **`--color-maybe` (`#E58F17`) is the first colour in `globals.css` with no Figma style name
  behind it.** The design attaches no paint style to the Maybe pill. Flagged for the designer.

Still v1 and still carrying the `text-white` legibility defect: `/rides/new` and `/clubs/*`.
`/rides` cleared its own, `/rides/[id]` cleared its own on 2026-08-04, and `/profile` cleared
its own on 2026-08-05 — see the entries below.

~~**The next build is the ride detail page.**~~ **Built 2026-08-04** — `/rides/[id]` (Ride
plan) and `/rides/[id]/crew`, from the measured design. **No migration**, as predicted. What
it left behind:

- **The detail is four sub-pages and two are built.** The header carries a *dropdown page
  switcher*, not tabs — `v2 / Component / Context Menu` as a bottom sheet over a `Grey/70%`
  scrim. CLAUDE.md's "Plan/Journal/Crew tabs" had the right three and the wrong mechanism,
  and it is four, not three: **Chat is the header's chat-bubble button, not a menu row.**
  Journal needs `postcards.ride_id` plus an audience decision (`club_id` currently *is* the
  audience); Chat needs the whole Inbox epic. Both are omitted from the menu rather than
  offered as dead rows.
- **`No` needed no migration.** `ride_members.status` is `check (status in ('going','maybe'))`
  and `No` deletes the row. The Crew design draws only `Going` and `May be going`, which is
  the same fact from the other side. The cost: a decline and a non-answer are
  indistinguishable, so "who said no" is a migration if anyone ever wants it.
- **Blocking needed nothing.** `009` already put `private.is_blocked` on both the `rides` and
  `ride_members` SELECT policies, so the crew roster inherits it. Adding an application-side
  filter would have repeated the exact `is_public` subtraction bug this file records twice
  above — worth noticing that the *right* action was to write no code.
- **Two design tokens were missing from `globals.css`.** `Grey/10` (`#E5DACF`) — which is a
  **different token from `Grey/10%`** (`#0000001A`) despite the name, and is the RSVP track
  and this screen's hairlines — and `Accent Brand/110` (`#338059`), the "Ride host" label.
- **Two more AA failures, measured:** the host label is 4.10:1 and the unselected RSVP label
  4.17:1, both under the 4.5:1 bar and neither large text. Same palette-wide problem the rides
  list surfaced, on a second screen. Left as drawn, remedies costed in
  `docs/FIGMA-FIDELITY-TODO.md` §Ride detail.
- **`max_riders` has never been enforced** — not by the action, not by a policy, not by a
  trigger. Since `001`. The ride plan does not draw capacity so nothing here changed, but the
  column is a promise the database does not keep.
- **`formatRideDate`/`formatRideTime` already existed** and the compiler caught the duplicate.
  This is the same trap as the `getRides()` line above, one epic later: check before adding.

**The contrast numbers above cost three attempts to get right.** Two were written from memory
into a code comment and were wrong by a full point each — once in the direction that would
have let a failure ship as a pass. The lesson is narrow and mechanical: **compute the ratio,
then write the sentence.** Never the other way round.

**`reviewer` ran before the merge this time, and found seven things — none of them a data
leak.** That is the second epic running where the RLS reasoning held under audit and the real
defects were elsewhere, which is worth knowing when deciding where to spend review attention.
The shape of them:

- **Two were numbers that disagreed with each other.** "N riders going" counted `maybe` RSVPs,
  so the detail page and the crew page contradicted each other one tap apart. The fix was to
  delete the count, not correct it — it also required an unbounded roster read.
- **Two were claims in comments, again.** A doc naming `.pt-header-sub`, a class that does not
  exist under that name; and `24/36 measured` written over a `text-2xl` that renders 24/32.
  The second was the more valuable catch: `text-xl` and `text-2xl` were **missing from the
  `@theme` scale entirely**, so every screen using them had been silently rendering Tailwind's
  stock 20/28 and 24/32 against a design asking for 20/30 and 24/36. A ride-detail review
  found an app-wide defect.
- **One was dead code that contradicted its own docs** — `HeaderAction`, exported with zero
  callers, stubbing the control the file said was deliberately not stubbed.
- **Two were accessibility.** `role={error ? 'status' : undefined}` never announces, because
  the live region has to exist *before* its content changes. And `ContextMenu` listed an
  inline-arrow `onClose` in its effect deps, so the effect re-ran every render and re-fired
  `focus()`.

**Three findings I had already self-fixed before the review landed**, which is the argument
for reading your own diff rather than waiting: the organizer being offered an RSVP the crew
page would contradict, unconditional padding for a conditional bar, and invented `ContextMenu`
surface. **The `reviewer` agent is worth its cost anyway** — it found the type-scale bug, which
I would not have.

**The `reviewer` agent was run over the merged diff and found four real bugs, all since
fixed.** Worth recording *what kind* they were, because the pattern repeats: none was a data
leak — the RLS reasoning held when checked against the live policies — and three of the four
were **bounds**, not logic. The filter bar counted tiles over the list's page size, so a club
whose soonest ride sorted 31st lost its tile entirely (the same "unreachable" defect the same
PR was fixing, from the other direction); `myRideIds` put every joined ride id into an
`id.in.(…)` that would 414 at a few hundred; and `?club=` reached `.eq()` unparsed, so a stale
link took down the tab. The fourth was a **claimed** fact: a contrast ratio written from
memory rather than measured.

Two lessons, both cheap to reuse:

- **A comment asserting a safety property is a claim about state**, and gets the same
  treatment as one — `RideFilters` said tiles "can never offer a filter that yields an empty
  list", which was false the moment a filter was active. Wrong comments are worse than none:
  the next agent trusts them. Two more in that change said the card's padding was `4/4/4/16`
  when the code correctly used right-16, which would have had someone "fix" working code.
- **Run `reviewer` before merging, not after.** All four fixes needed a second PR because the
  first had already landed. The squad order in `CLAUDE.md` puts `reviewer` before `PR` for
  exactly this reason.

**#37 fixed four defects on the merged ride detail, three of them reported from a real
iPad.** Worth reading for *how they were found*, because none of the four was visible from
inside this container:

- **The map panel was invisible.** `bg-border/40` computes to `#0000000a` — 4% black, which
  over the cream background is **1.09:1 against the page**. Not an iPad bug; blank
  everywhere, and only noticed on a device someone was actually holding. **The whole class of
  defect — "renders, compiles, passes CI, cannot be seen" — has no gate in this repo.** A
  real device on the deployment is the only thing that catches it.
- **Its deeplink highlighted rather than routed.** `maps/search/?api=1&query=` drops a pin
  and stops; `maps/dir/?api=1&destination=…` with no `origin` routes from the rider's
  position. The distinction is one word in a URL and there is no way to notice it without
  tapping the thing.
- **The tap target was the 100×20 chip, not the 358×160 panel that looked like one.**
- **Every ride date and time rendered in UTC.** The `formatRide*` helpers run in server
  components, so a 20:00 Amsterdam departure was drawn as 18:00 — on the screen where the
  hour is the fact a rider acts on. `APP_TIME_ZONE` in `lib/utils.ts` pins them to
  `Europe/Amsterdam`, as a documented **interim**: the correct model is wall-clock at the
  meeting point, which needs a zone column on `rides`. The viewer's zone was rejected, not
  overlooked — server and client would render different strings, i.e. a hydration mismatch
  on every ride card.

**`TZ=UTC` in `vitest.config.ts` is why the tests agreed with a two-hour error.** The
environment asserting the behaviour was the one hiding the bug, and every assertion was
"correct" in it. That is the sharper version of this file's existing lesson about claims:
**a test can be as wrong as a comment, and it is more convincing.** The new assertions check
the CET *and* CEST offsets and that the date rolls with the clock, which UTC formatting
cannot fake.

**A plausible mechanism is not a verified one.** The first version of #37 blamed Safari's
`color-mix()` support for the blank panel — Tailwind v4 genuinely does compile opacity
modifiers to `color-mix(in oklab, …)`, and Safari genuinely did not ship it until 16.2. The
story was coherent and wrong. Grepping the *built* CSS showed the static hex sits **outside**
the `@supports` guard, so a browser without `color-mix()` still gets the fill. It cost one
`npm run build` to check and would have shipped as a fact nobody rechecked. Third entry in
this file's running tally of confidently-stated wrong claims, and the first caught before the
commit rather than by review.

**The cover image, avatar upload and Countries landed on 2026-08-05 (#39, migration `014`).**
Three of the five gaps #38 registered. What is worth carrying forward:

- **The avatar signing fan-out is the part that breaks quietly.** Nine components render an
  avatar and every one reads `avatar_url`, so `resolveAvatarUrls` writes the signed URL *into
  that field* rather than adding a second one — one promise at the render layer, one place
  that knows about paths. **Nine call sites** — count with
  `git grep -c "await resolveAvatarUrls(" -- src/` rather than reading a number here, which
  is the rule this line broke: it said "five" while enumerating seven, and the two it missed
  (`collageAvatars` and the v1 club page) were exactly the two that were not signing. Miss one and avatars fall back to
  initials on that screen only, which looks like a design choice rather than a bug.
- **Flags are emoji, not assets.** `NL` → 🇳🇱 is arithmetic on the country code, so ~40 SVGs
  and a sprite pipeline became one function. It does not render on Windows, which is stated
  in `lib/countries.ts` and in the fidelity log rather than discovered later.
- **The RLS suite caught a real thing.** An assertion from `010` required
  `storage.objects` to carry exactly 3 policies; `014` adds 6 more. Bumping the number to 9
  would have been the wrong repair — the assertion's intent is "no leftover policy to OR
  against the others" for ONE folder, and a whole-table count stops testing that the moment
  a second surface lands. It is now scoped by policy name.
- **The test harness does not use the production identity idiom.** My first assertions set
  `request.jwt.claims`, copied from `014`'s own verification footer. `harness.sql`'s
  `auth.uid()` reads `test.uid`. The GUC I set was read by nothing, `auth.uid()` returned
  NULL, and the profiles policy's `username is not null` arm then made every row visible —
  so a *positive* assertion written that way would have passed while proving nothing. Only
  the negative ones failed, which is what surfaced it.

**`/profile` is v2 as of 2026-08-05 (#38), and it is the last page-level v1 screen outside
`clubs/*` and `/rides/new`.** What it settled, and what it deliberately did not:

- **Four whole sections are drawn and omitted** — Badges (`7/42`), Countries (`22/195`),
  Motorcycles and Gear. Each needs its own table, and Badges needs more than a table: a rules
  engine deciding what earns one. They are omitted rather than rendered as empty headers
  reading `0/42`, which would state a fact about the rider where the truth is a fact about
  the app. `bike_model` is **one text column** standing in for the Garage, not an
  implementation of it.
- **The design has no edit screen at all.** `View your profile` draws the profile;
  `Login / Onboarding` draws the fields being filled in the *first* time; nothing draws
  changing them later. The edit form's placement is therefore invented, and flagged as such.
- **`getCurrentProfile()` and `getFeed`'s rider filter both already existed.** The timeline
  needed no new data function. That is the **third** time this repo has nearly rebuilt
  something it had — after `getRides()` and `formatRideDate`. The habit worth forming is
  `ls src/lib/data/` before writing a read, not after.
- **`profileEditSchema` omits `username` and `avatar_url` on purpose.** Renaming is a flow
  with a uniqueness conflict path, not a form field; avatar upload is `media` agent work.
- **`bio` and `bike_model` have no CHECK constraint** — `001` declares both bare `text`, so
  their length limits live only in the Zod schema the action parses. `location` has none
  either, which a comment in this diff got wrong before review caught it: the only database
  rule touching `location` is `003`'s trigger refusing the *completion stamp* while it is
  NULL, which bounds neither length nor content.

**The `reviewer` agent found nine things and none was a data leak — the third epic running.**
Worth knowing where the defects actually were, because the pattern is now three for three:
two were live-region and pending-state bugs in new client components, one was a heading that
read "Rides" over a motorcycle (the app's own noun for a *trip*, one tap from a tab of that
name), one was a count capped at `FEED_PAGE_SIZE` presented as a total, and **four were stale
claims in `CLAUDE.md`, this file and `FIGMA-FIDELITY-TODO.md`**. Documentation is now
reliably the largest category, which is an argument for editing it in the same commit rather
than after.

**A count command can be wrong in the direction that never resolves.** The lucide retirement
item specified `grep -rl lucide-react src/ | grep -v generated`, which matches *prose* — so
the profile page's own comment saying it no longer uses the library counted as an importer.
The command could never have reached 0 while any such comment existed. It now greps for the
import statement. Same class as the `NOTICE: ok` count that read 69 against a real 37.

**Both RSVP pills fail WCAG AA and it is now a live question for the designer** —
`#E58F17` with white is 2.54:1 and `Accent Brand/100` with white is 3.52:1, against a 4.5:1
requirement (12px semibold is not "large text"). The green one is used well beyond this
screen, so it is a palette-wide issue the rides list merely surfaced. Both left exactly as
drawn; remedies costed in `docs/FIGMA-FIDELITY-TODO.md` §Rides list.

**All of `/clubs/*` is v2 as of 2026-08-05, across `015` and `016`.** The list, Explore,
Create club, and the club detail's four sub-pages. What is worth carrying forward from the
second half:

- **The design says public clubs are Post-MVP, and the schema says otherwise.** `View not
  joined public club` carries the note *"Public clubs are Post-MVP. Until then we only have
  private clubs"* and is On hold; `View private club` is Done. But `clubs.is_public` defaults
  to **true** in `001`, and `/clubs/explore` — an epic marked **Done** — exists to browse
  exactly the clubs the note says do not exist yet. The create form now defaults to private;
  the column default is untouched. **This is a question for the product owner, not a
  decision I should have made alone.**
- **There is no v2 design for Create club or Edit club.** That epic reads **To do** and the
  frames are OLD-stylesheet throughout — zero `v2 / Component / *` instances. The composition
  that shipped is the v2 primitives applied to the fields that already existed, and it is
  flagged as ours in the component, the page and the fidelity log. Expect to move things when
  the designer draws it.
- **The v1 Create club frame draws two whole features, not fields:** member invitations with
  a `(Pending)` state, and an Admin role distinct from owner. `club_members.role` has had an
  `admin` value since `001` and nothing has ever written it. Both omitted.
- **Club image paths are keyed on the uploader, not the club.** `club-avatars/<owner uid>/…`,
  because at create time the club row does not exist yet, so a policy keyed on club id would
  refuse the upload that has to happen first. A CHECK ties the path back to `owner_id`, which
  is what the folder name alone could not.
- **`getRides` already took a club filter.** The club Timeline and Rides sub-pages needed no
  new read. That is the **fourth** time this repo has nearly rebuilt something it had, after
  `getRides()` itself, `formatRideDate` and `getCurrentProfile()`. `ls src/lib/data/` before
  writing a read.
- **The upload could not be exercised from this container**, and that is a harness limit
  rather than a defect — see the note under §Running the app. The server half *was* verified
  against the live project with `curl`.

**The club list is v2 as of 2026-08-05, and `015` came with it.** `/clubs` is two sub-pages
behind the header dropdown — `Your clubs` and `/clubs/explore` — built from the measured
design. What it left behind, and what is worth knowing before the next clubs screen:

- **The migration was the interesting half, and the shape argument is in `015`'s header.** A
  watermark stores the *decision*; a views table stores the *evidence*. The second grows as
  riders × content and turns every badge into an anti-join; the first is bounded by
  membership and reads through an index `009` already created. It is both the cheaper option
  and the one that survives ten thousand riders, which is unusual enough to be worth the
  paragraph it gets there.
- **The cost is stated rather than discovered:** a watermark expresses "everything older than
  T is read", and the deck is newest-first, so a rider who swipes three of twelve has read a
  *prefix* no timestamp can represent. The rule that makes it honest is that the watermark
  advances only when a surface is finished — which is what the deck already does.
- **`rides` had no indexes at all**, not one, since `001`. The badge's rides half would have
  been a sequential scan on every Clubs load. Worth checking the other tables the same way.
- **Club cover and avatar images are drawn and not built, deliberately.** Adding
  `avatar_path` / `cover_image_path` with no upload screen renders the same empty container
  *and* plants the dead column `014` had to remove from `profiles`. They size with
  Create/Edit club, where the upload lives and where the storage policy needs an ownership
  lookup rather than `014`'s folder-equals-uid shape.
- **Two Explore designs exist and the newer-looking one is on hold** — `Explore clubs` (row
  list) is Done, `Explore clubs v2` (2-up grid) is On hold. Position in the file is not
  status; the epic cover is.
- **Running it found two defects CI cannot see**, both the "renders, compiles, cannot be
  seen" class: the cover placeholder's icon sat *under* the overlapping avatar, and the
  initials avatar was translucent enough to show the container through it. Neither is a type
  error, a lint error or a failing test. That is now three sessions running where opening the
  page was the only thing that caught them.
- **A comment of mine claimed this retired the last client-side write. It did not** —
  `/clubs/new` and `/rides/new` are both `'use client'` and still write directly. Caught
  before commit by running the grep instead of trusting the sentence, which is the same
  lesson this file already records twice.

~~**The card's overflow menu is the next build.**~~ **Built 2026-08-05.** Trust & safety was
RLS-complete and UI-absent — a rider could not block or report anyone. **Four** of the six actions now have a caller — `hidePostcard`,
`reportPostcard`, `blockRider`, `deletePostcard`, all from the card's menu. **`unhidePostcard` and `unblockRider` are still called by nothing**, and
that is the real remaining gap: hiding and blocking are one-way from the UI. There is no
"hidden postcards" or "blocked accounts" screen in the design either, so undoing either
requires a frame before it requires code.

What it settled, and it is worth knowing before designing anything else moderation-shaped:

- **The design collects no report reason.** `Home / Report post` is marked Done and has four
  frames with no reason step. The standing TODO said "verify the six reasons once the
  snapshot is captured"; the answer is there was never anything to verify against. Every
  report now lands as `other`, so `011`'s `reason` column carries no signal. **A question for
  the designer**, written up in `docs/FIGMA-FIDELITY-TODO.md` §Postcard overflow menu.
- **No row in the sheet is destructive-toned**, including `Block account`. The `Type=Warning`
  variant exists in the component set and the design does not use it here.
- **Delete is not drawn at all** — the sheet is for someone else's postcard. It was added on
  the product owner's explicit call, with a two-tap confirm that is ours because the design
  has no confirmation pattern anywhere to copy.

`ui/Banner.tsx` is new and reusable — the confirmation toast the three banner frames draw.

**None of the comments UI has been run against the real database.** This container cannot
reach `supabase.co` *at the time*, so type check, lint, `next build` and 230 unit tests were the whole of its
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

~~**The `/friends` + `friendships` deletion is half done.**~~ **Finished 2026-08-04.** The code
half landed earlier — route, both components, the Navbar tab, the `Friendship` type, the
profile page's friend count and the RLS fixtures. The schema half was `013`, now applied
against zero rows. Code first, schema second, is the safe order for a removal, and it is the
order this took.

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
| Migrations | **`001`–`016` all applied and verified live** (`015` and `016` on 2026-08-05, before their PR merged). No drift. This cell once read "no drift" while §Do this first said the opposite three hundred lines above — if the two ever disagree again, the section is the one being edited and this cell is the one being missed. Ordering note below. |
| Tests | RLS suite **317** assertions (`npm test`) + Vitest **321** tests (`npm run test:unit`). Both measured 2026-08-05 **after merging `main`**, which is the only number worth writing down: two sessions landed work the same morning (the postcards overflow menu, and `014`) and each measured its own branch, so both were right and neither was the total. This line said 255/195, then 263/222, 263/229, 263/230, 263/246, 263/251, 263/261, 263/269, 263/279 and 263/281. Both gate every PR that can affect them — see CLAUDE.md §Branching & CI, which is now path-scoped. Count with `npm test 2>&1 \| grep -c "NOTICE:  ok"` — it read 69 for as long as anyone can tell, and the real number on `main` was 37. |
| Workflow | OpenSpec adopted: `/opsx:propose` → `apply` → `archive`. Rules in `openspec/config.yaml`. |
| Design | **The snapshot is populated** (`design/`, 2026-08-04) — read it, never the API. v2 tokens, Poppins, light theme, the login primitives, Header, Navbar and the 53 icons all landed. `--text-display` is correct — the style it maps to does exist; see the correction below. |
| Spec | `docs/specs/login-onboarding.md` — 25 questions, all with defaults. The data-layer build took the defaults for Q1–Q9, Q11, Q13, Q14, Q23. |
| Squad | Nine agents in `.claude/agents/`. |
| CI | Green, and **path-scoped as of 2026-08-04**: a `changes` job diffs the merge base and skips `Type Check, Lint & Build` for docs/design-only PRs and `RLS Policy Tests` for anything not touching `supabase/**`. Pushes to `main` always run both. Job names are unchanged, so the branch-protection rule below still applies. |
| Data | 1 rider, 1 club, 1 ride — all real, created through the deployed app. |

**v1 is gone.** `/rides/new` was the last page carrying it and was rebuilt on 2026-08-05.
The tree now has **zero** `text-white` in `src/app/`, **zero** `lucide-react` importers, and
**zero** client-side `supabase.from()` writes; the dependency is uninstalled, taking runtime
dependencies from nine to eight. Re-derive rather than trust:

```bash
grep -rn "text-white" src/app/ | wc -l
grep -rl "from 'lucide-react'" src/ | grep -v generated | wc -l
grep -rn "supabase.from(" src/app/ src/components/
```

The only `zinc-*` strings left in the tree are two comments describing the migration.

**22 of those `text-white` occurrences are the defect; the other 7 are correct.** This line
used to say "three", which was wrong by an order of magnitude and in the direction that makes
the job look done. White on a dark fill is right in `Button`, `Checkbox`, `FilterTile`,
`RideCard` and the two postcard components. Count the real ones with:

```bash
grep -rn "text-white" src/app/\(app\)/clubs src/app/\(app\)/rides/new | wc -l
```

It read 22 while `/profile` was v1, 17 once it was not, 13 once `/clubs` itself was v2, and
reads **4** now that all of `clubs/*` is — **every one of them is in `/rides/new`**, which is
the last v1 page in the app. `lucide-react` is down to that same single file
(`grep -rl "from 'lucide-react'" src/ | grep -v generated`). `profile` and `clubs` are still in
the paths above only so the command keeps working; neither can contribute now.

The app looks inconsistent on purpose: `/`, `app/auth/*`, `app/onboarding/*`, `app/legal/*`,
`app/(app)/postcards/*`, `app/(app)/profile` and now all of `app/(app)/rides/` except `new/`
are v2, along with the `(app)` shell — its layout and the Navbar migrated on contact when Home
moved to `/postcards`. Clubs and `/rides/new` are still v1 `zinc-*`/`orange-500` and migrate
with their own epics.

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
- ~~**Private clubs are unreachable from `/clubs`.**~~ **Fixed 2026-08-04.** The page filtered
  `is_public` in application code, which *subtracted* from the clubs SELECT policy — that
  policy already unions public with "owned by you" and "you are a member". The read moved to
  `getClubs()` in `lib/data/clubs.ts` and the filter is gone. Found by fixing the identical
  bug on the rides list, which is the argument for the `lib/data/` boundary in one line: the
  two pages carried the same mistake because each wrote its own query. **Unverified against
  the live database** — unverified because the container could not reach `supabase.co` then;
  it can now, so load `/clubs` as a
  member of a private club to confirm it now appears.
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
- **The v1 pages have white headings on a cream background** — `clubs/*` and `/rides/new`.
  Invisible, not merely off-brand. Goes with their migration; count with the command in
  §State rather than trusting a number here.
- ~~**Blocking could skip unseen cards in the deck.**~~ **Fixed 2026-08-05.** `PostcardDeck`
  held a numeric `index` and sliced, which is only correct on an append-only list; a block
  removes cards from the middle. It now holds the **set of ids already swiped past**, so a
  removal cannot shift anything. Worth copying the shape, not just the fix: the bug was
  unreachable until the overflow menu shipped block/hide/delete, and was fixed in the next
  session because that change is what activated it. Write-up in
  `docs/FIGMA-FIDELITY-TODO.md` §Postcard overflow menu.
- **The swipe deck only moves forward.** A swipe in either direction advances, per the product
  owner's description, so there is no way back to a card you have passed except "Start over".
  If a carousel was meant instead, it is one change in `PostcardDeck.tsx`.
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
  the container could not reach `supabase.co` at the time — so it proves nothing about signup itself. The
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

**The agent proxy blocks outbound HTTPS to `vercel.app`. `supabase.co` was unblocked on
2026-08-05 at the owner's grant — see the measured table under *Before you trust this file*.**
Verify database
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
