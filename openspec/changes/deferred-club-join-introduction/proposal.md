# The Introduction Sheet Becomes the Join — Post, or Join later, which does not join

> Linear **PD-392** — *"The introduction sheet becomes the join — Post, or Join later, which does
> not join"*, status **Development (AI)**, priority Medium, labels `slot-2` `App` `UX/UI`
> `Improvement`.
>
> **`get_issue` and `list_comments` were both called, on 2026-09-05.** The body is first-hand.
> There is exactly **one** comment and it is the dispatcher's territory claim (`slot: 2`,
> `migration: N`, `primitive: N`, this change directory named at full path) — **nothing overtakes
> the body**, so there is no correction to reconcile into what follows.
>
> It narrows one decision of **PD-365** (`openspec/changes/introduce-yourself-on-joining-a-club/`,
> migration `097`) and inherits **PD-384**'s sheet-ownership rule and **PD-372**'s
> (`openspec/changes/an-introduction-appears-only-as-its-announcement/`) placement rule. All three
> are merged.

> **No migration, and this change must not add one.** The sheet has to open for a rider who is not
> yet a member, which is a client mode driven by the Join control — not a relaxation of
> `owesIntroduction`, and not a column. This branch does not touch `supabase/` at all. If an
> implementer concludes a migration is required, **stop and say so** rather than writing one: it
> would mean §The order is forced below is wrong and this proposal needs re-reading.

## ⚠ Read this first — the four assumptions

Nobody was available to answer while this was written, so each of these is taken under
`CLAUDE.md`'s standing *ambiguity → assume and proceed* instruction, stated here rather than
parked. Each is
independently reversible and §Decisions says who owns it.

**A1. The second control's label is derived from whether a membership exists at that instant, not
from an arrival-path enum.** The issue says *"the sheet learns which path opened it and labels its
second control accordingly"*, and that is exactly the behaviour delivered — but the predicate is
*is there a `club_members` row for this rider in this club right now*, because that formulation
also covers the one case a path enum gets wrong: a `Post` whose join succeeded and whose
introduction then failed. That rider arrived by the Join button and is now a member, so
`Join later` would be a lie on the very screen that just made it one. The two formulations agree on
every other cell, because a Join control renders for a non-member and nobody else.

**A2. `Join later` records NO session dismissal, and the question of whether it should suppress the
members-only sheet therefore does not arise.** The issue says the sheet "should not nag within the
session after `Join later`, and the existing dismissal store already answers that". Measured, the
store is not needed for that: the pre-join sheet is opened by an **explicit tap on a Join control**
and by nothing else, so it cannot reappear on its own. The dismissal store exists to stop a
*state-driven* sheet re-opening on every navigation, and after `Join later` that rule is false
anyway (`owesIntroduction` requires `viewerRole !== null`). So the rule becomes one line — **a
dismissal is recorded if and only if a membership exists when the sheet is dismissed** — which is
the same predicate as A1 and needs no second store, no second key and no new kind. §D2 carries what
this decides about the edge the issue asked to have decided rather than discovered: a rider who
taps `Join later` and then joins by another door in the same session **is** prompted, because
nothing was recorded.

**The iff is one rule with TWO call sites, and the club-detail one is the easier to miss.**
`src/app/(app)/clubs/detail/page.tsx` writes the dismissal from `onDismiss` and `onPosted`, both
unconditional, and `ExploreClubsPage.advanceIntroductions` does the same before advancing its
queue. The detail screen is the surface the issue's own copy is about, so a change that fixes only
Explore ships the defect where it is most likely to be met. §D2 names both, and says why
`onPosted`'s unconditional write is *consistent* with the iff rather than an exception to it.

**A3. The pre-join sheet is offered only where an introduction would be owed; everywhere else the
Join control still joins outright.** The default club is the case that matters and it is a live
one — `JoinClubButton`'s own header records that the welcome club **does** appear on Explore with a
`Join club` button for the 15 of 24 DEV riders who are not members of it. It is exempt from
introductions (`058`, `097`), so if the sheet became the only thing that writes a membership, that
club would become unjoinable. The default-club fact is **read, never assumed**, at both join
controls — `ClubMembershipButton` does not take it today and must.

