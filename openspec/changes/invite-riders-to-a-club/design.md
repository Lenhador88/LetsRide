# Design — sharing a public club, inviting to a private one

Companion to `proposal.md`. This file holds the *how*: the structural call, the predicate that has
to have exactly one definition, the orderings that are load-bearing, and every question closed with
what it would take to reopen it.

## One table or two — the most consequential call in the change

**Two: `club_invites` beside `club_join_requests`, not one table with a `direction` column.**

The case for one is real and should be stated at its strongest. Both rows say *"a named rider and a
named club are in a pending relationship that resolves into a `club_members` row"*. Both carry
`(club_id, user_id, status, created_at, responded_at)`. Both die with the club and with either
rider. And the two mechanisms **meet** — a rider can be invited while their own request is pending —
so one table with `unique (club_id, user_id)` would make that collision structurally impossible
rather than something a predicate has to catch.

Four things decide it the other way.

**1. The direction determines every policy, and the policies are mirror images.** Nothing else about
the row does.

| | `club_join_requests` (`085`) | `club_invites` (`093`) |
|---|---|---|
| Who INSERTs | the rider, about themselves | an authorised member, about somebody else |
| Who answers | an owner or admin | the invitee |
| A refusal is terminal against | the **requester** — they may withdraw a question, never un-answer it | the **inviter** — the invitee may reopen their own refusal |
| Who may clear a refusal | the club's admins | the club's admins |
| What the answer writes | a membership, and the row is DELETED | a membership, and the row is DELETED |

Merging means every one of those becomes a `case direction` inside a policy qual. That is
`notifications_subject_shape`'s shape — a `case` with an `else false` — applied to **access control**
rather than to column presence, and `036`'s own comment already calls that construct load-bearing
and delicate where it only decides which columns may be NULL.

**2. `club_join_requests` is applied and live on both projects.** Merging is not an additive file; it
is a destructive rewrite of a live table's policies, its two RPCs, its two fan-outs, its retraction
triggers and every client surface reading it — to buy tidiness. `CLAUDE.md`'s append-only rule and
the additive-first ordering both point the same way.

**3. The status domains would have to differ by direction anyway.** `083` keeps `accepted` because
for a ride the invite row **is** the audience arm; `085` refuses `approved` because for a club the
membership is the record and a surviving row makes a club a rider left un-re-requestable. This
change follows `085` — accept deletes the row — so the two domains happen to agree *today*, and
they agree by coincidence of two independent arguments rather than by being one thing.

**4. The collision the merged table would prevent is better prevented explicitly.** §The two
mechanisms meet gives it a rule that a reader can find, rather than a `23505` a reader has to infer
from a key.

**What would reopen it:** a third direction (a club asking to absorb another club, a rider asking on
behalf of somebody else), which would make the `case` unavoidable and the shared machinery worth its
cost. Nothing on the roadmap has one.

## The two mechanisms meet, and one wins deterministically

Two orderings, and each gets its own rule because only one of them can be refused in advance.

**A rider with a pending join request cannot be invited.** `private.club_takes_invites_for` carries
`not exists (a pending club_join_requests row for this club and rider)`, so the INSERT is refused.
The admin's remedy is the one already in front of them: **approve the request**, which is the same
outcome with the audit trail the rider started. It discloses nothing — the only riders who may
invite into a private club are its admins, and `085`'s SELECT policy already lets an admin read
every request for their own club, so the refusal names a row they can see. On a **public** club the
conjunct is vacuous: `club_takes_join_requests_for` requires `is_public = false`, so no request can
exist to collide with.

**A rider holding a live invite may still ask to join.** `085`'s
`private.club_takes_join_requests_for` is **not touched by this change** — that function is
`discoverable_private_clubs`' predicate, and narrowing it would make the club vanish from an invited
rider's Explore list, which is a visible change to a shipped screen for no safety gain. If the
request is approved first the rider is a member and the invite becomes inert; accepting it then is
idempotent (`on conflict do nothing`) and truthful.

**A claim through a link clears a pending request in the same transaction.**
`private.join_club_from_invite` deletes any pending `club_join_requests` row for that (club, rider)
after writing the membership. This is not tidiness: `085`/`087`'s
`private.retract_club_join_requested` fires on that DELETE and takes the admins' *"X asked to
join"* notification with it. Without the delete, every admin keeps an actionable request line for a
rider who is already in the club — `087`'s exact defect, arriving by a third route.

## Authority is re-derived at every use, never trusted from creation

