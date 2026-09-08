# Design — preview a ride before signing up

Decisions that shaped the artifacts, each with the alternative it was chosen over. `proposal.md`
carries the argument; this file carries the choices a builder would otherwise have to re-make.

## D1. Enter the shared logic at `live_ride_invite_link`, not at `reachable_by`

**Chosen: the anonymous function calls `private.live_ride_invite_link(t)` and nothing else.**

`091` built a two-level split that this change turns out to need exactly:

```
private.live_ride_invite_link(t)          -- about the LINK. No caller. No auth.uid().
private.ride_invite_link_reachable_by(t, uid)  -- about the CALLER. Needs auth.uid().
```

The lower level is caller-free by design and its comment says so. An anonymous path has no caller, so
it enters at the lower level and inherits every dead-state guarantee `091` proved — revoked, expired,
ride deleted, ride departed, malformed, never existed — without restating one predicate.

**Rejected: a self-contained anonymous function with its own liveness test.** It would work on the
day it shipped and drift on the day a liveness rule changed, and the copy that drifts is the one with
no policy underneath it. `091` and `093` each spent a section preventing exactly this; `111` §3
enumerates the five wrong homes for a predicate for the same reason.

**Consequence worth naming:** `private.live_ride_invite_link` gains a second caller and its
`revoke all … from public, anon, authenticated` stays exactly as it is. The anonymous public function
is `security definer`, so it reaches the private helper as the owner. **`anon` never gains EXECUTE on
anything in `private`.**

## D2. `anon` only, not `anon, authenticated`

**Chosen: EXECUTE to `anon`, revoked from `authenticated` and from `public`.**

The obvious grant is both roles — "it is a subset, so it is safe for everyone". It is not. A signed-in
rider who is **blocked by the organiser**, or who **never accepted the terms**, is refused by
`public.ride_invite_link_preview` through `reachable_by`'s block and stamp conjuncts. If the thin
function were also executable by `authenticated`, both riders could call it instead and get the title,
time and organiser anyway — a second door around a gate `091` argued for at length.

It is true that either rider could sign out and call it as `anon`. **That does not make the grant
harmless**: an `authenticated` grant is a path the app's own client can take by accident, and a
reviewer reading `reachable_by` would no longer be reading the only caller predicate that matters.
The narrow grant keeps "who may reach a ride's title while signed in" answerable in one place.

**Cost, accepted:** the client must branch on the session to pick which function to call. That branch
already exists — `getRideInviteLinkPreview` reads `supabase.auth.getUser()` and returns `null` when
there is none.

## D3. VOLATILE, deliberately — and the reason this decision was first written down is FALSE

**Corrected against a measurement taken during the build, 2026-09-08. The decision stands; its
justification did not survive.** As first written, this section said the function performs no write
and takes no lock so `stable` would be truthful, and that it is `volatile` anyway because *PostgREST
serves a `stable` function over GET while a volatile one is POST-only*, so the label keeps a live
capability token out of a URL.

**The second half is not true on this deployment.** Probed against DEV with the publishable key
alone, `GET /rest/v1/rpc/ride_invite_link_public_preview?t=<token>` answers **200** and returns the
full six-column row. The control that proves the method is not what stops it: the same GET against
`091`'s `ride_invite_link_preview` answers **401 / 42501 permission denied** — a privilege error
raised at execution rather than a `405`.

**So what keeps the token out of the query string is the client, not the label.** `supabase-js`'s
`.rpc()` POSTs, and `src/lib/data/` is its only caller. The danger of leaving the old reasoning in
place is not that a session "corrects" the label — it is that a session *trusts* it and concludes
the URL is safe to publish.

The label still stays: it is the safe default for the app's only unauthenticated surface, and it
matches `091`'s three RPCs. `091` reached `volatile` for the authenticated preview by a different
route (its entry point may take
`for share`, which Postgres refuses in a non-volatile function) — **and that half is real**, which
is why `claim_ride_invite_link` could not be `stable` even if someone wanted it to be. Here the
volatility is **chosen rather than forced**, which is precisely why it needs a comment in the
function body. The spec
requires the reason to live in the function's `comment`, not only in this file.

## D4. A different type and a different cache key, not a widened one

**Chosen: a new type in `src/types/index.ts` with six fields — `ride_id` and the five data fields —
and its own key in `src/lib/query/keys.ts`.**

**Rejected: `Partial<RideInviteLinkPreview>`, or making `crew_count` and `organizer_avatar_path`
nullable on the existing type.** Both make the anonymous projection *assignable* to the
authenticated one, so a component handed the thin object can read `preview.crew_count`, get
`undefined`, and render an empty line — or worse, a `0` — where a reviewer would have expected a
compile error. The two excluded columns are what keeps the anonymous projection a strict subset of
`091`'s, so the exclusion deserves enforcement by the type system and not only by a SQL column list.