**A4. The pre-join sheet is opened only after the rider is confirmed to still owe an
introduction.** The Join control asks that question **on tap, before the sheet opens** — one read,
replacing the two round trips the current flow pays after the join. It is not a formality: both
lists that draw a Join control are cached queries, so a row can say `Join club` for a club the
rider already joined in another tab or was admitted to by another door. Opening the pre-join sheet
there would promise a join that has already happened. §D4.

**The pre-join copy names no club**, which is a **choice and not a constraint** — the name is
available at both controls (`ClubCard` already passes `clubName` into `JoinClubButton` for its
`aria-label`, and the detail screen holds `club.data.name`). Recorded as Q5 in §Decisions; the
wording is in §The copy.

## Why

`IntroductionPrompt` opens **after** `joinClub` has written the `club_members` row and
`private.notify_club_joined` has fanned out. Its escape hatch says `Not now`, and a rider reads
that as *"don't join yet"* while it means *"you have joined, and you are not introducing
yourself"*. The decision the sheet appears to be asking about was taken before it opened.

Product owner, 2026-09-03:

> When I am joining a club, there is a popup to add an introduction. I would rather have a post or
> join later (join later will not join the club for now)

**It needs a proposal rather than a ticket because it moves *when a membership row is written*.**
That is a domain rule, and it collides with three other ways a rider reaches the same sheet
already holding the membership this change proposes to defer.

## The order is forced, and it is join-then-introduce

`introduce_to_club` (`097`) **refuses a non-member**: the RPC restates membership, owner,
default-club and duplicate checks inside its `security definer` body, and
`src/lib/actions/club-introductions.ts`'s header lists *"one the caller is not a member of"* among
the six conditions collapsed into its single raise site. So `Post` cannot introduce-and-then-join.
The membership is written first and the introduction second, and they remain **two separately
failable writes** — there is no transaction across them and this change adds no RPC that would
create one.

Two failure points follow, and they are not symmetric:

| Fails | State afterwards | What the rider is told |
|---|---|---|
| The **join** | Nothing written. Not a member. No notification. | The join failed; the sheet stays open, still offering `Join later`, and `Post` may be pressed again |
| The **introduction**, after the join landed | A member who owes an introduction — **exactly today's post-`Not now` state** | That they **have joined** and the introduction did not post; the sheet's second control is now `Not now` |

