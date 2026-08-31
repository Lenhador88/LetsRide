# Tasks — an-owner-leaves-their-club (PD-194, closing PD-103's club-side half)

**This change HAS a migration**, so `openspec/config.yaml`'s tasks rule binds: every task adding or
changing SQL is paired with a task adding assertions to `supabase/tests/rls_test.sql`. §0 is
pre-flight, §7 is the ordering, and §7 is the part that cannot be reordered for convenience.

> **`design.md` §Q1 is ANSWERED — 2026-08-31, the product owner: the roster row is DELETED.**
> "Leave" means out. §2.4 stands as written, §D2 needs no revision, and nothing in this file is
> blocked. Stepping down — hand the club over and stay as a member — is a separate affordance
> nobody has asked for.

> **`036`'s hand-exercise gate FIRES on this change.** §3 hangs a trigger on a live write path:
> every ordinary member leaving any club will run new code inside their own transaction from the
> moment `095` applies, and a raise there takes that rider's leave down with it. §7.3 and §7.6 are
> not optional and are not satisfied by the RLS suite.

## 0. Pre-flight — re-derive rather than trust, before writing SQL

- [ ] 0.1 **The migration number.** This file says **095** because `092`, `093` and `094` are held by
  three concurrent changes; the last file on disk is `091`. Re-derive both halves — a number is the
  claim this repo has had wrong in both directions:
  ```bash
  ls supabase/migrations/ | tail -5
  ```
  ```
  mcp__Supabase__list_migrations fpmrimzxadewsaiwpsel   # DEV
  mcp__Supabase__list_migrations zwprydcyryvudhurbnye   # PROD
  ```
- [ ] 0.2 **Which arm every club falls to, run with RLS bypassed** (`design.md` §D7 — under
  `authenticated` this undercounts by exactly the rows a block hides). Record the result in `095`'s
  header the way `013`, `019`, `022` and `043` do. Measured 2026-08-31: **DEV** 12 clubs, 0 with
  another admin, 9 where the owner is the only member; **PROD** 1 club, which is the welcome club.
  ```sql
  select c.id, c.name, c.is_default,
         (select count(*) from public.club_members m
           where m.club_id = c.id and m.user_id <> c.owner_id)                      as other_members,
         (select count(*) from public.club_members m
           where m.club_id = c.id and m.user_id <> c.owner_id and m.role='admin')   as other_admins
    from public.clubs c order by c.name;
  ```
- [ ] 0.3 **The ownerless-owner count, both projects.** `design.md` §D2 walks that state through all
  three arms and §Q7 declines to repair it here. Expect **0 / 0**; a non-zero means
  `enforce-creator-membership`'s backfill has become urgent and this change should say so rather than
  quietly work around it.
  ```sql
  select count(*) filter (where not c.is_public) as private, count(*) as total
    from public.clubs c
   where not exists (select 1 from public.club_members m
                      where m.club_id = c.id and m.user_id = c.owner_id);
  ```
- [ ] 0.4 **The trigger inventory on `club_members` and `clubs`, with events and WHEN clauses.** Two
  facts in `design.md` §D2 depend on it and both are easy to get wrong from memory: the participation
  gate is **INSERT only**, and `notify_club_joined` is **AFTER INSERT**, so neither fires on the
  transfer's UPDATEs. Also confirms there is still **no DELETE trigger** on `club_members`, so §3's is
  the first and there is no name-ordering interaction.
  ```sql
  select tgrelid::regclass::text, tgname, tgtype,
         pg_get_expr(tgqual, tgrelid) as when_clause
    from pg_trigger
   where tgrelid in ('public.clubs'::regclass,'public.club_members'::regclass)
     and not tgisinternal order by 1, 2;
  ```
- [ ] 0.5 **Measure three Postgres behaviours on a scratch database**, `021` §3's style, and record
  the observations in the migration header rather than the recollection:
  **(a)** `LockRows` sits below `Limit`, so `select … order by … limit 1 for update of m, p` skips a
  candidate that stops matching under a concurrently-committed change rather than misreading it as
  "no successor" — `032` §3 measured this for `for update of p` alone and this adds a second lock
  target; **(b)** inside a `security definer` function `current_user` is the function's owner, so a
  trigger carrying `when (current_user = 'authenticated')` does **not** fire for statements that
  function issues; **(c)** when a `clubs` row is deleted, the RI cascade into `club_members` fires
  *after* the parent row is gone, so a `BEFORE DELETE` guard can tell "the owner is leaving" from "the
  club is being deleted".
