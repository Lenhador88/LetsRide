## MODIFIED Requirements

### Requirement: The prompt SHALL be driven by the ABSENCE of an introduction, not by the join action

A rider SHALL be prompted for an introduction when, and only when, all of the following hold: they
hold a membership of the club; their role is not `owner`; the club is not the default club; and no
introduction exists for that membership.

This rule SHALL be evaluated from state the screen reads for itself, so that it holds for **every**
way a membership comes into existence — the Join button, creating a club, onboarding's auto-join,
an admin approving a request, accepting an invite, and claiming an invite link. A prompt attached
to one write path SHALL be treated as incomplete.

**The prompt SHALL NOT appear during onboarding.** The default club is joined by every rider inside
a wizard that has no skip affordance, and a prompt there would be the first thing a new rider is
asked and the one they least understand.

**A club's owner SHALL NOT be prompted**, because a club's owner is a member of it and introducing
yourself to a club you founded expresses nothing.

**This rule is NARROWED and SHALL NOT be relaxed.** A second, additive mode of the same sheet is
attached to the Join control for a rider who is **not yet** a member, and it SHALL be expressed as
a mode of that control, never by weakening a conjunct of the rule above. In particular the
membership conjunct SHALL remain: a rule that prompts a non-member on the club's own screen would
open an unsolicited modal on every public club a rider browses, which is a worse defect than the
one the second mode exists to fix.

#### Scenario: Every door reaches the same rule
- **WHEN** a membership is created by any of the six paths
- **THEN** the rider SHALL be prompted on the club's own screen if and only if the rule above holds
- **AND** no path SHALL be special-cased to prompt or to suppress

#### Scenario: Onboarding is never interrupted
- **WHEN** a rider completes onboarding and is auto-joined to the default club
- **THEN** no introduction prompt SHALL appear at any point in the wizard
- **AND** none SHALL appear on the default club afterwards

#### Scenario: The founder is not asked
- **WHEN** a rider creates a club
- **THEN** they SHALL NOT be prompted to introduce themselves to it

#### Scenario: The membership conjunct survives the second mode
- **WHEN** a signed-in rider who is not a member opens a public club and taps nothing
- **THEN** no introduction sheet SHALL open
- **AND** the state rule SHALL still require a membership, a non-`owner` role, a non-default club
  and the absence of an introduction

### Requirement: A rider who joins and writes no introduction SHALL be a first-class state

"Joined, no introduction" SHALL exist by construction and SHALL be rendered as an ordinary join
row — the sentence, the time and the wave — with no comment affordance, no placeholder and no
appeal to write one. It SHALL arise from a dismissal, a failed write, a closed tab, a lost
connection, any of the doors that do not prompt, and every membership that predates this change.

No migration SHALL backfill an introduction, and none is needed.

**"Neither joined nor introduced" SHALL be a first-class state too**, reached by declining the
pre-join sheet. It SHALL be indistinguishable, on every screen and in every table, from a rider who
never opened the sheet at all.

#### Scenario: An existing membership needs no backfill
- **WHEN** this change is applied to a database holding memberships
- **THEN** every existing join row SHALL render exactly as it did before, plus nothing
- **AND** no row SHALL be written by the migration

#### Scenario: A failed introduction leaves a joined rider
- **WHEN** the introduction write fails after the membership was created
- **THEN** the rider SHALL still be a member
- **AND** the failure SHALL be shown as a failure of the introduction, never of the join
- **AND** the rider SHALL be told, in the sheet, that they have joined

#### Scenario: A declined pre-join sheet leaves no trace
- **WHEN** a rider opens the pre-join sheet and declines it
- **THEN** no `club_members`, `club_threads` or `club_messages` row SHALL exist for them in that
  club
- **AND** their state SHALL be identical to a rider who never tapped the Join control

## ADDED Requirements

### Requirement: On the Join-control path the membership SHALL be written by Post, and by nothing else