**The second failure is benign and no compensating delete is proposed.** The rider lands in a state
this app has had by design since `097` (*"A rider who joins and writes no introduction SHALL be a
first-class state"*), and the club detail screen's own state-driven sheet asks them again on their
next visit. A join-then-leave would write a `club_joined` notification to the club and remove the
member underneath it — the exact wake the issue refuses in *"Defer the join; do not undo it"* — and
a compensating delete on this path has precisely that wake, plus `095`'s owner guard and a second
failure point of its own.

## The rule

**One sheet, two modes, and the mode is a fact about the membership.**

| | Pre-join mode | Member mode (today, unchanged) |
|---|---|---|
| Opened by | A tap on a Join control, for a club where an introduction would be owed | `showIntroductionPrompt` — a membership with no introduction |
| Reaches | The Join-button path only | An approved join request (`085`), a claimed invite link (`093`), `058`'s welcome-club auto-join, an invite acceptance, creating a club |
| Second control | **`Join later`** — writes nothing, joins nothing, records nothing | **`Not now`** — writes nothing, records the session dismissal |
| `Post` | Joins, then introduces | Introduces |
| Heading | §The copy | `Welcome to the club!`, byte-for-byte as today |

**The pre-join mode transitions to member mode irreversibly the moment its own join succeeds**, and
it never reads a cache back to decide that. A cache read would be racy against
`invalidateClubMembership`, and the sheet already knows the answer: it issued the write.

**The state rule keeps `viewerRole !== null`.** `owesIntroduction` is untouched, and the pre-join
mode SHALL NOT be expressed by relaxing it. Dropping that conjunct is the tempting simplification
and it would open the sheet on **every public club a non-member visits** — an unsolicited modal on
a browse surface, which is a worse defect than the one being fixed.

## What Changes

### The screen

- **`ClubMembershipButton`** (club detail, full-width) and **`JoinClubButton`** (Explore row,
  link-style) stop writing the membership for a club where an introduction is owed, and ask their
  parent screen to open the sheet in pre-join mode instead. They stay two components; the rule
  about which one draws is unchanged.
- **`ClubMembershipButton` gains the default-club fact** it does not have today, read from the
  club the detail screen already holds. For the default club — and only there — both controls join
  outright with no sheet, exactly as today.
- **`hasIntroducedClub` stays, and moves in front of the sheet.** `JoinClubButton` today joins and
  *then* calls it to decide whether to prompt. It moves to the tap, before anything is written, and
  a rider who turns out to already hold an introduction is joined outright with no sheet. It is
  the **freshness** conjunct and nothing else supplies it: both lists that draw a Join control are
  cached, and `joinClub`'s upsert is `ignoreDuplicates`, so a stale row's tap would report a join
  that created nothing. Net round trips on this path go from two to one. §D4.
- **The sheet tells the page what it knows.** `onDismiss` gains an argument saying whether a
  membership exists at that instant — the sheet issued the join, so it is the only thing that can
  answer, and the alternative is the cache read §D3 refuses. That argument is what makes the
  dismissal iff applicable at both call sites.
- **The sheet stays owned by the screen, not by the row** — PD-384's hazard survives and moves.
  It no longer bites while the sheet is open (nothing has been written, so the row does not leave
  Explore), and it bites the instant `Post`'s join lands: `invalidateClubMembership` moves the row
  to Your clubs and unmounts `JoinClubButton` **while the introduction write is still in flight**.
  A sheet owned by the row would unmount mid-write with the rider's typed words in it.
- **`Post` orchestrates both writes through `src/lib/actions/`**, not from the component: a
  composite action owns the ordering rule and returns which of the two writes failed. Components
  never write; two sequential action calls in a click handler would put the ordering rule in a
  component and leave it untested.
- **Dismissal is inert from `Post` until the MEMBERSHIP write resolves, in pre-join mode only** —
  the second control, the scrim and Escape. That window is exactly the one in which a dismissal
  labelled `Join later` could land over a join that has already committed. It ends when the
  membership write returns, not when both writes do: from that moment the sheet is in member mode,
  where `097`'s *"always present and always closes the sheet, pending or not"* applies unchanged
  and the introduction alone is at stake. Getting that boundary wrong in the other direction would
  make the two rules contradict each other over the introduction's flight.
- **At most one introduction sheet per screen.** On the club detail the state rule turns **true**
  the moment `Post`'s join lands — `viewer_role` becomes `member` and `hasIntroduced` is still
  false — so the state-driven sheet must not open a second one, remount the open one, or reset its
  draft. This is a trap the issue did not anticipate.
- **`IntroductionPrompt.test.tsx`'s two pinned invariants survive**: `Post` inert until the field
  holds non-whitespace text, and the starter as a `placeholder` and never a `defaultValue`. Both
  hold in **both** modes, and the new control is assertable through the same
  `IntroductionPromptBody` seam, because `ContextMenu` renders nothing under
  `environment: 'node'`.

### The copy

Member mode keeps every word it has today. Pre-join mode is new, and *"Welcome to the club!"* is
false there:

| | Pre-join | Member (unchanged) |
|---|---|---|
| Heading | **Introduce yourself** | Welcome to the club! |
| Body | **Post an introduction and you'll join the club.** | Say hello — the club can read it, wave and reply. |
| Second control | **Join later** | Not now |
| Primary | Post | Post |

One more string exists only in this change: when the join lands and the introduction fails, the
sheet says **"You've joined the club. Your introduction couldn't be posted."** — the only place the
product tells a rider that half of a `Post` succeeded, and the reason the second failure above is
not misleading.

### The database

**Nothing.** No table, no column, no policy, no grant, no function, no trigger, no migration, and
therefore no movement in the participation-gate count or the security-advisor count. The
membership write is `joinClub`'s existing `club_members` upsert under the INSERT policy quoted in
§The negative cases, and the introduction write is `097`'s existing RPC.

## Capabilities

### Modified Capabilities

- `club-introductions`: PD-365's *"The prompt SHALL be driven by the ABSENCE of an introduction,
  not by the join action"* is **narrowed, not superseded** — the state rule keeps every one of its
  four conjuncts and keeps reaching all six doors; a second, additive mode is attached to the Join
  control alone. Its *"A rider who joins and writes no introduction SHALL be a first-class state"*
  gains a sibling state — *did not join at all* — and its failure scenario gains the second write's
  ordering.
- `client-render-shell`: the pre-join sheet's states, including the two failure points, the
  in-flight dismissal rule, and the fact that a `Join later` leaves every screen exactly as it was.
- `client-cache-invalidation`: `Join later` invalidates nothing because it wrote nothing; `Post`
  inherits both existing claims in order; and the sheet must outlive the row its own invalidate
  removes.
- `client-session-storage`: the dismissal record's meaning is narrowed to *"I am a member and I am
  not introducing myself now"*, and a declined join records nothing.

### Not modified, asserted rather than assumed

`database-enforced-integrity` — nothing in this change reaches the schema, and the negative cases
below are enforced by policies that already exist rather than by anything it adds. The standing
specs were read; this is a checked "none", not an unstated one.

## The negative cases

Every one is a testable statement about a role and a resource. The first four are the change's
whole point; the rest are the reach questions `openspec/config.yaml` requires for anything touching
clubs and memberships.

1. **A rider who taps `Join later` is not a member.** No `club_members` row, no `club_joined`
   notification, no fan-out, no timeline join row, no roster count change, no `club_threads` row,
   no `club_messages` row, no analytics `club_joined` event. The club still offers Join and reads
   as a non-member on every screen.
2. **`Join later` on a private club cannot create a join request**, and it cannot arise at all.
   **The proof is the policy, not the screen list.** Measured on `letsride-dev`
   (`fpmrimzxadewsaiwpsel`), 2026-09-05:

   ```sql
   select policyname, with_check from pg_policies
    where schemaname='public' and tablename='club_members' and cmd='INSERT';
   -- Users can join public clubs, as a member:
   --   auth.uid() = user_id
   --   AND EXISTS (select 1 from clubs c where c.id = club_id and (c.is_public or c.owner_id = auth.uid()))
   --   AND role = 'member'
   ```

   A direct join is admitted for a **public** club or one the caller **owns**, and for nothing
   else — so the pre-join sheet, which exists to defer exactly that write, has no private-club case
   to get wrong. The screen routing corroborates it (`ClubCard`'s `is_public` ternary picks
   `RequestToJoinButton`; a private club's own screen is `ClubPreviewScreen`), and corroboration is
   all it is: a screen list goes stale the next time a screen is added, and the policy does not.
   No path from this sheet writes, changes or withdraws a `club_join_requests` row.
3. **The three inherited paths keep `Not now` and threaten no membership somebody else's action
   created** — an approved join request (`085`), a claimed invite link (`093`), and `058`'s welcome
   club, which `095` refuses to let anyone leave. A dismissal on those paths joins nothing and
   leaves nothing.
4. **`Join later` is not a rejection that sticks.** It records nothing, so the club is joinable
   again on the next tap, in the same session, with no cooldown and no stored trace.
5. **No rider may join a club through the sheet that they could not join through the button.** The
   INSERT policy quoted above is unchanged, the sheet passes no rider id, and its third conjunct
   (`role = 'member'`) means the deferred write cannot arrive as anything but an ordinary
   membership.
6. **A club's owner and its admins gain nothing.** No role is named anywhere in this change.
7. **A blocked rider's reach is unchanged.** Blocking stays in RLS; this change adds no filter and
   no arm.
8. **A signed-out visitor reaches the shell and no data.** `anon` holds zero grants and this change
   adds none; both join controls sit behind the route guard's default-protected paths.

## Non-Goals

- **No `join_later` analytics event.** Adding one is a product and privacy decision, not a
  consequence of this change — see §Decisions Q3, which carries its default and who owns it.
- **No change to `via`.** `joinClub` keeps capturing `club_joined` with `via: 'browse'`; the sheet
  is a step inside that door, not a seventh door.
- **No atomic join-and-introduce.** `097`'s Non-Goals already declined it and the reason holds
  harder here: a combined RPC would be a **seventh** membership-writing door and would leave the
  other six exactly as they are.
- **No compensating delete, no join-then-leave, no retracted notification.** §The order is forced.
- **No change to `owesIntroduction`, `introduce_to_club`, `joinClub`'s own write, the default-club
  carve-out, the owner carve-out, or the introduction's own audience.**
- **No sheet on any other door.** Creating a club, onboarding's auto-join, an invite acceptance, an
  approved request and a claimed invite link all keep writing their membership where they write it
  today.
- **No editing an introduction, no Realtime, no rate limit** — unchanged from `097`.

## Decisions

| # | Question | Who answers | Status | Default taken |
|---|---|---|---|---|
| **Q1** | Which write goes first, and what on a partial failure? | Forced | **Settled** — measured | Join, then introduce. A failed introduction leaves a member who owes one, told plainly; no compensating delete |
| **Q2** | Path enum or membership predicate for the label? | Agent | **Settled** (A1) | Membership predicate; identical labels, and it also covers the partial failure |
| **Q3** | Does `Join later` emit an analytics event? | Product owner | **OPEN, non-blocking** | **No.** A new PostHog event is new tracking of a rider declining something, and `docs/reference/observability.md` puts each event behind a stated question. If the owner wants "how many riders bail at the sheet", it is a one-line follow-up |
| **Q4** | Does a `Join later` suppress the members-only sheet later that session? | Agent | **Settled** (A2) | **No** — nothing is recorded, so a rider let in by another door is prompted normally |
| **Q5** | Pre-join copy, and does it name the club? | Agent, owner may overrule | **Settled** (A4) | §The copy, **naming no club**. A choice, not a constraint — the name is available at both controls. Reversible in one file; no schema, no predicate compares against it |
| **Q6** | Does the default club still join outright? | Agent | **Settled** (A3) | **Yes** — it is exempt from introductions and would otherwise become unjoinable |
| **Q7** | Keep the `hasIntroducedClub` round trip? | Agent | **Settled** (A4) | **Yes**, moved in front of the sheet. It is the freshness conjunct against a cached Join row, and the path still pays fewer round trips than today |

**Nothing here blocks a build.** Q3 is the only open question and it is additive, owner-owned, and
answerable after this ships.

## Impact

- **Affected specs** — deltas on `club-introductions`, `client-render-shell`,
  `client-cache-invalidation` and `client-session-storage`.
- **Affected code** — `src/components/clubs/IntroductionPrompt.tsx` (the required mode, the second
  control, the latch, the in-flight dismissal rule, the two-failure copy, and `onDismiss`'s new
  argument), `src/components/clubs/JoinClubButton.tsx`,
  `src/components/clubs/ClubMembershipButton.tsx` (gains the default-club fact and an opener
  callback), `src/app/(app)/clubs/detail/page.tsx` (**its own `onDismiss` stops recording a
  dismissal for a declined join** — the same defect as Explore's, on the screen the story is
  about), `src/app/(app)/clubs/explore/page.tsx` (`advanceIntroductions`, likewise),
  `src/lib/actions/club-introductions.ts` (the composite that owns the ordering),
  `src/lib/validation/clubs.ts` (copy constants only),
  `src/components/clubs/__tests__/IntroductionPrompt.test.tsx`,
  `src/components/clubs/__tests__/JoinClubButton.test.tsx`, `docs/FIGMA-FIDELITY-TODO.md` (the
  sheet has no v2 frame; the second mode is composition and is logged where the first one is).
  **`src/lib/clubs/introduction-dismissal.ts` is expected to need no change at all** — see §D2.
- **Affected database** — none. No migration, so `openspec/config.yaml`'s rule pairing a migration
  with new `supabase/tests/rls_test.sql` assertions is satisfied by there being no migration, and
  **not** by skipping assertions for one.
- **Promotion** — nothing to sequence. No migration means no ordering rule in either direction, and
  the change is safe against DEV's and PROD's schemas as they stand.
