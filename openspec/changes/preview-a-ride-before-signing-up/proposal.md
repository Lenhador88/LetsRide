# Preview a ride before signing up

> Linear **PD-430**. This file is the specification; the issue is the decision and the reason.

## The one thing the build must settle before it writes a line

**The migration is `115`, and `tasks.md` 0.2 re-derives it rather than trusting this sentence.**
`supabase/migrations/` holds 114 files and the last is `114_a_completion_carries_a_country.sql`
(measured 2026-09-08), so `115` is the next free number. *Filename order equals apply order*, which
makes a taken number a real collision rather than a naming quibble, and the queue runs two slots —
so 0.2 re-derives from `ls supabase/migrations/*.sql | tail -3` against `list_migrations` on DEV
(`fpmrimzxadewsaiwpsel`) **and** PROD (`zwprydcyryvudhurbnye`).

## What was read first-hand, and what was not

**Everything below is first-hand.** The Linear connector answered: PD-430's body and **all four**
of its comments were read directly. The Supabase connector answered: DEV was read live for
`public.rides`' column list and for the applied migration ledger. `091` was read from the migration
file in this repo — its `ride_invite_link_preview` column list, its `reachable_by` conjuncts and
its header are quoted from that file, not from prose about it. `111` and `069` were read the same
way; `src/lib/data/ride-invite-links.ts`, `src/app/rides/join/page.tsx`,
`src/components/rides/RideInviteJoin.tsx`, `src/lib/auth/guard.ts`, `src/lib/validation/rides.ts`
and `supabase/tests/harness.sql` were read from the working tree. The `ride-invite-links` base spec
was read from `openspec/changes/share-a-ride-invite-link/`. The design snapshot was read offline
with `npm run figma -- ls "Join ride"` and `text … --all`.

**The owner's decision that this revision implements is second-hand to this file**: it was taken in
chat and reaches these artifacts through the spawning message. The Linear issue and the PR body
carry it, and the main thread writes both.

## Why

**The one growth loop the product already has is spent on a blank form.**

`RIDE_JOIN_PATH` is in `PUBLIC_PATHS` today, and the comment beside it is unambiguous about the
scope of that opening:

> **It is public so it can HOLD a credential, never so it can SHOW anything.**

That was the right call for `091`, which had no anonymous read to offer. Its consequence is that a
rider who has never heard of Let's Ride, tapping a link in their crew's group chat, gets a signup
form with **no ride on it** — no date, no place, no organiser, nothing about what they are being
asked to join. They are asked to create an account to find out what they were invited to.

The `share-a-ride-invite-link` spec states that outcome as a requirement and asserts it:

> With no session the route SHALL render the shell, a generic sentence naming neither the ride nor
> its organizer, and controls to sign in or create an account. It SHALL NOT call either RPC, and
> SHALL NOT render the ride's title, date, meeting point, organizer or crew count.

**This change narrows that requirement rather than deleting it.** Everything it refuses stays
refused except four named fields.

## The safety argument: anonymous ⊂ authenticated, and the subset is read off `091`

**This is the spine of the change and every other section hangs off it.** A signed-out caller
holding a token sees strictly less than a signed-in caller holding the same token already sees,
and the subset relation is measured rather than argued.

`public.ride_invite_link_preview(t)` returns **eight named columns to any token holder, before they
claim anything**: `ride_id`, `title`, `departure_at`, `timezone`, `meeting_point`,
`organizer_username`, `organizer_avatar_path`, `crew_count`. **Its gate is not ride membership.** It
is `private.ride_invite_link_reachable_by`, whose three conjuncts are — in `091`'s own words — *"Live
… AND not blocked in either direction … AND both participation stamps on the caller."*

So the meeting point is **already disclosed to exactly this audience**: somebody holding the token,
who is a member of nothing. And `091`'s header names the threat that gate was written against,
which is not a stranger reading a meeting point:

> without the stamp test an account created by calling GoTrue's `/auth/v1/signup` directly and
> never calling `accept_terms()` — the precise threat `023` exists for — could hold a forwarded
> token and read a private ride's title, meeting point, departure, organizer and crew count.

The gate is about **who is allowed to participate in this app at all**, not about the sensitivity of
the meeting point. What actually stands between a link recipient and the meeting point today is the
forced onboarding wizard — decision #5, plus a home country since `114`. That is friction, not a
boundary, and every link is shared precisely so that its recipients will push through it.

**The anonymous projection is five data fields — `title`, `departure_at`, `timezone`,
`meeting_point`, `organizer_username` — plus the Sign-up call to action, which is UI and not data.**
Every one of the five is in `091`'s eight. **`crew_count` and `organizer_avatar_path` are left out
deliberately**: the owner did not ask for them, and holding the anonymous projection *strictly
inside* the authenticated one is what keeps the safety argument to one checkable sentence. Anyone
wanting either of them anonymously is proposing to widen the subset and owes the argument again.

**What it is not:** it is not a public ride index, not a search surface, and not reachable without
128 bits of secret. There is no route from this function to a second ride, to a rider list, or to
any row a token does not name. **The bound is the link's own lifetime**, which `091` already
enforces: `least(rides.departure_at, created_at + 14 days)`, re-read from `rides` at every use, plus
the organiser's revoke.

## This breaks architectural decision #1, deliberately, and the wording change is owed here

`CLAUDE.md` §Architectural Decisions #1 reads today:

> **1. No anonymous access, anywhere.** No policy grants to `anon`. `is_public = true` means
> "visible to any signed-in rider", never "visible to the internet".

**This is the first deliberate exception in the app's history, and an exception that is not written
down is just a broken rule.** The replacement text this change owes `CLAUDE.md` — written here so
the main thread applies it verbatim rather than paraphrasing:

> **1. No anonymous access, with one named exception.** No table grant and no policy grant to
> `anon`, ever. `is_public = true` means "visible to any signed-in rider", never "visible to the
> internet". **The one exception is EXECUTE on `public.ride_invite_link_public_preview(t)`**
> (`115`, PD-430): a single `security definer` function, reachable only by a 128-bit bearer token,
> returning the title, start time, zone, meeting point and organiser username of exactly one ride —
> a strict subset of what `091`'s authenticated preview already returns to any holder of the same
> token. A second such function, a column added to it, or any grant to `anon` on a table or policy
> is a **new** decision and not an extension of this one.

**What stays forbidden, in as many words:**

| Still forbidden | Why the exception does not reach it |
|---|---|
| Any `anon` grant on any **table** | The exception is EXECUTE on one function. `has_table_privilege('anon', …)` stays `false` everywhere. |
| Any policy naming `anon` | No policy is added, modified or widened by this change. |
| Any second `anon`-executable function | Each would be its own decision with its own negative cases. |
| `anon` EXECUTE on `ride_invite_link_preview` or `claim_ride_invite_link` | Explicitly refused below — the claim stays a signed-in act, and the *authenticated* preview keeps its block check. |
| "Public" meaning readable without a token | The exception is a **credential**, not a visibility class. `is_public` is not consulted by the new function at all. |

## The mechanism, and why the existing preview cannot be reused

**`public.ride_invite_link_preview` cannot be widened, and this is not a preference.** It resolves
through `private.ride_invite_link_reachable_by(t, auth.uid())`, whose three conjuncts are *live*,
*not blocked in either direction*, and *both participation stamps on the caller*. Two of the three
are statements **about a caller who does not exist here**. Granting `anon` EXECUTE on it would not
loosen a check — it would make `is_blocked(NULL, organizer)` and a `profiles` probe for `NULL`
decide the answer, which is a security-critical predicate evaluated against an argument it was
never written for. `091.13` asserts by reading `prosrc` that neither public body restates those
checks; that assertion is what makes the single entry point trustworthy, and it is exactly what
would be quietly voided.

