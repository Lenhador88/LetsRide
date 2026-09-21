# Design — A club's stamps include the photos taken on its own rides

Everything here is read from the repo's migration chain, `src/lib/data/postcards.ts`, the component
tree and the committed `design/` snapshot. **No live database was reachable while this was
written**; counts are re-derived in `tasks.md` §0.

## The accessor, and why each of its three predicates is load-bearing

```sql
create function public.club_stamp_postcard_ids(
  club        uuid,
  before      timestamptz default null,
  page_size   int         default 30
)
returns table (id uuid, from_ride boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id,
         p.club_id is distinct from club as from_ride
    from public.postcards p
   where
     -- (1) THE OUTER CLUB GATE
     private.can_read_club((select auth.uid()), club)
     -- (2) THE TWO ARMS
     and (
       p.club_id = club
       or exists (
         select 1
           from public.rides r
          where r.id = p.ride_id
            and r.club_id = club
            and private.can_read_ride((select auth.uid()), r.id)   -- (3)
       )
     )
     -- (4) 011's postcards SELECT qual, restated verbatim from 062
     and (
       p.author_id = (select auth.uid())
       or (
         not private.is_blocked((select auth.uid()), p.author_id)
         and (p.club_id is null or private.is_club_member(p.club_id))
         and not exists (
           select 1 from public.postcard_hides h
            where h.postcard_id = p.id and h.user_id = (select auth.uid())
         )
       )
     )
     and (before is null or p.created_at < before)
   order by p.created_at desc, p.id desc
   limit least(coalesce(page_size, 30), 100);
$$;
```

### (1) `private.can_read_club(caller, club)` — the outer gate

**It is not redundant, and naming the one rider it excludes is the proof.** For a member it excludes
nobody; for a non-member of a *public* club it excludes nobody, because they can read the club and
its public rides; for a non-member of a *private* club, arm (3) already excludes every ride.

The rider it does exclude is **`083`'s invitee** — a rider invited to one ride of a private club.
`083` added a fourth arm to `rides` SELECT precisely so an invitee reads that ride, so
`can_read_ride` answers **true** for them while `can_read_club` answers **false**. Without gate (1),
that rider calling this accessor for the private club would learn *which of the postcards they can
already see are tagged to a ride of that club* — a correlation with a private club they are not in
and cannot otherwise name.

They cannot reach the club's strip through the UI (`getClub` returns `null` for them, and PD-325's
preview branch draws no postcards), but the accessor is a PostgREST endpoint and the UI is not its
boundary. Gate (1) is what makes "MUST NOT show a non-member anything" true **by construction**
rather than by composition through a screen.

### (2) The two arms, and why the union lives here

`p.club_id = club` is the audience arm — the postcards the club's page shows today. The `exists`
over `rides` is the tag arm.

**`p.ride_id` is readable inside this function and nowhere else.** `062` revoked
`select (ride_id)` from `authenticated`, and Postgres checks the column privilege to filter as well
as to return — which is the entire reason this function exists rather than a client-side
`.eq('ride_id', …)`.

Doing the union here rather than in the client is what gives one `order by`, one cap and one
`before`. `proposal.md` §The two id sets are merged in SQL has the argument.

### (3) `private.can_read_ride(caller, r.id)` per ride

Load-bearing for the **public club** case, which is the one that would be missed. A non-member of a
public club can read the club, so gate (1) admits them — and a public club may hold a ride that is
not public. `022`'s `propagate_club_privacy_to_rides` only rewrites rides when a club goes
*private*, so a public club's private ride is an ordinary, reachable state. Without (3), that ride's
postcards would surface on the club strip to somebody who cannot read the ride.

It also keeps the tag arm's disclosure exactly equal to what the caller could compute by hand:
for every ride they can read, `public.ride_journal_postcard_ids(r)` already returns this set. **The
accessor adds no correlation that was not already reachable one call at a time**, which is what
makes the `from_ride` flag safe — see §The marker names nothing.

### (4) `011`'s postcards SELECT qual, restated

Copied verbatim from `062`, including the shape of its two halves. The author branch is
unconditional there and must stay unconditional here: `009` made it so a rider can never lose their
own photo, including one in a club they left and one they hid from themselves.

