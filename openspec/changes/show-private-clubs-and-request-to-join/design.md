# Design — Show private clubs in Explore, and let a rider ask to join one

Everything here is read from the repo's migration chain, `supabase/tests/rls_test.sql`,
`docs/reference/schema.md` and the committed `design/` snapshot. **No live database was reachable
while this was written** (`proposal.md` §Read this first), so every count is re-derived in
`tasks.md` §0 rather than trusted here.

## Why the accessor, not the policy

The brief offers two routes to making a private club findable and asks for the choice to be
justified. **The accessor wins, and it wins before the enumeration below is even reached**, on an
argument that is structural rather than a weighing of costs.

### The policy route cannot do the job on its own

An arm on `clubs` SELECT has to be predicated on *something about this rider and this club*. The
only candidates are a membership (they have none), an ownership (not theirs), or **a request row**.
So the arm reads `or exists (a live request from me for this club)`.

That is circular. **To make a request the rider must already hold the club's id, and the only place
a `/clubs/explore` rider gets one is a list.** The list is the thing being built. So the policy arm
can only ever be a *post*-request read — it cannot be the discovery mechanism — and a discovery
accessor is required **either way**. Given that, the policy arm is a second widening on top of a
sufficient first one, and it is the wider of the two.

### What the policy route would open, enumerated

The enumeration is the reason, not a footnote — a summary like "it only shows the club" is exactly
the sentence `openspec/config.yaml` exists to refuse. Every entry is read from the migration that
wrote it.

| Surface | Predicate it actually uses | What an arm on `clubs` SELECT would do |
|---|---|---|
| `clubs` SELECT itself | `is_public OR owner_id = auth.uid() OR private.is_club_member(id)` | The requester reads **every column**: `description`, `cover_image_path`, `owner_id`, `created_at`, `is_default`. The accessor returns seven columns; the policy returns thirteen. |
| `private.can_read_club(candidate, club)` (`060`) | restates `clubs` SELECT with a candidate | **Must gain the same arm or go stale**, and its qual is pinned textually at §060.1b. `060`'s own comment: *"IT RESTATES A POLICY AND CAN GO STALE."* PD-211 is what happens when only one of a pair moves. |
| `club_members` SELECT | `private.is_club_member(club_id) OR EXISTS (clubs c WHERE c.id = … AND c.is_public)` | **Unchanged** — the `EXISTS` requires `is_public`, not merely a readable club. The roster stays hidden. Worth stating because it is the surface everyone assumes moves. |
| `rides` SELECT (`017`, `022`, `083`) | `private.is_club_member(club_id)` | Unchanged. |
| `postcards` SELECT (`009`, `011`) | `private.is_club_member(p.club_id)` | Unchanged. |
| `club_threads` / `club_messages` (`081`) | the membership helper **alone** | Unchanged. |
| `storage.objects` — club avatars and covers (`016`) | `EXISTS (clubs c WHERE c.avatar_path = objects.name …)` | **Moves.** Both the avatar *and the cover photo* become readable to the requester, because the policy delegates to `clubs` SELECT by design. That is a picture of the club's own choosing handed to a non-member, and it moves silently — no migration touches `016`. |
| `notifications` SELECT (`036` §3) | `club_id is null or EXISTS (clubs …)` | **Moves.** Every notification carrying that `club_id` becomes readable to the requester, which is how the decline notification in §Why a decline is silent would start working — and also how a `ride_created_in_club` row addressed to somebody else's reader would start resolving for a requester who happens to hold one. |

Two of those seven move, and neither is the one anybody would have listed. **That is the whole
argument.** The accessor's widened reach is one function, seven columns, one grant, one advisor —
and `grep` finds every caller of it, which is not true of a policy that eight other predicates
delegate to.

### What the accessor is, precisely

```sql
create function public.discoverable_private_clubs(
  target_club uuid default null,
  page_size   int  default 50
)
returns table (
  id uuid, name text, avatar_path text,
  location_name text, latitude double precision, longitude double precision,
  members_count bigint
)
language sql stable security definer set search_path = ''
```

- **`security definer`, `stable`, `set search_path = ''`, every name schema-qualified**, revoked
  from `public` and `anon`, granted to `authenticated`. `021`/`025`/`062`'s shape.
- **The narrow shape is the security statement.** Seven columns, chosen so that each answers a
  question the card and the reduced screen actually draw. Nothing about the club's rides,
  postcards, threads, roster, description, cover, owner or age. A column added to this list later
  is a widening and needs its own reason in the migration.