- [ ] 0.6 **The advisor baseline, both projects.** Expect **24**. §7.4 asserts 25 afterwards, and an
  after-count means nothing without this.
  ```sql
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute');
  ```
- [ ] 0.7 **Read `032`'s successor `select` and `088`'s three RPCs before writing §2.** `design.md`
  §D3 declines `enforce-creator-membership` §Q1's instruction to extract a shared selector, and that
  refusal only holds if the two bodies are actually diffable. Read `pg_get_functiondef` for
  `private.transfer_owned_clubs` on the live project, not the migration file — `032` replaced `029`'s
  body and a third file could have replaced it again.
- [x] 0.8 **`design.md` §Q1 is answered — DELETED.** Product owner, 2026-08-31. Nothing here is
  blocked; build §2.4 as written.

## 1. `095` — the header

- [ ] 1.1 The pre-flight counts from 0.2 and 0.3, re-run at apply time and dated.
- [ ] 1.2 The three measurements from 0.5, as observations.
- [ ] 1.3 The three arms, as a table, with the product owner's own sentence quoted.
- [ ] 1.4 **Why this is an RPC and not a policy**, naming all four barriers in order — `045`'s absent
  `owner_id` column grant (the one a policy-level fix misses, and it fails `42501` before any policy
  runs), `clubs` UPDATE's `with check`, `club_members`' absent UPDATE policy, and PostgREST having no
  transaction.
- [ ] 1.5 **`016`'s two path CHECKs fire on the happy path.** State that any `update clubs set
  owner_id` raises `23514` while either image path is non-null, and that §2.4 clears both in the same
  statement.
- [ ] 1.6 The `036` hand-exercise warning: this file hangs a trigger on a live write path, and which
  paths (`leaveClub` for every rider, `delete_owned_club`'s cascade).
- [ ] 1.7 The ordering: **additive against the shipped bundle**, applies **before** the deploy that
  serves the new row, nothing destructive, no post-deploy step. Say why it is safe before the deploy —
  `ClubOptionsMenu` renders `Leave club` only for a non-owner today, so the guard refuses nothing the
  deployed app does, and an older bundle never calls the new function.

## 2. `095` — the transfer

- [ ] 2.1 `private.pick_club_admin_successor(target_club uuid, departing uuid) returns uuid` —
  `security definer`, `set search_path = ''`, `revoke all … from public, anon, authenticated`. In
  `private`, so it adds **no** advisor and `005`'s absent USAGE makes that structural rather than
  dependent on the revoke surviving `apply_migration`'s string round trip.
  Body: `club_members` joined to `profiles`, `role = 'admin'`, `user_id <> departing`, ordered
  `case role when 'admin' then 0 when 'member' then 1 else 2 end, joined_at, user_id`, `limit 1`,
  `for update of m, p`. **Write the full CASE even though the filter makes it redundant** — it is what
  keeps this body diffable against `032`'s, which is the whole of §D3's answer to "extract, never
  copy". Comment both locks: `p` is `032`'s (a candidate mid-account-deletion is skipped rather than
  misread as absent), `m` is new and is what `088`'s three RPCs race over.
- [ ] 2.2 `comment on function` for 2.1, stating that it is **admin-only on purpose** and that
  `private.transfer_owned_clubs` deliberately falls back to a member because an account deletion has
  nobody to ask and its alternative is destroying the club.
- [ ] 2.3 `public.leave_owned_club(p_club_id uuid) returns table (object_path text)` — `security
  definer`, `set search_path = ''`, `#variable_conflict error`, every column reference
  alias-qualified. `revoke all … from public, anon`, `grant execute … to authenticated`. Parameter
  named `p_club_id` to match `delete_owned_club`, whose sibling constraints this function inherits;
  `043`'s reason (`club_id` is a column on five tables) is unchanged.