**The cache key is separate for a second, independent reason:** a shared key would let a stranger's
thin row be served to a signed-in rider who navigates to the same token, or the reverse. `keys.ts` is
the contract and an inline key is a bug even when the string is right.

## D5. The projection carries `meeting_point`, and its bound is `091`'s eight columns

**Chosen: `title`, `departure_at`, `timezone`, `meeting_point`, `organizer_username` — five data
fields, every one of them already in `public.ride_invite_link_preview`'s projection.**

This is the decision the whole change turns on, and the argument is a subset relation rather than a
judgement about how sensitive a meeting point is:

- `091`'s `public.ride_invite_link_preview(t)` returns **eight columns to any token holder before
  they claim**: `ride_id`, `title`, `departure_at`, `timezone`, `meeting_point`,
  `organizer_username`, `organizer_avatar_path`, `crew_count`.
- **Its gate is not membership of the ride.** It is `private.ride_invite_link_reachable_by`: the
  link is live, the caller is not blocked in either direction, and the caller carries both
  participation stamps. Two of those three are statements about *who may participate in this app*,
  and `091`'s header names the threat they were written against — an account created straight
  against GoTrue that never accepted the terms.
- So the only thing standing between a link recipient and the meeting point today is the **forced
  onboarding wizard** (decision #5, plus a home country since `114`). That is friction, not a
  boundary, and every link is shared so that its recipients push through it.

**Rejected: `crew_count` and `organizer_avatar_path` as well.** Both are in `091`'s eight, so
neither would break the subset — but the owner did not ask for them, the count is a fact about
riders rather than about the ride, and the avatar cannot render anyway (`anon` has no reach into
`storage.objects`). Holding the anonymous projection *strictly inside* the authenticated one keeps
the safety argument to one sentence a reviewer can check in `091`.

**Rejected: coordinates and map paths.** Not because they are more sensitive than the string — a
human reading an invite does not need a machine-readable pin, `091` does not return them either, and
including them would put the anonymous projection outside the authenticated one for no product gain.

**The consequence to keep in view:** the projection is now a closed list whose *upper bound* is
`091`'s. A field added past it is disclosed to somebody no signed-in caller could ever have been,
and is a new decision with a new argument owed.

## D6. Serve club-private rides, and carry no club field at all

Two independent arguments land on the same answer, which is why it is a decision rather than a
default:

- **`091` already settled it** for the authenticated preview: a token reaches its ride regardless of
  `is_public`, `club_id` or club visibility, because the organiser minted a link to that ride.
- **Refusing would build an oracle.** Zero rows for a club-private ride and a preview for a public one
  tells any token holder which class of ride their token names — a new anonymous signal, and a direct
  contradiction of the requirement that every failure be one outcome.

Carrying **no `club_id` and no `is_public`** makes club membership *unobservable* rather than
*filtered*, which is the stronger property: there is no field to infer from and no column for a later
edit to leak by default.

## D7. Blocking is unavailable; say so, do not simulate it

`private.is_blocked(NULL, organizer_id)` is not a weaker check — it is a security-critical predicate
evaluated against an argument it was never written for, whose result nobody has reasoned about. The
function does not call it.

**The anonymous reach is one conjunct, not three: the link is live.** That is what the function
computes, it is stated in the spec in those words, and it is why the projection must stay closed —
every field added is a field disclosed to a blocked rider and to an un-onboarded account.

**The residual is real and it is accepted.** A rider the organiser has blocked can sign out, paste a
token they already hold, and read the ride's title, time, organiser **and meeting point** — where
the ride leaves from, which is the part worth stating plainly rather than folding into a field list.

**Why that is a statement rather than a mitigation:**

- **There is nothing to mitigate it with.** Symmetric blocking is a statement about two identities
  and one of them is absent. A NULL passed into `private.is_blocked` is not a weaker check, it is an
  unreasoned one.
- **The reach is the URL's, not the rider's.** They must already hold a token somebody gave them,
  and any other holder of that URL — a stranger in the same group chat — reaches exactly the same
  five fields. Withholding a shared URL from one person who has it is not something a bearer
  credential can do.
- **What the block still holds is everything actionable.** `public.claim_ride_invite_link` stays
  `authenticated`-only behind `reachable_by`'s `is_blocked` conjunct, so the blocked rider cannot
  join, cannot reach the crew, the thread, the photos or any message, cannot see the organiser's
  other rides or profile, and stays invisible in every list. Signed in, the authenticated preview
  returns them zero rows, unchanged.
- **It is bounded in time by machinery that already exists**: `least(departure_at, created_at + 14
  days)`, departure re-read at every use, plus revoke.

**Rejected: refusing the anonymous preview when the ride's organiser has any block at all**, or when
the token's `created_by` does. It leaks the existence of a block to every unrelated stranger holding
the link, it makes a public surface vary with a private fact, and it does not stop the blocked rider
— who can read the same five fields from any other copy of the URL. Decision #2 is narrowed for this
projection alone and for no other surface.

## D8. No metering, and the reason is structural

`069`'s ledger is keyed on `user_id references public.profiles(id)`; both ceilings are per rider. **An
anonymous caller is not a subject**, so there is nothing to key a ledger on. IP or device
fingerprinting would add a personal-data table with its own retention window and visibility decision —
a bigger change than the thing it protects.

`069` metered a **paid vendor credit**. This function calls no vendor and costs one index probe on a
unique constraint, so the spend argument does not transfer either.

`091`'s entropy statement is the precedent and it does not weaken when the caller is anonymous: 128
bits, zero rows on every failure, no error to time against, nothing written.

## D9. Sequencing — migration-first, by asking which side fails safe

Both sides answered rather than the conclusion asserted:

| Order | What happens | Safe? |
|---|---|---|
| Migration first, old bundle serving | `anon` holds EXECUTE on a function nothing calls. Nothing else changes. | **Yes — nothing observes it** |
| Bundle first, migration not applied | Every signed-out preview call returns `PGRST202` on the one screen the change exists to fix — a stranger's first impression, which does not come back. | **No** |

The other three questions the rule asks are all empty here: nothing writes a new column (no
`PGRST204`), nothing adds a PostgREST relationship (no HTTP 300), and nothing is destructive or
exhaustive (no "wait until the build is confirmed serving"). **One side fails safe and the other does
not, so the order is decided rather than free**, and the PROD promotion carries the same order for the
same reason.

**The hand-exercise gate does not fire.** No trigger is hung on any table and no function on a live
write path is replaced, so there is no shipped transaction the migration could take down.

## D10. The number is `115`, and the build re-derives it

`supabase/migrations/` holds 114 files and the last is `114_a_completion_carries_a_country.sql`
(2026-09-08), so `115` is the next free number. Filename order equals apply order, so a taken number
is a real collision rather than a naming quibble.

`tasks.md` 0.2 re-derives it from `ls supabase/migrations/*.sql` against `list_migrations` on both
projects, because the queue runs two slots and a number written into a proposal is stale before it is
read.

## D11. The unattributed read is an accepted cost, not an open question

**Chosen: accept it, record it here once, and build no mechanism.**

Every *authenticated* use of an invite link is attributable — the claim writes a `ride_invites` row
carrying `link_id`, and `091` made the use count derivable from it. **An anonymous preview is
attributable to nobody.** The organiser cannot know their link was opened, how often, or by whom.

That is inherent rather than an oversight: the caller has no identity by construction. The only way
to manufacture one is an IP address or a device fingerprint, and either means a **personal-data table
with its own retention window and its own visibility decision** — a larger change than the thing it
would measure, built to watch a read that returns five fields and writes nothing.

**What bounds the cost is machinery `091` already has**: expiry at
`least(rides.departure_at, created_at + 14 days)` with departure re-read at every use, the
organiser's revoke, and 128 bits of token so the audience is the set of people the URL reached.

**The owner accepted this knowingly when they chose to show the meeting point.** It is recorded as a
cost so a later session finds a decision rather than re-discovering a gap. It is deliberately **not**
an open question — nothing about the build waits on it.

## D12. `noindex, nofollow` is a stated requirement, not an inherited accident

**Chosen: the signed-out preview page declares `noindex, nofollow`, with its own scenario.**

Until this change every route but `/auth/*` and `/legal/*` needed a session, so a crawler fetching
anything got a shell with no data on it. **That protection was a side effect of the authenticated
wall**, and this change removes the wall from exactly one screen. A property that used to hold for
another reason has to be restated as a requirement or it quietly stops holding.

**The exposure, stated rather than assumed.** The token is 32 random hex characters and there is no
link to `/rides/join?token=…` anywhere in the app or on the marketing site, so a crawler cannot walk
to a preview. The realistic path is a **link somebody published** — a public forum, an indexed shared
document, a chat export, a Discord channel a crawler reads. `noindex, nofollow` stops that one
published URL becoming a permanently searchable page naming a ride, its time and its meeting point
long after the link itself died.

**Rejected: relying on the token's entropy alone.** Entropy answers *guessing*; it says nothing about
a URL that was published on purpose. The two defences answer different attacks and the cheap one is
not a substitute for the other.

## D13. The grant follows the token, and `is_public` is never consulted

**Chosen: a public ride opened WITHOUT a token shows a signed-out visitor nothing, and this is an
explicit negative case rather than a consequence of the signature.**

The function takes a token and matches on it. It does not read `is_public`, it has no ride-id
parameter, and there is no listing, search or enumeration endpoint reachable by `anon`. So
`is_public = true` still means *"visible to any signed-in rider"* and never *"visible to the
internet"* — decision #1's second sentence survives this change untouched.

It is written down because *"the ride is public anyway"* is exactly the reasoning that would widen
this later, and because a signed-out visitor is otherwise never granted anything: `openspec/config.yaml`
requires the boundary to be asserted rather than left implied.