- **`members_count` is an aggregate and never a roster.** It is the same number `ClubCard` draws
  today for a public club, computed inside the function because `club_members` SELECT would return
  the caller zero rows.
- **`target_club` non-null narrows to that one club and changes nothing else.** One body, two call
  shapes. A separate `club_discovery_card(uuid)` function would be a second copy of the same
  visibility rule and a second advisor, and `060`'s lesson is that two copies of one rule drift.
- **`page_size` is capped in SQL** — `least(coalesce(page_size, 50), 100)` — so a client cannot ask
  for every private club in the database in one call.
- **Ordered `created_at desc, id desc`** internally, matching `getExploreClubs`' existing
  `.order('created_at', { ascending: false })`, without returning `created_at`. The two halves of
  the list are then merged and sorted client-side by the existing comparator.

Its predicate is `private.club_takes_join_requests(auth.uid(), c.id)`, which is:

```
c.is_public = false
and c.is_default = false
and c.owner_id <> candidate
and not private.is_club_member_for(candidate, c.id)
and not private.is_blocked(candidate, c.owner_id)
```

Each conjunct earns its place:

- **`is_public = false`** — public clubs come from the ordinary query. Overlap would double a club
  in the list.
- **`is_default = false`** — `058`'s welcome club is public anyway, so this is belt-and-braces
  against somebody flipping it; and a request to join the club everyone is auto-joined to is
  meaningless.
- **`owner_id <> candidate` and `not is_club_member_for`** — a club you are in belongs on Your
  clubs; `getExploreClubs`' existing exclusion is checked against the page and this one is checked
  in SQL, which is safe here because the predicate is per-row rather than a bounded id list. That
  distinction is `getExploreClubs`' own recorded defect (`CLUB_MEMBERSHIP_LIMIT`) and this does not
  reproduce it.
- **`not private.is_blocked(candidate, c.owner_id)`** — decision #2, and the direction question the
  brief asks is answered by `is_blocked` itself: `009`'s comment is *"symmetric by construction —
  call sites must not re-check the reverse direction"*, so **one directional `blocks` row hides the
  club from the requester and hides the requester's request from the owner, both ways round, from
  a single row.**