**So: a separate, thinner function, entering the shared logic one level lower.**

```
private.live_ride_invite_link(t)                     ← UNCHANGED, and reused
   ├── private.ride_invite_link_reachable_by(t,uid)  ← UNCHANGED, authenticated only
   │      ├── public.ride_invite_link_preview(t)      ← UNCHANGED, authenticated only
   │      └── public.claim_ride_invite_link(t)        ← UNCHANGED, authenticated only
   └── public.ride_invite_link_public_preview(t)      ← NEW, anon only
```

**The reuse point is chosen and it is the whole reason this is safe.**
`private.live_ride_invite_link` is described by its own comment as *"THE SINGLE DEFINITION OF
'LIVE' … A statement about the LINK alone: it takes no caller and reads no `auth.uid()`."* A
caller-free definition of liveness is precisely what an anonymous path needs, and reusing it means
**every dead-state guarantee `091` proved is inherited rather than re-implemented**: revoked,
expired, ride deleted, ride departed, malformed and never-existed already return zero rows from one
function that never raises. A second liveness predicate written for `anon` would be the drift
`091` and `093` both spent whole sections preventing.

## The projection, and every field that is absent on purpose

`public.ride_invite_link_public_preview(t text)` returns a **fixed list of named columns for
exactly one ride**, never `rides.*`:

| Column | Why |
|---|---|
| `ride_id` | The screen's own identity and cache key. Not a capability — it opens nothing. |
| `title` | The owner's list. |
| `departure_at` | The owner's list. |
| `timezone` | **Inseparable from `departure_at`.** A ride's times are wall-clock at its meeting point (`080`); without `rides.timezone` the only fallback is the viewer's own zone, which `CLAUDE.md` says is never the answer. It is the same instant expressed correctly, not a second fact. |
| `meeting_point` | **The owner's decision, and already in `091`'s authenticated projection for the same audience.** A rider deciding whether to ride needs to know where it leaves from; the token holder could read it today by finishing the wizard. |
| `organizer_username` | The owner's list. |

**Absent, each for a stated reason. The first two are the ones a builder will be tempted by,
because `091` returns them to a signed-in holder of the same token:**

- **`crew_count`** — the authenticated preview returns one; this must not. The owner did not ask for
  it, it is a fact about *riders* rather than about the ride, and it makes the endpoint a
  popularity oracle for anyone holding a token. Leaving it out is also what keeps the projection
  strictly inside `091`'s, which is the whole safety argument.
- **`organizer_avatar_path`** — likewise not asked for, and it could not render anyway: signing an
  avatar URL is `resolveAvatarUrls`' job and `anon` holds no reach into `storage.objects`. Adding
  the column would be a path disclosed for nothing.
- **`latitude`, `longitude`, `geocode_confidence`** — **not** because they are more sensitive than
  `meeting_point`; a machine-readable pin is simply not what a human reading an invite needs, and
  `091` does not return them either. Keeping them out holds the subset.