Where an introduction would be owed, tapping a Join control SHALL write **no** membership row. It
SHALL open the introduction sheet, and the membership SHALL be created by `Post` alone.

`Post` SHALL write the membership first and the introduction second. That order is forced rather
than chosen: the introduction-writing function refuses a caller who is not a member of the club, so
no order exists in which the introduction precedes the join.

The two writes SHALL remain **separately failable**. This change SHALL NOT introduce a function,
RPC or transaction that performs both, because such a function would be a further membership-writing
door and would leave every existing door exactly as it is.

Both writes SHALL be issued from the actions layer, not from a component, so that the ordering rule
has one named home and is testable.

#### Scenario: Tapping Join writes nothing
- **WHEN** a rider taps a Join control for a club where an introduction would be owed
- **THEN** no `club_members` row SHALL be written
- **AND** no notification SHALL be fanned out
- **AND** the sheet SHALL open

#### Scenario: Post joins and then introduces
- **WHEN** a rider composes an introduction in the pre-join sheet and presses `Post`
- **THEN** the membership SHALL be written first
- **AND** the introduction SHALL be written second, by the existing introduction function,
  unchanged
- **AND** neither write SHALL take a rider id; the subject SHALL come from the session alone

#### Scenario: The join fails
- **WHEN** the membership write fails
- **THEN** no introduction SHALL be attempted
- **AND** the rider SHALL NOT be a member
- **AND** the sheet SHALL stay open, still offering to defer, and `Post` SHALL be pressable again

#### Scenario: The introduction fails after the join landed
- **WHEN** the membership write succeeds and the introduction write then fails
- **THEN** the membership SHALL be kept
- **AND** no compensating delete, leave or retraction SHALL be attempted
- **AND** the rider SHALL be told that they joined and that the introduction did not post
- **AND** the resulting state SHALL be the ordinary "joined, no introduction" state, so the
  state-driven prompt asks again on the next visit

### Requirement: The sheet's second control SHALL be decided by whether a membership exists, and SHALL NOT threaten one it did not create

The sheet SHALL offer exactly one control that closes it without writing an introduction, and what
that control means SHALL be a function of whether the rider holds a membership of the club at the
moment it is offered:

- **No membership** — it SHALL offer to defer the join, SHALL write nothing, SHALL join nothing,
  and SHALL leave every screen exactly as it was before the Join control was tapped.
- **A membership** — it SHALL decline the introduction only, exactly as it does today. It SHALL
  NOT remove, weaken or offer to undo the membership.

The membership fact SHALL be known to the sheet from the control that opened it and from its own
successful write, and SHALL NOT be re-read from a cache: an invalidation issued by the membership
write resolves on its own schedule, so a cache-derived label can offer to defer a join that has
already happened.

Once a membership exists the sheet SHALL NOT return to offering deferral, for the remainder of
**that sheet instance's** life. The scope is one club and is load-bearing: an instance is opened
for a single club, and a membership fact held wider than one instance would put a second club's
sheet into member mode on the strength of the first club's join — which would then attempt an
introduction for a club the rider has not joined, and be refused.

The sheet SHALL also make that fact available to whatever dismisses it, because the component that
records a dismissal is not the component that issued the write.

#### Scenario: One club's join does not settle another's
- **WHEN** a rider posts an introduction to one club and then opens the sheet for a different club
  they have not joined
- **THEN** the second sheet SHALL offer to defer the join
- **AND** its `Post` SHALL write a membership for that club before attempting an introduction

#### Scenario: A rider who defers is not a member
- **WHEN** a rider declines the sheet before any membership exists
- **THEN** they SHALL hold no membership of that club
- **AND** the club SHALL still offer to join, on every screen that offered before
- **AND** no `club_joined` notification SHALL have been written to anybody

