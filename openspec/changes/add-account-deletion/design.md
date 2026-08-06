# Design — account deletion

## Context

The design for this flow exists, is marked **Done**, and answers less than it looks like it
does. Everything below is read from `design/` and from the migration chain on 2026-08-05, not
quoted from documentation.

| Fact | Value | How to re-derive |
|---|---|---|
| Design frames | 3 + an epic cover + a note, status **Done** | `npm run figma -- ls "Delete account"` |
| Rows in the `Account options` sheet | **3** — Preferences, Sign out, Delete account | `npm run figma -- tree "Profile / Delete account / Account options" --all` |
| Rows built in `ProfileMenu.tsx` | **1** — Sign out | read the file |
| Confirmation copy | "Delete account?" / "This action cannot be undone." | `npm run figma -- text "…/Confirm account deletion"` |
| Confirmation buttons | `Button / Regular / Warning` "Delete account", `Secondary` "Cancel" | same |
| FKs into `public.profiles` | **11**, every one `ON DELETE CASCADE` | `grep -n "references .*profiles(id)" supabase/migrations/*.sql` |
| `postcards.club_id` | `ON DELETE CASCADE` — the second cascade level | `009_postcards_and_blocks.sql:161` |
| `rides.club_id` | `ON DELETE SET NULL` — deliberately different, see `009`'s comment | `001_initial_schema.sql:64` |
| Storage | **one** bucket `media`, five folder prefixes | `scripts/storage/sweep-orphans.mjs:49` |
| Edge Functions today | **zero**; no `supabase/functions/` directory | `ls supabase/` |
| Admin/moderator role | none, recorded as a KNOWN GAP | `011_postcard_interactions.sql` |
| Next free migration number | **028** — `026` and `027` landed in the same session this was written in | `ls supabase/migrations/` |

**Two documentation claims this change had to correct before it could start.**

1. `ProfileMenu.tsx`'s doc comment and `docs/FIGMA-FIDELITY-TODO.md` §Profile both say the sheet
   has "**exactly two rows** in the design, and that is read from the frame rather than
   assumed". It has three. `Preferences` (`Element / Icon / Preferences`) is the first row and
   is **not** hidden — verified with `--all`, where the hidden nodes in that frame are the
   header's back button and an unused button container, and none of the three list items. A
   claim that names its own method and is still wrong is the most expensive kind, because the
   method reads as verification.
2. `npm run storage:sweep` cannot clean up after a deleted account and was never meant to. It
   sweeps `media/postcards/<uid>/` for **one** rider, using that rider's own email and password,
   because `010` grants each rider DELETE on their own folder only. There is no credential in
   this repo that can delete a departed rider's objects, and decision #8 says there must not be
   one in the app. That is why the Edge Function has to do it before the rows go.

Four constraints shape everything below.

1. **`auth.users` is the root of the cascade and the only correct place to cut.** Deleting
   `public.profiles` alone leaves an `auth.users` row whose owner can sign in, hit
   `handle_new_user`'s absence, and INSERT a fresh `profiles` row — `012` §KNOWN LIMIT, in full.
2. **The cascade is already written and it is wrong in one place.** Not "unspecified" — written,
   in `001` and `009`, and destructive of third-party content through `clubs`.
3. **No SELECT policy may change.** The visibility layer is where this project's bugs come from;
   a deletion feature that edits it is a deletion feature nobody can review.
4. **The design draws the screens and cannot draw the semantics.** "This action cannot be
   undone" is a real answer to reversibility and no answer at all to what happens to a club.

## Goals / Non-Goals

**Goals**

- A rider can delete their own account, in the app, without contacting anybody, and the account
  and its personal data are gone when the flow reports success.
- No other rider loses content they authored because someone else exercised an erasure right.
- Every table, folder and future table has a stated answer, so nothing is left to the
  implementer's assumption — which `openspec/config.yaml` names as the origin of every
  access-control bug here.
- The elevated-rights surface is one function, takes no id, and can delete exactly one account.

**Non-Goals**

- Data export / portability (GDPR Art. 20). A different right, a different screen, not drawn.
- Notifying affected riders. Needs Inbox, which has no tables. The confirmation screen tells the
  *deleting* rider what it will cost; nobody else is told anything.
- An admin, moderator or support-initiated deletion path. There is no admin role and this change
  does not invent one.
- A grace period, an undo, or a "recently deleted" state — see D5.
- Reopening decision #1 (no anonymous access), decision #2 (blocking in RLS) or decision #8.

