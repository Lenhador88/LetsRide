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

## D3. VOLATILE, deliberately, in the safe direction

The function performs no write and takes no lock, so `stable` would be a truthful label. It is
`volatile` anyway, because **PostgREST serves a `stable` function over GET** and that would put a live
capability token into the query string of `/rest/v1/rpc/…` — and therefore into the project's request
log, any intermediary's access log, and the browser's history.

`091` reached `volatile` for the authenticated preview by a different route (its entry point may take
`for share`, which Postgres refuses in a non-volatile function). Here the volatility is **chosen
rather than forced**, which is precisely why it needs a comment in the function body: a later session
optimising query plans will otherwise "correct" it and silently move the token into a URL. The spec
requires the reason to live in the function's `comment`, not only in this file.

## D4. A different type and a different cache key, not a widened one

**Chosen: a new type in `src/types/index.ts` with five fields, and its own key in
`src/lib/query/keys.ts`.**

**Rejected: `Partial<RideInviteLinkPreview>`, or making `meeting_point` nullable on the existing
type.** Both make the anonymous projection *assignable* to the authenticated one, so a component
handed the thin object can read `preview.meeting_point`, get `undefined`, and render an empty line
where a reviewer would have expected a compile error. The single most important negative case in this
change — the meeting point never reaching a stranger — deserves to be enforced by the type system and
not only by a SQL column list.

**The cache key is separate for a second, independent reason:** a shared key would let a stranger's
thin row be served to a signed-in rider who navigates to the same token, or the reverse. `keys.ts` is
the contract and an inline key is a bug even when the string is right.

## D5. No town, and no column invented to hold one

Measured, not assumed: `public.rides` has no locality column, and `meeting_point` holds the place
**name** for a picked start (`boundName(placeLabel(place))`) or free text for a typed one. The
vendor's `meta` — *"street and locality, comma-joined"* — is the only locality the app ever sees and
it is discarded at submit.

**Rejected: adding `rides.locality` in this migration and leaving it NULL.** It would be a dead column
that reads as live — `CLAUDE.md`'s own worked example of a trap for the next session — and it would
not make the preview show a town, since nothing would write it.

**Rejected: deriving one.** Truncating `meeting_point` frequently yields the *precise* place, which is
the one thing ruled out; a `security definer` SQL function cannot reverse-geocode; and
`profiles.location` is where the organiser lives, not where the ride starts.

So the spec states the projection as a closed list **plus a town when and only when a column holds
one**, and the unconditional half — never `meeting_point`, never coordinates — does not move under
either answer to Open question #1.

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

What makes the absence acceptable is D-level and belongs in the spec rather than in a comment: **the
projection carries no rider-identifying data beyond the organiser's username.** That is the whole
safety argument, and it is also the reason the projection must stay closed — every field added is a
field disclosed to a blocked rider and to an un-onboarded account.

**The residual is real and is accepted:** a blocked rider can sign out and read the organiser's
username beside a ride title. They still cannot claim, join, reach the crew, the thread or the
meeting point, and they remain invisible in every list. Decision #2 is narrowed for this projection
alone.

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

`114` is **owed, not free** — `docs/reference/migrations.md` §Applied state holds it open for
`113_home_country`'s partner, which must not exist until the home-country bundle is serving. Filename
order equals apply order, so taking it is a real collision rather than a naming quibble.

`tasks.md` 0.2 re-derives the number from `ls supabase/migrations/*.sql` against `list_migrations` on
both projects, because the queue runs two slots and a number written into a proposal is stale before
it is read.