#### Scenario: The three inherited paths still decline only the introduction
- **WHEN** the sheet is shown to a rider whose membership was created by an approved join request,
  by claiming an invite link, or by onboarding's auto-join of the default club
- **THEN** its second control SHALL decline the introduction alone
- **AND** it SHALL NOT offer to defer, undo or leave the membership
- **AND** no membership SHALL be removed by any path in this capability

#### Scenario: The label follows a partial Post
- **WHEN** `Post`'s membership write succeeds and its introduction write fails
- **THEN** the sheet SHALL no longer offer to defer the join
- **AND** its second control SHALL decline the introduction alone

#### Scenario: Deferral is not a rejection that sticks
- **WHEN** a rider defers and then taps the Join control again
- **THEN** the sheet SHALL open again
- **AND** no cooldown, suppression or stored refusal SHALL prevent it

### Requirement: The deferred-join sheet SHALL be offered only where a Join control is offered, and SHALL never reach a request path

The pre-join sheet SHALL be reachable only from a control that would otherwise write a
`club_members` row directly. It SHALL NOT be mounted on, or reachable from, any control that asks
to join rather than joins:

- a **private** club's Explore row, which asks rather than joins;
- a **private** club's reduced preview screen, which asks rather than joins;
- an **invite-link claim**, which is a token claim and not a membership insert;
- an **invite acceptance** and an **admin's approval of a request**, neither of which is the
  joining rider's own write.

**No path from this sheet SHALL write a join request.** Deferring SHALL NOT create, modify or
withdraw a `club_join_requests` row, and pressing `Post` SHALL NOT convert into a request for a club
that cannot be joined directly.

The sheet SHALL grant no reach a Join control does not already grant. No rider SHALL be able to
join, through the sheet, a club they could not join through the control that opened it; the
membership policy SHALL remain the only thing that decides.

#### Scenario: A private club is asked, never deferred
- **WHEN** a rider meets a private club they are not in, on any screen
- **THEN** they SHALL be offered a request control and no introduction sheet SHALL open
- **AND** deferring is unreachable, so no request SHALL be created by it

#### Scenario: Deferral writes no request
- **WHEN** a rider defers the pre-join sheet for any club
- **THEN** no `club_join_requests` row SHALL be written, changed or removed

#### Scenario: The sheet adds no reach
- **WHEN** `Post` writes a membership
- **THEN** it SHALL be refused or permitted by exactly the policy that governs the Join control
- **AND** the write SHALL name no rider but the caller

### Requirement: The sheet SHALL open only after the rider is confirmed to still owe an introduction, and a successful join SHALL NOT be read as a created membership

A Join control SHALL confirm, at the moment it is tapped and before anything is written, that the
rider still owes an introduction for that club. A control's own position SHALL NOT be treated as
that confirmation: the lists that draw it are cached, so a row may offer to join a club the rider
already joined in another tab or was admitted to by another door.

Where the confirmation says no introduction is owed, the control SHALL join outright and SHALL open
no sheet, exactly as for a club exempt from introductions.

**A membership write that does not error SHALL NOT be reported as a membership created.** The write
is an upsert that ignores duplicates, so "no error" includes "this rider was already a member and
nothing was written". No copy, state or claim SHALL assert that the rider has just joined on the
strength of that alone.

#### Scenario: A stale Join row does not promise a join
- **WHEN** a rider taps a Join control on a list row for a club they have already joined and
  introduced themselves to
- **THEN** no pre-join sheet SHALL open
- **AND** no screen SHALL state that they have just joined

#### Scenario: The confirmation precedes the write
- **WHEN** a Join control is tapped for a club where an introduction may be owed
- **THEN** the confirmation SHALL be issued before any membership or introduction write
- **AND** the sheet SHALL open only if an introduction is genuinely still owed

#### Scenario: A no-op upsert is not a join
- **WHEN** the membership write succeeds without creating a row
- **THEN** the rider SHALL NOT be told that they joined