## Decisions

### D1 — One Edge Function, no id parameter, service-role never leaves it

Removing an `auth.users` row needs the Auth admin API, which needs the service-role key. That is
"more server compute, same database" — the first of decision #8's three readings, and the one it
calls "almost certainly the only one we ever need". It is **not** the third reading: the function
owns one operation, not the database, and every other read and write in the app keeps going
through RLS unchanged.

The function:

- Takes **no user id**. It reads the caller's JWT, resolves `sub`, and deletes that. A
  service-role function that accepts an id is account-deletion-as-a-service for anyone who finds
  the URL, and "we validate that the id matches the caller" is one refactor away from not doing
  that. Removing the parameter removes the class.
- Verifies the JWT itself rather than trusting the gateway, and refuses anything that is not a
  live, non-anonymous rider session.
- Calls `deleteUser(sub)` with **hard delete**, not Supabase's soft-delete mode. A soft-deleted
  `auth.users` row keeps the email address — personal data we said we erased — and keeps that
  address from being reusable, which turns a deletion into a permanent ban on the person's email.
- Is the only place the key exists. Not in `.env.local`, not in Vercel, not in `src/`, not in a
  test fixture. `CLAUDE.md` §What Not To Do says "don't introduce a service-role key into the
  app"; the function is not the app, and this decision is what keeps that distinction real.

*Alternatives.* A `security definer` RPC in Postgres cannot do it: `auth.admin` is an API, not a
SQL surface, and a definer function owned by `postgres` deleting from `auth.users` would put a
row-deleting privileged function on PostgREST's published surface — the thing `009` moved
`is_blocked` into `private` to avoid. A Next.js Route Handler is out because the render model is
migrating to the client and Route Handlers go with it (`CLAUDE.md` §Technology Decisions).

### D2 — A club outlives its owner. This is the change's centre of gravity

Today: `clubs.owner_id → profiles ON DELETE CASCADE`, and `postcards.club_id → clubs ON DELETE
CASCADE`. Chain it. Rider A owns club C. Riders B, D and E have posted forty postcards into C.
A deletes their account. **All forty are destroyed**, along with the club, its roster, its
`feed_reads` watermarks, and — through `rides.club_id ON DELETE SET NULL` — a set of rides that
survive in a state described in D3.

`009` argued the second link carefully and correctly for the case it considered: a club being
*deleted by its owner*, deliberately, where "cascade loses the rows; set null leaks them" and
losing them is right. It did not consider the club being deleted as a *consequence* of an
unrelated erasure request. The reasoning is sound and its premise moved.

**So ownership transfers before the cascade runs, inside the deletion, in one transaction:**

1. The longest-tenured remaining `admin` of that club, by `club_members.joined_at`.
2. Failing that, the longest-tenured remaining `member`.
3. Failing that — the departing rider is the only member — the club is deleted with them, and
   its postcards go with it, which is `009`'s original case and its original answer.

Nothing writes `club_members.role = 'admin'` today (`CLAUDE.md`; the invitations feature owns
it), so step 1 is dead code on arrival and is written anyway because the day it stops being dead
is the day someone would otherwise have to remember this.

**`016`'s CHECK constraints make ownership transfer impossible today, and that is not obvious
from either file.** `clubs_avatar_path_owned` is `avatar_path is null or avatar_path like
'club-avatars/' || owner_id::text || '/%'` — the path is pinned to the *current* owner, because
the object must land before the club row exists so the storage policy had to key on the
uploader. Any `update clubs set owner_id = …` on a club with an image therefore raises `23514`.
Two ways out:

- **Null both paths on transfer and delete the objects.** The club keeps its name and falls back
  to initials, exactly as every club does today (0 clubs have ever had an `avatar_path`). One
  line in the transfer function, no new constraint semantics.
- **Add an `image_owner_id` column** the CHECK points at instead, so the object stays valid under
  its uploader's folder. Better-looking, and it retains a departed rider's uid in a path forever,
  which is the opposite of what an erasure request asked for.

The second is rejected on that last clause alone. **The club loses its images when its owner
leaves**, and that is a stated product consequence rather than a bug to be found later.

*Alternative considered and rejected: refuse the deletion until the rider hands over their
clubs.* It reads responsible and it is a store risk — Apple's 5.1.1(v) exists precisely to stop
apps putting steps between a rider and deletion, and "resolve your three clubs first" is a step.
Deletion always completes.

