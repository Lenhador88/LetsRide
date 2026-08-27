# Design — postcard audience follows its entry point

Every policy and grant quoted here was read off **DEV (`fpmrimzxadewsaiwpsel`) on 2026-08-27**
with `pg_policies` and `information_schema.column_privileges`, not off a migration file. Where a
migration and the live database disagree, the database is what shipped.

---

## D1 — The three predicates this change turns on, as they actually are

**`postcards` SELECT:**

```
author_id = auth.uid()
or ( not private.is_blocked(auth.uid(), author_id)
     and (club_id is null or private.is_club_member(club_id))
     and not exists (select 1 from postcard_hides h
                      where h.postcard_id = postcards.id and h.user_id = auth.uid()) )
```

**`postcards` INSERT (`with check`):**

```
author_id = auth.uid()
and (club_id is null or private.is_club_member(club_id))
and image_path like 'postcards/' || auth.uid() || '/%'
and (ride_id is null
     or (exists (select 1 from rides r where r.id = postcards.ride_id)
         and private.is_ride_crew(ride_id)))
```

**`rides` SELECT:**

```
organizer_id = auth.uid()
or ( not private.is_blocked(auth.uid(), organizer_id)
     and ( (is_public and (club_id is null or private.is_club_public(club_id)))
           or (club_id is not null and private.is_club_member(club_id)) ) )
```

Three things worth reading twice, because a shortened version of each circulates:

- **The postcards SELECT policy has a third conjunct**, the `postcard_hides` test. A postcard a
  viewer has hidden is invisible to them regardless of audience.
- **The postcards INSERT policy has four conjuncts, not two.** The `image_path` prefix and the
  `ride_id`/`is_ride_crew` gate are part of it. So the ride tag is **already** gated on crew
  membership, independently of the club.
- **The rides SELECT policy is `022`'s, not `004`/`005`'s.** It carries a block arm and
  `private.is_club_public`, so `is_public` alone has not been enough to read a ride since
  2026-08-05.

**`ride_id` appears in the INSERT policy and in no SELECT predicate anywhere.** That asymmetry is
the whole architecture: the ride decides *who may write the tag*, the club decides *who may read
the row*.

## D2 — Why the chain is resolved at insert and never walked at read

The rider's mental model is postcard → ride → club. Implementing it literally means a SELECT policy
that resolves `ride_id` to a ride and that ride to a club, which is wrong for two independent
reasons.

**It would put `ride_id` into an audience predicate**, which `062` spent a whole migration taking
out of even the SELECT *grant*: the raw uuid is comparable, so a viewer who can resolve neither the
ride nor its crew could still group postcards by it. Putting it back into a policy is strictly
worse than putting it back into a grant.

**And the chain moves.** `rides.club_id` is `ON DELETE SET NULL`, and `authenticated` holds
`update (club_id)` on `rides` — measured 2026-08-27, the UPDATE list being `club_id, departure_at,
description, geocode_confidence, is_public, latitude, longitude, map_card_path, map_detail_path,
meeting_point, route_description, start_place_id, timezone, title`. So the organizer can move a
ride between clubs, and deleting a club nulls it. A policy walking the chain would mean:

- a club deleted → every postcard tagged to its rides silently becomes app-wide
- an organizer moving a ride → other riders' postcards move audience with it

Neither is a thing anybody asked for, and neither would produce an error anywhere. **The row
stores its own `club_id`.** That is `009`'s original design — *"There is no `is_public` flag; this
column IS the audience"* — and this change makes the composer honour it rather than changing it.

## D3 — The refusal, and why it cannot be a silent widening

A **public** ride may carry a `club_id`. `022` forbids the *private*-club case; it says nothing
about a public club, so a public club's ride is readable by every signed-in rider through the
`is_public and is_club_public(club_id)` arm, and `ride_members` INSERT requires only that the ride
be visible. `041`'s own header records the consequence in advance:

> **What this gate is NOT.** For a public ride, crew membership is one RSVP away … So it is a real
> boundary for private-club rides and for blocked riders, and for a public ride it is an opt-in
> rather than a wall.

So: **crew ⊅ club members.** A rider who RSVPs to a public club ride is crew, passes
`private.is_ride_crew`, and fails `private.is_club_member`. Copying the ride's club onto their
postcard returns `42501`.

**Three responses are possible and the owner chose the third.**

1. Post it app-wide instead (`club_id` NULL). **Silently widens** the audience past what the rider
   was told, and past what the ride implied.
2. Post it with no ride tag. Loses the thing they came to do, quietly.
3. **Refuse, and explain.** The owner's choice, on the injection argument in `proposal.md`.

**The refusal must not be today's error.** `src/lib/actions/postcards.ts` returns
`{ error: 'Could not post that. Try again.' }` for every failed insert. For this refusal that
sentence is *false* — retrying cannot succeed, in this session or any other, because the rider is
not a member of the club and no screen in the app offers to make them one from here.

**The state must be reachable before the submit, not only after it.** The composer knows the ride,
the ride's `club_id` and the rider's own clubs at render time. A refusal surfaced only as a failed
POST spends an upload — the image is already in Storage by the time the form submits, which is
`uploadPostcardImage`'s whole design — and the orphaned object is not cleaned up.

**The permanence has to be said out loud.** `authenticated` holds UPDATE on `postcards` over
exactly `caption, club_id, image_path`. **`ride_id` is not in that list** (`041`, and `046` owns the
operative list). So there is no later remedy: a postcard posted from Home cannot be tagged to a
ride afterwards, and a refused rider loses that ride's journal permanently. That is the accepted
cost, recorded here so it is not discovered as a bug.