**It is load-bearing even though the caller re-reads under RLS.** The re-read stops a postcard from
*rendering*; it does not stop the id from being *returned*, and `062`'s own comment is that the
correlation is the payload. Without (4) the accessor would tell a reader that a postcard they cannot
see exists and belongs to this club's rides — and it would also silently short-page the strip, since
the ids would be spent on rows the second query drops.

**It restates a policy and can therefore go stale**, exactly as `private.can_read_club` and
`private.can_read_ride` do. The suite pins `postcards` SELECT's qual as whole text under
`ride_journal_postcard_ids`' name already; `086` adds the same pin under this function's name, and
task 5.2's failure message says to move both.

### `from_ride` is computed, not stored

`p.club_id is distinct from club` — true exactly when the row reached the result through the tag arm
and not the audience arm. A postcard that is both (club-scoped **and** tagged to one of the club's
rides) reads `false`, which is correct: it is already the club's postcard, and marking it "from a
ride" would say something the reader cannot act on.

`is distinct from` rather than `<>` because `p.club_id` is nullable and `null <> club` is null.

## The marker names nothing

**Decided: the stamp says "from a ride" and does not say which ride.** No second accessor, no ride
id, no ride title.

The alternative — a badge naming the ride — needs a postcard → ride read, which `062`'s column
comment describes as *"absent rather than merely awkward"* and prices at *"a call per visible
ride"*. Building it means either a second accessor returning `(postcard_id, ride_title)` for a set
of postcards, or widening the grant. A ride **title** is a string the reader must be entitled to,
so the accessor would restate `rides` SELECT for a third time in this codebase; a raw ride uuid is
literally the thing `062` revoked.

**What it costs, stated plainly:**

- A rider seeing a marked stamp cannot tell which of the club's rides it came from, and cannot
  navigate to that ride from the stamp. Tapping the stamp opens the postcard popup, which does not
  name the ride either.
- The marker therefore answers "why is this here" and not "where was this". Given that the strip is
  scoped to one club, "one of this club's rides" is most of the answer.
- The cheap upgrade path, if the owner wants the ride named later, is a **third** accessor
  (`club_stamp_ride_titles(club uuid)` returning `(postcard_id, ride_title)` for the same gated set)
  rather than a change to this one — so nothing here forecloses it.

### Why the flag itself discloses nothing new

The flag says: *this postcard, which you can already see, is tagged to a ride of this club, which
you can already read.* Both halves are already reachable — gate (3) means every ride contributing to
the tag arm is one the caller can read, and for such a ride
`public.ride_journal_postcard_ids(ride)` already returns exactly which visible postcards are tagged
to it. The accessor saves the caller N calls; it tells them nothing N calls would not.

**That is why returning the boolean is not an inversion of `062`.** `062` refuses postcard → *ride*.
This returns postcard → *"is in this club's ride set"*, a property of the (postcard, club) pair the
accessor already discloses by returning the row at all.

### Where it sits on the stamp

`PostcardStamp` is a `w-32` photo block plus a byline row (`mt-1.5 flex items-center gap-1`:
`Avatar h-5 w-5` + truncated username at `text-2xs font-semibold`).

**The marker goes at the end of the byline row**, `shrink-0`, after the truncated username, as a
`BikeIcon` at `h-3 w-3` in `text-muted`, with an accessible label folded into the stamp's existing
`aria-label` rather than added as a second one.

Not overlaid on the photo: `stamp-edge` is a CSS mask, and the tile's shadow is a
`filter: drop-shadow` chosen so the shadow follows the notched silhouette. An absolutely positioned
child inside the masked span inherits the mask, so a corner badge would be bitten by a perforation
at exactly the corners a badge wants. Not a second line under the byline either: the tile is already
the photo plus one row, and `ClubPostcardCarousel` and `RideJournal` both size their neighbouring
tiles (`Add`, "Nothing yet") against the stamp's total height through `STAMP_TILE_WIDTH` and an
`aspect-square`, so a third row silently misaligns two strips on two screens.

