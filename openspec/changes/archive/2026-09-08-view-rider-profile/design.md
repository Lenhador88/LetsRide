# Design — view another rider's profile

## D1 — No migration is needed, and here is the evidence

Measured against DEV `fpmrimzxadewsaiwpsel` on 2026-08-14. This decision is recorded with its
queries because "does the database already allow this" is the question the whole change turns on,
and asserting it without measuring is how a needless migration gets written.

**The `profiles` SELECT policy**

```
Profiles are viewable by signed-in riders  (cmd r, role authenticated)
  using: (auth.uid() = id)
      OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))
```

That is exactly the audience the screen needs: every signed-in rider, minus riders with no
username, minus blocks. **No club-sharing term appears in it.**

**`private.is_blocked` is symmetric**

```sql
select exists (
  select 1 from public.blocks
  where (blocker_id = a and blocked_id = b)
     or (blocker_id = b and blocked_id = a)
);
```

`STABLE SECURITY DEFINER`, `search_path = ''`. One helper, both directions — so the two blocked
scenarios in the spec are one policy term, not two.

**The column grants to `authenticated`**

`id, username, bio, bike_model, created_at, location, avatar_path, cover_image_path` — SELECT
granted. `onboarding_completed_at`, `terms_accepted_at`, `terms_version` — not granted, to any
client role.

The seven columns the screen draws are a strict subset of that grant, so the read works as-is.

**`profile_countries`**

```
Countries are visible to anyone who can see the profile  (cmd r)
  using: EXISTS (SELECT 1 FROM profiles p WHERE p.id = profile_countries.user_id)
```

The subquery is evaluated as the caller, so `profiles` RLS applies inside it and the countries
inherit the profile's audience — including the block term — by composition rather than by
restating it. Correct as written; nothing to add.

**`postcards`**

```
Postcards are viewable by their audience  (cmd r)
  using: author_id = auth.uid()
      OR (NOT private.is_blocked(auth.uid(), author_id)
          AND (club_id IS NULL OR private.is_club_member(club_id))
          AND NOT EXISTS (hide row for this viewer))
```

So the timeline needs no visibility logic of its own.

**Conclusion: no migration, no policy change, no grant change.** The change is entirely client
code plus one projection decision.

## D2 — `?id=` rather than `?username=`

Both are viable: `056`/`057` made usernames case-preserving with case-insensitive uniqueness, so a
username URL would resolve deterministically.

Chosen `?id=` for three reasons, in order of weight:

1. **A username is mutable.** `database-enforced-integrity` permits a rider to change it and only
   forbids returning it to NULL. A username URL therefore rots on rename — and worse, after a
   rename plus a re-registration of the freed name, an old link resolves to a *different rider*
   with no error anywhere.
2. **The id is already in hand.** `PUBLIC_PROFILE_COLUMNS` carries `id`, so every byline can build
   the link with no extra read. A username route would need no extra read either, but see 1.
3. **Consistency.** All ten existing detail routes take `?id=`, and `routes.ts` exists precisely
   so link shapes are not invented per screen.

The cost is an unreadable URL. That is acceptable here because the app ships as a static bundle in
a native shell where the URL is not a user-facing surface, and because `routes.ts` §Why the id is
a query parameter already priced exactly this trade for rides, clubs and postcards.

**A stale or wrong `id` renders not-found**, identically to a blocked or nonexistent one — see D4.

## D3 — Self-view redirects to `/profile`

`/profile/detail?id=<own id>` redirects rather than rendering read-only.

Rendering it read-only would mean two screens drawing the same rider, which diverge — and the
design's other-profile header carries an Options button (block/report) and a Follow button, both
nonsensical aimed at yourself. Redirecting keeps exactly one owner surface.

The comparison uses the session id, which the guard cache already holds, so the redirect is
decided **before** the profile read is issued rather than after it answers. `/profile` already
establishes the pattern of a client page calling `redirect()`.

## D4 — One not-found state, for six different reasons

Blocked either way, no username, nonexistent, deleted, malformed id, and a valid id whose row RLS
withholds all render the same state. This is `client-render-shell`'s *A blocked rider sees an
ordinary absence* applied literally: any variation between these cases turns the route into an
oracle for testing whether a rider exists or whether a block is in place.

This is the one place where the standing spec **already decided** the question, so the new spec
complies rather than re-deciding — noted because the alternative (a distinct "unavailable" copy
for the blocked case) is the intuitive design choice and is wrong.

## D5 — A third column allowlist, not a widened `PUBLIC_PROFILE_COLUMNS`

`PUBLIC_PROFILE_COLUMNS` is `id, username, avatar_path, bike_model` — insufficient, since the
header draws a bio, a cover and a location.

Three options were considered:

- **Widen `PUBLIC_PROFILE_COLUMNS`.** Rejected: it is used by ride organizers, ride crew, postcard
  bylines and the filter tiles, none of which draw a bio. Widening it ships a bio and a cover path
  to every list that renders a name.
- **Reuse `OWN_PROFILE_COLUMNS`.** Rejected on naming rather than on safety — it is exactly the
  grant list, so it would not fail, but a constant named "own" reading someone else's row is how
  the next reader concludes the two are interchangeable. It is also pinned by
  `columns.test.ts` with `toEqual(granted)`, and that assertion should keep meaning what it says.