**The block conjunct is on `clubs.owner_id` and on nobody else, and that is deliberate.** A club is
not a rider; the only rider identified on a `clubs` row is its owner. Blocking one ordinary member
of a club does not hide the club — which is already true today for public clubs, because `clubs`
SELECT carries **no** block predicate at all (`060`'s comment says so in as many words). This
change does not add one. It makes the *new* surface block-aware from birth, which is the one place
it is free.

## Two halves, one list

`getExploreClubs` keeps `.eq('is_public', true)` on its `clubs` query. That filter is **the public
half's definition, not a re-filter of RLS** — its own header records the defect that reading it the
other way caused twice, where `/rides` and `/clubs` subtracted from a policy that already unioned
public with owned and joined. Removing it now would be that defect for a third time, and it would
also not work: the private clubs are not in the policy's answer to remove *from*.

So the read is two calls and one merge:

1. the existing `clubs` page — public, newest fifty, then the page-scoped membership exclusion;
2. `discoverable_private_clubs()` — the narrow rows, already excluding membership and blocks;
3. concatenate, `withDistance`, sort with the existing `byDistanceThenName`.

`CLUBS_PAGE_SIZE` therefore bounds **each half** rather than the union, so the list can be up to
100 rows. That is stated rather than papered over: the honest description of what ships is *the
newest fifty public clubs plus the newest fifty requestable private ones, nearest first*, and the
existing header's note about the recency window applies unchanged to both halves.

**Neither half signs an avatar the other could not.** `signClubImages` runs over the merged list and
a private club's `avatar_path` will not sign — see §The avatar that will not sign.

**The requester's own request status is a third, bounded read**, exactly mirroring the membership
read `getExploreClubs` already does: `club_join_requests` filtered to `user_id = auth.uid()` and
`club_id in (<the private ids on this page>)`. It is readable under the requester's own SELECT
policy with no accessor, because it is their own row. That gives each private card its
`request_status`.

## The state machine, and what each state grants

| State | Row | What the requester sees in Explore | What an admin sees | Who may move it |
|---|---|---|---|---|
| Never asked | none | the club, `Request to join` | nothing | the requester, by INSERT |
| Pending | `status = 'pending'`, `responded_at` NULL | the club, `Requested` (not a control) | the club, in the pending list, with Approve and Decline | the requester (withdraw, by DELETE); an admin (either RPC) |
| Declined | `status = 'declined'`, `responded_at` set | **the club is gone from Explore** | the row, in the club's request history, with Clear | an admin only, by DELETE |
| Approved | **no row** — the `club_members` row is the record | the club on Your clubs | the new member on the roster | — |

Two decisions live in that table and both are answers the brief asks for explicitly.

### Approval DELETES the request row

The membership row **is** the outcome. Keeping an `approved` request beside it is two sources of
truth for one fact, which is the drift `083` refused when it wrote *"status is the answer to the
invitation and never a copy of membership"*. Here the analogy is exact and the consequence is
sharper: with `unique (club_id, user_id)`, a surviving `approved` row would make a rider who
**leaves the club** unable to request again — the insert collides, and there is no affordance
anywhere to clear it. A private club a rider left would become permanently unreachable to them.

Deleting the row also fires the retraction (§Notifications), which is what takes the admins'
`club_join_requested` notification away at the moment `notify_club_joined` gives them a
`club_joined` one. The record survives, in the right form, for the right reason.

### A declined request is immovable BY THE REQUESTER and clearable by the club

`083` made decline terminal against the **inviter** and reopenable by the **invitee**, on the
reasoning that the anti-spam rule must bind the party the rule exists to constrain and must not
lock out the party at risk. **Here the parties are the other way round.** The requester is the one
who could spam; the club is the one at risk. So the rule inverts with them:

- **The requester cannot delete, update or re-insert a declined row.** DELETE is scoped to
  `status = 'pending'` for them, there is no UPDATE grant or policy for anyone, and the unique key
  refuses a second insert with `23505`. **A `no` means no, and it does not expire.**
- **An admin may DELETE a declined row**, which is the "you may ask again" affordance and is
  deliberately in the club's hands. It is one line in the DELETE policy; the *surface* for it is
  PD-326's.

The requester is told nothing about the difference between "declined" and "the club vanished",
because the club leaves their Explore list either way — see §Why a decline is silent.

## Why a decline is silent

`proposal.md` §1 states the mechanism. This is the fork and what each branch costs.

**A. No decline notification. The request row is the record, and the club leaves Explore.**
*Chosen.* Costs nothing to build, discloses nothing, and is coherent with the club having said no:
the rider stops seeing the club, exactly as they did before they found it. The row survives so the
club's own history is intact and so a second request is refused.

**B. A notification type carrying no subject at all.** `notifications_subject_shape`'s
`case … else false` structure permits an arm where all four subject columns are NULL, so this is
buildable. It renders as *"<Admin> declined your request"* with no club named, no destination and
no thumbnail — and it names **which rider** refused, which is the one fact §What the requester may
learn deliberately withholds. Rejected: it delivers less information than A and one extra
disclosure.

**C. An arm on `clubs` SELECT for a live request.** Would make the ordinary
`club_id`-carrying notification resolve. Refused for the reasons in §Why the accessor, not the
policy — and note that it would resolve the notification by making the whole `clubs` row and both
its Storage objects readable, which is a large price for one sentence.

**If the product owner wants the rider told out loud, B is the buildable one** and it needs the
`responded_by` column §What the requester may learn refuses. That is a decision, not a task.

## What the requester may learn

The requester holds a readable row — their own — so every column on `club_join_requests` is a
column they can read. That is why there is **no `responded_by`**.

A club refuses as a club. Naming the individual admin who pressed Decline turns an institutional
answer into a personal one, in an app whose only safety primitive is blocking, and it does it
through a column nobody would think to check the reach of. `status` and `responded_at` are the
whole answer, and a club that wants an internal audit trail can have one when PD-326 asks for it,
behind an accessor scoped to admins.

The requester likewise learns nothing about **other** requests: the SELECT policy admits their own
row and an admin's view of their club's rows, and nothing else. A non-admin member of the club sees
**zero** request rows — including their own club's — which is the negative case the brief asks for
by name.

## The avatar that will not sign

`016`'s `"Club avatars are readable with the club"` and `"Club covers are readable with the club"`
policies both run an `EXISTS` against `public.clubs` under the reader's own RLS. For a private club
a non-member reads nothing there, so both objects are unreadable, `signImagePaths` returns null,
`ClubListItem.avatar_url` stays null and `Avatar` draws the club's initials.

**`085` adds no storage policy and the card draws initials.** The accessor still returns
`avatar_path`, so the day the policy arm lands nothing else changes.

The arm, written out so that adding it later is an edit rather than a design:

```sql
-- a THIRD disjunct on "Club avatars are readable with the club", scoped to
-- club-avatars and to private clubs a discovery caller may see. NOT added to
-- the covers policy: an avatar is the club's identity, a cover is its content.
or exists (
  select 1 from public.clubs c
   where c.avatar_path = storage.objects.name
     and (storage.foldername(storage.objects.name))[2] = c.owner_id::text
     and private.club_takes_join_requests(auth.uid(), c.id)
)
```

Its cost, stated plainly: **every private club's avatar image becomes readable to every signed-in
rider who is not blocked with its owner.** That is the same audience the club's name and location
already reach through the accessor, so it is consistent — but it is bytes rather than a string, and
it is a `storage.objects` policy, which is the table this repo has been most careful with. It is
`tasks.md` 0.2's question with "no, ship initials" as the default.

## The reduced club screen

The Explore card wraps its whole row in a stretched `<Link href={routes.club(club.id)}>`. Left
alone, tapping a private club lands on `/clubs/detail?id=…`, where `getClub` reads `clubs` under the
SELECT policy, gets nothing, returns `null`, and the page calls `notFound()`. **A rider finds a club
and taps into a 404.**

Three answers were considered.

**The row does not navigate.** Smallest change, and wrong: a card that is a link everywhere else and
inert here is a dead surface, and the rider gets no explanation of why there is nothing.

**A reduced screen served by the same accessor.** *Chosen.* It is the only branch that can say
*why* the club is empty, which is the one thing the card cannot; and it puts the request control in
the design's primary shape (`ClubMembershipButton`'s full-width `Button / Regular`) rather than the
card's link-sized one.