- [ ] 2.4 The body, in this order, and the order is load-bearing:
  1. `auth.uid()` null → `insufficient_privilege`.
  2. One `select … from public.clubs where id = p_club_id and owner_id = v_uid for update` reading
     `owner_id`, `is_default`, `avatar_path`, `cover_image_path`. `if not found` → **one** raise site,
     `insufficient_privilege`, message byte-identical to `delete_owned_club`'s so "no such club" and
     "not your club" cannot drift apart.
  3. `is_default` → `insufficient_privilege` with a specific message (§D5; `059` already settled that
     naming this discloses nothing, the column being readable).
  4. successor from 2.1; null → **one** raise site, `check_violation` (`23514`), one message covering
     arms 2 **and** 3: *"this club has no other admin to take it on; promote another rider to admin,
     or delete the club"*. **Do not split this into two clearer messages** — §D7's one-bit leak.
  5. `return next` each non-null image path, before the update that clears it.
  6. `update public.clubs set owner_id = successor, avatar_path = null, cover_image_path = null where
     id = p_club_id` — one statement, because `016`'s CHECKs are evaluated at statement end.
  7. `update public.club_members set role = 'owner' where club_id = p_club_id and user_id = successor`.
  8. `delete from public.club_members where club_id = p_club_id and user_id = v_uid` — **delete, not
     demote**, per §Q1's default and §D2. Deleting zero rows is correct for `054`'s ownerless owner and
     SHALL NOT raise.
- [ ] 2.5 `comment on function public.leave_owned_club(uuid)` — takes a club and **no rider id**, so
  a successor cannot be proposed; the ownership re-check in the body is the entire access control
  because RLS does not apply inside it; the leaver's row is deleted rather than demoted and why that
  differs from `032`; the `is_default` refusal and its `059` precedent; three post-session raise
  sites and the argument for each.
- [ ] 2.6 **Assertions for 2.1–2.5** in `supabase/tests/rls_test.sql`. Each is a statement about a
  **role** and a **resource**, and each is verified **both ways** per `CLAUDE.md` §Working Principles
  — confirm it fails against the mistake it names:
  - The owner of a club with one other admin leaves; afterwards `clubs.owner_id` is that admin, their
    roster row reads `owner`, the leaver holds no row, and all three are true in one call.
  - The successor's `joined_at` is unchanged, so a transfer does not rewrite roster tenure.
  - Two admins with different `joined_at` → the earlier one wins. Two with the **same** `joined_at` →
    the lower `user_id` wins, and the same rider wins on a re-run.
  - A roster holding a stray `role = 'owner'` row for a rider who is not `clubs.owner_id` → that rider
    is **not** selected.
  - An admin, a member, a non-member and a signed-out caller each get `insufficient_privilege`, with
    the **same message** as a nonexistent club id.
  - The club's `avatar_path` and `cover_image_path` are NULL afterwards and both were **returned**.
    (Fails if the update is split in two — assert that a version setting only `owner_id` raises
    `23514`, which is the happy-path trap.)
  - A club with a non-null avatar transfers **without** raising, which is the assertion that proves
    the clearing is in the same statement.
- [ ] 2.7 **Assertions for the two refusals**, SQLSTATE-exact:
  - Only members remain → `23514`, nothing transferred, nothing deleted, roster unchanged.
  - **No other rider at all** → `23514` with the **same message string**, asserted by equality. This
    is §D7's leak defence and it is the assertion that fails the moment somebody "improves" the copy.
  - The `is_default` club → `insufficient_privilege`, both with and without another admin present.
- [ ] 2.8 **Assertion: `054`'s ownerless owner can still leave.** A club whose `owner_id` holds no
  roster row, with another admin present → the transfer succeeds and deletes zero roster rows.

## 3. `095` — the guard

- [ ] 3.1 `private.protect_club_owner_membership()` — `security definer`, `set search_path = ''`,
  `revoke all … from public, anon, authenticated`, and **in `private`** rather than
  `enforce-creator-membership`'s drafted `public` + revoke (§D4). Raises `check_violation` when
  `old.user_id` equals the club's `owner_id`; returns `old` when no `clubs` row with `old.club_id`
  exists.
- [ ] 3.2 `create trigger protect_club_owner_membership before delete on public.club_members for each
  row when (current_user = 'authenticated') execute function
  private.protect_club_owner_membership()`. **The `WHEN` clause is not decoration** — `023`'s shape,
  not `022`'s. It is what lets §2's definer transfer and the account-deletion cascade through, and
  copying `022`'s no-escape shape would make this change unimplementable without `disable trigger`.