- **`map_card_path`, `map_detail_path`** — a Storage path, and a tile of the start point. `anon`
  cannot sign a Storage URL in any case (`harness.sql` reproduces Supabase's grants and the suite
  asserts anon's reach into `storage.objects`), so this would be a leak with no render behind it.
- **`club_id`, `is_public`, `description`, `route_description`, `start_place_id`** — the owner's
  decision says **nothing about clubs**, and the rest are not a decision the invitee is making.

**The absence of `club_id` and `is_public` together is what makes club-privacy unobservable**, and
that is a stronger property than filtering: there is no field to infer from.

## Blocking cannot be evaluated anonymously, and this is the decision

**There is no `auth.uid()`, so there is no block check. It is not weakened, simulated or
approximated — it is unavailable by construction**, and pretending otherwise (a NULL passed into
`private.is_blocked`) would be worse than its absence.

**The anonymous reach is therefore one conjunct, not three: the link is live.** No block test, no
participation stamps, because both are statements about a caller who does not exist. That is stated
here rather than left for a reader of the function body to notice.

**The decision: serve the preview anyway.** Stated in full rather than implied:

- The five fields are facts about **a ride**, not about riders. There is no crew, no count, no
  rider id, no second rider, and nothing that says who else is going.
- The one rider-identifying field is **the organiser's username**, which is the fact the sharer
  disclosed by pasting *this organiser's* link into a group chat.
- **The residual, named because it is real and because it grew:** a rider the organiser has blocked
  can sign out, paste a token they hold, and read the ride's title, time, organiser and **meeting
  point**. Under an earlier draft of this change they would have read four harmless fields; they now
  read where the ride leaves from. Decision #2 — blocking enforced in RLS — is narrowed **for this
  projection only**, and it cannot be otherwise: symmetric blocking is a statement about two
  identities and one of them is absent.
- **What the block still holds completely.** The blocked rider **cannot claim** — the claim is
  `authenticated`-only and goes through `reachable_by`'s `is_blocked` conjunct — so they cannot
  join, cannot reach the crew, the thread, the photos or any message, cannot see the organiser's
  other rides or profile, and remain invisible in every list. Signed in, the authenticated preview
  still returns them zero rows.
- **What bounds it.** They must already hold the token, which the organiser or somebody they shared
  it with gave them; it dies at the ride's departure or fourteen days; and the organiser can revoke
  it. It is the same reach any other holder of that URL has, which is the point of a bearer
  credential. **A block is not a mechanism for withholding a shared URL from somebody who already
  has it**, and this change does not pretend otherwise.
- **The participation gate is in the same position** and gets the same answer. `091` gated the
  *authenticated* preview on both stamps for a concrete threat — an account made by calling
  GoTrue's `/auth/v1/signup` directly, never accepting the terms, reading a private ride off a
  forwarded token. That threat is unchanged and the gate is unchanged; what this change adds is a
  strictly thinner projection which that same actor could reach anyway by simply **not signing in
  at all**. Widening `anon`'s reach past the five fields would reopen it.

**This is the argument for keeping the projection closed, and it is why it is a fixed list with an
assertion on it rather than a column list somebody may extend.** Every field added to this function
is a field disclosed to a blocked rider and to an un-onboarded account, and every field added past
`091`'s eight is a field disclosed to somebody no signed-in caller could ever have been.

## The accepted cost: an anonymous read leaves no attributed record

Recorded once, as a cost the owner accepted knowingly, and not as an open question.

Every authenticated use of an invite link is attributable: the claim writes a `ride_invites` row
carrying `link_id`, and the organiser can see who came in through which link. **An anonymous
preview writes nothing and is attributable to nobody** — the organiser cannot know their link was
opened, or how often, or by whom. That is inherent: the whole point is a caller with no identity,
and manufacturing one would mean an IP-keyed or fingerprint-keyed table, which is personal data
with its own retention window and its own visibility decision.

**What bounds it is machinery `091` already built**: the link expires at
`least(rides.departure_at, created_at + 14 days)` with departure re-read at every use, the organiser
can revoke it at any moment, and the token is 128 bits so the audience is exactly the set of people
the URL was given to. `design.md` D11 records it as an accepted cost.

## Guessability, metering, and the one honest answer

**Entropy is the answer to guessing, and the precedent is explicit rather than inferred.** `091`'s
own header:

> 128 bits, 32 lowercase hex characters. That is treated as sufficient that guessing is not an
> attack, and no rate limit, ledger or lockout is built for the claim path on the strength of
> guessing alone.

That argument does not weaken when the caller is anonymous — 128 bits is 128 bits — and the
function returns **zero rows and never raises**, so it is not an oracle either: a prober learns
nothing that distinguishes a wrong guess from a revoked link from a deleted ride.

**`069`'s metering does not transfer, and the reason is structural rather than a judgement.**
`public.place_search_attempts` is keyed on `user_id references public.profiles(id)`, and both
ceilings (`PER_RIDER_HOURLY`, `PER_RIDER_DAILY`) are per rider. **An anonymous caller is not a
subject**: there is no id to key a ledger on. The only candidate keys are an IP address or a device
fingerprint, neither of which this schema stores, and storing either would add a personal-data
table with its own retention window and its own visibility decision — a larger change than the one
it would protect, made to defend a function that returns four public-by-the-sharer's-choice fields
and writes nothing.

**So this change specifies that no per-caller ledger is built, and says who owns the remainder.**
Volumetric abuse of an unauthenticated POST endpoint is Supabase's platform-level rate limiting,
which sits in front of PostgREST and is not this schema's to write. **`069`'s spend argument does
not apply either**: the search proxy metered a *vendor credit*, and this function calls nothing and
costs nothing but a Postgres index probe.

**If the owner wants more, it is named as Open question #3 (non-blocking) rather than invented
here.** Designing a mechanism the repo has no precedent for is how a change acquires a table nobody
asked for.

## A club-private ride reached by a valid token IS served, and refusing it would be the bug

The tempting answer is to refuse. It is wrong, for two reasons that point the same way:

1. **`091` already decided this for the authenticated preview** and the decision is not reopened
   here: a token reaches its ride *regardless of `is_public`, `club_id` or club visibility*,
   because the organiser minted a link to **that ride** and shared it. The token is the decision.
   What `091` did instead was strip the club from the projection — *"NEVER THE CLUB'S NAME — a
   private club's name is not something a bearer token should disclose"* — and this change strips
   it harder, carrying no `club_id` and no `is_public` at all.
2. **Refusing would build the oracle the whole feature is designed to avoid.** If a club-private
   ride returned zero rows where a public one returned a preview, the endpoint would tell any token
   holder *which class of ride this token names* — a new signal, available anonymously, that does
   not exist today. Serving both identically is what keeps every dead state indistinguishable.

## A past ride's link needs no special case, and that is worth asserting

`private.live_ride_invite_link` carries `now() < r.departure_at`, re-read from `rides` rather than
trusted from `expires_at`. So a departed ride's link is **already dead** and the anonymous preview
returns zero rows for it through the same door as a revoked one. No branch, no second message, and
a stranger can never be shown a ride that has already left.

## The grant follows the token and nothing else — a public ride without one shows nothing

**`is_public = true` still does not mean "visible to the internet", and this change is where that
sentence would be easiest to break.** The new function takes a token, matches on it, and never reads
`is_public` at all. There is no route into it that does not begin with 32 hex characters somebody was
given.

So a signed-out visitor who opens `/rides/join` with **no** token, an **empty** token, or a token
that matches nothing sees exactly what they see today: the generic invite copy and the sign-in /
create-account controls. **A public ride opened without a token is not previewed** — not by id, not
by slug, not by any listing — and there is no endpoint that turns a ride id into a preview. This is
written as an explicit negative case rather than left to follow from the signature, because "it is
public anyway" is precisely the reasoning that would widen it later.

## The signed-out preview SHALL be `noindex, nofollow`

**The authenticated wall was blocking crawlers by accident.** Every route but `/auth/*` and
`/legal/*` needed a session, so nothing a crawler fetched had anything on it; `/rides/join` rendered
a generic sentence. After this change it renders a real ride to an unauthenticated fetch, and the
accident stops covering it. **Make it a stated requirement with its own scenario** rather than
relying on the property that used to hold for another reason.

**Say the exposure accurately.** The token is 32 random hex characters and unguessable, so a crawler
cannot reach a preview by walking the site — there is no link to `/rides/join?token=…` anywhere in
the app or on the marketing site. The realistic path is a **link somebody published**: pasted into a
public forum, a shared Google Doc that gets indexed, a chat export, a Discord channel a crawler
reads. `noindex, nofollow` is what stops that one published URL from becoming a permanently
searchable page naming a ride, its time and its meeting point long after the link itself has died.
It is cheap, it is stated, and it is not a substitute for the token's entropy.

## What Changes

### New

- **`public.ride_invite_link_public_preview(t text)`** — one `security definer` function in `115`,
  `set search_path = ''`, **VOLATILE**, resolving through `private.live_ride_invite_link(t)` and
  nothing else. **EXECUTE granted to `anon` alone.**
- **One `src/lib/data/` read** beside `getRideInviteLinkPreview`, returning a **different, thinner
  type** — not a nullable-field variant of `RideInviteLinkPreview`, because a type whose fields are
  sometimes present is how a screen ends up rendering a crew count or an avatar it was never given.
- **One no-session state on `/rides/join`**, replacing the generic sentence with the preview card
  and a `Sign up to RSVP` call to action.
- **`noindex, nofollow` on `/rides/join`**, stated as a requirement with its own assertion rather
  than inherited from the authenticated wall that used to cover it.

### Changed

- **`CLAUDE.md` decision #1** — the wording above. **The main thread writes this, not a subagent.**
- **The comment beside `RIDE_JOIN_PATH` in `src/lib/auth/guard.ts`** — *"public so it can HOLD a
  credential, never so it can SHOW anything"* becomes false the day this ships, and a comment that
  states the opposite of the code is worse than none. **No behaviour in `guard.ts` changes**:
  `/rides/join` is already in `PUBLIC_PATHS` and already in `needsOnboardingState()`'s set, and
  both stay.
- **`src/components/rides/RideInviteJoin.tsx`'s header — the bigger of the two, and the file this
  change actually edits.** It carries the same claims at length and argues *against* what this
  change does, so leaving it is worse than leaving `guard.ts`'s one line. Four passages go or turn:
  *"with no session it renders a generic sentence naming neither the ride nor its organizer, and
  **calls neither RPC**"*; *"Decision #1 is untouched and no `anon` grant is added to make this
  screen richer"*; the **seven-state** list, which gains one; and the paragraph refusing the
  temptation — *"an invite page naming the ride would convert better… Anyone can hold a URL, and
  the ride may be a private club's."* That last one is the argument being replaced, so it is
  **rewritten rather than deleted**: it should carry the subset argument — that `091`'s
  authenticated preview already returns these five fields to any holder of the same token, so what
  stood in front of them was the onboarding wizard rather than a boundary — and that a club-private
  ride *is* previewed while its class stays unobservable. A reader who finds only the new behaviour
  learns nothing about why the old argument does not apply.

### Explicitly NOT in this change

- **No `anon` grant on any table, and no policy touched.** `public.rides`' SELECT qual and
  `private.can_read_ride` are byte-identical after `115`, asserted the way `091.14` asserts it.
- **`public.ride_invite_link_preview` is not modified, not re-granted and not called by the
  anonymous path.** `private.ride_invite_link_reachable_by` is not modified.
- **`public.claim_ride_invite_link` stays `authenticated`.** Joining is a signed-in act. Nothing
  anonymous writes anything, anywhere.
- **No crew count, no avatar, no map, no coordinates, no club, no description** — see the
  projection table. The projection stays **strictly inside `091`'s eight columns**.
- **No rate-limit table, no ledger, no lockout, no new dependency, no Edge Function**, and nothing
  resembling a service worker, manifest or Web Push.
- **No new column on `public.rides`.** The projection is built entirely from columns that exist
  today, and `115` alters no table.
- **No anonymous route to a ride without a token** — no id lookup, no listing, no search, and
  nothing that consults `is_public`.

## Capabilities

### New Capabilities

- `anonymous-ride-preview`: the app's first and only anonymous read — what it returns, what it must
  never return, why the projection is a strict subset of `091`'s, which role holds EXECUTE and which
  roles must not, why blocking and the participation gate are unavailable rather than skipped, why
  every failure is one outcome, that the grant follows the token and never `is_public`, that the
  page is `noindex, nofollow`, and the exception's exact boundary. Stated per role: the ride's
  organiser, a crew member, a club admin, a club member, a non-member, a **blocked rider in either
  direction**, an **un-onboarded** account, and a **signed-out visitor with** and **without** a
  token.

### Modified Capabilities

- `ride-invite-links` — two requirements become false as written. *A live token SHALL buy exactly
  two RPC calls* becomes three, and its scenario *"A token grants nothing without a session"* is
  the exact statement this change reverses in one narrow place. *The landing route SHALL be public,
  SHALL render no data without a session* keeps its first clause and loses its second; its
  seven-state table gains a populated no-session row.
- `client-session-storage` — its standing requirement is *A signed-out visitor SHALL reach no
  data*, with a scenario asserting *the answer SHALL be to wait for the session, not to grant
  `anon` a read*. That scenario is the general rule and it survives; what it needs is the named
  exception beside it, or the next session reads a spec that forbids what the app does.
- `database-enforced-integrity` — *Every role's reach into a rider's identity SHALL be stated* has
  a **Signed-out visitor** scenario asserting zero rows from `profiles`. That stays true and stays
  measured (it is a **table** grant), but a username now reaches an anonymous caller by another
  route, and a requirement about *every role's reach into identity* that does not mention it is
  wrong by omission.

**`client-render-shell` is deliberately not modified.** Nothing about the render model changes: the
read is still a client-side call through `useQuery` in an effect, and the new state is a seventh
row in a table that already exists.

## Open questions

Each carries a recommended default so the build is not stalled, and says who answers it. **None of
them is blocking**: the projection, the grant and every negative case are settled.

### 1. Does the preview's copy name the app, and what does the CTA do? **Non-blocking — the owner's, with `product`.**

**Default: `Sign up to RSVP`, exactly as PD-430 words it**, routing to `/auth/signup` with the
token still stashed — the existing `pending-token` round trip, unchanged. The question is only
whether a first-time visitor also gets a sentence saying what Let's Ride is, which is
`positioning.md`'s territory and `product`'s to write, not this change's to invent.

### 2. Does the anonymous endpoint need metering beyond the token's entropy? **Non-blocking — the owner's.**

**Default: no, and nothing is built.** The reasoning is in *Guessability* above: 128 bits, zero
rows on every failure, no vendor credit spent, no write performed, and no subject to key a ledger
on. If the owner wants a ceiling anyway, the honest options are Supabase's platform rate limiting
(a dashboard setting, theirs to click) or an IP-keyed table — and the second is a personal-data
table needing its own retention window, which is a change of its own.

### 3. Should the *authenticated* preview also drop its crew count? **Non-blocking — the owner's. Out of scope either way.**

Raised only because this change makes the asymmetry visible: a signed-in token holder sees a crew
count and an avatar, and an anonymous one will not. That is intended — it is what keeps the
anonymous projection a strict subset — but if the count was never wanted on that screen either,
removing it is a one-column edit to `091`'s function and belongs in its own issue.

## Impact

**Database** — one migration (**`115`**, per the note at the top of this file; `tasks.md` 0.2
re-derives it) and new assertions in `supabase/tests/rls_test.sql`. **This proposal writes
neither.** Re-derive the suite size with `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`
and reconcile by **label set**, never by count.

**Sequencing — MIGRATION-FIRST, and the reasoning rather than the conclusion.** `CLAUDE.md`'s rule
asks *which side fails safe*, so both sides are answered:

- *Migration applied, old bundle serving.* The old bundle never calls the new function. `anon` holds
  EXECUTE on one function nothing invokes, and every other object is untouched. **Nothing observes
  it.** Safe.
- *New bundle serving, migration not applied.* Every signed-out visitor's preview call returns
  `PGRST202` (no such function) on the one screen this change exists to fix — the failure lands on
  a stranger's first impression, which is the exact thing PD-430 says does not come back. **Not
  safe.**
- *Does a shipped client WRITE a new column?* No — nothing writes anything. The `PGRST204` hazard
  has nothing to bite on.
- *Does it add a second PostgREST relationship?* No. No table, no foreign key, no new embed path,
  so the HTTP 300 hazard (`092`'s shape) does not arise.
- *Is the client switch exhaustive?* No. The change is purely additive on both sides: no existing
  read, function, policy or grant is removed or narrowed, so there is no destructive half to hold
  until a build is confirmed serving.

**One side fails safe and the other does not, so the order is decided rather than free.** The PROD
promotion carries the same ordering for the same reason. **`115` is additive in every statement**;
it creates one function and grants EXECUTE on it, and drops, alters and revokes nothing.

**The hand-exercise gate does NOT fire.** `115` hangs no trigger on any table and replaces no
function on a live write path. It creates one new object that nothing existing calls, so there is no
shipped write path whose transaction could be taken down by it — the opposite of `091` §5 and `111`
§2, both of which touched live triggers and said so in their headers.

**Security advisors** — **+1 WARN expected, and its exact label is unmeasured.** Every existing WARN
of this class reads `authenticated_security_definer_function_executable`, and **no `anon`-executable
`security definer` function exists on either project today**, so whether Supabase's lint reports the
`anon` grant under that name, under a variant, or not at all is a fact to be read rather than
predicted. `tasks.md` requires `get_advisors(security)` before and after, and records the delta.
**If the advisor does NOT fire, that is a finding to write down**, not a saving: it would mean the
advisor set cannot see the app's only anonymous surface. **+0 INFO** — no table is created, so no
`rls_enabled_no_policy` appears.

**Participation gate** — **+0 triggers**, and the count staying still is the assertion. No table is
created, so there is no `authenticated` writer for a gate trigger to gate. Re-derive before and
after with
`select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal;`.

**Grants** — the `service_role` revoke question does not arise: no table is created, so the
30-kept/3-revoked census is unchanged. Re-run the census in `CLAUDE.md` §Supabase Rules to confirm
rather than assume.

**Reads and writes** — one new function in `src/lib/data/`, no new function in `src/lib/actions/`,
and **no write of any kind**. The new read resolves its client through `resolveSupabase` like every
other module in the directory, is called from an effect through `useQuery`, and gets its own key in
`src/lib/query/keys.ts` — a **different** key from the authenticated preview's, because the two
answer different questions and a shared key would serve a signed-in rider the thin projection or
cache a stranger's row into a signed-in session.

**Types** — one new type in `src/types/index.ts`. Deliberately **not** `Partial<RideInviteLinkPreview>`
and not a widened `RideInviteLinkPreview`: the two projections must be structurally impossible to
confuse, so that a component handed the anonymous one cannot reach for `meeting_point` and find
`undefined` where a reviewer would have expected a compile error.

**Design** — the no-session state of `/rides/join` needs a frame or an explicit ruling that the
existing preview card is reused with the CTA swapped. `npm run figma -- ls "join"` and
`tree`/`text` on the invite landing screens, qualified by flow, **and `--all`**, since a toggled-off
layer is how a control nobody designed ends up on the screen. `design-system` owns that call, not
this change.

**Dependencies** — none added. Twelve runtime dependencies before and after; verify with
`node -p "Object.keys(require('./package.json').dependencies).length"`.

**The walk** — `npm run walk` already opens both invite landing routes signed **in**. It gains one
phase that opens `/rides/join?token=…` **signed out** and asserts the title renders and the string
in `meeting_point` does **not**. That is the only gate in the repo that renders anything, and it is
the only place the absence of the meeting point is checked against a real DOM rather than against a
column list.

**Docs** — `docs/reference/schema.md` gains a `ride_invite_link_public_preview` entry beside the
other three RPCs; `docs/reference/migrations.md` §Applied state gains `115`'s ordering; `CLAUDE.md`
gains the decision #1 rewording and the advisor delta. **The main thread writes all three.**
