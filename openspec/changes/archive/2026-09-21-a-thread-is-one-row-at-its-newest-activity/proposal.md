# A thread is one row on its timeline, at its newest activity

> Linear **PD-439** — *"A thread is ONE row on the timeline, at its newest activity — not one for
> the start and another for the reply"*, status **Development (AI)**, labels `slot-1` `App`
> `Database` `UX/UI` `Improvement`.
>
> **`get_issue` and `list_comments` were both called, on 2026-09-08.** The body is first-hand.
> There is exactly one comment — the dispatcher's territory claim — and it **overtakes the body on
> one fact**: the migration number is **`116`**, not the `115` the body predicts, because
> `115_a_stranger_sees_the_ride` landed between the issue being written and this firing. Re-measured
> here in both directions and `116` is genuinely free (`design.md` §D1).
>
> **No existing change owns this.** All seven candidates were read and ruled out — see
> `design.md` §D0.

## Why

A thread that has been replied to draws **two** rows on its club's timeline and two on its ride's:
one at the thread's `created_at`, one at the newest reply's. Both render the same row component and
link to the same thread. Product owner, 2026-09-07, on DEV: *"in a ride details, and in a club
details, when I create a thread, and I reply to it, it shows up in 2 different lines in the
timeline. It should just show the threads, and the thread has the comment icon with a count. So no
need for 2 entries or more. just display the thread item in the timeline."*

**On the club the redundancy is already visible inside the row.** `ClubTimelineThreadRow` draws the
reply count with its `partial` flag (`12+ replies`) and the participant faces, so the thread's own
row already says everything the separate reply row adds.

**The single row sits at NEWEST ACTIVITY. The decision is the product owner's, 2026-09-07, and is
not reopened here.** Option A of three; merging onto the creation date was explicitly rejected,
because a thread started in March with a reply this morning would sink back to March and drop out
of the window — deleting exactly the signal the reply row exists to carry.

**That is why this carries a migration.** Neither thread table has a sort key for "newest
activity"; it is derived today from a bounded message window. That is tolerable on a ride, which
reads every source whole at a bound and does not page. It leaks on a club, which **does** page: a
thread whose newest reply falls outside the fetched message window has no known position, so a
merged row would be placed at its creation date anyway — reintroducing the sinking bug for exactly
the quiet-then-revived threads this change exists to surface.

## What Changes

- **Migration `116` adds `last_activity_at` to `club_threads` and `ride_threads`** — `not null`,
  defaulting to the thread's own `created_at`, maintained by an `AFTER INSERT` trigger on
  `club_messages` and `ride_thread_messages` as `greatest(last_activity_at, new.created_at)`, and
  **backfilled** from each thread's newest message.
- **The column is server-owned.** No INSERT grant, no UPDATE grant, no UPDATE policy — which means
  the trigger function must be `security definer`, or every reply insert fails outright. Measured;
  `design.md` §D2.
- **Both timelines drop the `reply` event kind.** The thread source is ordered, bounded and
  horizoned on `last_activity_at` instead of `created_at`.
- **The reply source stays on both timelines as a *decoration* source.** It supplies the per-thread
  reply count, the `partial` flag and (on the club) the participant faces. It emits no stream rows,
  so **its horizon leaves the merge's horizon list** — a source that draws nothing must not cut the
  stream. Its horizon still governs whether a count is exact or a floor.
- **The ride's thread row gains a reply count and the `partial` flag in the same change.** A bare
  total that row cannot know is the defect `RideTimelineThreadRow`'s own header exists to prevent.
- **`absorbClubTimelineWindow` must de-duplicate by id, not by interval.** Its correctness rests on
  a row's position being immutable, and this change makes one row type's position mutable. Left
  alone it draws a bumped thread **twice**, with one React key — the very defect being fixed.
  `design.md` §D4; this is the most dangerous thing in the change.
- **Posting or erasing a reply must invalidate the thread source key**, which it does not today.
  Without it the bump is invisible until the next mount.