**This is the rule the whole change turns on, and it is the one a reader is most likely to optimise
away**, because at creation the policy already checked it.

`private.may_invite_to_club_for(candidate, club)` — `is_club_admin_for(candidate, club) OR (the club
is public AND is_club_member_for(candidate, club))` — is evaluated **again** when an invite is
accepted and when a link is claimed, against the club's current visibility and the inviter's current
standing. It is `091`'s "departure is re-read at every use rather than trusted from `expires_at`",
one table over and with a sharper consequence.

What it buys, in the four cases that would otherwise be silent holes:

| What happened after the invite was sent | What the accept/claim does | Why |
|---|---|---|
| The inviter **left the club** | refused | they no longer speak for it |
| The inviter was **demoted** by `088`'s `demote_club_admin` | refused | demotion is the club withdrawing exactly this authority; outstanding grants must go with it |
| The club flipped **public → private** | refused **if** the inviter is an ordinary member; allowed if they are an admin | a member's *pointer* into a public club must not silently become a *grant* into a private one. This is the case that makes the rule non-optional, and `propagate_club_privacy_to_rides` (`022`) is the schema already doing the same thing for that club's rides |
| The club flipped **private → public** | allowed | it admits nothing the plain URL does not; see §A link on a club that has become public |
| The inviter **deleted their account** | the row is already gone | `inviter_id → profiles on delete cascade`, and `private.transfer_owned_clubs` may have handed the club to a successor. Nothing dangles |

