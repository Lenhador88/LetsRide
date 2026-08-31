# Club Timeline Engagement — design

Everything here was measured against `letsride-dev` (`fpmrimzxadewsaiwpsel`) on 2026-08-31 or read
out of the repo, and each claim carries the command that re-derives it. Where a decision rests on a
policy, the policy text is quoted from `pg_policies` rather than from a migration file, because the
file is what was *sent* and the catalog is what is *there*.

## D1 — "Wave" is the existing reaction, and this change adds a second surface for it, not a second concept

**Decision.** A wave on a thread and a wave on a join are the same gesture `postcard_likes` already
implements, and they get the same mechanism: a composite-key table, an `EXISTS` against the parent
evaluated under the caller's own RLS, a symmetric block arm on the reactor, a per-viewer count, and
no denormalised total.

**The vocabulary is already split, and this change decides it rather than inheriting it.**
`LikeButton` renders `WaveIcon` and its accessible name is `Like, N likes`; the table is
`postcard_likes`; the glyph is `Wave  4127:6925` in the snapshot; the product word, in the owner's
own message, is *wave*. The new tables are named `club_thread_waves` and `club_join_waves`.

**The cost of that choice is stated rather than hidden**: the schema now holds two names for one
concept, and a session grepping `likes` finds one half. The alternative — `club_thread_likes` —
propagates a word the product has already abandoned into a surface with no legacy, and would make
the *button* say Wave while the *column* says like on a screen where both are visible in the same
scroll. `092` carries a `comment on table` on each new table naming `postcard_likes` as the same
concept under the older name, which is what makes the split discoverable from either end.

**What does NOT change**: `postcard_likes` is not renamed. Renaming an applied table is a
migration whose only benefit is tidiness, and `add-club-timeline` already declined a rename that
had a real collision behind it.

## D2 — A join does NOT auto-create a thread, and this is a decline rather than a deferral

**Decision.** No trigger on `club_members` mints a `club_threads` row. The join stays a derived
timeline entry, exactly as `add-club-timeline` shipped it.

The shape is attractive for a real reason — it reuses the whole of `081` unchanged, and "say
welcome" becomes an ordinary reply with an unread watermark, Realtime, `delete_own_club_message`
and `moderate_club_thread` all working on day one. It loses on five counts, and the first three
are structural rather than matters of degree.

**1. `club_threads.author_id` is `NOT NULL` with no default, and every candidate author is
wrong.** Measured:

```sql
select a.attname, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) as default_expr
  from pg_class c join pg_attribute a on a.attrelid = c.oid
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
 where c.relname = 'club_threads' and a.attnum > 0 and not a.attisdropped;
-- author_id | t | (none)
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.club_threads'::regclass and contype = 'f';
-- club_threads_author_id_fkey  FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE CASCADE
```

- **The joiner as author.** `081`'s DELETE policy is `… and author_id = auth.uid()`, so the
  newcomer can delete the thread they were welcomed in — and `club_messages` cascades from the
  thread, so **every welcome other riders wrote goes with it**. `081` chose that cascade
  deliberately for rider-authored threads and named the cost: *"deleting a THREAD AUTHOR's account
  deletes a conversation other riders took part in."* Accepting that for a thread a rider chose to
  start is one thing; accepting it for a thread the app minted in their name is another.
- **The club owner as author.** Then the app has written a rider's username into a title that
  **cannot be edited by anyone** — `club_threads` has no UPDATE policy and no UPDATE grant, and
  `081` refused both on purpose — that the named rider cannot delete, and that keeps naming them
  after they leave the club. It is also inherited: `029`'s succession hands a club to its
  longest-tenured admin, so the "author" of a thousand welcome threads becomes a rider who wrote
  none of them.

**2. `058`'s Welcome club turns the shape against its own purpose.** Every rider joins the club
carrying `clubs.is_default` on completing onboarding, so the shape mints one thread per signup for
ever, in the one club every rider is in, and the Threads list — ordered `created_at DESC` — becomes
a wall of welcomes with no topic reachable behind them. `private.notify_club_joined` already
carries precisely this carve-out, and `059` added a second one to
`private.notify_ride_created_in_club` for the same class of reason, so the precedent for carving it
out is strong. **That is exactly what makes the shape self-defeating**: carve it out and the rider
with the emptiest app — the one PD-299 names as the reason Discussions does *"double duty on
first-run"* — is the only rider guaranteed no welcome.

