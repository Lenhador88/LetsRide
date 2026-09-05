# Design — undo a block or a hide

Every measurement below was taken against DEV (`fpmrimzxadewsaiwpsel`) on **2026-09-05**, as
`authenticated` with a real rider's `sub`, in a rolled-back transaction where it wrote anything.
Where a number is inferred rather than measured it says so.

---

## D1 — Why a `security definer` accessor, and not a second `profiles` policy

**The rejected alternative:** add a SELECT policy on `profiles` reading
`exists (select 1 from blocks b where b.blocker_id = auth.uid() and b.blocked_id = profiles.id)`.

It is wrong, and the reason is a property of RLS rather than a matter of taste. **Multiple
permissive policies for the same role and command are OR'd together.** So that policy does not
"let the blocked-riders list read the row" — it lets **every** `profiles` read in the app read
the row: the postcard byline, the club roster, the ride crew, search, chat. The block would
stop working while still existing, which is the worst of the three possible outcomes.

A `security definer` function is the opposite shape: it opens a single, named hole with a single
statement in it, and every other reader is untouched. `private.is_blocked` itself exists for
this reason and `009` says so in its header.

**The function's owner is `postgres` and `relforcerowsecurity` is `false` on all four tables
involved** (`blocks`, `postcard_hides`, `profiles`, `postcards` — read from `pg_class`), which is
what makes the bypass work. That is worth stating because it is load-bearing and invisible: if
anyone ever sets `FORCE ROW LEVEL SECURITY` on `profiles`, both accessors silently return
nothing rather than failing.

**`public`, not `private`.** `029` is the precedent for getting this backwards: it put a worker
in `private` on the assumption that a non-client role could reach it, and nothing caught the
mistake because the RLS suite runs as the table owner, for whom no barrier exists. The client
calls these two through PostgREST, PostgREST routes only to `public`, so `public` it is — and
the advisor is the price. **Two advisors, 37 → 39 per project**, derived rather than trusted:

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'execute');   -- 34 today
```

34 + 2 `rls_enabled_no_policy` INFOs + 1 `auth_leaked_password_protection` = the documented 37.

**Each accessor restates its invariants because it must.** Inside a `security definer` function
`current_user` is the *owner*, so any trigger guard beginning `if current_user <> 'authenticated'`
never runs. `public.ride_journal_postcard_ids(uuid)` is the exact precedent to copy — a `public`
`security definer` function, `stable`, `set search_path to ''`, restating the whole `postcards`
SELECT qual verbatim with a comment explaining which conjunct must stay unconditional.

---

## D2 — `my_blocked_riders()` SHALL NOT restate the `username is not null` conjunct

The `profiles` SELECT qual is
`(auth.uid() = id) OR ((username IS NOT NULL) AND (NOT private.is_blocked(auth.uid(), id)))`.

A careful implementer copies that qual into the accessor, exactly as `ride_journal_postcard_ids`
copies the `postcards` qual — and here that is **a bug**, because it drops a row.

The `blocks` INSERT policy checks only `blocker_id = auth.uid()`, and the sole CHECK is
`blocks_no_self_block`. Nothing requires the blocked party to have a username. Through the app
that never happens (you can only block someone you can see), but the publishable key ships in
the bundle and PostgREST accepts any rider's JWT, so a block row against an un-onboarded uuid is
one hand-rolled request away — the same argument `database-enforced-integrity` opens with.

**The rule: one row out per `blocks` row in, always.** A block that does not appear in the list
is a block that cannot be lifted, which is precisely the defect PD-298 exists to fix, reproduced
inside its own fix. A NULL username renders as a fallback; it does not vanish.

The FK direction makes the join itself safe — `blocks.blocked_id` references `profiles(id)`
`ON DELETE CASCADE` (read from `pg_constraint`), so a `blocks` row always has a `profiles` row
and the join can never drop for a missing parent. The only hazard is the qual, not the join.

---

## D3 — Neither list can render an image, and this was measured

**This is the most consequential finding in the change and it contradicts the issue and the
brief that commissioned this proposal.**

`storage.objects` policies are ordinary RLS policies evaluated as the **caller**. Both relevant
ones delegate to a table the caller's own RLS governs:

```
"Riders read avatars their profile visibility allows"
  … AND (foldername[2] = auth.uid() OR EXISTS (SELECT 1 FROM profiles p
        WHERE p.avatar_path = objects.name AND foldername[2] = p.id))

"Riders read postcard images their audience predicate allows"
  … AND EXISTS (SELECT 1 FROM postcards p
        WHERE p.image_path = objects.name AND foldername[2] = p.author_id)
