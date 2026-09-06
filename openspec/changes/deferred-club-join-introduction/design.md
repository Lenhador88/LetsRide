# Design — the introduction sheet becomes the join

Six decisions. Each is the version a careful implementer would otherwise re-derive differently,
and each names the wrong shape it was chosen over.

## D1 — The ordering is forced, and the compensating delete is refused

**`introduce_to_club` refuses a non-member.** `097` restates membership, owner, default-club and
duplicate checks inside a `security definer` body, collapsed into one raise site;
`src/lib/actions/club-introductions.ts`'s header lists *"one the caller is not a member of"* among
the six conditions behind that single message. So there is no arm in which `Post` introduces first.

Three shapes were available and two are refused:

| Shape | Verdict |
|---|---|
| Join, then introduce | **Chosen.** The only order the RPC permits |
| Introduce, then join | Impossible — the RPC refuses the write |
| Join, introduce, and delete the membership if the introduction fails | **Refused** — §below |

**The compensating delete is refused for three reasons, and the first is the issue's own.** The
issue says *"Defer the join; do not undo it"* because a join-then-leave writes a `club_joined`
notification to the club and then removes the member underneath it, so every reader sees an arrival
that is no longer there. A compensating delete on the failure path has the identical wake, on the
rarer and more confusing occasion. Second, it has a failure point of its own, and there is no
transaction to make it atomic — PostgREST has no multi-statement request, which is why `createClub`
already lives with two inserts and no transaction. Third, `095`'s
`private.protect_club_owner_membership` refuses some deletes outright, so the compensation is not
even total.

**What the rider gets instead is a state this app already designs for.** `097`'s standing
requirement *"A rider who joins and writes no introduction SHALL be a first-class state"* names a
dismissal, a failed write, a closed tab and a lost connection as its sources. A failed second write
is the same state by the same route, and the club detail's state-driven sheet asks again on the
next visit. The only thing owed is that the rider be **told they joined** — which is the one new
string this change adds, and the reason the failure is benign rather than merely tolerated.

## D2 — `Join later` records nothing, and that is what decides the edge case

The issue asks whether `src/lib/clubs/introduction-dismissal.ts` is the right store for a dismissal
that now means *"did not join"*, and whether such a dismissal should block the members-only sheet
later in the same session if the rider joins by another door.

**Measured: no dismissal is needed on that path at all.** The store exists for one job, stated in
its own header — the members-only rule *"is satisfied for ever once an introduction exists, but a
rider who taps `Not now` has not written one, so without this the very next navigation to the same
club would ask again"*. That is a property of a **state-driven** sheet. The pre-join sheet is
state-driven by nothing: it opens on an explicit tap of a Join control and closes, and after
`Join later` the state rule is false anyway because `owesIntroduction` requires
`viewerRole !== null` and the rider is not a member. Nothing can re-open it but another tap, and a
tap is not a nag.

**So the rule is one predicate, the same one that picks the label:**

```
dismissing the sheet records a session dismissal  <=>  a membership exists at that moment
```

- `Join later` (no membership) → record nothing.
- `Not now` (membership, however it came to exist) → record, exactly as today.
- `Not now` **after a partial `Post`** (join landed, introduction failed) → record, because the
  rider is a member who owes an introduction and would otherwise be asked again on the next
  navigation to a club they just declined to introduce themselves to.

**The consequence, decided rather than discovered:** a rider who taps `Join later` on a club and
then joins it ten minutes later through an approved request or an invite link **is** prompted, in
the same session. That is correct — the earlier answer was *"I am not joining"*, and they have since
joined; treating the first as consent to silence the second would suppress a prompt the rider never
declined.

**Two shapes were rejected.** A second store, or a `kind` on the stored value, buys nothing over
"record nothing" and adds a second thing to keep swept on sign-out. Recording the club id anyway
"for symmetry" is the actively wrong one: it silences the members-only sheet on a fact the rider
never asserted.

**The store module is therefore expected to need no change** — same `sessionStorage`, same
per-(rider, club) key, same silent failure, same `signOut` sweep, same `useSyncExternalStore`
read. **The change is entirely at the call sites, and there are TWO of them:**

| Call site | Today | Under the iff |
|---|---|---|
| `src/app/(app)/clubs/detail/page.tsx` — `onDismiss` | `dismissIntroductionPrompt(id)`, unconditional | Records only when a membership exists |
| `src/app/(app)/clubs/detail/page.tsx` — `onPosted` | `dismissIntroductionPrompt(id)`, unconditional | **Unchanged** — see below |
| `src/app/(app)/clubs/explore/page.tsx` — `advanceIntroductions` | `dismissIntroductionPrompt(introducingClubId)`, unconditional, before advancing the queue | Records only when a membership exists |