### Requirement: A club exempt from introductions SHALL still be joinable in one tap

Where the prompt rule would owe no introduction, the Join control SHALL write the membership
immediately and SHALL open no sheet. The default club is the case this exists for: it is exempt
from introductions and it is reachable with a join control, so a sheet-only join path would make it
unjoinable.

The exemption SHALL be **read** from the club, never assumed by a control from its position in the
product. Every join control SHALL know the club's default-club status from data.

#### Scenario: The default club joins outright
- **WHEN** a rider taps a Join control on the default club
- **THEN** the membership SHALL be written immediately
- **AND** no introduction sheet SHALL open, in either mode

#### Scenario: The exemption is read, not assumed
- **WHEN** any join control decides whether to open the sheet
- **THEN** it SHALL take the club's default-club status from the club's own data
- **AND** no control SHALL hardcode it on the grounds that the default club cannot appear there

### Requirement: The prompt SHALL NOT be suppressed by anything the rider did while not a member

A rider SHALL be prompted for an introduction whenever the state rule holds and they have not
declined **that** prompt in this session. Declining to join is not declining to introduce yourself,
and SHALL NOT suppress the prompt: a rider who defers a join and is then admitted to the same club
by another door in the same session SHALL be prompted.

**What is recorded, and when, is owned by `client-session-storage`** — *A session dismissal SHALL
record only a declined introduction, never a declined join* — and SHALL NOT be restated here. This
requirement owns only the consequence for the prompt.

The rule SHALL be applied wherever a dismissal is recorded, and there is more than one such place:
every screen that mounts the sheet writes its own dismissal. A screen that applies it and a screen
that does not is the defect, not a partial fix.

#### Scenario: A deferral does not silence a later membership
- **WHEN** a rider defers a join and is admitted to the same club later in the same session, by an
  approved request, an invite or a claimed invite link
- **THEN** the prompt SHALL be shown on that club's screen
- **AND** it SHALL offer to decline the introduction only

#### Scenario: The rule holds on every screen that mounts the sheet
- **WHEN** a rider defers a join from a club's own screen, rather than from a list
- **THEN** the outcome SHALL be identical to deferring it from a list
- **AND** no screen SHALL record a dismissal for a rider who is not a member

#### Scenario: A declined introduction still suppresses the prompt
- **WHEN** a rider who holds a membership declines the prompt, including after a `Post` whose
  membership write succeeded and whose introduction write failed
- **THEN** the prompt SHALL NOT reappear for that club for the rest of the session

### Requirement: One introduction sheet SHALL be open per screen, and the state rule SHALL NOT disturb an open one

At most one introduction sheet SHALL be mounted and open on any screen at any time.

On a screen that also evaluates the state-driven rule, that rule turns true the instant `Post`'s
membership write lands — the rider is a member and holds no introduction — while the sheet is open
with their composed text in it. The state rule SHALL NOT open a second sheet, remount the open one,
or reset its draft.

A composed introduction SHALL never be posted to a club other than the one it was composed for.

**Where the sheet must be mounted is owned by `client-cache-invalidation`** — *A sheet SHALL
outlive the invalidation that removes the control which opened it* — and SHALL NOT be restated
here.

#### Scenario: The state rule does not double the sheet
- **WHEN** the membership write lands while the pre-join sheet is open
- **THEN** exactly one sheet SHALL be open
- **AND** the text the rider composed SHALL be unchanged

#### Scenario: A draft cannot be misdirected
- **WHEN** more than one club is queued for a sheet on one screen
- **THEN** text composed for one club SHALL NOT be submitted for another

### Requirement: The sheet SHALL NOT be dismissible while a Post is in flight before the membership is written

In pre-join mode, from the moment `Post` is pressed until the **membership** write resolves, the
second control, the scrim and Escape SHALL NOT close the sheet. A dismissal accepted in that window
would be labelled as deferring a join that may already have committed.

