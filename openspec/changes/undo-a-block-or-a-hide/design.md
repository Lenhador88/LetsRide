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
2. **`my_hidden_postcards()` returns `image_path` anyway, and the client does not sign it.**
   Different call, because unlike the avatar case the path is the thing Q1 is about: if the owner
   widens the Storage policy, the column is already there and only the client changes. Until
   then the list draws a neutral placeholder. *(If Q1 is answered "no", drop the column in the
   same change rather than leaving a field nothing reads.)*
3. **The `postcards` Storage policy is the only place a widening could go**, and it is a
   modification of an existing SELECT policy — so choosing it moves this migration out of the
   purely-additive class. Recorded here so the ordering question is asked rather than inherited.

---

## D4 — `restorable = false` is a side channel, and collapsing the reasons is the mitigation

A hidden postcard stops being restorable for three reasons: the hider left the club it was
posted to, the **author blocked the hider**, or the author deleted their account.

The middle one is the problem. `supabase/tests/rls_test.sql` asserts, in as many words, *"the
blocked rider is not told they were blocked"* — the invisibility of a block to its subject is a
property the suite defends. A hidden-postcards list that flips a row to *"the author blocked
you"* tells them, and it does so on a schedule the rider controls: hide one postcard from each
person you want to monitor, then read this list as a block detector.

**This channel does not exist today.** Without the feature, A hides B's postcard, B blocks A, and
A observes nothing — the postcard was already gone from every screen. The feature creates the
observation. That makes it a new leak rather than an existing one, which is the bar for taking
it seriously.

**Rejected mitigations, and why:**

- *Show the postcard anyway when only the block is refusing it.* Discloses an author's photo to
  someone they blocked. Far worse than the leak it fixes.
- *Drop unrestorable rows from the list.* The row disappearing is itself the same signal, and it
  strands a `postcard_hides` row the rider can no longer reach — D2's rule, one level down.

**Adopted:** one neutral, indistinguishable state. Identical copy for all three reasons, the
reason never returned by the accessor and therefore never available to the client to leak by
accident. `restorable` is a boolean and not an enum **on purpose**; an enum is how the reason
gets added later by someone who reads this as a missing feature.

The residual leak is that *something* changed, which is unavoidable while the row exists at all,
and is not attributable to any particular cause. That is the whole of the mitigation and it is
worth stating plainly rather than claiming the channel is closed.

The deleted-postcard case needs no state, because `postcard_hides.postcard_id` references
`postcards(id)` `ON DELETE CASCADE` (read from `pg_constraint`) — deleting the postcard removes
the hide row, so it leaves the list rather than becoming unrestorable. Verified, because the
brief asked for it to be.

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