**A full screen with every section empty.** Refused outright. It would need `getClubFeed`,
`getClubMembers`, `getRides` and `ClubThreadsSection` to each return zero rows and be *drawn* as
empty — which is precisely the "permission denied looks identical to empty" trap
`openspec/specs/client-render-shell/spec.md` names, four times on one screen, and it would show a
non-member four empty-state sentences that each assert something false about the club.

### How the route decides which screen it is

```tsx
const club   = useQuery(queryKeys.clubs.detail(id), () => getClub(id))
// Enabled only once the full read has DECIDED it cannot see the club.
const preview = useQuery(club.data === null ? queryKeys.clubs.preview(id) : null,
                         () => getClubPreview(id))

if (club.data === null && preview.data === null) notFound()
```

- **`getClub` is unchanged.** It still answers `null` for "no such club" and "a club the policy
  hides" indistinguishably, which is decision #1's requirement and stays true — the *page* now
  distinguishes them, using a second, deliberately-narrow read, and a club that genuinely does not
  exist still 404s because the accessor returns nothing for it either.
- **`null` versus `undefined` is load-bearing twice.** The preview query is disabled until `club`
  has *decided*; `notFound()` needs **both** to be `null`, never merely falsy, or every load of
  every club flashes a 404 while the first read is out.
- **Two round trips only on the path that was going to 404 anyway.**

### What the preview branch renders, section by section

| Section on the full screen | On the preview branch |
|---|---|
| `ClubDetailHeader` | rendered, with `{ name, avatar_url: null }` from the preview. **`ClubOptionsMenu` absent** — Leave, Edit and Delete are all member/owner actions. |
| Club rides strip + `See all` | **not rendered.** No query is issued. |
| `ClubCreateRideRow` | **not rendered.** `017`'s `rides` INSERT policy would refuse it, and *"a control that always fails RLS is worse than no control"* is this screen's own recorded rule. |
| Postcards carousel + `See all` | **not rendered.** No `getClubFeed` call. |
| `ClubMembershipButton` | **replaced** by `RequestToJoinButton`, in the same slot, same full-width shape. |
| `ClubThreadsSection` | **not rendered.** |
| Members section + `ClubMemberRail` + `See all` | **not rendered.** The member **count** is drawn as a line of text from the preview instead. |
| Type / started line | `Private club` and the location, from the preview. **No `created_at`** — the accessor does not return it. |
| Description | **not rendered**, and no "has not written a description, yet!" placeholder — that sentence claims the club has none, and this screen does not know. |
| `MarkClubSeen` | **not rendered.** `015` refuses a watermark for a club you have not joined. |

In its place, one sentence naming the state — *"This club is private. Its rides, postcards, threads
and members are for its members."* — which is the thing the card cannot say and the whole reason
this branch exists.