### D3 — A ride is cancelled by its organizer's deletion, and must not become a zombie

`rides.organizer_id → profiles ON DELETE CASCADE`, so the ride and its `ride_members` rows
vanish. Riders who RSVP'd `going` find out by the ride no longer being there.

That is accepted for the organizer's *own* rides: a ride is one person's plan, the organizer is
the plan, and preserving a ride nobody is running is worse than removing it. What is **not**
accepted is the second-order case, which nothing has written down:

**A club ride organised by someone else, when the club is deleted, becomes invisible to everyone
including its own crew.** `rides.club_id` is `ON DELETE SET NULL`. A private club's rides carry
`is_public = false` (guaranteed by `022`). After the club goes, such a ride has `club_id NULL`
and `is_public false`, and `022` §4's SELECT policy reads
`organizer or (is_public and (club_id is null or is_club_public(club_id))) or club member` — so
only the organizer can see it. Its `ride_members` rows still exist, and `ride_members`' SELECT
policy is `exists (select 1 from rides r where r.id = ride_members.ride_id)`, so the crew cannot
see the crew either. A ride with a roster nobody can read is a zombie.

D2 removes the common path to this by transferring the club instead of deleting it. The
remaining path — last member deletes, club goes, other riders' rides orphan — is closed by
deleting the club's rides with the club rather than orphaning them, in the same transfer
function. Stated rather than left to `SET NULL`'s default, because `SET NULL` was chosen in `001`
for a schema that had no `is_public` interaction and no `022`.

### D4 — Storage objects are deleted before the rows, by the function, through the Storage API