## Impact

- **Migration** `116` — two columns, two triggers, two backfills, one index per table. Additive and
  the client reads it, so **migration-first**: apply, then deploy.
- `src/lib/data/club-timeline.ts`, `src/lib/data/ride-timeline.ts`, `src/lib/data/club-threads.ts`,
  `src/lib/data/ride-threads.ts`
- `src/components/clubs/ClubTimeline.tsx`, `ClubTimelineThreadRow.tsx`,
  `src/components/rides/RideTimeline.tsx`, `RideTimelineThreadRow.tsx`
- `src/types/index.ts`, `supabase/tests/rls_test.sql`
- **No policy changes.** `081`'s SELECT on `club_threads` and `108`'s on `ride_threads` are
  untouched; the new column is a sort key and never an audience predicate.

## Negative cases — who must NOT see or do this

Nobody's audience changes. Stated per role because an unstated negative becomes whatever the
migration author assumed.

| Role | Club thread row | Ride thread row |
|---|---|---|
| **Owner / admin / member** of the club | Sees it, once, at `last_activity_at` | n/a |
| **Non-member** of a public club | Zero rows from `081`; the timeline is refused entire | n/a |
| **Non-member** of a private club | Not mounted; the reduced preview gains no read | n/a |
| **Blocked rider** (either direction) | Absent, by `private.is_blocked` inside `081` | Absent, by `108`'s block arm |
| **Signed-out visitor** | Nothing. No `anon` grant on either table, no policy naming `anon`, and `ride_invite_link_public_preview` returns six ride columns and no thread | Same |
| **Ride crew** | n/a | Sees it, once, at `last_activity_at` |
| **Non-crew rider who can see the ride** | n/a | Zero rows from `108`; no thread row, no count |

And the writes:

- **No rider may bump their own thread**, or any other rider's. `last_activity_at` carries no
  INSERT grant and no UPDATE grant, and neither table has an UPDATE policy for `authenticated` at
  all — two independent refusals. The only writer is the trigger.
- **No rider may bump a thread by writing a message they could not otherwise write.** The bump is
  a consequence of an insert the participation gate and `082`/`108`'s WITH CHECK already allowed;
  it adds no write path.
- **A reply the reader may not see SHALL NOT move a thread they can see.** It can, and that is
  correct and deliberate: `last_activity_at` is a property of the thread, not of the reader. There
  is no reader for whom a message in a thread they can read is invisible — `082`'s and `108`'s
  message policies are the thread's policy plus the block arm — so the only rows that can bump a
  thread a reader sees are rows from a blocked rider. `design.md` §D6 states what a reader can
  infer from that and why it is judged acceptable.

## Open questions

Every one has a recommended default, so the build proceeds and gets corrected.

**Q1 — non-blocking, product owner.** Should a thread bump on a *wave*, or only on a message?
**Default: message only.** `101` dropped `club_thread_waves`; the surviving waves are on postcards
and introductions, so there is nothing on a thread to bump from and no work is implied. Revisit
only if a thread-level reaction returns.

**Q2 — non-blocking, build.** Should the club's thread source keep `CLUB_THREADS_PAGE_SIZE` as its
bound now that its ordering dimension changed? **Default: yes, unchanged.** The bound counts
threads either way; only the column it orders and cuts on changes.

**Q3 — non-blocking, product owner.** Does a *moderator's takedown* of a message un-bump the
thread? **Default: no** — decided in the issue and restated here: recomputing on DELETE costs a
scan per moderation action, and the activity did happen. A thread whose only reply was removed
keeps its bumped position until the next real message.

**Q4 — non-blocking, build.** Does the ride's thread row draw participant faces like the club's?
**Default: no.** The count and the `partial` flag are what the issue asks for; faces need
`collapseToNewestPerThread`'s participant bookkeeping on the ride's simpler collapse, which is
additive later and is not what the owner reported.