**3. A trigger on `club_members` INSERT is a live write path with four callers**, three of which
are not obvious: `joinClub`, `createClub`'s owner row, `complete_onboarding` (`058`) and
`private.join_club_from_request` (`085`). A raise inside the first is a failed join; inside the
third it is caught by `058`'s `when others` block, so it fails safe; **inside the fourth it is
not** — `join_club_from_request` has no exception block, so a raise takes a club admin's approval
down with it. `036`'s hand-exercise gate exists for exactly this and would apply in its full form.
**The recommended shape adds triggers only to two brand-new tables**, so no existing write path
runs new code at all, and that is the single largest reason it is cheaper to apply.

**4. Retro-active joins split the screen on an invisible date.** Every `club_members` row predates
this change. Backfill and the Welcome club takes one thread per existing rider; do not, and the
timeline draws some joins as threads and some as plain rows with the boundary at a deploy nobody
can see. There is no third answer. **The recommended shape has no such choice to make** — a wave
hangs off the membership row that already exists, so every historical join is wavable the moment
`092` applies and nothing is backfilled.

**5. It answers a question the owner asked with a question mark.** *"should also be some kind of
discussion?"* is a proposal, not an instruction, and the brief asks for a recommendation.

## D3 — Words about a newcomer, without a table: the pre-filled compose

**Decision.** The join row's overflow offers **Say welcome**, which opens `CreateThreadForm` with
its title pre-filled — `Welcome, <username>` — and nothing else. The rider edits or discards it
like any other draft. **Zero schema.**

**Why this is not a consolation prize.** It gives the owner's *"People should then be able to say
welcome, etc."* its full meaning — words, in a thread, with replies, unread marks and Realtime —
while every objection in §D2 evaporates:

- The **author is the welcomer**, a rider who chose to write it. The participation gate fires
  normally, in the caller's context, because the INSERT is an ordinary client write rather than a
  definer body where `current_user` is the owner (`023` §2, restated in `081` §3).
- The **Welcome club does not explode**, because nobody hand-welcomes ten thousand signups. No
  carve-out is needed, so the newcomer with the emptiest app is *more* likely to be welcomed than
  under shape 1, not less.
- **Retro-active joins work identically** — any join on the stream can be welcomed, whenever it
  happened.
- The **title still names a person who may leave**, and that is now a rider's own sentence about
  another rider, which this app already permits in every message and every postcard caption. It is
  not the application publishing a name on its own initiative, which is the version that would owe
  a consent question.

**What it does not do**: it does not make the welcome thread *findable from the join row later*.
There is no link back, because there is no column to hold one and adding one is the table this
change is declining. The thread appears on the timeline as an ordinary `thread` event, one row
above the join it answers, which is the same adjacency the frame's own event grouping draws.

## D4 — The composite foreign key, and the orphan it prevents

**Decision.** `club_join_waves` carries `FOREIGN KEY (club_id, subject_user_id) REFERENCES
club_members (club_id, user_id) ON DELETE CASCADE`, and this is not a stylistic preference.

**The defect it prevents, stated exactly.** The obvious design keys the subject as a bare
`subject_user_id → profiles`. `add-club-timeline` already specifies that a leave deletes the
`club_members` row and takes the join entry with it, and that a rejoin *"is indistinguishable from
a first join"*. Under the bare key, the wave rows survive the leave: they decorate an entry that no
longer renders, they are unreachable by any screen, they are invisible to `029`'s deletion path in
the sense that matters (the *subject* is gone from the club, not from the app) — and on a rejoin
they **come back**, so a rider welcomed in March is silently shown as welcomed again in September
by riders who did nothing in September.

**The composite key makes the cascade exact**: leave → the membership row goes → its waves go →
the rejoin starts at zero, which is what "indistinguishable from a first join" requires. It is
available only because `club_members`' primary key is `(club_id, user_id)`, measured in
`proposal.md`.

**`user_id` — the waver — keeps its own `→ profiles ON DELETE CASCADE`**, so deleting the *waver's*
account removes their waves everywhere. `029`'s standing rule applies to it: *"every foreign key
referencing `public.profiles` SHALL have an index Postgres can use"*, and on `club_join_waves` the
primary key leads with `club_id`, so `user_id` needs an index of its own or every account deletion
is a sequential scan. `club_thread_waves`' primary key leads with `thread_id` and needs the same.
Both are in `092`; the assertion is `029`'s catalog form, never a timing.

