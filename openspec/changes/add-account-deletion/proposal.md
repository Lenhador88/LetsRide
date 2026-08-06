# Add account deletion

## Why

**It is a hard store blocker, not a backlog item.** App Store Review Guideline 5.1.1(v) rejects
any app that offers account creation and does not offer in-app account deletion. Google Play's
User Data policy requires the same, plus a route to request deletion that does not require
installing the app. LetsRide creates accounts on the first screen a rider sees, and the native
build is Phase 2 of `migrate-to-client-rendered-shell`. Without this, that build cannot be
submitted.

**The design is already drawn and marked Done.** `Profile / Delete account` carries an epic
cover with status **Done**, a `Profile - Timeline` frame, an `Account options` sheet
(`2303:8097`) whose last row is `Delete account` in `Warning/100` with `Element / Icon / Trash`,
and a `Confirm account deletion` frame (`2303:9370`) reading **"Delete account?"** /
**"This action cannot be undone."** with a `Button / Regular / Warning` and a `Cancel`. So the
screens are not the open question. What the button *does* to eleven tables, five Storage
folders and every other rider's screen is, and none of that is drawable.

**Two migrations already name this feature as the thing that changes their reasoning.**
`012` §KNOWN LIMIT: its consent guard is a BEFORE **UPDATE** trigger, unreachable today only
because `handle_new_user` guarantees the `profiles` row exists so a rider's own INSERT dies on
`23505` — "the day an account-deletion flow removes a `profiles` row without its `auth.users`
row … that rider can insert a fresh row with any consent timestamp they like."
`023_participation_gate` §4 builds the `TG_OP`-guarded INSERT arm that closes it, and cites
account deletion as the reason. **`023` is written and not applied**, so the hole is closed on
paper and open in the database. This change is where the two meet.

**And the cascade nobody wrote down is worse than the hole.** Every foreign key into
`public.profiles` is `ON DELETE CASCADE` — eleven of them, from `001`, `009`, `011`, `014` and
`015`. `clubs.owner_id` is one of them, and `postcards.club_id` is *also* `ON DELETE CASCADE`.
So one rider deleting their own account destroys **every postcard every other member ever
posted to a club that rider happened to own**. `009` reasons carefully about the club-deletion
step ("cascade loses the rows; set null leaks them — losing them is the correct failure") and
never considers that the club deletion can be a side effect of a third party's erasure request.
That transitive step is the single most dangerous thing in this proposal.

## What Changes

- **A rider can delete their own account from `/profile`**, through the sheet and confirmation
  the design draws. Nobody else can delete it: there is no admin role — `011` records that as a
  KNOWN GAP, not a feature — and the deletion path takes **no user id parameter at all**.
- **A new Supabase Edge Function is the only thing that may remove an `auth.users` row.**
  Decision #8 permits exactly this — "more server compute, same database". The service-role key
  lives in the function's environment and never enters `src/`, never enters the bundle, and is
  never used to answer a read the client could have made under RLS.
- **`auth.users` is what gets deleted; `public.profiles` is never deleted on its own.** The
  cascade does the rest. Deleting the profile row alone is the exact hole `012` names, and this
  proposal forbids it in a sentence rather than leaving it to the implementer.
- **New migrations** (append-only. **`029` and `030` are claimed by `enforce-creator-membership`, so start at `031`** — and that change should land first, being much smaller. The number here read `026`, then `028` once `028_refresh_stale_column_comments` took that, then `029`; `run.sh` applies by filename so two files sharing a prefix is a trap this repo has sprung before; `026` and `027` landed in the session that wrote this proposal, which is exactly why the task below says re-derive it —
  re-derive with `ls supabase/migrations/` rather than trusting that, because the numbering moved
  underneath this document while it was being written: `021_profile_column_privileges` was split
  into an applied `021_onboarding_state_accessors` plus a pending
  `025_profile_column_privileges`. `CLAUDE.md` and `docs/HANDOFF.md` described the old shape
  while this was being written and were corrected in the same session, so read them rather than
  this parenthesis):
  - **Club ownership survives its owner.** A club is transferred rather than cascaded, so other
    riders' postcards are not collateral. This needs a `security definer` transfer function and
    a relaxation of `016`'s `clubs_avatar_path_owned` / `clubs_cover_image_path_owned` CHECKs,
    which pin the image path to `owner_id` and therefore make **any** ownership transfer raise
    `23514` today.
  - **Four missing FK indexes** — `clubs.owner_id`, `rides.organizer_id`, `club_members.user_id`,
    `ride_members.user_id`. `011` added `postcard_comments_author_id_idx` explicitly "for the
    ON DELETE CASCADE from profiles"; these four never got the same treatment, so a deletion is
    four sequential scans under an `ACCESS EXCLUSIVE`-adjacent lock.
  - **`terms_version`** on `profiles`, because `terms_accepted_at` records *when* consent was
    given and nothing records *to what*, and a consent record that cannot name its terms is weak
    evidence — which is `012`'s own standard applied to `012`'s own column.