**The disclosure this creates is small, considered, and named.** A rider can learn — from their own
invite disappearing — that the person who invited them is no longer authorised. It is a fact about a
club they were invited to, it is what the product wants to tell them anyway ("this invitation is no
longer valid"), and the alternative is an Accept button that always fails.

## Liveness and reachability each have exactly one definition

`091`'s recorded defect is the specification here: centralising *liveness* while leaving the *caller*
predicate copied into two bodies gave the weaker treatment to the more security-critical half, and
there is no policy underneath a `security definer` read to catch the drift. A preview more permissive
than its claim is a pure disclosure; a preview less permissive is a rider staring at "no longer
valid" for a link that works.

**For the link**, two functions and no third:

- `private.live_club_invite_link(t)` — a statement about the **link alone**. Token matches, `revoked_at`
  is NULL, `now() < expires_at`, the club still exists. Takes no caller, reads no `auth.uid()`,
  returns zero rows for every dead state and never raises.
- `private.club_invite_link_reachable_by(t, uid, lock)` — **the only entry point either public RPC
  has.** Live, **and** the minter still has authority (`may_invite_to_club_for(created_by, club)`),
  **and** `not is_blocked(uid, created_by)`, **and** `not is_blocked(uid, owner_id)`, **and** both
  participation stamps on the caller, **and** the caller is not already a member and is not the
  owner. `lock => true` takes `for share` on the link row before resolving, so a claim and a
  concurrent revoke serialise — and that is what makes it VOLATILE, Postgres refusing `SELECT FOR
  SHARE` in a non-volatile function, which in turn is why the two RPCs are POST-only rather than
  served over GET with a live token in the query string.

**For the in-app invite**, one function: `private.club_invite_is_answerable_for(candidate, invite)` —
pending or declined, addressed to the candidate, the inviter still authorised, neither block
standing, both stamps. It is what `public.my_live_club_invites()` filters on, what
`accept_club_invite` requires, and — through the caller-relative `private.has_live_club_invite` —
what the `notifications` policy arm asks. **Three callers, one body**, and the assertion reads
`prosrc` for the absence of an `is_blocked` or a stamp test in any of them, `091.13`'s shape.

**Every dead state is one outcome.** The preview returns zero rows and raises nothing; each RPC has
exactly **one** raise site with one message and one SQLSTATE. Expired, revoked, club deleted, minter
demoted, blocked either way, un-onboarded, already a member, malformed and unmatched all arrive
there. A second message is an oracle.

## The invitee needs no new read path, and that is the narrowness proof

The tempting design gives a pending invitee an arm on `clubs` SELECT so they can see what they were
invited to. **It is unnecessary, and `085` already wrote down what it would cost**: `016`'s club
avatar *and* cover storage policies both delegate to `clubs` SELECT, so the club's photographs become
readable to a non-member with no migration touching `016`; and `036` §3's notifications conjunct
starts resolving for every `club_id`-carrying row a rider happens to hold.

It is unnecessary because the invitee can already read the club, by two existing paths that cover
the two cases exactly:

- **Public club** → `clubs` SELECT's `is_public` arm. They could always see it.
- **Private club** → `public.discoverable_private_clubs(club)`, whose predicate
  `club_takes_join_requests_for` is true for precisely a non-owner, non-member, unblocked rider of a
  non-default private club — which is what a live invitee **is**, by construction of
  `club_takes_invites_for`.

So `my_live_club_invites()` returns the club's name and avatar path having disclosed nothing the
rider could not obtain from `085`'s accessor, and the spec asserts that equivalence rather than
claiming it. **The avatar will not sign for a private club** — `016`'s storage policy runs its own
`EXISTS` against `clubs` under the reader's RLS — so the card draws initials, exactly as `085` left
it, and the day a storage arm lands the assertion names it.

**The one exception, and it is why the notification policy has to move at all**: a *notification* is
not a club. Its readability is decided by `036` §3's conjunct, which asks `EXISTS (SELECT 1 FROM
clubs …)` under the recipient's own RLS and gets `false` for a private club. That is the finding in
`proposal.md`'s warning.

## Why the notification arm is type-scoped, and why both policies move

`089` faced this and answered it with `OR ((type = 'club_join_request_declined') AND
private.club_takes_join_requests(club_id))`. This change adds one more disjunct of the same shape.

The alternative — relaxing the club conjunct generally — would make **every** `club_id`-carrying
notification a rider happens to hold resolve for a club they cannot read, which is a widening with no
statement behind it. The alternative in the other direction — a subject-less `club_invited` type — is
**lossy**, and `085` measured why: `notifications_event_key` is unique over all four subject columns
with `NULLS NOT DISTINCT` (confirmed on DEV: `indnullsnotdistinct = true`), so two invites from the
same admin to the same rider for two different clubs would collapse to one row and the second would
be silently dropped by `on conflict do nothing`.

**Both the SELECT and the UPDATE policy carry the identical qual** — read live off `pg_policies` —
and they must move together. Moving only the read leaves the invitee a notification they can see and
can never mark read: `Riders mark only their own readable notifications read` would refuse the
UPDATE, so the unread count never comes down and nothing on screen explains it. This is the kind of
defect that is invisible in review because the feature demo works.

## The share row is one component with three callers

The defect is one line — `shareAppLink(routes.club(clubId))`, unconditional — and it now has **two**
call sites: `ClubOptionsMenu` and PD-356's new `Share club` row on the club thread screen, which is
annotated at the site as inheriting it. A branch copied into two menus is the shape where the third
one gets it wrong.

**So the branch lives in one component**, mounted by both (and by whatever carries a ⋯ menu next):

```
<ClubShareOrInviteItem clubId={…} isPublic={…} viewerRole={…} isOwner={…} onDone={closeMenu} />
```

Its whole contract is three states, and the third is the fix:

| Club | Viewer | The row |
|---|---|---|
| Public | anyone who can see the menu | **`Share club`** — share or copy `routes.club(id)`, plus `Invite a rider` for a member |
| Private | owner or admin | **`Invite riders`** — the in-app picker and the link section |
| Private | member who is not an admin, or a non-member | **no row at all** |

**The third state is the defect corrected, and it must be asserted as an ABSENCE.** A row that offers
a share producing "content unavailable" is worse than no row; and a component test that only checks
what renders cannot see a row that should not. `RideInviteJoin`'s test is the precedent — it asserts
what is *not* there, in the source as well as in the markup.

**`is_public` is already on `ClubDetail`** (verified in `src/types/index.ts`), so `ClubOptionsMenu`
needs no new read. Whether the **thread screen** holds it is task 6.3's first question: if it does
not, the field goes onto that screen's existing club read rather than into a second query, and the
component **must not** guess — an unknown visibility renders no row, because rendering the public
branch for a private club is exactly the bug being fixed.

## The token lifecycle, end to end

1. **Minted.** An admin taps `Invite riders` → `Create a link`. One INSERT naming
   `(id, club_id, created_by)` and nothing else; the database supplies `token` and `expires_at`.
   The client never sees a token it chose.
2. **Shared.** `shareAppLink('/clubs/join?token=' + token, club.name)` — the existing helper, a
   different URL, not a different mechanism. The rider's own phone sends the message.
3. **Opened.** `/clubs/join?token=…` is **public**. With no session it renders the shell, a generic
   sentence naming **neither the club nor its minter**, and two buttons. With a session it renders
   the six-column preview.
4. **Claimed.** One tap → `claim_club_invite_link(token)` → a `club_members` row carrying
   `invite_link_id` → the rider lands on `/clubs/detail?id=…`.
5. **Dead.** At `created_at + 14 days`, at revoke, when the club is deleted, or when the minter's
   authority ends — whichever comes first. Death is a property of the link; the riders it admitted
   are unaffected.

## Where the credential lives, and why there are now two stashes

`091` put the ride token in `sessionStorage` under `letsride.pendingInviteToken`, cleared on
sign-out. A club token is a **second capability of the same 32-hex shape**, and the two must never be
spent as each other.

**One key per kind, one module, one clear.** `src/lib/invites/pending-token.ts` generalises to take a
kind and owns both keys; `signOut` clears **both**, because `client-session-storage`'s standing rule
is that sign-out destroys every local trace and a token is both a trace and a credential.

**Cross-spending is already impossible at the database, and the client rule is still worth having.**
A club token handed to `ride_invite_link_preview` simply matches no row — the tables are separate and
each RPC reads one — so the failure is the ordinary indistinguishable dead-token answer rather than
a grant. The stash rule exists so the *rider* is not sent to the wrong landing screen, which is a
correctness bug in the product rather than in the schema.

**`sessionStorage`, never `localStorage`**, for `091`'s reason: a credential whose whole security is
possession must not outlive its tab, and an abandoned sign-up on a shared laptop must not leave a
live grant behind. It still survives the onboarding wizard, which is the one thing the stash has to
do.

## A claim is always a tap, never automatic

**Refused permanently, and asserted against in the component's source**: no effect, no route-guard
branch and no `onAuthStateChange` listener may spend a stashed token.

A stash is a string in a browser. The rider who *signs in* is not necessarily the rider who *opened
the link*: an abandoned sign-up followed by somebody else signing into the same tab would auto-join
**that second rider** to a private club they were never told about, with a `club_members` row and a
`club_joined` notification naming them to the club's admins. At the database layer that is a
perfectly valid claim — authenticated, onboarded, unblocked, live token — so **no assertion in
`supabase/tests/` can ever see it.** Only the client contract can refuse it, which is why it is a
source-level assertion and not a behavioural one.

It costs one tap, and `091`'s `RideInviteJoin` test is the shape to copy exactly.

## What removal does not do, and the gap that leaves

`088`'s `remove_club_member` exists, which is a materially better position than `091` had for rides —
an admin *can* eject a rider a link admitted. **What it does not do is stop them coming back**, because
nothing records a removal: the `club_members` row is deleted, and the rider's live token or standing
invite is unchanged.

The remedies, in order: **revoke the link** (which is one tap and is what the surface should suggest
at the moment of removal), and **block**, which is decision #2's sledgehammer and removes the two
riders from each other's feeds, search, chat and member lists everywhere.

**Closing it properly costs something this change should not spend.** The three candidates were
weighed: a trigger on `club_members` DELETE that clears invites (hangs new code on a live write path,
`036`'s gate, and it would also delete an invite when a rider merely *leaves*); an edit to `088`'s
RPC (a live path, and it would only cover one of the two doors); or a removal tombstone table (a new
table with its own retention question, which is a different story). **PD-351's precedent is exact** —
the owner chose to leave `091`'s equivalent gap open, named, rather than build a second visibility
mechanism beside blocks. Q5 asks whether to file it.

## A link on a club that has become public

**Still claimable, and it admits nothing the plain URL would not.** A public club's `club_members`
INSERT policy already lets any signed-in rider join, so the claim is a longer route to the same
membership. Killing the token on a flip would be a surprise with no safety behind it.

The reverse — a club going private with a live link out — is covered by §Authority is re-derived:
the minter must be an admin *now*, so an admin's link survives the flip (they may still admit
riders, which is what being an admin means) and nothing else does.

## The function inventory

**Six `public`, `security definer`, one advisor each** — `accept_club_invite(invite uuid)`,
`decline_club_invite(invite uuid)`, `my_live_club_invites()`, `club_invite_link_preview(t text)`,
`claim_club_invite_link(t text)`, `revoke_club_invite_link(link uuid)`. Each takes an **invite id, a
token or a link id and never a rider id** — the subject is `auth.uid()`, and *"we check the id
matches the caller"* is one refactor away from not doing that.

**Fifteen `private`, no advisor** — `has_live_club_invite_for` / `has_live_club_invite`,
`may_invite_to_club_for` / `may_invite_to_club`, `may_mint_club_link_for` / `may_mint_club_link`,
`club_takes_invites_for`, `club_invite_is_answerable_for`, `enforce_club_invite_is_admissible()`,
`live_club_invite_link`, `club_invite_link_reachable_by`, `join_club_from_invite`,
`notify_club_invited()`, `notify_club_invite_declined()`, and `set_club_invite_responded_at()` if the
coupling needs a writer beyond the RPCs.

**Every `_for` twin is granted to NO client role** and its caller-relative wrapper is granted to
`authenticated` only where an RLS expression calls it — `060`'s pattern, `085`'s reasoning. The
subject-taking forms are **oracles**: `may_invite_to_club_for` answers "is rider X an admin of club
Y" for any pair, and `club_takes_invites_for` answers a membership-and-block question for any pair.
Both are safe only while nobody can call them.

**One extra BEFORE INSERT trigger, and it exists to avoid granting an oracle.**
`private.enforce_club_invite_is_admissible()` enforces the *invitee-side* conditions — not the owner,
not already a member, not the default club, no pending request — which the INSERT policy cannot ask
without `authenticated` holding EXECUTE on `club_takes_invites_for`. `enforce_ride_club_audience` and
`enforce_ride_timezone` are the same shape: a BEFORE trigger carrying a cross-table rule a policy
cannot express. **It deliberately tests no block**, because a raise mentioning a block between the
invitee and the club's owner would tell an inviting member something about two other riders —
decision #2 says a block is never revealed by a gap, a count or a marker, and an error string is a
marker. Blocks are enforced instead at four places that disclose nothing: the INSERT policy (a block
the inviter is a party to), the fan-out, the accessor, and the accept.

## The orderings that are load-bearing

| Ordering | Consequence if reversed |
|---|---|
| The bundle serves **before** `093` applies | `089`'s rule: two new notification types under an older bundle whose `notificationCopy` and `describe` are exhaustive switches takes a rider's notifications screen down |
| The membership row is written **before** the notification, inside the accept | `085` §5.2's measured rule: `036` §3's SELECT policy needs the clubs row to resolve for the recipient, and for a private club only a member gets that. Reversed, the row is written and never readable |
| The pending request is deleted **after** the membership is written | the retraction trigger fires on the delete; doing it first leaves a window where the rider is neither requested nor a member and a concurrent approval can re-write a row nothing will clear |
| `for share` on the link row **before** liveness is resolved | under READ COMMITTED a claim resolving liveness a moment before a concurrent revoke commits still admits the rider, and the admin's Revoke returned success |
| Both `notifications` policies move **in the same statement block** | a readable notification that cannot be marked read is a permanent unread badge |
| Both `notifications` CHECKs move together | `036`: a bare `case` returns NULL for an unmatched type and a CHECK passes on NULL, so a type in the flat list with no shape arm admits a row with no subject |

## Risks

- **A `security definer` read with a predicate missing is an exposure reachable by URL.** There is no
  policy underneath `club_invite_link_preview` or `my_live_club_invites`, so every check they do not
  make is a check nobody makes. `091` was bitten twice here — the block check written into two
  bodies, and the participation gate left out of the read path entirely. Both are facts about the
  single entry point in this change, asserted by reading `prosrc`.
- **Widening a live policy on `notifications`.** The suite pins its qual by equality, and here the
  pin is *supposed* to move. That makes this the one place where "re-pin it" is the right answer —
  which is exactly the habit `091` warns against — so task 5.2 states which pins may move (the two
  `notifications` quals) and which must not (`clubs` SELECT, `private.can_read_club`,
  `club_join_requests`' three policies). A failure in the second set means this change is wrong.
- **`private.notify_club_joined` runs inside the new write path** with no `WHEN` clause, so a raise
  there takes a rider's accept or claim down. `036`'s hand-exercise gate, task 7.3.
- **A leaked token into a private club.** Bounded by 14 days, revoke and `088`'s removal — and *not*
  bounded against a removed rider re-entering. §What removal does not do.
- **The withdrawn-invite notification outlives its invite**, by design (`090`). It must degrade to
  plain text with no controls, which requires the notification row's actions to read the **live**
  invite through `my_live_club_invites()` rather than trusting the notification. `RideInviteActions`
  is the built precedent — `if (!invite) return null`.

## Questions closed, and what would reopen each

Each was open, each is answered here, and each carries what it would take to reopen it.

- **Q — one table or two?** **Two.** Reopen if a third direction of ask appears, or if the two
  status domains ever diverge such that both tables need a `case` anyway. §One table or two.
- **Q — does a link claim bypass `085`'s approval?** **Yes.** Reopen if the owner decides a private
  club's admission must always be per-rider — which would make the token a deep link to a request
  and, by decision 1's own test, not worth building. Also reopen if `discoverable_private_clubs` is
  ever narrowed so that private clubs stop being universally requestable, because that is the fact
  the argument rests on. `proposal.md` decision 4.
- **Q — who may mint a link?** **Owners and admins, on a private club only.** Reopen if members are
  ever given the power to approve join requests, since the two sets are deliberately the same one.
- **Q — who may send an in-app invite?** **Admins on a private club; any member on a public one.**
  Reopen if a public club ever gains an admission decision, at which point the pointer becomes a
  grant and the sets must converge.
- **Q — does a public club get a token?** **No.** Reopen only if a public club stops being readable
  by every signed-in rider. §decision 1 in `proposal.md`.
- **Q — what happens to an invite when the inviter's authority ends?** **It stops working, checked at
  use.** Reopen if invites are ever attributed to the club rather than to a rider — which would need
  a different `inviter_id` story and a different fan-out actor.
- **Q — is there a `club_invite_accepted` notification?** **No** — `club_joined` already tells the
  owner and the admins, through a fan-out that predates this change. Reopen if the product ever wants
  the *inviter specifically* to be told, which is a different recipient set from `notify_club_joined`'s.
- **Q — is there a retraction trigger for `club_invited`?** **No**, on `090`'s measured ground: with
  one, withdraw-and-re-send re-notifies without limit because the deleted row never collides with
  `notifications_event_key`. Reopen only with a rate limit, which this app has nowhere.
- **Q — does the preview show the club's member count?** **Yes, a count and never a roster** —
  `085`'s accessor already returns exactly that number to any rider who can see the club in Explore,
  so it discloses nothing new and it is what makes "is this the club I was told about" answerable.
- **Q — does the preview show whether the club is private?** **Yes**, as one boolean. A rider
  deciding whether to join is deciding whether their content and presence become visible to a closed
  group; withholding that makes the decision worse rather than the club safer. Reopen if the six
  columns are ever reduced.

## Open questions, each with the default that gets built

Marked blocking or not, and who can answer.

- **Q1 — the 14-day ceiling.** Default: **14 days**. A product judgement; one interval literal.
  **Non-blocking.** Product owner's.
- **Q2 — may an admin clear another admin's *declined* invite, and re-send it?** Default: **yes**,
  mirroring `085`'s "a refusal is clearable by the club". The bound is the unique key (one invite row
  per pair at a time) plus `notifications_event_key` (a re-send by the *same* admin writes nothing
  new). The residual is that N admins can each notify once, which is bounded by the admin count and
  accepted. **Non-blocking.** Product owner's.
- **Q3 — does the club's *timeline* get an entry for an invite accepted?** Default: **no**. PD-355's
  timeline already draws a `join` event from `club_members.joined_at`, so an invite entry would draw
  the same fact twice. **Non-blocking**, and it belongs to `club-timeline-engagement` rather than
  here.
- **Q4 — should the in-app invite reach a rider by *username search* only?** Default: **yes**, the
  `RideInvitePicker` contract exactly, including its two-character minimum, prefix anchor and 20-row
  cap — and `083`'s recorded reason that this is a sequential scan of `profiles` with no index that
  can serve `ILIKE`, fine at this size and not at thousands (PD-333). **Non-blocking.** Engineering.
- **Q5 — should "a removed rider walks back in through a live link" be filed as its own story?**
  Default: **file it, build nothing here.** PD-351's precedent. **Non-blocking here** — the answer
  changes nothing in this change — but it is the honest counterpart to the Remove button and only
  the product owner can decide it. §What removal does not do.
- **Q6 — BLOCKING for §4 only: is the approval bypass acceptable?** Default: **yes**, built as
  decision 4 describes. It is marked blocking because it is the one decision that an additive
  migration cannot undo: by the time it is reversed, riders are already members, and unwinding that
  means removing people from a club they were legitimately told they had joined. **Everything except
  the claim's terminal write can proceed while it is open** — the table, the in-app invite, the link,
  the preview, the revoke and every policy are unaffected by the answer. Product owner's alone.