**`role` moving does not disturb it.** `088` (`promote_club_member` / `demote_club_admin`) writes
`club_members.role`, which is not in the primary key, so an admin promotion does not touch a single
wave.

## D5 — Two tables, not one, and not a polymorphic one

**Decision.** Two narrow tables. Neither the generic `(kind, subject_id)` table of shape 2 nor the
single `club_waves` with two nullable subject columns.

**Shape 2 fails on two counts and the first is fatal.** A polymorphic `subject_id` cannot carry a
foreign key, so **nothing cascades**: deleting a thread leaves orphan reactions, and the join case
loses §D4 entirely. And its SELECT policy would have to switch on `kind` and restate three
audiences in one body — the `club_threads` conjunction, the `club_members` conjunction and the
`postcards` conjunction — which is the thing `add-club-timeline`'s own
`database-enforced-integrity` delta forbids in as many words: *"a restated audience rule that
drifts"* is *"visible, bounded and stated"* in neither sense. It looks like the general answer and
is the most dangerous of the four.

**One table with two typed, nullable, FK-carrying subject columns was weighed seriously**, because
it is `notifications`' own idiom — five nullable subject keys and a `CHECK` switching on `type`,
measured:

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.notifications'::regclass and contype = 'c';
-- notifications_subject_shape: CASE type WHEN 'postcard_liked' THEN … ELSE false END
```

It loses to the asymmetry in §D4: the join subject needs a **two-column** key and the thread
subject a **one-column** one. A single table carrying both must either denormalise `club_id` onto
thread waves — a copy of `club_threads.club_id`, which `database-enforced-integrity` refuses in
*"A derived row SHALL NOT hold a copy of a visibility decision"* — or drop the composite key and
accept the orphan. It would also need `nulls not distinct` on its uniqueness index, which `036` §8
records as a trap that *"would NEVER FIRE"* if forgotten, for a benefit two primary keys give for
free.

**The cost of two tables, stated:** the block arm, the gate trigger, the grants, the indexes and
the RLS assertions are written twice. That is duplication in the migration and it is the cheap
kind — two policies each doing one obvious thing, rather than one policy doing two.

## D6 — The per-viewer count: what `009` answers, and what it answers badly

**`009`'s answer is correct, and the brief is right to ask whether it is *good*.** It is good for
disclosure and bad for coherence, and the second half is what has to be written down.

**What it gets right.** There is no `like_count` column, by explicit refusal: *"the correct count
is per-viewer: a blocked rider's like must not be visible to, or counted for, the rider who blocked
them. Counting the rows under RLS gives that for free and cannot drift from the rows it
summarises."* The count arrives as a PostgREST aggregate — `likes_count:postcard_likes(count)` —
which is evaluated under the caller's session, so a blocked rider's wave is absent from the rows
*and* from the total, in one mechanism.

**What it gets badly, and it is not fixable in the direction people reach for.**

1. **Two members of one club see different totals on the same thread**, and neither is told why.
   A count is a number riders compare, and this one is not comparable between them.
2. **A rider blocked by every other member of a club still sees `1`.** The own-row arm
   (`user_id = auth.uid() or not is_blocked(…)`) means their own wave always counts, so a wave
   nobody can see reads back as acknowledged. This is the sharpest instance of the general shape
   and it is invisible from the client.
3. **The obvious fix leaks.** A global count tells the viewer that a hidden rider exists and acted,
   which is a disclosure decision #2 forbids, and it would have to be denormalised to be cheap,
   which reintroduces the drift `009` refused.

**Decision: keep the per-viewer count, and forbid the three things that would make its
incoherence rider-visible.** The spec states them as requirements rather than leaving them to
review: a wave count SHALL NOT order or rank anything, SHALL NOT feed a threshold or a badge that
implies a shared fact ("popular", "trending", "3+ waves"), and SHALL NOT be denormalised onto its
parent. Each of the three turns a per-viewer number into a claim about the club, and only the
third would be caught by a reviewer reading a migration.

## D7 — Who may delete a wave, and why there is no moderation verb

**The author, and nobody else** — `using (user_id = auth.uid())`, with **no visibility
requirement**, which is `009`'s exact rule and its exact reason: *"a rider must be able to withdraw
a like from a postcard that has since gone out of view, or the row is stranded."* A rider who waves
a thread and is then blocked by its author can still withdraw the wave, because the DELETE names
its own row by both key columns and the policy does not ask whether the parent is still visible.

**A caveat worth carrying, and it is why the wave tables are NOT `club_messages`.** `081` measured
that RLS applies the SELECT policy to a `DELETE … where id = …`, so a row the caller owns but
cannot *see* survives its own delete, silently, with PostgREST reporting success — which is why
`club_messages` has no DELETE policy at all and a definer RPC instead. **The wave tables do not
inherit that problem, and the reason is the block arm's own-row escape hatch**: `user_id =
auth.uid()` is a disjunct of the SELECT policy, so a rider can always see their own wave whoever
has blocked them, and the attached SELECT never hides the row the DELETE is aiming at. That is a
property to assert, not to assume, because removing the own-row arm would break the delete path
silently while looking like a tightening.

**No owner or admin moderation verb.** A wave is one bit from one rider with no text in it, so
there is nothing to moderate; the remedies that exist already reach it — a block removes the
rider's waves from the blocker's view and their counts, and `moderate_club_thread` deletes the
thread, which cascades its waves. Adding a verb would mean a definer RPC, an advisor, and a
capability whose only use is deleting somebody's approval.

## D8 — The seven states, for a decoration rather than a section

`client-render-shell` requires every state be decided once. A wave is not a section, so several of
the seven resolve to *nothing visible*, and saying so is the point.

| State | Behaviour |
|---|---|
| Empty | zero waves is the ordinary state and the count is **absent, not `0`** — `PostcardActionButton` already omits a zero count, and a row of zeroes on every timeline entry is noise that makes a real `1` harder to see |
| Loading | the entry renders **immediately, with the toggle disabled and no count**, never held behind the wave read. The wave state is a second, smaller read than the entry's own; gating the stream on it would make a decoration a prerequisite for the content |
| Error | a failed wave read costs **marks, not rows** — `getClubThreadUnread`'s existing rule, transferred. No error state is shown for a failed count; the entries render unwaved. A failed wave *write* rolls the optimistic toggle back and surfaces its message inline, which is `LikeButton`'s behaviour |
| Offline | the toggle is **not queued**. A wave is an expression at a moment; replaying it on reconnect makes the app act on a rider's behalf minutes later, possibly after they blocked the subject. The write fails and says so |
| Permission denied | **the affordance is absent, not inert.** A rider who cannot see the parent never sees the entry, so the question only arises for the entry-visible-write-refused case, which is empty by construction: both INSERT policies' `EXISTS` is the same one the SELECT policy used. The refusal SHALL NOT be rendered as a message naming a block |
| Partial | the wave read is per subject kind, so **threads can carry counts while joins do not**, and that renders correctly with no cross-source coupling |
| Stale | read on load, no subscription. A wave from another rider appears on the next load. The rider's **own** toggle is optimistic and authoritative locally until the write answers |

## D9 — What the migration touches, and which paths need hand-exercising

`036`'s gate applies to *"a migration that hangs triggers off an already-shipped write path"*.
`092` hangs **four** triggers and the distinction between them is the whole risk assessment:

| Trigger | Table | Live write path? |
|---|---|---|
| `enforce_participation_gate` | `club_thread_waves` | **No** — new table, no writer exists before this change |
| `enforce_participation_gate` | `club_join_waves` | **No** — same |
| `notify_club_waved` | `club_join_waves` | **No** — same |
| `retract_club_waved` | `club_join_waves` | **No** — same |

**No existing write path runs new code**, which is the property shape 1 could not have. The gate
still applies in its narrow form — exercise the wave and un-wave paths by hand on DEV, in a rolled
back transaction, as `authenticated`, with the fan-out's rows **counted rather than assumed** — and
`092` is not inert, because the moment it applies the fan-out is live for every wave.

**The one existing object `092` modifies is `notifications`' pair of CHECK constraints.** That is a
`drop constraint` / `add constraint` on a live table, and it is additive in the only sense that
matters: the new predicate accepts every row the old one did. The ordering rule that binds is
`089`'s, in the client — see `proposal.md`.

## Open questions

Every one carries a recommended default so the build can proceed and be corrected later.

### Q1 — Does a thread get a share affordance, and if so what does it share? — **ANSWERED, 2026-08-31: B**

**The product owner chose B — the row shares the CLUB, labelled as such.** Asked directly, given
all three options with their costs, they picked it over "no share at all" and over a thread
capability URL. So a thread's share row reads **`Share club`**, calls
`shareAppLink(routes.club(clubId))`, and no thread URL is ever handed out.

Two consequences to build against rather than rediscover:

- **The label is the whole safety property.** A row reading `Share` on a thread screen promises
  the thread; only the word `club` stops a rider believing they sent someone a conversation. A
  future refactor that shortens it to `Share` reinstates the defect this question exists for,
  with nothing red.
- **It does not fix PD-299's own share defect and must not be read as fixing it.** That one is
  `ClubOptionsMenu` sharing a PRIVATE club's URL unconditionally, which RLS refuses to the
  non-member you sent it to. This row inherits that bug the moment the club is private — same
  call, same route. PD-299 #2 is where it gets fixed; **this change is not allowed to ship a
  second caller of it without saying so**, which is what this paragraph is.

C stays closed. If thread links are ever wanted they are their own story, for the reason below.

**The options as they were put, kept because the reasoning is what makes B defensible:**

Three options, and only the first two are open:

- **A) No share on a thread.** Was the recommendation; not chosen. The club already has one (`ClubOptionsMenu`, PD-280),
  and a rider who wants to bring someone to a conversation is really trying to bring them to the
  club.
- **B) The row shares the CLUB, labelled as such** — `Share club` on a thread. **CHOSEN.** Honest,
  no dead link, and slightly surprising: the rider aimed at a thread and got a club.
- **C) A capability URL for a thread.** **Not open in this change.** PD-330's `ride_invite_links`
  is the precedent for what one costs — an expiry, a revoke, a use count, three `security definer`
  RPCs whose caller is authorised *by a secret rather than by their identity*, and `091`'s whole
  policy surface. A thread link that grants reach into a members-only club conversation is a bigger
  decision than the icon it would sit behind, and it must not arrive by accident because a share
  button needed something to do.

### Q2 — Does waving a thread notify its author? — **NON-BLOCKING · product owner**

**Default: no.** A join wave notifies the joiner, because *welcome* is addressed to a person and is
the whole content of the gesture. A thread wave is ambient approval of a topic, and notifying it
would mean a twelfth notification type, a `thread_id` column on `notifications`, its index (`036`'s
every-cascade-path rule), an arm on `notifications_subject_shape`, and another exhaustive-switch
ordering constraint in the client — for a signal the thread's own screen already shows. If the
owner wants it, it is a follow-up with its own migration rather than a line in this one.

### Q3 — May a rider wave their own thread? — **NON-BLOCKING · engineering**

**Default: yes for a thread, no for a join.** The asymmetry is deliberate and is stated so it is
not read as an oversight. `postcard_likes` permits a self-like and a rider can coherently endorse
their own topic, exactly as they can their own photo. A **self-welcome** is not an expression at
all, and refusing it in the WITH CHECK (`user_id <> subject_user_id`) removes a self-addressed row
from the fan-out's path rather than relying on the fan-out to exclude it — belt and braces on the
one path that writes to somebody else's notification list.

### Q4 — Is the join wave read embedded on `club_members`, or a second batched read? — **NON-BLOCKING · engineering**

**Default: try the embed, fall back to the batched read, and decide by measurement rather than by
argument.** `postcard_likes(count)` works because PostgREST resolves a single-column foreign key;
`club_join_waves`' key into `club_members` is **composite**, and whether PostgREST exposes an
embeddable relationship for it is exactly the sort of thing that quietly does not resolve. The
fallback is `attachLikeState`'s shape — one `.in('subject_user_id', ids).eq('club_id', clubId)`
read folded in client-side — and it is not a lesser artifact, only a second round trip.

### Q5 — Does the Welcome club get wavable join events? — **NON-BLOCKING · product owner**

**Default: yes, unchanged.** The two reasons the Welcome club needed carve-outs elsewhere do not
apply: a wave is opt-in rather than automatic, so nothing fans out per signup, and the unique key
means it cannot stack. The residual exposure is a wave/unwave loop re-lighting one notification,
which is the bound `postcard_likes` has carried since `036` and which `036` accepted once for
likes. **This is the second acceptance of that bound and the owner should know it is a second**,
which is the whole reason it is a question rather than a line in the migration.

### Q6 — Does the join row's overflow carry "Say welcome"? — **NON-BLOCKING · product owner**

**Default: yes (§D3).** It is the words half of the owner's ask and it costs no schema. If it is
declined, the wave still ships and the change is coherent — which is why this is non-blocking
despite being the part of the ask that reads as most important.