**The window ends with the membership write, not with the introduction's.** From the moment the
membership exists the sheet is in member mode, where the standing rule applies unchanged: the
second control is always present and always closes the sheet, pending or not, because nothing there
is at stake but the introduction. A rule holding the sheet shut for the introduction's flight would
contradict that.

A sheet held open in this way SHALL show that it is working, and SHALL become dismissible again the
moment the membership write resolves either way.

#### Scenario: Deferring is refused while the membership write is in flight
- **WHEN** a rider presses `Post` in the pre-join sheet and then taps the scrim, presses Escape, or
  taps the second control before the membership write resolves
- **THEN** the sheet SHALL stay open

#### Scenario: The sheet is dismissible again once the membership exists
- **WHEN** the membership write has succeeded and the introduction write is still in flight
- **THEN** the sheet SHALL be dismissible
- **AND** dismissing it SHALL decline the introduction alone and SHALL NOT affect the membership

#### Scenario: The member-mode sheet is always dismissible
- **WHEN** a member presses `Post` and dismisses the sheet while it is pending
- **THEN** the sheet SHALL close, exactly as it does today

#### Scenario: A failed join returns the sheet to dismissible
- **WHEN** the membership write fails
- **THEN** the sheet SHALL be dismissible again
- **AND** its second control SHALL still offer to defer the join

### Requirement: The sheet SHALL NOT claim a membership the rider does not have

The sheet's wording SHALL be true of the rider's state at the moment it is shown. Before a
membership exists it SHALL NOT welcome the rider to the club, congratulate them on joining, or
otherwise assert a membership; it SHALL say what pressing `Post` will do.

The wording of each mode SHALL be **copy only**. No predicate, policy, assertion or branch SHALL
compare against it, and the mode SHALL be decided by the membership fact and never by reading a
string.

The suggested starter SHALL remain a placeholder and SHALL NOT become a prefilled value in either
mode. `Post` SHALL remain inert until the field holds non-whitespace text in both modes — in
pre-join mode a prefilled value would let one tap both post a canned sentence and join a club.

#### Scenario: The pre-join sheet does not welcome a non-member
- **WHEN** the sheet is shown before any membership exists
- **THEN** its heading SHALL NOT assert that the rider is in the club
- **AND** it SHALL state that posting will join them

#### Scenario: The member-mode wording is unchanged
- **WHEN** the sheet is shown to a rider who is already a member
- **THEN** its wording SHALL be exactly what it is today

#### Scenario: Post stays inert on open in both modes
- **WHEN** the sheet opens in either mode
- **THEN** the field SHALL be empty
- **AND** `Post` SHALL be inert until non-whitespace text is entered

### Requirement: Deferring a join SHALL be invisible to everyone but the rider

A deferred join SHALL produce no record any other rider can observe. No notification, no timeline
entry, no roster change, no count change, no thread, no message, and no stored refusal.

Every role's reach is unchanged by this change and SHALL be asserted rather than assumed:

- the club's **owner** and its **admins** learn nothing, and gain no control over the sheet, the
  deferral or the rider;
- **members** see no roster change and no join announcement;
- a **non-member** — which is what the deferring rider remains — reads exactly what a non-member
  read before;
- a **blocked** rider, in either direction, is unaffected; this change adds no block predicate, arm
  or filter, and blocking stays enforced in row security;
- a **signed-out visitor** reaches the shell and no data, and this change adds no grant to `anon`.

#### Scenario: The club is not told
- **WHEN** a rider defers a join
- **THEN** no notification SHALL be written to any member, admin or owner
- **AND** the club's member count and roster SHALL be unchanged

#### Scenario: No role gains a new reach
- **WHEN** this change is applied
- **THEN** no policy, grant, function, trigger or table SHALL be added or altered
- **AND** every rider's reach into a club, its membership and its introductions SHALL be exactly
  what it was before