- **A public `/legal/account-deletion` page** for Play's web-accessible requirement. It sits
  under the existing public prefix, holds no data, needs no session and adds **no `anon`
  grant** — decision #1 is untouched.
- **Nothing gains a soft-delete flag.** No `deleted_at` on `profiles`, no tombstone rows, no
  "recently deleted" state. The design's own copy is "This action cannot be undone", both stores
  accept immediate deletion, and a soft delete would add a predicate to every SELECT policy in
  the schema — the largest possible change to the layer this project's bugs come from.

**Explicitly not in this change:** notifying affected riders that a ride was cancelled or a club
changed hands (needs the Inbox epic, which has no tables); an admin or moderator role; a
"download my data" export (GDPR Art. 20 portability — a separate right, separately drawn,
not drawn here); and background location tracks, which do not exist yet but whose deletion and
retention rules this change states in advance so the table cannot be created without them.

## Capabilities

### New Capabilities

- `account-deletion`: the rider-facing flow — where it starts, what it confirms, what it costs,
  what it refuses, and every screen state around it. Owns "only the rider themselves", the
  absence of a grace period, and the web-accessible entry point Play requires.
- `account-erasure-cascade`: what actually happens to eleven tables and five Storage folders,
  and — the part reviewers should read first — **what a different rider sees the instant a
  deletion lands**. Owns club ownership survival, ride cancellation, comment threads, blocks and
  the empty-versus-forbidden distinction.
- `deletion-privileged-execution`: the Edge Function as a security boundary. Owns the
  service-role blast radius, idempotency, partial failure, and the rule that the function
  deletes the caller and only the caller.
- `deletion-evidence-and-retention`: the tension between GDPR Art. 17 erasure and keeping the
  consent record `012` calls evidence. Owns retention windows, moderation reports, username
  release, and the rule that any future table holding personal data states its window at
  creation.

### Modified Capabilities

**All four standing capabilities are modified.** They were folded out of
`migrate-to-client-rendered-shell` when it was archived on 2026-08-06 — it now lives at
`openspec/changes/archive/2026-08-06-migrate-to-client-rendered-shell/` — and each was read
requirement by requirement against this change before the deltas below were written. "All four"
is a conclusion, not a default: the reason it comes out that way is that deletion is the first
event in this app that removes a rider *while other riders are looking at them*, and every one
of the four capabilities has at least one requirement whose scope was drawn on the assumption
that riders only ever arrive.

- **`client-session-storage`** — MODIFIED `Sign-out SHALL destroy every local trace of the
  rider`, plus one ADDED requirement. Deletion extends the rule rather than duplicating it, in
  two directions the original could not see. On the deleting device, the revocation call is
  *refused* by a server that no longer knows the account, which is a different failure from the
  offline one the existing scenario covers — and an implementation that reads the refusal as
  "the deletion failed" leaves a signed-in rider with a populated cache. On any *other* device,
  no sign-out ever happens at all: the route guard's `unavailable` branch redirects and clears
  nothing, `signIn` has never cleared anything, and only `signOut` does. That is the ADDED
  requirement — a session whose account is gone must be destroyed, not merely redirected.
- **`database-enforced-integrity`** — MODIFIED four requirements. `Club membership role SHALL
  NOT be self-assignable` now has to admit exactly one promotion, because the club transfer
  moves `clubs.owner_id` while the roster label and `viewer_role` are both read from
  `club_members.role`, and `019` deliberately left that table with no UPDATE policy for anyone.
  `Consent and lifecycle timestamps SHALL NOT be readable by other riders` names two columns and
  must now name three, because `terms_version` is a consent record and `025`'s column allowlist
  is the only thing deciding who can read it. `Onboarding completion SHALL gate participation`
  was reasoned entirely about riders who *have* a `profiles` row; the gate happens to refuse a
  rider who has none, and the five tables it deliberately excludes are held instead by a foreign
  key — a different mechanism, a different error code, and no assertion behind either. `Storage
  object ownership SHALL remain database-enforced` is touched because this change proposes to
  relax `016`'s two club path CHECKs; the delta pins what must survive, and records that the
  relaxation is very likely unnecessary — see the note under Impact.