- [ ] 3.3 Comment the three rules, and comment rule 3 as a **correctness** requirement for
  `security definer` rather than a convention: under invoker rights the parent probe cannot tell
  "invisible to me" from "does not exist", and its answer to the second is to permit the delete — a
  guard that fails open.
- [ ] 3.4 The guard keys on `clubs.owner_id`, **never** on `club_members.role`. Comment why, citing
  `054` and PD-128: the two are permitted to disagree, and a role-keyed guard would both let an
  ownerless owner delete a row the invariant needs and refuse a delete on a stale `owner` row.
- [ ] 3.5 **Assertions for 3.1–3.4**, one per branch, each verified both ways:
  - The owner cannot delete their own roster row → `23514`, not `42501`. A test accepting "any error"
    passes when the wrong rule fires.
  - A `member` can still leave; an `admin` can still leave. Both for a public club and a private one.
  - An admin cannot delete the **owner's** row (already refused by the DELETE policy; assert it stays
    refused and that the guard is not what is doing it, so the policy's removal would be caught).
  - A non-member can delete nothing.
  - The owner deleting the whole club through `delete_owned_club` **succeeds** and takes the roster
    with it — the parent-is-gone branch, and the one that breaks a naive guard.
  - A delete issued by a role other than `authenticated` succeeds, so the account-deletion cascade
    and any maintenance path still work.
  - `leave_owned_club` passes through the guard — asserted by the transfer succeeding, and asserted
    **again** by confirming `prosecdef` is true, since an invoker-rights version would be refused by
    its own guard and the failure would look like a policy problem.
  - A club whose owner holds no roster row: nothing is refused.
- [ ] 3.6 **Assertion: the guard's parent probe is not visibility-dependent.** With RLS in force for
  the caller, delete a `club_members` row for a club the caller cannot see through `009`'s predicate
  and confirm the guard's behaviour is unchanged. Verify both ways: an invoker-rights version of the
  function must fail this.

## 4. `095` — the footer

- [ ] 4.1 A `§Verification` block in `016`/`022`/`023`/`043`'s style — every expected number with the
  query that produces it, to be run against each project after applying:
  - `prosecdef` and `proconfig` for all three new functions. Expect `t` and `{search_path=""}` **with
    the literal quotes**, which is how Postgres stores it; matching on `search_path=` finds nothing
    and reads as a pass.
  - `prosrc like '%#variable_conflict error%'` for `leave_owned_club`. Expect `t`.
  - `has_function_privilege` per role: `leave_owned_club` → `authenticated` **t**, `anon` **f**; the
    two `private` functions → **f** for both, and for `service_role` too. As a **role**, never by
    calling it as the table owner — `031` exists because `029` shipped a function nothing could call
    and nothing noticed.
  - PUBLIC's default `=X/` grant is gone from `leave_owned_club`.
  - `select string_agg(cmd, ',' order by cmd) from pg_policies where tablename = 'club_members'` →
    `DELETE,INSERT,SELECT`. Read as the sorted **command list**, not as a count — `015`'s trap: a
    count of 3 also passes for a set that swapped DELETE for UPDATE.
  - `clubs` policy count unchanged at 4.
  - `select count(*) from pg_trigger where tgname = 'protect_club_owner_membership' and not
    tgisinternal` → 1, and the gate count unchanged at **17**.
  - The advisor count: **25**, up from 24, the one new finding being
    `authenticated_security_definer_function_executable` on `public.leave_owned_club`.
- [ ] 4.2 A rollback note: `drop trigger`, `drop function` ×3. Nothing else moved, so the rollback is
  complete rather than approximate.

## 5. RLS assertions — the cross-cutting ones

Paired with §§2–4 per `openspec/config.yaml`. These are the ones that are not about a single object.