**`viewer_role` and `isMember` are untouched.** `page.tsx:170`'s `const isMember =
!!club.data.viewer_role` lives in the full branch and only runs when `club.data` is a real
`ClubDetail`. The preview branch has no `ClubDetail` and therefore never computes it. **Nothing
gains a third value**; the two branches are separate renders, which is what keeps every existing
`isMember` gate meaning exactly what it means today.

## The seam PD-326 absorbs

PD-325 must not ship a request nobody can accept, and must not build PD-326. The line:

**Built here — the minimum that makes a request answerable.** A `Requests` section on the club
detail's **full** branch, rendered only when `private.is_club_admin` is true for the viewer, listing
`pending` rows with the requester's public profile and an Approve / Decline pair per row. Nothing
else: no roster management, no roles, no removal, no search, no history view, no Clear control on
declined rows.

**Inherited by PD-326.** That section is where PD-326's Manage riders surface goes. It should
*absorb* this list — same route, same key, same data function — rather than build a second one.
The database side needs nothing from PD-326: `private.is_club_admin` already names the authority,
the DELETE policy already admits an admin clearing a declined row, and PD-326's job is to give that
line a button and to make `admin` reachable at all.

**Two things PD-326 owns that this change deliberately leaves undone**, so that neither is read as
an oversight: **the Clear control on a declined row** (the policy exists, the button does not), and
**role promotion**, without which the "or admin" half of every rule here is empty (`proposal.md`
§2).

## Notifications

Two types, both carrying **`club_id` alone**, matching `club_joined`'s existing subject shape
exactly — which means `036` §3's per-column resolvability conjuncts already cover them and the
SELECT policy is **not** rewritten. That is the property `036` chose the per-column form for.

| Type | Recipient | Actor | Subject | Resolves? |
|---|---|---|---|---|
| `club_join_requested` | `clubs.owner_id` ∪ `club_members` with `role in ('owner','admin')`, minus the actor, minus anyone blocked with them | the requester | `club_id` | **yes** — every recipient is a member or the owner |
| `club_join_request_approved` | the requester | the approving admin | `club_id` | **yes, and only because of statement order** — see below |
| *(a decline)* | — | — | — | **no**, which is why there isn't one |

### The ordering rule inside `approve_club_join_request`

The approved notification's fan-out guard is `private.can_read_club(requester, club)`, which is
false for a private club until the requester holds a `club_members` row. So the RPC's statements
are ordered, and the order is load-bearing rather than stylistic:

1. `private.join_club_from_request(requester, club)` — writes the `club_members` row.
2. `delete from public.club_join_requests where id = request`.
3. write `club_join_request_approved`.

Step 1 before step 3 is what makes step 3's guard pass. Step 2 anywhere before step 3 is fine; it
is placed second so the retraction and the join notification land adjacently.

### Three traps, named because each has a fresh way in here

- **(a) A `when` clause on the fan-out trigger.** Every gate trigger in this repo carries
  `when (current_user = 'authenticated')`, and copying that onto a fan-out whose only writer is a
  `security definer` RPC disables it silently. `notify_club_joined` has no `when` clause and the
  two new ones must not either.
- **(b) `auth.uid()` inside a fan-out.** The actor comes from the row (`NEW.user_id` for the
  request) or from the RPC's own argument list (the approver), never from `auth.uid()` inside the
  trigger function.
- **(c) A caller-relative helper computing a recipient set.** This is the live one.
  `private.is_club_admin(target_club)` resolves `auth.uid()`, and the request fan-out's recipient
  set is *literally the set that helper describes*, so writing
  `where private.is_club_admin(new.club_id)` is the natural thing to type and it would compute the
  set relative to whoever happened to be inserting. **`private.is_club_admin_for(candidate, club)`
  is what the fan-out uses**, and the suite asserts that `is_club_admin_for`'s body mentions
  `auth.uid()` nowhere.

### `notify_club_joined` acquires a definer caller

`036`'s `notify_club_joined` is `after insert on public.club_members for each row` with no `when`
clause, so it **fires inside `join_club_from_request`**. That is correct and wanted — the club's
owner and admins get their ordinary "X joined" row — and it is new behaviour on a shipped fan-out
reached from a new caller, which is why `036`'s hand-exercise gate applies (`tasks.md` 6.2).

Two properties of it that must hold and are asserted rather than assumed: it excludes the actor
(`new.user_id`, the requester, who therefore does **not** get a duplicate), and it returns early for
`clubs.is_default` (irrelevant here, since a default club is public and the accessor excludes it,
but the early return is the reason a second guard is not needed).

## Retention, cascades and the lifecycle answers

Every one of these is an answer the brief asks for by name.

| Event | What happens to the request row | Mechanism |
|---|---|---|
| The club is deleted | gone | `club_id` FK `on delete cascade` |
| The requester deletes their account | gone | `user_id` FK `on delete cascade` |
| **The owner deletes their account** | **survives** | `029`/`032` transfer `clubs.owner_id` to a remaining admin or member, so the club and its requests outlive them. Only when nobody is left is the club deleted, and then the cascade above applies. |
| The requester is blocked by the owner | the row survives and **both parties stop seeing it** | the SELECT policy's `not private.is_blocked(auth.uid(), user_id)` conjunct, symmetric from one directional row. The club also leaves the requester's Explore list, through the accessor's own block conjunct. **A blocked pending request is inert and unanswerable, by both parties.** |
| The requester leaves the club | no request row exists to affect — approval deleted it | §The state machine |
| The club flips **private → public** | the pending row survives and is still answerable; **the club also becomes joinable directly** through the existing `club_members` INSERT policy, which admits a public club | intentional. A rider with a pending request who joins directly leaves a stale `pending` row, which the approval RPC's `on conflict do nothing` renders harmless and which an admin can clear. Asserted. |
| The club flips **public → private** | requests are unaffected; the club leaves nobody's Explore list who already asked | `propagate_club_privacy_to_rides` (`022`) rewrites the club's rides and does not touch this table |
| Nobody answers | the row is `pending` for ever | **stated decision, no expiry.** See below. |

**No expiry, and that is a decision.** An expiring request needs a scheduled job (an Edge Function
on a cron), and it would silently withdraw a rider's request in a way neither party is told about —
which given §Why a decline is silent means the rider cannot tell an expiry from a refusal from a
club that never looked. The trigger that would reopen it is scale: when a club accumulates enough
pending rows that the list is unusable, the answer is pagination on PD-326's surface first, and an
expiry only if that is not enough. Recorded here so the absence is a choice on the record.

**Requests carry personal data** — that one rider asked to join one club, and when. That is the
retention statement `openspec/config.yaml` asks for, and its window is "until the club is deleted,
the rider is deleted, or an admin clears the row".

## Questions Closed

Each has a recommended default so the build is not blocked, and each names who can answer it.
`tasks.md` 0.2 is where they are put to the owner.

**Q1 — Does the private club's avatar ship? (product owner; NON-BLOCKING)**
Default: **no**, initials. §The avatar that will not sign has the one-arm change if the answer is
yes. Non-blocking because the arm can land in a later migration with no data change.

**Q2 — Does a declined club disappear from Explore, or stay with no control? (product owner;
NON-BLOCKING)**
Default: **disappear**. It composes with the silent decline into one coherent "no". Staying with no
control leaves a row the rider will tap for ever. Non-blocking: it is one conjunct in
`club_takes_join_requests`.

**Q3 — May a declined rider ever ask again? (product owner; NON-BLOCKING)**
Default: **only if an admin clears the row.** The requester cannot. §The state machine has the
inversion of `083`'s reasoning that produces this. Non-blocking: it is the DELETE policy's shape,
already written.

**Q4 — Is a decline told to the rider at all? (product owner; BLOCKING if the answer is yes)**
Default: **no**. Blocking in one direction only: building A and later wanting B is a new
notification type, a new column and a rewrite of §What the requester may learn's reasoning, so if
the owner wants the rider told, it is cheaper to know before `085` is written.

**Q5 — Does the reduced screen exist, or does the private card simply not navigate? (product
owner; BLOCKING)**
Default: **the reduced screen.** Blocking because it decides whether `getClubPreview`,
`queryKeys.clubs.preview` and a second render branch on `clubs/detail/page.tsx` exist at all —
roughly half the client-side work in this change.

**Q6 — Is `Request to join` the string? (product owner; NON-BLOCKING)**
Default: **`Request to join`** on the card (matching the brief's own words) and **`Request to join
club`** on the reduced screen's full-width button, mirroring `Join Club`'s existing capitalisation.
There is no drawn frame for either.

**Q7 — Does the minimum approval surface live on the club detail, or on its own route? (agent's,
recorded)**
Answered: **on the club detail**, as a section above Members, visible to owners and admins only.
Its own route would be a screen PD-326 then has to delete or absorb, and PD-125's defect is a
screen nobody can reach — a `Requests` route with no entrance anywhere would be exactly that.