- **`client-cache-invalidation`** — MODIFIED `Counts SHALL stay per-viewer and SHALL NOT be
  cached across viewers` and `Stale data SHALL be bounded and visible`. Deletion is the first
  mutation in this app whose visible effects land almost entirely in *other riders'* caches,
  none of which will ever run its `invalidate`, so its freshness contract is a revalidation rule
  rather than an invalidation set. It also produces the first cached value that can change what
  a rider is *allowed* to do rather than only what they see — a club that changed hands — and
  the first signed URLs whose objects are gone before the signature expires.
- **`client-render-shell`** — MODIFIED three requirements. `Permission-denied and empty SHALL be
  told apart` is a two-way distinction and deletion makes it a three-way one, with a copy rule:
  unavailable, never "you lack permission", never "this account was deleted". `Every screen
  SHALL define its offline behaviour` offers a choice between refusing a write and holding it,
  and deletion removes the second branch — stated *there* rather than only in this change's own
  flow spec, because the offline queue will be built against that requirement. `The route guard
  SHALL be a UX affordance` gains the branch deletion makes reachable for the first time.

**Nothing is REMOVED and nothing is RENAMED.** No SELECT policy changes, which is the property
`design.md` §Context calls deliberate, and no standing requirement is weakened by this change —
every delta above either narrows a choice or extends a rule to a case it did not cover.

The original note, still true and worth keeping: **where this change contradicts a policy or FK
that already exists, it says so in the delta rather than pretending the behaviour is new.**

## Impact

**Database.** New migrations from `031` (`029`/`030` are claimed by `enforce-creator-membership`,
which should land first) — re-derive with `ls supabase/migrations/` rather than
trusting either number in this document. One new `security definer` transfer function, four
indexes, one column, and **possibly** a relaxed CHECK pair (`016`). **No SELECT policy changes**
— that is a deliberate property, and it is what keeps this change from touching the visibility
layer at all.

**The `016` relaxation is probably not needed at all, and the delta says so rather than letting
a migration be written for it.** `clubs_avatar_path_owned` is
`avatar_path is null or avatar_path like ('club-avatars/' || owner_id::text || '/%')`, and a
CHECK is evaluated against the finished row — so a transfer that clears both paths at or before
the moment it changes `owner_id` satisfies both constraints as written, through the NULL arm
they already have. Only a transfer that *keeps* the images needs the constraint changed, and
that is the option D2 rejects on erasure grounds. Tasks 1.4 and 1.5 are therefore conditional
on a decision this change has already taken the other way; see task 1.4a.

**Code.** `src/components/profile/ProfileMenu.tsx` (the sheet currently ships one row of three),
a new confirmation screen, `src/lib/actions/` gains one action that calls the Edge Function,
`src/lib/data/` gains one read for the confirmation screen's impact summary,
`src/app/legal/account-deletion/page.tsx`, and the empty-state copy on `/rides/[id]`,
`/postcards/[id]`, `/clubs/[id]/members` and the profile byline route — because "this rider is
gone" and "you are not allowed" are currently the same zero rows.

**Supabase.** First Edge Function in the repo — there is no `supabase/functions/` directory
today. It brings a deploy step CI does not have and a secret Vercel does not hold.

**Tests.** Every migration pairs with assertions in `supabase/tests/rls_test.sql` per
`openspec/config.yaml`. The cascade itself is testable in the RLS suite — delete a fixture's
`auth.users` row inside a savepoint and assert what survives — which is better than it sounds,
because the cascade is the part of this change most likely to be wrong.

**Sequencing — this constraint is now satisfied and the note is kept as the reason.** This
change must not ship before `023` is applied. **`023` was applied on 2026-08-06** (the consent
prompt it waited on, `/onboarding/terms`, shipped 2026-08-05, and the `SKIP_MIGRATIONS`
machinery that held it back is retired), so the ordering hazard is closed before this change
starts rather than during it. Had deletion shipped first, `012` §KNOWN LIMIT would have stopped
being theoretical on the same day. See `design.md` §D8.

**A count worth re-deriving rather than reading here.** Eleven FKs reference
`public.profiles` with `ON DELETE CASCADE`; the chain is two levels deep in two places:

```bash
grep -n "references .*profiles(id)" supabase/migrations/*.sql   # 11, all `on delete cascade`
grep -n "references .*clubs(id)"    supabase/migrations/*.sql   # postcards CASCADE, rides SET NULL
```