- **A third constant, `VIEWED_PROFILE_COLUMNS`.** Chosen. Named for the surface, asserted as a
  *subset* of the grant rather than an equality, since it deliberately omits `bike_model`'s
  Garage-adjacent role only if the header does not draw it.

The new assertion is a subset check plus the stamp check; `OWN_PROFILE_COLUMNS`' existing equality
assertion is untouched.

## D6 — The timeline is in the first cut

The single frame the design gives for this flow **is** the scrolled timeline state, so a
header-only first cut would ship the one state the design does not draw.

It is also nearly free: `getFeed` has taken `{ kind: 'rider', id }` since the home screen shipped,
`filterSegment` already builds the key, and the `postcards` policy already scopes the rows per
viewer. The marginal work is a second `useQuery` and an empty state.

**One caveat carried into the spec:** the frame's postcards are authored by *different* riders
(Pedro Abreu, Julia Windfield), which is filler content rather than a specification — the timeline
on a rider's profile is that rider's postcards. Building the frame literally would produce a feed.

## D7 — Follow, followers and motorcycles are specified as absent

The header draws `Follow`, `1.2M followers` and `3 motorcycles`. None has a data source, and the
first two have a *deliberately removed* one: `013` dropped `friendships` and CLAUDE.md names this
exact failure mode — *"A dropped table gets designed back in by exactly this route: prose that
still names it."* A design frame is that prose.

They are written into the spec as things that SHALL NOT be rendered, rather than omitted from it,
because an unstated absence is indistinguishable from an oversight to the next builder — and the
next builder here is reading a Figma frame that shows all three.

`3 motorcycles` is the Garage epic, already registered in `docs/FIGMA-FIDELITY-TODO.md` §Profile
as unbuilt, with `bike_model` standing in as a single text column.

The country flag is the one header element that **does** have a source — `profile_countries`, with
a policy that already delegates to the profile's audience — so it is built.

## D8 — The design frame's status, and why this proceeded

The epic annotation reads **In progress**, not To do. That was checked against every epic cover in
the file before proceeding, because a status is only a signal if its vocabulary is known:

| Status | Epics carrying it |
|---|---|
| Done | Login ×5, Block account, Report post, View all rides, View your rides, View rides from club, View your clubs, Explore clubs, View private club, Delete account |
| In progress | **View someone else's profile**, View all new postcards, View postcard details, Create postcard, View ride, View your profile |
| Todo | View new postcards from club, Comment on a postcard, Create ride, Create club |
| In review | View notifications, View chats |
| On hold | Explore clubs (v2), View public club ×2 |

`In progress` sits on three screens that are **already shipped** — the postcards feed, ride detail
and own profile. It is the designer's working state, not a build gate. The gate in this vocabulary
is **On hold**, which is what CLAUDE.md's epic-status trap names on `Explore clubs`, and which
this epic does not carry. `Todo`, meanwhile, marks the least-developed epics — `Create ride` and
`Create club`, the two CLAUDE.md flags as having OLD-stylesheet frames.

Recorded because the naive reading — "anything not To do is not ready" — would refuse to propose
against almost the whole app, including the screens that ship today.

## Open questions

Every one has a recommended default so the build is not blocked on it.

**Q1 — Does the header show `location` as text, given the design draws a country flag instead?**
*Non-blocking. Product owner.*
Default: **render both** — the flags from `profile_countries` as drawn, and `location` text only
if the own-profile screen's treatment transfers cleanly. If it looks redundant in review, drop the
text. `location` is already in the projection either way.

**Q2 — Should the postcard count appear at all, given it is per-viewer?**
*Non-blocking. Product owner.*
Default: **omit the stats row entirely in the first cut.** Two of its three numbers (followers,
motorcycles) are unbuildable, and a lone postcards count in a three-slot row reads as broken
layout. Omitting is also what the own-profile screen already does with Badges.

**Q3 — Does the Options button (block/report) ship on this screen in the first cut?**
*Blocking for the header's right-hand affordance. Product owner.*
**ANSWERED 2026-08-14 — yes, ship it, block only.** The owner was given the reviewer's counter —
that a block affordance is beyond an ask which was only "make the byline a link", and that putting
it on this screen is what turns the one-hour signed-URL window into a designed path rather than an
edge case — and kept it, on the description "an option on the menu that opens at the bottom to
block that profile". Report is still out.
Default was: **yes, block only, reusing the existing `blockRider` action.** A profile screen is the
natural place to block someone, `Home / Block account` is a Done epic with a built action, and a
screen that renders a stranger with no block affordance is the weaker safety position. If this is
deferred, the button is omitted rather than rendered inert.

**Q4 — Does the byline link also apply to comment authors, ride crew, club rosters and chat?**
*Non-blocking. Builder's call, once the route exists.*
Default: **postcard byline only in this change.** The other five sites are a mechanical follow-up
once the route and the link component exist, and bundling them widens the review surface of the
change that introduces the route.

**Q5 — Retention: does anything on this screen create a record of who viewed whom?**
*Non-blocking. Answered here so it is not left implicit.*
Default and recommendation: **no.** No view is recorded, no `profile_views` table is added, and no
notification fires on a profile view. Adding one later would be a new personal-data record needing
its own stated retention window at creation.