- [ ] 5.1 **Every assertion about the invariant runs with RLS bypassed or as the club's owner** —
  `reset role` / `set role postgres` around the check, never the suite's ambient `set role
  authenticated` (§D7). An assertion written under `authenticated` passes on a database full of
  orphans owned by riders the runner is blocked from, and that is a defect rather than a style note.
- [ ] 5.2 **A blocked admin still inherits**, asserted in **both** block directions — owner blocks
  admin, and admin blocks owner. Two cases, not one; blocking is symmetric but the row is directional
  and only one of the two is the obvious fixture.
- [ ] 5.3 **A block cannot trap an owner.** The club's only other admin blocks the owner; the owner's
  leave still succeeds. This is §D9's adversarial case and the reason blocking does not filter the
  candidate set.
- [ ] 5.4 **The departing owner's reach afterwards**, per role-matrix scenario: for a **private** club
  they read zero of the club, its roster, its rides, its postcards, its threads and its messages —
  **including postcards and threads they wrote themselves**; for a **public** one they read it as a
  non-member does.
- [ ] 5.5 **The departing owner's content survives**: their postcards keep `club_id`, their rides keep
  `club_id`, their `ride_members` rows are untouched, and their `feed_reads` watermark **survives** —
  `feed_reads` cascades from `clubs` and `profiles` and never from `club_members`, and there is no
  DELETE trigger on `club_members` doing it either.
- [ ] 5.6 **The successor's reach afterwards**: `delete_owned_club` accepts them, `088`'s three RPCs
  accept them including against another **admin**, `081`'s `moderate_club_thread` accepts them, and
  `085`'s approval accepts them. Assert `private.is_club_admin_for(successor, club)` is true by both
  of its arms.
- [ ] 5.7 **The remaining roster is unchanged**: a non-chosen admin keeps `admin`, a member keeps
  `member`, and neither can remove or demote the new owner.
- [ ] 5.8 **Nothing moved in the visibility layer**: policy counts and commands for `clubs` and
  `club_members` unchanged, every policy still `to authenticated`, `anon` still holds zero grants, and
  `club_members` SELECT still carries its block predicate.
- [ ] 5.9 **`anon` holds no EXECUTE on `leave_owned_club`**, and a call without a session raises.
  Decision #1 asserted as a negative, not implied.
- [ ] 5.10 **No notification row is written by a transfer.** Count `notifications` before and after.
  This is §Q3's deferral, asserted so that adding one later is a deliberate change with a red test
  rather than a silent one.
- [ ] 5.11 **The participation gate does not fire on the transfer**, asserted from the trigger's
  events and WHEN clause rather than from the transfer succeeding — a positive test cannot see this
  (`023` §2's own warning). And a rider with a NULL `terms_accepted_at` still cannot own a club at all.
- [ ] 5.12 **Concurrency, two orders.** (a) The owner's transfer and `demote_club_admin` against the
  only admin: whichever commits first, the other is refused or finds no successor, and no club ends up
  owned by a rider whose roster row says `member`. (b) The owner's transfer and that admin's own
  `leaveClub`: if the transfer wins, the admin's delete meets the new guard and is refused with
  `23514`, because they are now the owner.
- [ ] 5.13 **Arm 2 through the real path.** A club whose owner is its only member: `leave_owned_club`
  raises, and `delete_owned_club` then succeeds and takes the roster, the postcards, the threads and
  the private rides. Assert a **public** ride in that club survives with `club_id` NULL, keeping its
  crew — `032` §2's rule, which arm 2 inherits and must not silently lose.
- [ ] 5.14 **The two succession rules agree where their candidate sets coincide.** A roster whose
  non-owner members are all admins: `private.pick_club_admin_successor` and
  `private.transfer_owned_clubs` name the same rider. This is §D3's testable substitute for the shared
  function `enforce-creator-membership` §Q1 asked for, and it is what would catch the tie-break
  drifting apart.
- [ ] 5.15 **Arm 2 destroys other riders' postcards even with an empty roster.** Fixture: a rider
  joins a public club, posts, leaves; the owner then deletes it. Assert the postcard is gone. `020`'s
  seed already carries this shape (`...00e5`, *"Posted before I left"*). This is what §D11 and the
  confirmation copy rest on.
- [ ] 5.16 Re-run the whole suite and **compare label sets, not counts** — a count cannot tell a
  rename from a loss, which is what `038` did to one of `036`'s assertions.

## 6. Client

- [ ] 6.1 `src/lib/actions/clubs.ts` — `leaveOwnedClub(clubId)`, a plain async function calling
  `supabase.rpc('leave_owned_club', { p_club_id: clubId })`. Sweep the returned `object_path` rows
  from `MEDIA_BUCKET`, the shape `deleteClub` already uses.
- [ ] 6.2 **The two refusals get two messages and the transport failure gets a third.** Match on the
  message rather than the SQLSTATE alone — `018`'s text bounds raise `23514` too, which is why
  `createRide` already matches this way. `insufficient_privilege` carrying the default-club message →
  *"This club cannot be left."*; `23514` → the arm-3 string; anything else → one generic failure. A
  network error reported as "this club has no other admin" is the defect this task exists to prevent.
- [ ] 6.3 `invalidateClubMembership(clubId)` on success, unchanged and **not** extended. Confirm
  rather than assume: it already invalidates `clubs.all()`, the club's postcard feed, the club's ride
  list and `notifications.all()`, the last for exactly the reason a departure needs (`036` §3's SELECT
  conjunct resolves per-reader, so rows leave a list with nothing written or deleted). This is what
  makes "`client-cache-invalidation` is not modified" a checked claim.
- [ ] 6.4 `ClubOptionsMenu` — a `Leave club` row in the **owner** branch, warning tone, beside
  `Delete club` in the same destructive group. The non-owner branch is untouched.
- [ ] 6.5 The owner's row routes by the roster the screen already holds: **no other members → open
  `DeleteClubSheet`** with the arm-2 reason; **otherwise → call `leaveOwnedClub`**. On a `23514`
  refusal, **open `DeleteClubSheet` with the arm-2 reason rather than only bannering** — that is the
  self-correcting path §D1 and the "stale roster count" scenario require, and it is the one behaviour
  a reviewer should check by hand.
- [ ] 6.6 `DeleteClubControl` / `DeleteClubSheet` take an optional `reason` rendered **above** the
  existing impact counts, never instead of them. Arm 2's default string is the product owner's own:
  *"You are the only rider here — leaving deletes this club."*
- [ ] 6.7 **The confirmation names no rider** (§D9). Copy states the rule.
- [ ] 6.8 The control is disabled offline with the line the delete control already carries, and
  nothing is queued.
- [ ] 6.9 `router.replace('/clubs')` after either outcome, matching `onLeave`'s existing comment —
  for a private club the invalidated refetch answers null and the page's `notFound()` would fire over
  a success banner.
- [ ] 6.10 **Do not gate the row on `isLoading`.** Gate on the data; if the roster has not arrived,
  offer the leave and let the database answer, per the Loading scenario. Offering the destructive arm
  on absent data is the failure to avoid.
- [ ] 6.11 Icons from `@/components/icons/generated` — `LogOutIcon`, already imported. Primary buttons
  stay near-black `Grey/100`; the destructive rows keep `variant="warning"` / `danger`.

## 7. Ordering — the part that cannot be reordered

Additive first, deploy, destructive last. **Nothing in `095` is destructive**, so the third step is
absent by construction rather than skipped — say so in the PR body, because an ordering section with
a missing step reads as an omission.

- [ ] 7.1 Merge to `development`. Vercel builds the Preview against `letsride-dev`.
- [ ] 7.2 **Apply `095` to DEV BEFORE confirming the new bundle serves.** It is additive against the
  shipped bundle — `069`'s footing, not `089`'s: the guard refuses nothing the deployed app does
  (`Leave club` is drawn only for a non-owner today) and an older bundle never calls the new function.
  The reverse order would leave a deployed *Leave club* row calling a function that does not exist,
  which is `082`'s `PGRST202` with nothing red.
- [ ] 7.3 **Hand-exercise on DEV, in a rolled-back transaction, as `authenticated`** — `036`'s gate,
  and it fires here because §3 hangs a trigger on a live write path. Do **not** skip it because the
  RLS suite is green; the suite runs as the table owner, for whom the `WHEN` clause is false.
  Exercise, counting rows rather than assuming: an ordinary member leaving a club still works; an
  admin leaving still works; an owner is refused with `23514`; `delete_owned_club` still cascades the
  roster; and `leave_owned_club` transfers a fixture club end to end.
- [ ] 7.4 `get_advisors(security)` on DEV. Expect **25**, up from 0.6's 24, the single new finding
  being on `public.leave_owned_club`. A second new one means a `revoke` did not land or a function
  went into the wrong schema — `021`'s footer for why the file and the database can silently disagree.
- [ ] 7.5 Confirm DEV is serving the merge sha — a `READY` deployment, `aliasError` null — then walk
  the club menu by hand for an owner, an admin, a member and a non-member.
- [ ] 7.6 Promote to `main`, apply `095` to PROD in the same order as 7.2, then repeat 7.3 and 7.4
  there. **On PROD the only club today is the welcome club**, so 7.3's owner case is the `is_default`
  refusal rather than the transfer; make the fixture explicitly, in a rolled-back transaction, rather
  than concluding the transfer is untestable in production.
- [ ] 7.7 Record the applied state with the command that checks it — `list_migrations` against both
  refs, against `ls supabase/migrations/` — never a number typed by hand.

## 8. Documentation

- [ ] 8.1 `docs/reference/schema.md` — the `clubs` and `club_members` rows gain the leave rule, the
  guard, the three arms, the `is_default` refusal, and the fact that the guard keys on `owner_id`
  rather than `role`. The `clubs` row already carries `059`'s known gap about inherited rename and
  imagery rights; amend it, because a voluntary leave now cannot reach it.
- [ ] 8.2 **`leaveClub`'s docstring in `src/lib/actions/clubs.ts` carries a claim that is false.** It
  says *"the row goes, and `015`'s FK cascade takes the watermark with it — so rejoining later reads
  as 'everything since you rejoined'"*. `feed_reads` has exactly two foreign keys, to `clubs` and to
  `profiles`; `club_members` has no child tables and no DELETE trigger. Correct it in the same file
  this change edits, and delete the *"No guard against the owner leaving their own club"* paragraph
  below it, which stops being true.
- [ ] 8.3 `docs/reference/product-scope.md` — the Clubs row, for what leaving now covers and what it
  deliberately does not (no successor notification, no hand-picked successor, no step-down).
- [ ] 8.4 Do **not** edit `CLAUDE.md` or `docs/HANDOFF.md` from an agent; the main thread owns both.
  The advisor count moves 24 → 25 and the migration count moves, and both are that thread's to write.
- [ ] 8.5 `npm run docs:check`, and `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — this
  change adds `§`-pointers into `enforce-creator-membership` and that check is what catches a moved
  section.