`delete from storage.objects` is refused by Supabase's own guard (`42501: Direct deletion from
storage tables is not allowed`), which `sweep-orphans.mjs` documents at length and which is
right — the row is metadata and the bytes live elsewhere. So the Storage API is the only path,
and the function is the only caller with rights over a folder that is not its own.

Five prefixes in the `media` bucket: `postcards/<uid>/`, `avatars/<uid>/`, `covers/<uid>/`,
`club-avatars/<uid>/`, `club-covers/<uid>/`. All five go. The last two are keyed on the
**uploader**, so they hold images for clubs that may now belong to somebody else — which is
exactly why D2 nulls those paths rather than leaving a dangling reference.

**Order: objects first, rows second.** The reverse loses the paths that say what to delete, and
leaves bytes nothing can enumerate — the failure `sweep-orphans.mjs` was written to clean up
after, at a scale where nobody is coming back with a password. If the object delete fails, the
whole deletion fails and is retried; see D7.

### D5 — Immediate and final. No grace period, no soft delete, no tombstones

The design's own copy is "This action cannot be undone." Both stores accept immediate deletion;
Apple accepts a grace period and does not require one.

A grace period costs: a `deleted_at` column on `profiles`, a predicate in **every** SELECT policy
in the schema (twenty-plus), a scheduled Edge Function to finish the job, a re-activation path
through an auth row that must stay alive, and a state in which a rider is invisible but their
data is present — which is a new visibility state, and this project's bugs come from exactly
those. It also weakens the erasure claim: data still there is data still there.

Tombstone rows ("[deleted rider]" bylines) are rejected on the same grounds plus one more: they
require keeping a `profiles` row, which keeps a subject whose deletion we reported as complete.
A comment whose author is gone is **removed**, not anonymised. The alternative — anonymised
comments — is defensible product design and is a different change, with a different schema
(a nullable `author_id` and a rewritten `postcard_comments` SELECT policy), and it is not this
one.

### D6 — Re-authentication is added, deviating from the drawn frame

`Confirm account deletion` draws a title, a line of body copy and two buttons. It does not draw
a password field, and a stolen unlocked phone is two taps from destroying an account. Every
comparable flow re-authenticates.

The recommendation is to require the account password immediately before the destructive call
(and to accept an OAuth re-consent if federated sign-in ever lands). It is a deviation from a
`Done` frame, so it is Q7 for the designer rather than a decision taken here, and the default is
"add it" because the failure it prevents is unrecoverable and the failure it causes is a rider
mildly annoyed.

`/auth/reset-password`'s recovery grant (`migrate-to-client-rendered-shell` D3) is the wrong
mechanism to copy: that one exists because the rider does *not* know their password. Here they
do, and being unable to produce it is itself the signal.

### D7 — The function is idempotent and fails loudly, and there is no partial success

Deletion is one HTTP call over a mobile connection, so the interesting states are the ones where
it does not cleanly return.

- **Already deleted** → success. The JWT resolves to a `sub` with no `auth.users` row; there is
  nothing to do and reporting failure would strand a rider on a screen with no exit.
- **Storage delete fails** → the whole call fails, nothing is deleted, the rider sees an error
  and a retry. The rows are what make the objects findable.
- **Row cascade fails** → the same, except the objects are already gone. This is the one
  genuinely partial state, it is unavoidable in the absence of a distributed transaction, and it
  is the *right* half to lose: images without rows are orphans a sweeper can find; rows without
  images render broken.
- **Client disconnects mid-call** → the function completes server-side. The client's next start
  finds no session, which is the correct outcome, reached by an unnerving route.
- **A still-valid access token on another device** keeps working until it expires — up to an
  hour by default. It can read; it cannot write, because every INSERT's FK to `profiles` now
  fails `23503`, and with `023` applied `private.may_participate()` returns false first. This is
  a stated, accepted window rather than a hole, and the two independent failures are why.

### D8 — Sequencing against `023`, and what `1.14` got right and wrong

`migrate-to-client-rendered-shell` task 1.14 closes `012` §KNOWN LIMIT with a `TG_OP`-guarded
BEFORE INSERT arm on `enforce_onboarding_completion`, and says it is needed because account
deletion is coming. Reading `023` as written:

- **1.14 is right that the hole exists and right about its mechanism.** It is written and it is
  correct.
- **1.14 is wrong that account deletion is what opens it, if this proposal's D1 holds.** The hole
  needs a `profiles` row absent while its `auth.users` row survives. Deleting the auth row can
  never produce that state — the cascade takes the profile with it. What produces it is deleting
  the profile row *alone*, which is a thing an implementer might reasonably do and which this
  change forbids in writing. So the two are belt and braces, and the belt is this sentence.
- **1.14's arm is narrower than its stated intent in one respect.** On INSERT it server-stamps
  `terms_accepted_at` and refuses completion without username, location and consent. It does not
  server-stamp or bound `onboarding_completed_at`, so a re-inserted row could carry a back-dated
  completion stamp. Completion time is not evidence the way consent time is, so this is a note
  rather than a defect — recorded so the next reader does not have to re-derive it.
- **`023` is unapplied and gated behind the consent prompt**, which is unbuilt. If deletion ships
  first, nothing is worse than today. If someone implements deletion as "delete the profile
  row", everything is. Hence the requirement rather than the trust.

### D9 — Blocks do not survive re-registration, and we say so rather than fix it

`blocks` cascades on both `blocker_id` and `blocked_id`. A rider who is blocked can delete their
account, sign up again with the same email — decision #6 has email confirmation off, so the
address need not even be theirs — receive a new `auth.users` uuid, and be un-blocked by everyone
who had blocked them.

Every fix is worse than the problem:

- Retaining a hash of the deleted rider's email in a surviving table retains an identifier of an
  account we said we erased, and it would have to be readable by the block check, which means a
  `security definer` function over a table of hashed emails of deleted people. No.
- Blocking re-registration on a previously-used email turns deletion into a permanent ban and
  breaks the ordinary "I deleted it by mistake, let me sign up again" case.

So: accepted, stated, and mitigated only by the fact that blocking someone again is two taps.
The scenario is written down so the first support conversation about it is not a discovery. It
also gets worse if email confirmation stays off, which is one more argument for decision #6's
"must be revisited before public launch".

### D10 — The consent record: erasure wins, with one narrow retention

`012` argues that `terms_accepted_at` is evidence and that evidence a party can rewrite is not
evidence. GDPR Art. 17 says the subject may demand erasure. Art. 17(3)(e) preserves data needed
for the establishment or defence of legal claims. Both are real and they point opposite ways.

The recommendation, for a pre-launch app with four accounts and no paid tier:

- **Erase the `profiles` row, consent stamp included**, with everything else.
- **Retain one row in an append-only `consent_records` table** holding a one-way hash of the
  subject's uuid (salted with a secret held only by the Edge Function), the terms version, the
  server timestamp, and nothing else. No email, no username, no IP. It cannot identify anyone by
  inspection; it can confirm or refute a specific claim if the claimant supplies their own uuid.
  Not readable by `authenticated` at all — no policy, no grant.
- **Add `profiles.terms_version`**, because `terms_accepted_at` records *when* and nothing
  records *what*, and the document at `/legal/terms` changes without leaving a trace. A consent
  record that cannot name its terms is exactly the weak evidence `012` set out to prevent, and
  `012` did not notice it about its own column.

This is a legal position, not an engineering one. Q4 is the product owner's, and the default
above lets the build proceed either way: without the retention table the flow is strictly
simpler, so adopting "retain nothing" later removes work rather than adding it.

### D11 — Empty and forbidden must stop looking identical

RLS returns zero rows for "not allowed", "blocked", "does not exist" and "the author deleted
their account". Four causes, one client-visible symptom — the state checklist's permission-denied
row, and the reason it is on the checklist.

Deletion makes the fourth cause ordinary rather than exotic: a shared postcard link, an open ride
page, a byline tapped from a cached deck. The rule adopted here is the same one Q2 of the render
migration settled for private clubs — **reveal nothing about existence** — with one addition: the
copy says the content is *unavailable*, never that the rider was deleted, because "this account
was deleted" discloses something about a person to someone they may have blocked.

Four screens need the treatment: `/rides/[id]`, `/postcards/[id]`, a byline tapped through to a
profile, and the deck when a card disappears between fetch and swipe. The deck matters more than
it looks: `CLAUDE.md` records that it only moves forward, so a card that vanishes must be skipped
rather than leaving a blank the rider cannot get back to.

## Risks / Trade-offs

- **The cascade is destructive and there is no undo.** → The RLS suite gets a fixture that
  deletes an `auth.users` row inside a savepoint and asserts, table by table, what survived. The
  cascade is the part most likely to be silently wrong, and it is fully testable on plain
  Postgres, which is unusual and worth spending.
- **Service-role key in an Edge Function.** → No id parameter, JWT verified in the function,
  one operation, secret never in the repo or the bundle, and the function is the only new
  privileged surface. Re-audited by `reviewer` before the PR, per its RLS/data-exposure mandate.
- **Ownership transfer hands a club to someone who did not ask for it.** → Real, and preferable
  to destroying forty postcards. The receiving rider can delete or leave the club, both of which
  already have policies. Notifying them needs Inbox; recorded as out of scope rather than
  assumed away.
- **Deleting the last owner of a large club still destroys content** when they are the only
  remaining member. ~~The case is empty by construction.~~ **It is not — that claim was refuted
  2026-08-06.** A rider can leave a club while their postcards stay, so "only remaining member"
  does not imply "only remaining author", and `postcards.club_id` cascades from `clubs`. The
  delete branch can therefore destroy the third-party content D2 exists to protect. Recommended
  default: delete only when no other rider's postcards remain, else transfer to the author of
  the oldest one. Task 1.6b; **PO decides.**
- **Four missing FK indexes turn a deletion into four sequential scans.** → Free to add now, at
  three rides and two clubs. Not free at ten thousand, and the deletion holds locks while it
  runs. `011` added exactly this index for `postcard_comments` and named the reason; the other
  four are the same reason, unwritten.
- **First Edge Function in the repo** brings a deploy path CI does not have. → One task for it,
  and a note that a function deployed by hand and never redeployed is the same class of drift as
  an unapplied migration.
- **The free-tier project auto-pauses.** → A rider who cannot reach a paused project cannot
  delete their account, and "I tried and it failed" is the complaint that reaches a store
  reviewer. Pro before submission, which `docs/HANDOFF.md` already carries as an owner action.

## Migration Plan

Four steps. **Only the first is independently landable**; steps 2 and 3 are one unit, because a
deletion flow with no club transfer destroys other riders' postcards on its first use.

1. **Additive migrations.** The four FK indexes, `profiles.terms_version`, the relaxed `016`
   CHECK pair and the transfer function, plus assertions. Nothing removes anything; nothing the
   app reads changes shape. Valuable even if the flow never ships — the indexes are right
   regardless, and the CHECK relaxation unblocks any future ownership transfer.
2. **The Edge Function**, deployed and exercised against a disposable account, before any UI
   points at it.
3. **The flow**: sheet row, confirmation screen, impact summary, re-auth, sign-out, and the four
   empty-state repairs from D11.
4. **The public `/legal/account-deletion` page**, which can land any time and is listed last
   because it is the only part with no dependency.

**Verify against the real database, with a real account, before calling it done.** `npm test`
proves the cascade; only a live run proves the Edge Function's JWT verification, the Storage
delete and the sign-out. `docs/HANDOFF.md` records that three PRs once merged unverified because
nobody tested a claimed blocker — the same discipline applies to a claimed success.

**Rollback.** Nothing here is reversible in the data sense, which is the feature. The *code* is
an ordinary revert; the migrations are append-only, so a transfer rule that proves wrong is
corrected by a further migration. A deleted account is not coming back under any of them.

## Open Questions

Each carries a recommended default so the build is never blocked on an answer. **PO** = product
owner only; **Designer** = the design owner; **Eng** = decidable in the work.

| # | Question | Recommended default | Blocking? | Who |
|---|---|---|---|---|
| Q1 | What happens to a club whose owner deletes their account, given `clubs.owner_id` cascades and `postcards.club_id` cascades behind it? | **Transfer** to the longest-tenured admin, else the longest-tenured member; delete only if no member remains (D2). Never destroy another rider's postcards as a side effect of someone else's erasure. | **Yes** — it decides the migration's shape | PO |
| Q2 | An ownership transfer violates `016`'s `clubs_*_path_owned` CHECKs, which pin the image path to `owner_id`. Null the paths, or re-point the CHECK at an uploader column? | **Null both paths and delete the objects.** The club falls back to initials. Keeping a departed rider's uid in a live path is the opposite of erasure. | No | Eng + Designer (the club loses its image) |
| Q3 | An upcoming ride with a crew, whose organizer deletes. Cancel silently, or preserve? | **Cancel** — the ride vanishes with its organizer, and the confirmation screen names the count before the rider commits. Preserving needs a nullable organizer and a cancelled state, i.e. a different change. | No | PO |
| Q4 | Consent evidence versus erasure: `terms_accepted_at` is what `012` calls evidence, and Art. 17 says erase it. | **Erase the profile row; retain one de-identified `consent_records` row** — salted hash of the uuid, terms version, timestamp, nothing else, no grants (D10). Adopting "retain nothing" later removes work rather than adding it. | **Yes, before launch** — not before build | PO (legal) |
| Q5 | Is there a grace period? | **No.** Immediate and final, matching the drawn copy "This action cannot be undone." A soft delete adds a predicate to every SELECT policy in the schema. | No | PO |
| Q6 | Is the username released immediately for anyone else to take? | **Yes**, immediately — it is a UNIQUE column and the row is gone. Reserving it needs a table that outlives the profile, which is retention of an identifier we said we erased. | No | PO |
| Q7 | Re-authenticate before deleting? The `Done` frame draws no password field. | **Require the password** (D6). A deviation from the frame, justified by an unrecoverable failure mode. Needs the designer to draw the field or bless the deviation. | No | Designer + PO |
| Q8 | Play requires a web-accessible deletion route. Every route but `/auth/*` and `/legal/*` needs a session. | A public **`/legal/account-deletion`** page describing the in-app path and linking to `/profile`. Holds no data, needs no session, adds **no `anon` grant** — decision #1 untouched. | No | PO |
| Q9 | Moderation reports the deleting rider filed cascade away with them. Keep them? | **Let them go.** No admin role exists to triage them (`011` KNOWN GAP), and a report is an accusation attached to a person who has left. Revisit when moderation gets a role. | No | PO |
| Q10 | Objects the Storage delete misses become permanent orphans — no credential can reach a departed rider's folder. | Fail the whole deletion if the object delete fails (D7), and log the prefix. A cross-rider sweeper needs a privileged credential and is out of scope; name it rather than build it. | No | Eng |
| Q11 | Deleting while offline. | **Refuse**, with a plain message. Queuing an irreversible destructive action for later execution is the one mutation that must never be optimistic. | No | Eng |
| Q12 | Background location tracks are on the roadmap and do not exist yet. | The table **may not be created without** a stated retention window and a stated deletion rule; this change writes the rule now so the table inherits it. A GPS track with no expiry is a permanent record of where someone was. | No | PO (window) + Eng |
| Q13 | Should the deletion be rate limited or audited? | One deletion per session, no id parameter, and **no audit row in the database** — an audit trail of who deleted their account is a record of the people who asked to have no record. The function may log without a subject id. | No | PO (legal) + Eng |
| Q14 | `profiles.terms_version` does not exist, so no consent record can name its terms. | **Add it**, defaulting to the current version string, and stamp it alongside `terms_accepted_at`. Cheap now; impossible to reconstruct later. | No | Eng, PO to supply the version string |