**`fromRide` defaults to false and `RideJournal` does not pass it.** On a ride's own Journal every
stamp is from that ride, so the marker would be on every tile and mean nothing. `PostcardStamp`'s
own header already records that a third caller "should not need a third decision about what a stamp
looks like"; the prop is how that stays true.

**No frame exists.** `npm run figma -- ls` finds no stamp component; `v2 / Component / Postcard`'s
provenance row is `User name · in · Club name` and says nothing about rides. This is assembled from
a measured icon at a measured type scale and it is logged in `docs/FIGMA-FIDELITY-TODO.md`.

## Two boundaries this change does not move

Both are stated because a reader will otherwise assume them, and both are follow-ups rather than
gaps in this change.

**`club_unread_counts()` (`015`, `068`) still counts `club_id`-scoped postcards and threads.** So a
club whose only new photo arrived through a ride shows a new stamp on its strip and **no badge** on
its card. Fixing it means giving that function the same union, which means giving it the same three
predicates, which is a second copy of this accessor's rule inside a `security invoker` function —
`060`'s drift trap. If it is worth doing, the right shape is for the count function to call this
accessor, and that is a change with its own assertions.

**`getPostcardFilters` still derives its club tiles from `row.club`.** A ride postcard with a NULL
`club_id` carries no club, so it appears under no club tile in the postcard filter bar even though
it now appears on that club's strip. Same reasoning; same follow-up.

## Interaction with PD-309

`postcard-audience-follows-its-entry-point` (PD-309, not built) would make a postcard composed from
a ride carry that ride's club as its **audience**, so future ride postcards land in **arm (2)'s
first half** and the tag arm stops doing work for them.

It does not make this change redundant, and the three reasons are worth writing down because
"PD-309 covers it" is the plausible wrong summary:

1. **Postcards already posted.** PD-309 cannot rewrite `club_id` on existing rows — that is a
   visibility change to somebody else's published photo — so every postcard taken on a club ride
   before PD-309 ships is reachable only through the tag arm, for ever.
2. **A postcard on a club's ride composed from Home.** PD-309 changes the *default* audience for the
   ride entry point. A rider who opens the composer from Home, or who picks a different club, still
   produces a postcard tagged to the ride with a different `club_id`. The tag arm is the only thing
   that finds it.
3. **The marker.** PD-309 provides none. A postcard whose audience *became* the club through PD-309
   is indistinguishable, to `getClubFeed`, from one posted to the club directly — which is why
   `from_ride` is computed from `club_id` rather than from the presence of a tag, and why after
   PD-309 those postcards correctly read `false`.

**Whichever lands second re-measures how much of the filter still does work**, with one query rather
than an argument:

```sql
select count(*) from public.postcards p
  join public.rides r on r.id = p.ride_id
 where r.club_id is not null
   and p.club_id is distinct from r.club_id;
```

That is the size of the tag arm's exclusive contribution. If PD-309 lands first and that number
stops growing, this change's arm becomes a backfill for history; if this lands first, PD-309's
author should run it before claiming the arm is now redundant.

## Questions Closed

**Q1 — Does the marker name the ride? (product owner; NON-BLOCKING)**
Default: **no**. §The marker names nothing has the cost and the upgrade path. Non-blocking because
naming it later is an additional accessor, not a rewrite of this one.

**Q2 — Does `getFeed`'s club filter move with `getClubFeed`? (agent's, recorded)**
Answered: **yes, and it must.** `proposal.md` §The defect this change would introduce. The
alternative — giving `getClubFeed` its own key — makes the strip and its own `See all` legitimately
show different lists, which is worse than the bug it avoids.

**Q3 — Does the club's unread badge count ride postcards? (product owner; NON-BLOCKING)**
Default: **no**, stated as a boundary. §Two boundaries this change does not move.

**Q4 — Is `BikeIcon` the glyph? (product owner; NON-BLOCKING)**
Default: **yes** — it is the Rides tab's own glyph (`src/components/layout/Navbar.tsx`), so it
already means "ride" everywhere else in this app. No frame exists either way.

**Q5 — Does the marker appear on the ride Journal too? (agent's, recorded)**
Answered: **no.** Every stamp there is from that ride, so a marker on all of them carries no
information and costs a row of the tile's width.