## 9. `enforce-creator-membership` — the amendment this change owes it

`design.md` §D8 is the argument; these are the edits. **Amend, do not rewrite** — its reasoning is
why the guard in §3 is shaped the way it is.

- [ ] 9.1 Move the club-side delete guard out: `tasks.md` 2.8 and 2.9 become pointers to this change,
  its `proposal.md` §Impact drops from **four** new trigger functions to **three**, and `design.md`
  §D3 keeps its whole argument while recording that the club half ships in `095`.
- [ ] 9.2 Its `design.md` §Open Questions **Q1 is now answered further**: not "no, not for now" but
  "yes, under three arms". Record the answer, the date, and that this change **declines** Q1's
  instruction to extract a shared `private.pick_club_successor` — with §D3's reason, since that
  instruction was written before `088` made admins writable and before the two candidate sets were
  decided to differ.
- [ ] 9.3 **Its coordination banner is stale and understates the collision.** It names
  `add-account-deletion` as the other change modifying `Club membership role SHALL NOT be
  self-assignable`; `manage-club-riders` modifies it too, so **three** unarchived deltas now replace
  that requirement wholesale. Extend the banner to name all three, and record that this change is
  deliberately **not** a fourth.
- [ ] 9.4 Its `database-enforced-integrity` delta's scenario *"The owner cannot leave their own
  club"* now has two exceptions. Amend it in place to name them — the transfer and the club's
  deletion — pointing at this change rather than restating the arms, so the two files cannot drift.
- [ ] 9.5 **Do not touch anything else under `openspec/changes/`.** Three other changes hold `092`,
  `093` and `094` and are being written concurrently.

## 10. Review and merge

- [ ] 10.1 Run `reviewer` on this **proposal** before any SQL is written — the first of its two
  passes, and the one that reads the only artifact in this pipeline with no automated gate. The
  ADDED-not-MODIFIED decision (§D8), the one-message refusal (§D7) and the `is_default` refusal (§D5)
  are what it is for.
- [ ] 10.2 Run `reviewer` again on the final diff, immediately before the PR.
- [ ] 10.3 The PR body says which migration is applied to which project and **that PROD's only club is
  the welcome club**, so the change ships as a refusal there until a second club exists. A reviewer
  reading "shipped" without that line will look for a feature nobody can reach.
- [ ] 10.4 Drive it to merged. Committed and pushed is not shipped.
