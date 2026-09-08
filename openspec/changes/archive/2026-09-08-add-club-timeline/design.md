# Club Timeline — design

Everything here was measured against `letsride-dev` (`fpmrimzxadewsaiwpsel`) on 2026-08-31 or
read out of the committed Figma snapshot, and each claim carries the command that re-derives it.

## D1 — The merge is CLIENT-SIDE, four ordinary reads, and never a `security definer` union

**Decision.** The timeline is assembled in the browser by merging four separately-RLS-filtered
reads. There is no RPC that unions them, and adding one later is a regression rather than an
optimisation.

**Why.** The obvious build is one `security definer` function returning
`(kind, id, actor_id, occurred_at)` for a club — one round trip, one `order by`, one bound, no
horizon problem. It is also the single most dangerous thing this change could ship, and the
reason is mechanical rather than stylistic: **a `security definer` body runs as the owner, for
whom RLS does not apply**, so the union would have to restate, by hand, in one place:

- `is_club_member(club_id)` for threads;
- `is_club_member(club_id)` **or** `club.is_public` for joins, which is a *different* predicate
  from the threads one and is the whole non-member problem;
- `(is_public AND is_club_public(club_id)) OR is_club_member(club_id) OR has_live_ride_invite(id)`
  for rides — three disjuncts, one of which (`083`'s invite) has nothing to do with clubs;
- `(club_id IS NULL OR is_club_member(club_id)) AND NOT hidden` for postcards, where the
  `club_id IS NULL` arm matters because `086`'s `club_stamp_postcard_ids` puts ride-tagged
  postcards with a NULL `club_id` into this club's feed;
- and **a symmetric block conjunct on four different actor columns** — `author_id`, `author_id`,
  `organizer_id`, `user_id`.

That is five audience rules and four block arms copied into a function body that no RLS assertion
covers, because `supabase/tests/` runs as the table owner and a definer body is invisible to it.
`CLAUDE.md` names this exact trap on `034`: the crew helper being `security definer` is what
stepped past `rides`' block arm and cost a shipped leak. `openspec/config.yaml` names the
consequence: *"a visibility decision left unstated in a spec does not fail loudly — it silently
becomes whatever the migration author assumed."*

**Four ordinary reads keep each row filtered by the policy that owns it**, blocks included, and
that property survives every future change to those policies without anyone remembering this
file exists. The costs are real and are paid deliberately: four round trips instead of one, and
the coherence horizon of §D7. Both are bounded and visible. A leaked private-club thread title is
neither.

**The rule generalises and is written into `database-enforced-integrity` for that reason** — the
profile timeline (`Profile - Timeline` is in the snapshot) and the standalone ride Journal
(PD-257) are the next two screens that will want exactly this shape.

## D2 — A non-member of a PUBLIC club gets NO timeline

**Decision.** A signed-in rider who is not a member of a public club sees the identity band, the
upcoming-rides strip and the Members rail, and **in place of the action layer and the timeline**
a single sentence and the join button. No partial stream, no empty state, no count.

**The problem, stated exactly.** Measured: `club_members` SELECT admits a non-member to a public
club's roster (`… OR EXISTS (select 1 from clubs c where c.id = club_id and c.is_public)`), and
`rides` SELECT admits them to its public rides. `club_threads` and `postcards` both require
`private.is_club_member`. So a non-member's four reads return **joins and public rides, and
nothing else** — the merged stream renders as a handful of "X joined the club." rows and reads as
*this club is quiet*, for a club that may have four hundred postcards and forty threads.

Nothing is disclosed by that. Every row in it was already reachable — the roster is one tap away
at `/clubs/detail/members` and the rides are already on the strip above. **The harm is not a
leak, it is a false impression, and it is aimed at the one rider the screen exists to persuade.**

**The rule this comes from, stated so the next screen inherits it:** *a partial view is honest
when partial fidelity preserves the message, and dishonest when it inverts it.* The rides strip
showing 2 of a club's 5 rides still says "this club rides". A timeline showing 3 of 300 events
says "nothing happens here". That is the test, and it is why the strip and the rail stay while
the timeline goes.

**Two rejected alternatives.**

- *Draw the sparse stream and label it* — "you are seeing part of this club". It is honest about
  completeness and still inverts the message: the rider reads three rows and one caveat, and
  three rows is what they remember. It also has to be worded so it does not disclose that there
  *are* threads and postcards, since on a private club the same component must not.
- *Draw the stream with placeholder rows for what is hidden.* Straightforwardly a disclosure —
  the count of hidden rows is information about the club's activity.

**This is not a new rule, it is the existing one generalised.** Both sections that dissolve
already refuse to lie, on this exact screen, today: `ClubThreadsSection` renders *"Join the club
to read and start threads."* and `ClubPostcardCarousel` renders *"Postcards in this club are for
its members."* What this change does is stop them being two independent decisions, because after
the merge there is only one place left to make it.

**The action layer goes with it.** All three of its tiles are writes a non-member's RLS refuses —
`017`'s `rides` INSERT needs `private.is_club_member(club_id)`, `009`'s `postcards` INSERT the
same, `081`'s `club_threads` INSERT the same. `ClubCreateRideRow`'s existing rule applies:
*"a control that always fails RLS is worse than no control."*

## D3 — The reduced preview branch is untouched

**Decision.** `ClubPreviewScreen` gains nothing. No timeline, no event rows, no roster, no
counts.

`085` gave a non-member of a **private** club a reduced screen reached from Explore, built from
`discoverable_private_clubs`' seven columns and no roster at all. Its docstring names the property
that makes it safe: *"it issues no query that could return zero rows"*, which is what keeps
"permission denied" and "empty" from being confusable there. **A timeline is a read that returns
zero rows, so putting one on that screen destroys that property outright** — and it would do it
four times over.

The join events are the sharpest case: `club_members` SELECT's public-club disjunct does **not**
fire for a private club, so the read returns zero rows and would render as "nobody has joined
this club", about a club with two hundred members. The branch stays exactly as `085` left it, and
the check that it did is a task rather than an assumption: the new code must not be reachable
from that branch at all, not merely gated inside it.

## D4 — Blocking: which conjunct does it per source, and the one path the merge adds

**Every source drops the row itself.** Measured, one policy at a time — and note the shape is the
same in all four, an own-row escape hatch OR-ed with a symmetric `private.is_blocked`:

| Source | The conjunct | What disappears |
|---|---|---|
| `club_threads` | `(author_id = auth.uid()) OR (NOT private.is_blocked(auth.uid(), author_id))` | the thread row, so the event |
| `postcards` | `(author_id = auth.uid()) OR ((NOT private.is_blocked(…)) AND …)` | the postcard row, so the entry |
| `rides` | `(organizer_id = auth.uid()) OR ((NOT private.is_blocked(…)) AND …)` | the ride row, so the event |
| `club_members` | `… AND ((user_id = auth.uid()) OR (NOT private.is_blocked(auth.uid(), user_id)))` | the membership row, so the join event |

`private.is_blocked(a, b)` is symmetric — its body is
`(blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)` — so it does not
matter which way the directional row points, which is decision #2 holding.

**The merge cannot reintroduce a blocked rider by taking rows from elsewhere**, because it takes
rows from nowhere else: every event is one row from one of those four reads, and the club's own
creation event carries a `created_at` rather than a person (see below).

**The merge DOES add one reintroduction path that none of the four sources has today, and it is
the actor's name.** Each source embeds its actor's profile, and `profiles` SELECT is
`(auth.uid() = id) OR ((username IS NOT NULL) AND (NOT private.is_blocked(auth.uid(), id)))` —
a *separate* predicate that can withhold a profile whose parent row came back. Today that is
unreachable for the four sources, because a withheld profile implies a block and a block already
removed the parent row; it becomes reachable the moment `username` is NULL, which is every
account between signup and the username step.

**The rule: an event row whose actor profile is absent is DROPPED, never drawn nameless.**
`getClubMembers` already applies exactly this — *"a membership whose profile the policies hide is
dropped rather than drawn as a nameless row"* — and this change extends it to all four sources.
The reason is that an event row is **entirely a sentence about a person**; "Rider joined the
club." carries no information and reads as a defect.

**Postcard entries are the deliberate exception and keep `PostcardStamp`'s existing `Rider`
fallback.** A postcard entry is not a sentence about its author — it is a photo with a byline —
so partial fidelity there does not invert the message, which is §D2's test applied one level
down. Changing `PostcardStamp` to drop instead would also change the Journal and the home deck,
and its component test asserts that fallback.

**The club's own creation event has no actor when it cannot name one.** `getClub` returns
`owner_id` and `created_at` but embeds **no owner profile**, so the name comes from the roster
read the Members rail already makes under `queryKeys.clubs.members(clubId)`. When the owner is
not in it — they blocked the viewer, or the viewer blocked them, or they are outside
`CLUB_ROSTER_LIMIT` — the row renders **"This club was created."** with no avatar. That fallback
is not a nicety: for the block case it is the required outcome, and it is why the event is
specified with an optional actor rather than being dropped when the name is missing.

## D5 — The unread signal Threads would otherwise take with it

**Decision.** The signal survives in **two** places, and both are required:

1. **Each thread's timeline entry carries its own unread dot**, from `getClubThreadUnread`'s
   existing `(thread_id, has_unread)` map — the same read `ClubThreadsSection` makes today, with
   its existing failure mode intact (a failed RPC resolves to `{}` and the entries render
   unmarked rather than not rendering).
2. **The action layer's Threads tile carries an aggregate mark** — `Object.values(unread).some(…)`
   over that same map. **No new read.**

**Why both, and why (2) is the load-bearing one.** A thread's timeline entry is placed by its
`created_at`, because that is the only timestamp a thread carries that this change may read.
`club_messages.created_at` would place it by activity, but the newest-message-per-thread is not
something the client can ask for without an RPC, and an RPC is a migration.

**So the timeline is a record of what STARTED, not of what is going on** — and a thread begun
three weeks ago with five unread messages from this morning sits three weeks down the stream,
below the horizon of §D7 more often than not, carrying a dot nobody scrolls to. The aggregate
mark in the action layer is what stops that being a regression against the screen this change
replaces, where the Threads section sits above the fold with its three newest threads and their
dots. It is not a nicety and it must not be dropped as scope.

**This is the sharpest thing the change gets wrong and it is stated rather than hidden.** See
§Open questions Q1 for the follow-up that fixes it properly.

**`markClubThreadSeen` is not affected.** It fires on the thread screen, writing
`club_thread_reads`; nothing on the club detail spends it. `MarkClubSeen` writes `feed_reads`
only — a different table, a different watermark.

## D6 — Two watermarks, and why this change touches neither

**`club_unread_counts` counts two of the four sources.** Measured — its body counts
`postcards` where `created_at > since AND author_id <> auth.uid()`, plus `rides` where
`created_at > since`. **No threads. No joins.** So the badge on `/clubs` and the timeline it
opens disagree by construction: a club whose only activity is three new threads shows no badge
and a timeline with three entries.

```sql
select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'club_unread_counts';
```

**Decision: state the divergence, do not close it.** Closing it means editing that function,
which is a migration, which this change does not have. And the divergence is defensible on its
merits: a join is not news *addressed to* the rider, and threads already carry a finer per-thread
watermark that the badge would double-count. `client-cache-invalidation`'s standing requirement
*"A count and the list it summarises SHALL be invalidated together and read through the same
predicate"* is about a count and **its own** list; this badge summarises the club, not the
timeline, and the delta says so in as many words so that nobody reads the silence as agreement.

**One pre-existing defect is made visible by this change and is not fixed by it.** The rides half
of that function has no `organizer_id <> auth.uid()` exclusion where the postcards half has
`author_id <> auth.uid()`, so an organiser creating a ride in their own club raises their own
badge. It is logged here because the timeline is where a rider will now *see* their own action
listed and wonder why it was unread. One-line fix, needs a migration, out of scope.

**No "new since your last visit" divider — and this is a decision, not an omission.** The screen
mounts `MarkClubSeen` in an effect on load, which upserts `feed_reads.last_seen_at = now()`. Any
divider would have to read the watermark **before** that write lands, and the only accessor today
is the aggregated `club_unread_counts`, which returns a count and not the timestamp.
`feed_reads` SELECT is `user_id = auth.uid()`, so the client *may* read the column directly — the
obstacle is the ordering, not the grant. Half-building it produces a divider that is correct on a
cold load and absent on every subsequent one, which looks like a rendering bug.

## D7 — Ordering, the bound, and the coherence horizon

**The problem this change would otherwise ship.** Four independently bounded lists merged
client-side produce a stream whose tail is incoherent: each source contributes only its own most
recent N, so once a chatty source saturates, an older event from a quiet source outranks a newer
one that fell outside the chatty source's bound and is simply missing. The stream still looks
ordered. `docs/FIGMA-FIDELITY-TODO.md` calls this *"a union of derived queries with no shared
ordering key"* and declined the feature over it; the key exists, and this is the real objection.

**Decision — the horizon.**

```
TIMELINE_SOURCE_LIMIT = 20      # per source
TIMELINE_MAX          = 40      # display cap

saturated  = sources that returned exactly TIMELINE_SOURCE_LIMIT rows
horizon    = max(oldest timestamp returned by each saturated source)   # null if none
stream     = all events with ts >= horizon, sorted by ts DESC, id DESC
display    = stream.slice(0, TIMELINE_MAX)
```

**`max`, not `min`, and this is the line to get right.** Below the *most recent* of the saturated
sources' oldest rows, at least one source is already truncated — so that instant is where the
merge stops being complete. Taking `min` would keep exactly the rows the merge cannot vouch for.

**A source that returned fewer than its limit imposes no floor**, because it is complete back to
the beginning of the club. That is what makes an ordinary club's timeline reach all the way down.

**`id DESC` as the tiebreak, not sort stability.** Two events sharing one `now()` is not
hypothetical here — `complete_onboarding` writes a `club_members` row for the default club inside
the same transaction as the completion stamp (`058`), so bulk joins share timestamps. Without a
total order the stream reshuffles between loads for no reason the rider can see, which is the
defect `byDistanceThenName` was given a name tiebreak to avoid.

**The tail.** Two terminal states, and they are different rows:

- **Complete** — `horizon` is null and the display cap was not reached. The last entry is
  **"&lt;owner&gt; created the club."**, and the timeline genuinely reaches the beginning. Nothing
  further is drawn.
- **Incomplete** — a **handoff row**: `See all postcards` · `All rides` · `All threads` ·
  `All members`. Four destinations, not a "load more". **No infinite scroll**, per the brief.

**The club-creation event is drawn only in the complete state**, and that is deliberate rather
than incidental: appended under a truncated stream it would claim an adjacency that is false —
"created the club" directly under an event from last Tuesday, with three years missing between
them.

**The accepted cost, stated honestly.** A burst — twenty joins in one minute during a club
import — sets the horizon to that minute and hides a postcard from an hour ago that the merge is
actually holding. That is data dropped to preserve truthfulness, and it is the right trade: the
alternative shows the postcard and lies about what sits between. The lever if it bites is
unequal per-source limits, not abandoning the horizon. See Q2.

## D8 — The empty state is impossible by construction

A brand-new club with one member and nothing else still has **two** entries: the owner's own
`club_members` row, and the club's own `created_at`. Both are already on the screen — the second
needs no read at all, `getClub` having returned `created_at` and `owner_id` before anything else
rendered.

So the timeline's genuine empty state is unreachable, and the screen does not need one. What it
needs instead is a **shortest-stream** state that reads as a beginning rather than as a failure:
two rows and the action layer above them, which is the club saying *nothing has happened yet,
here is how to make something happen*. That is a stronger empty state than a sentence, and it is
the frame's own bottom-of-stream shape.

**The one state that must not be confused with it** is the failed read, and §D2's non-member
refusal is what keeps them apart on the only screen where both are reachable.

## D9 — The name collision, and why the rename goes first

`src/components/clubs/clubTimeline.ts` exists **today** and is about the ride strip:
`clubTimelineRides`, `CLUB_TIMELINE_RIDES = 5`, `CLUB_TIMELINE_PAST_MIN = 2`. It got the name
from the *sub-page* called Timeline, which the 2026-08-18 merge deleted; nothing in it has
anything to do with an activity stream.

Leaving it in place and adding `ClubTimeline` beside it puts two unrelated things called
"club timeline" on one screen, one of which bounds a ride strip at 5 and the other of which bounds
a merged stream at 40. **Rename first, as its own commit**: `clubRideStrip.ts`,
`clubRideStripRides`, `CLUB_RIDE_STRIP_RIDES`, `CLUB_RIDE_STRIP_PAST_MIN`, and move its unit test
with it. The new merge helper then takes the freed name.

## D10 — What this costs in round trips

The screen already issues, for a member: `getClub` (2 — the club and the membership),
`getClubFeed` (2 — `club_stamp_postcard_ids` then the select, plus `attachLikeState`),
`getRides` (2 — upcoming and past), `getClubMembers` (1, from the rail), `getClubThreads` (1),
`getClubThreadUnread` (1).

This change **adds two**: `getClubRecentJoins` and `getClubRecentRides`. It removes none.

**Both are indexed except one, and the exception has a trigger rather than a fix.**
`rides_club_id_created_at_idx` on `(club_id, created_at DESC) WHERE club_id IS NOT NULL` already
exists, as do `postcards_club_id_idx` and `club_threads_club_id_idx`. **`club_members` has no
index on `(club_id, joined_at)`** — its only relevant one is the primary key `(club_id, user_id)`
— so a `joined_at DESC` read sorts the club's rows.

```sql
select indexname, indexdef from pg_indexes
 where schemaname = 'public' and tablename = 'club_members';
```

That is **not new**: `getClubMembers` orders by `joined_at` under the same index today, and the
sort is bounded by club size, which is tens. **No index is proposed**, because an index is a
migration and this change has none. The trigger is stated so the next session does not have to
rediscover it: *the day any club passes roughly a thousand members,
`(club_id, joined_at DESC)` is the index, and `getClubMembers` wants it as much as this does.*

## Open questions

Every one carries a recommended default so the build can proceed and be corrected later.

**Status after the build (2026-08-31).** Q2 and Q5 took their defaults and are closed.

**Q3 is closed a third way, better than either option it offered**: the entrance is `All
photos` on the **timeline's own section header**, so it sits beside the content it opens, the
action layer stays three actions wide, and PD-125's requirement is met without the row growing
a destination among its actions. It is drawn only when the club has posted any — being a member
is not the same as having photos, and this file's own reachability rule cuts both ways.

**Q4 is MOOT rather than defaulted, and the difference is worth the line.** Its default was
*"render 'This club was created.' until the roster read has landed"*, which presumes the
founding entry can render before that read. It cannot: `joins` is one of the four stream
sources, not a side read, so `ClubTimeline` gates the whole section on it and the entry never
renders early. The reasoning behind the default was right and the situation it guarded against
does not arise.

**Q1 is ANSWERED, and a third way — like Q3.** The owner approved it on 2026-08-31 and it
shipped the same session. The question offered a binary: place a thread's entry by its creation,
or by its last message. The build takes neither. The thread's entry keeps its creation placement,
which is the honest one, and activity arrives as a **separate `reply` event** at the instant of a
thread's newest message. A busy thread surfaces at the top, which is what the second option
wanted, without dating *"ana started a thread"* to today, which is what that option cost.

**Its blocking rationale was wrong, and that is the part worth keeping.** Q1 read: *"Placing it
by activity needs a `last_message_at` the client cannot ask for without an RPC, and an RPC is a
migration this change does not have… should be re-scoped before any code is written — which is
why it is blocking rather than a follow-up."* Only the **aggregate** needs an RPC. A bounded
window of recent messages is an ordinary read: `081` grants `authenticated` SELECT on
`club_messages` and its policy restates the club's whole audience, verified against DEV as a
member before any code was written. No migration, no re-scope. The lesson is the one this repo
already has a rule for — *test the block before reporting it* — applied to a schema claim rather
than a connector.

### Two places the build deviates from this document

**The display cap is 20, not §D7's `TIMELINE_MAX = 40`, and the source bounds are 30 / 30 / 20 /
60 rather than a uniform 20.** Q2 sanctions unequal per-source limits as the lever, so the
source half is covered by an answered question; the halved display cap is not, and it has a
consequence §D7 does not describe. **Under these numbers the coherence horizon is inert**: every
source reads at least as many rows as the timeline draws, so a truncated source's oldest row
already has twenty newer events above it and the filter can never remove a rendered one. The
horizon is defence in depth here rather than a live filter. That is stated at
`CLUB_TIMELINE_LIMIT` with its proof, and `club-timeline.test.ts` asserts the relationship
directly so that lowering a bound — two of the four belong to other screens — or raising the cap
switches the guard on deliberately rather than silently.

**Task 1.1's rename became a deletion.** `clubTimeline.ts` was to become `clubRideStrip.ts` with
`CLUB_TIMELINE_RIDES` → `CLUB_RIDE_STRIP_RIDES`; instead the module is deleted outright and the
name reused for this change's own read bound. PD-319 widened the ride strip to carry past rides
*because there was no timeline to put them on*, so with one built the split helper has no caller
and no reason to exist. The collision the task existed to prevent is gone either way.

### Q1 — Should a thread's timeline entry be placed by its creation or by its last message? — **BLOCKING · product owner**

**Default: creation, with the aggregate mark in the action layer as the compensation (§D5).**
Placing it by activity needs a `last_message_at` the client cannot ask for without an RPC, and an
RPC is a migration this change does not have. If the owner wants activity ordering, this change
grows a migration and its RLS assertions and should be re-scoped before any code is written —
which is why it is blocking rather than a follow-up.

### Q2 — Is horizon truncation the right trade against a burst? — **NON-BLOCKING · engineering**

**Default: yes, accept it (§D7).** The lever if a real club hits it is unequal per-source limits;
the fallback that must not be taken is dropping the horizon, which returns the incoherent tail.

### Q3 — Does the action layer carry a fourth tile for `All postcards`? — **NON-BLOCKING · product owner**

**Default: no.** The action layer holds *actions*; the handoff row holds *destinations*. The
requirement that matters either way is that `/postcards?club=<id>` keeps at least one entrance in
every state — see the spec's reachability scenario, which is PD-125's defect and the reason the
handoff row is specified rather than left to composition.

### Q4 — Should the club-creation event name its owner when the roster read has not landed? — **NON-BLOCKING · engineering**

**Default: render "This club was created." until it has, then swap in the name.** The alternative
— holding the whole timeline on the roster read — makes the Members rail a gate on the stream,
and `combineQueries` deliberately has no `isLoading` for exactly this reason.

### Q5 — Does the aggregate Threads mark count a thread the rider has never opened? — **NON-BLOCKING · engineering**

**Default: yes, whatever `club_thread_unread` already says.** It excludes the caller's own
messages (`079`'s fix, applied at birth in `081`), and re-deriving a second definition of unread
beside it is how two numbers for one fact appear.