## D4 — The clubless coupling, and the landmine under it

The rule is *clubless ⇒ public*, and it is single-table, so a CHECK expresses it:

```sql
alter table public.rides add constraint rides_clubless_ride_is_public
  check (club_id is not null or is_public);
```

**Pre-flight, DEV 2026-08-27:** 15 rides, 8 with a `club_id`, **0** private clubless rides. It adds
cleanly. Re-measure PROD before applying — the same query, and the same caution `022`'s header
gives about how short the free window is.

### The landmine

`rides.club_id` is **`ON DELETE SET NULL`**. So deleting a club rewrites `club_id` to NULL on its
rides — and a ride that was club-private (`is_public = false`, which is the *new default* for a
club ride) would then violate the constraint and raise `23514`, taking the club deletion down with
it.

**Today's paths, in order of what they do:**

- **`public.delete_owned_club(uuid)` (`043`)** deletes the club's `is_public = false` rides *with*
  the club, precisely so they are not left detached and unreadable. Those rides never reach the SET
  NULL, so the constraint never fires. **This path stays clean.**
- **`private.transfer_owned_clubs` (`029`/`031`)** deletes a club's rides with the club when nobody
  is left to inherit it. Same shape; verify.
- **A bare `.delete()` on `clubs`.** The DELETE policy is still `auth.uid() = owner_id` and the
  grant still exists. `docs/reference/schema.md` already warns this is the wrong way to delete a
  club, because it detaches every private ride by SET NULL and leaves it visible to its organizer
  alone with its crew list and chat unreadable. **With the constraint, that path stops silently
  orphaning and starts loudly refusing.**

**Recommendation: ship the CHECK.** The one path it breaks is the path the schema documentation
already calls a bug, and it converts a silent data defect into a `23514` that points at the RPC.
But it is question **B** rather than a decision made here, because it changes the failure mode of a
delete a rider can still reach, and `data` should confirm the RPC and the transfer function both
pass before it applies.

**Whatever is chosen, it is a database rule and not a form default.** `authenticated` holds
`update (is_public)` and `update (club_id)` on `rides`, so an organizer editing a ride can produce
the private-clubless state directly. A `defaultChecked` on a checkbox is not an invariant.

### Interaction with `022`

`022`'s trigger refuses `is_public = true` on a ride whose club is private, and
`propagate_club_privacy_to_rides` sets `is_public = false` on a club's rides when the club turns
private. Both write rides that **have** a `club_id`, so the new constraint's first disjunct is
satisfied and neither can trip it. Assert that rather than reason it — the two rules pull in
opposite directions and the space where they meet is exactly one row.

## D5 — What the composer's copy must not be able to say

`resolveLocationCopy` is the model this change copies: a pure function that computes the sentence
from **what will actually be written**, split into its own module so it has a tripwire, because a
composer whose copy describes a row it will not write is the one defect on that screen that cannot
be seen by looking at it.

The audience line needs exactly that treatment, because it has five states and three of them are
states where the obvious string is wrong:

| Entry point | Resolved `club_id` | The line must say |
|---|---|---|
| Home | NULL | every signed-in rider sees it |
| A club the rider is in | that club | only that club's members see it |
| A ride with no club | NULL | every signed-in rider sees it — **not** "the crew", which is what the rider will assume |
| A ride in a club the rider is in | the ride's club | only that club's members see it — **not** "the crew", which is a different and larger set |
| A ride in a club the rider is **not** in | *nothing is written* | the refusal, with why |

**Rows three and four are where a plausible string is false.** "Everyone on this ride will see
this" is wrong in both directions: a clubless ride's postcard is visible to every signed-in rider,
far beyond the crew; a club ride's postcard is visible to the whole club, which includes members
who are not on the ride, and **invisible to crew who are not in the club** — the exact riders row
five refuses.

**State the audience, not the source.** Product owner: *"Only &lt;club&gt; members see this"*, not
*"Club postcard — &lt;club&gt;"*.

## D6 — The asymmetry a ride journal will show, and it is correct

A public club ride is visible to every signed-in rider. Its journal is not.

`ride_journal_postcard_ids(ride uuid)` (`062`) is `security definer` and holds the `ride_id` column
grant, but it returns **ids and never rows** — so RLS still decides every postcard that renders,
and the postcards SELECT policy's club conjunct removes the club-only ones for a non-member.

So a non-member viewing a public club ride sees the ride, sees the crew, and sees an **empty or
partial journal**. That is correct and it is the intended shape. It must be stated in the spec,
because it looks exactly like a bug and the natural "fix" is to widen the postcards policy — which
would publish a club's journal to everyone who can see one of its rides.

## D7 — What this change is forbidden from touching

- **`ride_id` in any SELECT predicate or grant.** `062`.
- **`ride_id` in any UPDATE grant.** `041`/`046`.
- **`private.is_ride_crew` as a sole conjunct anywhere new.** It is `security definer` with
  `search_path = ''`, so inside it there is no RLS at all: it will confirm the crew row of a rider
  who has blocked the organizer or who left the ride's private club. `041`'s header measured both.
  It is used **in intersection** with a visibility test, never alone.
- **Any application-side audience filter.** The policy is the enforcement. Removing a `<select>`
  removes a control.
- **`private.is_club_member` as a fan-out recipient test.** It resolves `auth.uid()`, so it is
  caller-relative (`036` trap (c)). If any notification work follows this change, it needs
  `private.is_club_member_for` (`060`).
- **Anything shaped for a future "friends" concept.** `013` dropped `friendships`; reintroducing it
  is a separate owner decision and this change assumes nothing about it.