```

**Avatar, measured.** As the blocker, `exists (select 1 from profiles p where p.id = <blocked>)`
is `false`, while the same expression for their own id is `true`. The policy's EXISTS therefore
cannot resolve and the avatar cannot sign.

**Postcard image, measured in one rolled-back transaction.** As a rider who has audience for a
postcard, the policy's EXISTS subquery resolves `true`. Insert the `postcard_hides` row in the
same transaction and, in the very next statement, the postcard reads 0 rows and the subquery
resolves **`false`**. Rolled back; DEV still has 0 hide rows.

A `security definer` accessor bypasses table RLS, so it can *return* `avatar_path` and
`image_path`. It cannot make Storage sign them: `createSignedUrls` is an API-side call
authorized as the rider, and `resolveAvatarUrls`'s own header already states the consequence —
*"A path that will not sign lands as null and the tile falls back accordingly — signing is not
the check, the Storage SELECT policy is."*

**Three consequences, and they are decisions rather than observations:**

1. **`my_blocked_riders()` SHALL NOT return `avatar_path`.** The brief proposed
   `PUBLIC_PROFILE_COLUMNS`-equivalent fields, which includes it. Returning it costs a signing
   round trip whose only possible result is `null`, and ships a column whose sole meaning is a
   broken image. The list renders `Avatar`'s initials fallback from the username. This is
   omission-because-measured, not omission-by-preference.
2. **`my_hidden_postcards()` returns no `image_path` either — `106`, and for a different reason.**
   `105` returned it against a possible future widening of the Storage policy. D4 below then
   removed every column but `postcard_id` and `hidden_at`, so the question is moot: the list
   draws a neutral placeholder, and a widening would need a migration as well as a client change.
   Nothing is lost by that — this consequence already measured that no path on this list can
   sign.
3. **The `postcards` Storage policy is the only place a widening could go**, and it is a
   modification of an existing SELECT policy — so choosing it moves this migration out of the
   purely-additive class. Recorded here so the ordering question is asked rather than inherited.

---

## D4 — `restorable` IS the side channel, and the list stops differentiating

**This section is a rewrite. The version `105` was built from — "collapsing the reasons is the
mitigation" — was wrong, a pre-merge review found it before either accessor had a caller, and
`106` replaced the function.** What follows is what was actually found and what shipped;
`105`'s reasoning is in git history and is not restated here.

### What `105` shipped

`my_hidden_postcards` returned `restorable` — `011`'s `postcards` SELECT qual with the hide
conjunct removed — plus five preview columns, NULLed when `restorable` was false:

```sql
not private.is_blocked((select auth.uid()), p.author_id)
and (p.club_id is null or private.is_club_member(p.club_id))
```

### Finding 1 — for a non-club postcard the predicate reduces to the block

**`club_id IS NULL` makes the second conjunct vacuously true**, so `restorable` is exactly
`not is_blocked(me, author)`. The same change ships `my_blocked_riders()`, which tells a rider
their own **outbound** blocks. Subtract one from the other:

1. hide one non-club postcard by each rider you want to monitor;
2. poll the list;
3. a row that turns unrestorable while its author is absent from `my_blocked_riders()` has one
   remaining cause — **that rider blocked you**.

**And it is wider than the non-club case, which is the strongest version of the finding.** The
club conjunct is `club_id is null or private.is_club_member(club_id)`, and a rider can always read
their *own* membership — so for a club postcard in a club they are still in, the second conjunct
is *known* true and `restorable` reduces to the block there too. The reduction fails only for a
postcard in a club the rider has left, which they also know. **Every row on the list is therefore
either a block oracle or knowably not, at the reader's choice**, which is why no amount of
collapsing helps.

Deterministic, repeatable, and driven on a schedule the rider controls. `rls_test.sql` defends
*"the blocked rider is not told they were blocked"* in as many words, and decision #2 rests on
it. The channel did not exist before the feature: A hides B's postcard, B blocks A, and A
observed nothing, because the postcard was already gone from every screen. The feature created
the observation.

**NULLing the preview columns mitigated none of it.** The rider already knows who authored the
postcard *they themselves chose to hide*, so `restorable` beside the always-returned
`postcard_id` was the whole signal. `105` emptied the payload and left the channel.

### Finding 2 — the collapse was two-way, not three-way

The rejected version named three reasons and counted the author's account deletion as the third.
It cannot produce an unrestorable row: `profiles → postcards → postcard_hides` all cascade
`ON DELETE`, so that case removes the hide row from the table entirely and the entry leaves the
list. `105.10` asserts exactly that. **Two reasons, one of them the block, is a far weaker set to
hide a signal in than three** — and the change's own assertions proved the third away while its
design doc went on counting it.

### Finding 3 — no predicate fixes it

For a non-club postcard the only reason to withhold is the block. So:

- **withholding is the signal**, and
- **not withholding** discloses an author's photo, caption and username to someone they blocked —
  decision #2, far worse than the leak it fixes.

There is no third predicate between those, because the input it would have to be blind to is the
only input it has. Dropping unrestorable rows from the list is the same signal by omission, and
it strands a `postcard_hides` row the rider can no longer reach.

### Adopted — `106`, the list stops differentiating at all

`my_hidden_postcards` returns **two columns, `postcard_id` and `hidden_at`**, and nothing else.
No `restorable`, no caption, no author username, no place, no image path, no `created_at`.

**The property, stated as the migration header states it: nothing in a returned row may vary with
another rider's actions.** That is what the assertions assert — 105.7 and 105.8 compare the whole
result set before and after a membership change and before and after a block, and 106.3 places a
real block through the real INSERT policy and requires the list to come back byte-identical.

The cost is a duller screen: a neutral row per hidden postcard with a *Remove from this list*
action. No thumbnail is lost by this, because D3 already measured that none could ever sign.

The residual signal is that a rider can see a hide row exists at all, which is unavoidable while
the row exists and is attributable to nothing but their own action.

### The one richer alternative, and why it is not built

**A preview snapshotted into `postcard_hides` at hide time** — caption and author username copied
into the row when the rider hides the postcard, never updated afterwards — carries no signal,
because it is a constant of the rider's own action and cannot move when anybody blocks anybody.
It is the only design found that keeps a useful preview without reopening the channel.

It is not built, and would need its own decision: it stores a copy of one rider's content in a
row keyed to another, it goes stale against an edited caption, it is a schema change plus a
trigger plus a retention question, and the account-deletion reach argument has to be re-made for
the copy (the cascades do cover it — the postcard's deletion takes the hide row). Raised rather
than assumed; the owner has not asked for it.

---

## D5 — Key placement, and why only one of the two needs thinking about

**Hidden postcards → `['postcards', 'hidden']`.** `invalidate` matches structurally by prefix,
so the `invalidate(queryKeys.postcards.all())` that `hidePostcard` and `unhidePostcard` already
call reaches it. **Neither action changes at all.** This is exactly the reasoning `keys.ts`
records for `postcards.journal` — *"this key needs no call site of its own, and adding one would
be dead code"* — and following it means the hide half of this story adds zero lines to
`src/lib/actions/`.

Placing it under `profile` instead would have required a new `invalidate` in both actions, and
the one in `hidePostcard` is the easy one to forget: hiding a postcard **adds** a row to this
list, so a list keyed outside the `postcards` prefix goes stale the moment the feature is used.

**Blocked riders → `['profile', 'blockedRiders']`.** Free either way:
`blockRider`/`unblockRider` invalidate `EVERYTHING` (the empty prefix), which by construction
reaches every key. It sits under `profile` for the same reason `analyticsOptOut` does — the
sheet it renders in — and it inherits `updateProfile`'s `profile.all()` sweep, which costs one
re-read of a short list and cannot go stale.

Both keys are per-rider by virtue of holding only own-row data, satisfying
`client-cache-invalidation`'s standing rule that no cached value survives a sign-out —
`signOut` calls `clearQueryCache()`.

---

## D6 — Indexes

`postcard_hides_user_id_idx` is `(user_id, created_at DESC)` — `011` created it for this exact
screen and it serves both the filter and the keyset cursor with no work.

`blocks` has `blocks_pkey (blocker_id, blocked_id)` and `blocks_blocked_id_idx
(blocked_id, blocker_id)`. Neither orders by `created_at`, so `order by created_at desc` on a
rider's own blocks is a prefix scan plus a sort. That is free at real cardinality and the index
is added anyway, for symmetry with `011` and because the cost of adding it now is one line.
*(Inferred, not measured: no DEV rider has enough blocks for a plan to be informative — there is
exactly one `blocks` row on the whole project.)*

---

## D7 — What the RLS suite must assert, and the trap in asserting it

The suite runs **as the table owner**, for whom RLS does not apply — which is exactly why `029`'s
defect survived it. So an assertion that merely *calls* `my_blocked_riders()` proves nothing
about whether a rider can.

Assertions therefore come in two kinds and both are required:

- **Behavioural**, under an explicitly set `request.jwt.claims` and `set local role
  authenticated`, so the function's `auth.uid()` resolves to a test rider.
- **Privilege**, as `has_function_privilege('authenticated', …, 'execute')` and its negative for
  `anon` — the shape CLAUDE.md prescribes after `029`, because a privilege question cannot be
  answered by a call that the owner is allowed to make regardless.

Grant assertions are scoped to their grantee. A bare count over `information_schema` reads high
because `postgres` and `service_role` hold everything by Supabase default.