**The club-detail one is the easier to miss and the more damaging.** The pre-join sheet is opened
from that screen by `ClubMembershipButton`, and `ContextMenu`'s scrim closes through the same
`onDismiss` — so a scrim tap, an Escape or the `Join later` control all reach one unconditional
write. A rider who declines the join on club X's own screen, and is later admitted to X by an
approved request or an invite link in the same session, then navigates to X and is **never asked**.
That is the exact behaviour three requirements of this change forbid, and it is reachable on the
screen the story's own copy is about. A change that fixes Explore alone ships it.

**`onPosted` keeps writing unconditionally, and that is the iff rather than an exception to it.** A
successful `Post` means a membership exists — that is what `Post` did. The write is there because
recording it on the same tick closes the sheet without waiting on the invalidated `hasIntroduced`
read to come back and say the same thing, and dropping it as collateral while applying the iff
would put a round trip back in front of the sheet closing.

## D3 — The mode is a prop that latches, never a cache read

The sheet needs to know whether a membership exists. Three sources:

| Source | Verdict |
|---|---|
| A `mode` prop from the opener, latching to `member` when its own join succeeds | **Chosen** |
| Reading `club.viewer_role` back from the query cache | **Refused** — racy |
| A fresh `club_members` read when the sheet opens | **Refused** — a round trip to answer a question the opener already knows |

The cache read loses on a race that is not hypothetical: `joinClub` calls
`invalidateClubMembership`, which invalidates `queryKeys.clubs.all()`, and the refetch resolves on
its own schedule. Between the join returning and the club query resolving, a cache-reading sheet
still says `Join later` about a membership that exists. The sheet issued the write; it does not
need to be told.

**The latch is one-way.** Nothing turns member mode back into pre-join mode, including a failed
introduction, because the membership does not go away.

**The latch lives IN the sheet, per instance, and hoisting it to the page is a defect.** A sheet
instance is one club — Explore keys it `key={introducingClubId}`, and the club detail screen is a
single club by construction — so per-instance already means per-(rider, club). A page-level latch
would leak club A's answer into club B: after A's `Post` lands, B's sheet would open in member mode
and call `introduceToClub` alone, which `097` refuses for a non-member. B becomes unjoinable, and
the failure surfaces as an introduction error rather than as anything about joining. This is why
the spec says *the life of that sheet instance* rather than *its life*: the scope is load-bearing,
not incidental phrasing.

**And the page has to be told, because the page is what writes the dismissal.** The membership fact
lives in the sheet — it is the only thing that knows its own write returned — while
`dismissIntroductionPrompt` is called by the screen. `onDismiss` therefore carries the answer out:
it takes whether a membership exists at that instant. Without it the iff has no mechanism on the
one branch that most needs it, the partial `Post`, where the sheet is in member mode and the page
would otherwise still believe it opened a pre-join sheet. The alternative — the page re-reading the
cache — is the shape refused at the top of this section, for the same race.

**And the state-driven sheet must not collide with it.** On the club detail screen,
`showIntroductionPrompt` becomes **true** the moment `Post`'s join lands — `viewer_role` is
`member`, `hasIntroduced` is still `false`, and no dismissal is recorded — while the pre-join sheet
is open with the rider's words in it. One sheet is mounted per screen, and the state rule may not
open a second, remount the open one, or reset its draft. In the current shape both would be the
same `<IntroductionPrompt>` element, so the hazard is a `key` or an `open` expression rather than a
second mount — which is precisely the kind of thing that reverses in silence and is why it is a
spec requirement rather than a comment.

## D4 — The default club still joins outright, and the fact is read

`JoinClubButton`'s header records the measurement: the welcome club is `is_public = true`,
`getExploreClubs` filters on `is_public` alone with no `is_default` exclusion, and **15 of 24 DEV
riders were not members of it** — through a leave (`club_members` DELETE is a bare
`auth.uid() = user_id`) or through `059` §2's join that selected zero rows and reported success.
So a `Join club` button on the welcome club is a live state, not a hypothetical.

It is exempt from introductions (`058`, `097` §Q3). If the sheet became the only writer of a
membership, that exemption would make the club **unjoinable**. So the rule is: where no
introduction would be owed, the Join control writes the membership immediately and opens no sheet —
today's behaviour, unchanged.

**The decision needs `clubs.is_default` AND the existing `hasIntroducedClub` read, and the read
moves rather than going.** An earlier revision of this section deleted it as redundant, reasoning
that `owesIntroduction`'s other three conjuncts are known from position: a Join control renders for
a non-member alone, so the rider is neither owner nor member, and `097`'s column-scoped
`ON DELETE SET NULL` nulls a former member's marker, so a rejoiner has no introduction to find.
**Two of those hold and the third does not.** Position tells you what the *list* believed when it
was fetched, and both lists carrying a Join control are cached queries.

The failure it drops is a **stale Join row**, and it is silent in both halves:

```
rider joins club X in another tab, or is admitted by an approved request / an invite link
   → this tab's cached Explore row still draws `Join club`
   → tap  → pre-join sheet: "Post an introduction and you'll join the club."   ← already a member
   → Post → joinClub upserts with { ignoreDuplicates: true }  → NO ERROR, and NO ROW WRITTEN
          → the composite reads that as "the join succeeded"
          → introduceToClub is refused: 097's partial unique index already holds one
          → the sheet shows "You've joined the club. Your introduction couldn't be posted."
```

Both halves of that sentence are false — nothing was joined, and the introduction was refused
because one already exists. Today `hasIntroducedClub` prevents the sheet opening at all, and that
guard is the thing to keep.

**So it is issued on tap, before anything is written**, and a rider who turns out to already owe
nothing is joined outright with no sheet. The path is still cheaper than today's: one read before
the sheet, against today's `joinClub` **and** `hasIntroducedClub` after it.

**Two things follow and are written into the spec rather than left here.** *"The join succeeded"*
means *the upsert did not error*, never *a membership was created* — `ignoreDuplicates` makes those
different statements — so no copy may assert a creation. And the **owner** conjunct is now asserted
from position rather than read, which is safe only because an ownerless owner is unreachable:
`103` seeds the creator's membership row and `095`'s `protect_club_owner_membership` refuses to
delete it while the club stands. Measured on `letsride-dev` (`fpmrimzxadewsaiwpsel`), 2026-09-05:

```sql
select count(*) from clubs c where not exists (
  select 1 from club_members m where m.club_id = c.id and m.user_id = c.owner_id);
-- 0
```

The premise is stated with the thing that
makes it true, because if either of those is ever relaxed this inference goes with it.

**It is read, never assumed, at both controls.** `JoinClubButton` already takes it as a prop for
exactly this reason and its header records the defect that came of asserting it.
`ClubMembershipButton` does not take it today and must — the club detail screen holds
`club.data.is_default` and passes it down. A hardcoded `false` there would put the sheet in front of
a rider joining the welcome club, which is the mirror image of the defect `097` fixed.

## D5 — The copy, and what it may not do

Member mode keeps every word. Pre-join mode gets its own, because *"Welcome to the club!"* asserts
a membership that does not exist yet, and a heading that is false is worse than a plain one.

```
Introduce yourself
Post an introduction and you'll join the club.

[ Join later ]                              [ Post ]
```

**No club name — a choice, and it is worth saying that it is one.** The name is available at both
controls: `ClubCard` already passes `clubName` into `JoinClubButton` for its `aria-label`, and the
club detail screen holds `club.data.name`, so nothing prevents *"Introduce yourself to the Night
Owls"*. An earlier revision of this section claimed the sheet could not get the name and that was
simply false. It is left out because the sheet already sits over the club it is about on the detail
screen, and on Explore it is opened by a tap on a named row seconds earlier — and because a name in
the heading is a name to keep correct in a component mounted above the row that supplied it. The
owner may overrule it; it is Q5, and it is one string.

**The starter stays a `placeholder` in both modes.** `097` §Q3's collision is unchanged and its
reasoning does not depend on the mode: a prefilled value is never empty, so `Post` would be live on
open, and in pre-join mode that is worse — one tap would both post a canned sentence and join a
club.

**One new string carries the partial failure:** *"You've joined the club. Your introduction
couldn't be posted."* It replaces the bare introduction error on that one path, because the bare
error under a `Join later` label would tell the rider nothing happened when a membership was
created.

**Nothing may compare against any of this copy** — the standing rule from `097` §*The suggested
starter SHALL be copy* extends to the mode's own wording. The mode is decided by the membership,
never by reading a heading.

## D6 — The Explore queue keeps its shape, and its hazard moves rather than going

`ExploreClubsPage` holds a **queue** of club ids rather than one id, and `key={introducingClubId}`
remounts the sheet per club. `097`/PD-384 built that against two named defects: a misdirected
introduction (the id flips under a live draft and the rider's words about club A are posted to club
B) and a dropped prompt.

Under pre-join, the *arrival rate* of the hazard drops — the sheet is `aria-modal` over a scrim
with `body` overflow hidden, so a second `Join club` cannot be tapped while it is open, and no row
leaves the list while nothing is written. **The hazard does not go**, and one half of it gets
sharper: the moment `Post`'s join succeeds, `invalidateClubMembership` moves the row to Your clubs
and unmounts `JoinClubButton` **while the introduction write is still in flight and the rider's
words are on screen**. A sheet owned by the row would take the draft with it.

So the invariants survive verbatim and are restated in the spec rather than left to the queue's
implementation: the sheet is owned by something that outlives the row, and a draft can never be
posted to a club other than the one it was composed for. Whether the queue stays a queue or becomes
a single slot is an implementation choice; those two properties are not.
