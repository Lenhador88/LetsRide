## 0. Before anything — three answers and one measurement

- [x] 0.1 ~~**Q3 — blocking.**~~ **Measured 2026-08-06 against `zwprydcyryvudhurbnye`, RLS
  bypassed (service role, via the Supabase MCP `execute_sql`), so these are true counts and not
  per-viewer ones:**

  | Count | Value |
  |---|---|
  | Clubs with no `club_members` row for `owner_id` | **0** |
  | Clubs whose owner row exists but is not `role = 'owner'` | **0** |
  | Rides with no `ride_members` row for `organizer_id` | **0** |
  | Total clubs / total rides | **2 / 3** |
  | `club_members` rows with `role = 'admin'` | **0** |
  | Private clubs | **0** |

  **Read the zero correctly: it is a two-club, three-ride database.** Nothing here says the
  window is hard to hit — it says nobody has hit it yet on a dataset this small. It does mean
  **the backfill has nothing to fix today**, so `029` can be written as constraint-plus-trigger
  and the backfill kept as a guard for the apply-time re-run rather than as the main event.

  Still record the numbers in `029`'s header the way `013`, `019` and `022` do, and **re-run
  them at apply time** — a count that is 0 today is not 0 then. The three queries are in
  `proposal.md` §Impact.

  (The `admin`-rows zero independently confirms `019` Q10's premise, and the private-clubs zero
  confirms `docs/HANDOFF.md`'s "not reachable today (0 private clubs)" for the `createRide` `23514`
  message — both were assumptions elsewhere and are now measurements.)
- [ ] 0.2 **Q1 — product owner.** May a club owner leave their own club? Default: no. This decides
  whether `029` contains a delete guard, which is half the change.
- [ ] 0.3 **Q2 — product owner.** May a ride organizer leave their own crew? Default: no, with
  `maybe` as the way to express uncertainty.
- [ ] 0.4 Re-derive the migration number rather than trusting this file. It reads **029** at write
  time, on 2026-08-06, the day `028_refresh_stale_column_comments` took `028`.
  `ls supabase/migrations/` against `list_migrations`; this repo's docs have had that number wrong
  in both directions.
- [ ] 0.5 Measure three Postgres behaviours on a scratch database before writing SQL, in `021`
  §3's style — record the observations in the migration header, not the recollection:
  **(a)** an `AFTER INSERT` row trigger on `clubs` can see its own just-inserted row from a
  subquery; **(b)** inside a `security definer` trigger function `current_user` is the owner, so
  `023`'s `WHEN (current_user = 'authenticated')` gate does **not** fire for the row it writes;
  **(c)** when `clubs` is deleted, the RI cascade into `club_members` fires *after* the parent row
  is gone, so a `BEFORE DELETE` guard can distinguish "the owner is leaving" from "the club is
  being deleted".

## 1. Step 1 — make the second insert idempotent, and deploy it

This group is a no-op against the database as it stands and is what makes `029` safe to apply. It
must be **deployed to production**, not merely merged, before group 2 runs. `main` auto-deploys, so
merged and deployed are one step here — but confirm the Vercel deployment is `READY` at the commit,
the way `024`'s header records doing.

- [ ] 1.1 `createClub`: `supabase.from('club_members').insert(...)` becomes
  `.upsert({ club_id, user_id, role: 'owner' }, { onConflict: 'club_id,user_id', ignoreDuplicates: true })`.
  The shape `joinClub` already uses. **State the reason correctly:** `authenticated` **does**
  hold the table-level UPDATE grant on `club_members` — `019`'s own §Verification block says so
  explicitly ("Expected: **t** — and that is not a mistake") — and promotion is blocked by the
  *absence of an UPDATE policy*, which filters to zero rows rather than refusing. The
  `ignoreDuplicates` matters regardless, because an on-conflict-update would then silently
  affect nothing instead of erroring. The "no UPDATE grant" phrasing is inherited from a stale
  comment at `src/lib/actions/clubs.ts:253-254`; add it to group 5. **Keep the compensating
  delete** — it is still the only thing covering a genuine failure until `029` lands.
- [ ] 1.2 `createRide`: the same for `ride_members`, `onConflict: 'ride_id,user_id'`.
- [ ] 1.3 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build` green. No RLS
  suite run is needed — nothing under `supabase/**` changed, and CI will skip it for the same
  reason.
- [ ] 1.4 Confirm the deployment is live before starting group 2, and record the commit sha.

## 2. Step 2 — `029_creator_membership.sql`

Additive to the application: nothing it reads is removed and no SELECT policy changes. Every task
that touches SQL is paired with its assertion task, per `openspec/config.yaml`.

- [ ] 2.1 Header: the pre-flight counts from 0.1, the three measurements from 0.5, the sequencing
  argument from `design.md` §D6, and the explicit statement that applying this before group 1 is
  deployed is an instant outage of club and ride creation.
- [ ] 2.2 `public.establish_club_owner_membership()` — `security definer`, `set search_path = ''`,
  `revoke all … from public, anon, authenticated`. Inserts
  `(new.id, new.owner_id, 'owner', new.created_at)` into `club_members`. Takes no argument and
  reads nothing but `NEW`. `after insert on public.clubs for each row`. **No `WHEN` clause** — this
  is an invariant about what the table may contain, `022`'s shape rather than `023`'s, so it binds
  the seed and `service_role` too.
- [ ] 2.3 Assertions for 2.2: a rider creating a club holds an `owner` row immediately, with no
  second statement; the row's `joined_at` matches the club's `created_at`; the function is not
  executable by `authenticated` or `anon`; `prosecdef` is true and `proconfig` holds
  `search_path=""` (the literal quotes — matching on `search_path=` finds nothing and reads as a
  pass); a club inserted as the table owner also gets its row.
- [ ] 2.4 `public.establish_ride_organizer_membership()` — the same shape, inserting
  `(new.id, new.organizer_id, 'going', new.created_at)` into `ride_members`,
  `after insert on public.rides for each row`.
- [ ] 2.5 Assertions for 2.4: the organizer holds a `going` row immediately; the same
  executability and `prosecdef` / `proconfig` checks; and — the one that pins the read paths
  together — the crew roster and the ride card both contain the organizer for a freshly created
  ride.
- [ ] 2.6 **Backfill, before the guards in the same file.** Insert the missing `club_members` /
  `ride_members` rows for every existing orphan, `joined_at` from the parent's `created_at`; and
  **UPDATE** — not insert — any `club_members` row where `user_id = clubs.owner_id` and
  `role <> 'owner'`, which is the demoted-via-Explore case that no client action can repair,
  because `club_members` has no UPDATE policy.
- [ ] 2.7 Assertions for 2.6: after the chain applies, zero clubs lack an owner-membership row,
  zero owner rows carry a role other than `owner`, and zero rides lack an organizer crew row —
  **asserted with RLS bypassed**, per `design.md` §D7. An assertion written under the suite's
  ambient `authenticated` role is a defect: it passes on a database full of orphans owned by riders
  the runner is blocked from.
- [ ] 2.8 `public.protect_club_owner_membership()` — `before delete on public.club_members for each
  row when (current_user = 'authenticated')`, `023`'s shape rather than `022`'s, so
  `add-account-deletion`'s privileged transfer is still possible. Raises `check_violation` when
  `old.user_id` is the club's `owner_id`; returns `old` when the `clubs` row no longer exists, so
  deleting a club still cascades.
- [ ] 2.9 Assertions for 2.8, one per branch: the owner cannot delete their own row; a member can
  still leave; an admin cannot delete the owner's row; a non-member cannot delete anything; the
  owner deleting the whole club succeeds and takes the roster with it; a delete issued by a role
  other than `authenticated` succeeds. The SQLSTATE is asserted as `23514`, not "any error" — a
  test that accepts `42501` passes when the wrong rule fired.
- [ ] 2.10 `public.protect_ride_organizer_membership()` — the same on `ride_members` against
  `rides.organizer_id`.
- [ ] 2.11 Assertions for 2.10: the organizer cannot delete their own crew row; the organizer
  **can** update it to `maybe`, because the invariant is presence rather than status; an ordinary
  rider can still RSVP `No`; deleting the ride cascades.
- [ ] 2.11a **Assertions for the ride-side role matrix**, which group 2 otherwise leaves to the
  club-side scenarios and which is *not* symmetric with them — see the
  `database-enforced-integrity` delta's ride scenarios for the measured policy. One per role
  against the organizer's seeded crew row: organizer reads their own; club admin and club member
  read it on a private-club ride; a non-member reads it on a public ride and gets **zero rows**
  on a private-club ride; and a blocked rider gets zero rows **asserted twice** — once isolating
  `ride_members`' own `NOT private.is_blocked(auth.uid(), user_id)` arm, once isolating the
  `EXISTS` against `rides`. Two predicates currently hide the same row; one assertion cannot say
  which, so removing one later would leave the suite green.
- [ ] 2.11b **All four functions are `security definer`** — the two seeding *and* the two
  guarding. For the guards this is correctness, not convention: rule 3 ("allow when the parent
  is already gone") probes `select 1 from public.clubs where id = old.club_id`, and under
  invoker rights "invisible to me" and "does not exist" are the same empty result, so the guard
  would **fail open**. Assert the security context from `pg_proc.prosecdef`, and assert
  `has_function_privilege('authenticated', …, 'EXECUTE')` is false for all four.
- [ ] 2.12 Assertions for the participation gate, which 0.5(b) predicts stops firing on the seeded
  row: an un-onboarded rider cannot create a club or a ride at all, and holds no `club_members` or
  `ride_members` row afterwards. This is invisible in a positive test, which is `023` §2's own
  warning about the same class of trigger.
- [ ] 2.13 Assertions that nothing moved in the visibility layer: the policy counts for `clubs`,
  `club_members`, `rides` and `ride_members` are unchanged, every one is still `to authenticated`,
  `anon` still holds zero grants, and the `club_members` SELECT policy still carries its block
  predicate. `019`'s "3 policies, and NOT four" assertion on `club_members` still holds — this
  change adds no UPDATE policy.
- [ ] 2.14 Footer: the `§Verification` block, in `016`/`022`/`023`'s style — every expected number
  with the query that produces it, including `select count(*) from pg_trigger where tgname in (…)
  and not tgisinternal` = 4, and the orphan counts expected to be 0.
- [ ] 2.15 `PGPASSWORD=postgres npm test` green, and re-derive the assertion total rather than
  quoting it: `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`.
- [ ] 2.16 Apply to the hosted project, run the footer queries against it, and **check the security
  advisors**. Expect the count and identity to be **unchanged** — four new definer functions, all
  revoked from `authenticated`, so none should appear. A new
  `authenticated_security_definer_function_executable` finding means a `revoke` did not land, and
  `021`'s footer explains why the file and the database can silently disagree: `apply_migration`
  takes SQL as an argument, not a path.

## 3. Step 3 — the actions lose their second write

Deploy only after `029` is applied and verified. Nothing here is safe before it: removing the
second insert against a database without the trigger is the original defect, deliberately.

- [ ] 3.1 `createClub`: delete the `club_members` upsert and the compensating delete. Rewrite the
  doc comment — it currently describes the two-insert problem and names an RPC as the fix, which
  `design.md` §D1 rejects. Name the trigger and `029` instead.
- [ ] 3.2 `createRide`: the same. Its comment additionally says "leaves a club with an owner and no
  membership row" in the middle of the *ride* function — a copy-paste that survived review and
  should not be carried forward.
- [ ] 3.3 Delete the *"was only partly created. Check your clubs before trying again."* strings.
  They become unreachable, and unreachable copy reads as a live state to the next author.
- [ ] 3.4 `leaveClub`: an owner-specific message for the new `23514` (Q6, default *"You own this
  club, so you cannot leave it."*). Match on the message rather than the SQLSTATE alone, the way
  `createRide` matches `022`'s audience error, because `018`'s text bounds raise the same code.
  Delete the "no guard against the owner leaving" note — it stops being true.
- [ ] 3.5 `setRideAttendance`: the same for an organizer choosing `No`. The control is hidden from
  them today, so this is defence for the direct call rather than a screen change.
- [ ] 3.6 Confirm the invalidation sets are unchanged. One round trip makes exactly the same
  screens stale as two did; `client-cache-invalidation` is not modified by this change and the
  check is what makes that a claim rather than an assumption.
- [ ] 3.7 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build` green.
- [ ] 3.8 `npm run walk` against the real project — create a club and a ride with a disposable
  account and confirm both land complete. Read `scripts/supabase-relay.mjs`'s header first;
  Chromium in this container cannot reach Supabase directly and the walk is the only gate that
  renders anything.

## 4. Step 4 — `030_club_member_owner_arm.sql`

- [ ] 4.1 Replace `019`'s INSERT policy with one whose only role arm is `role = 'member'`,
  reproducing the rest of `019` verbatim, because a policy is replaced whole. Header: this applies
  **after** group 3 is deployed, and why the arm is dead rather than merely unused.
- [ ] 4.2 Assertions for 4.1: the club's own owner can no longer insert `role = 'owner'`; nobody can
  insert `admin`; joining a public club as `member` still works; creating a club still produces an
  `owner` row, because the trigger is not `authenticated` and is unaffected. **Update rather than
  delete `019`'s "creator's own owner row is still permitted" assertion** — deleting it loses the
  record that the rule ever existed, and its replacement is what documents the narrowing.
- [ ] 4.3 `PGPASSWORD=postgres npm test` green; apply; run the footer queries; check the advisors.

## 5. Documentation this change found wrong

Each of these is a claim that reads as verified and is not. Fix them in the same PR, per the
documentation-claims audit `reviewer` runs.

- [ ] 5.1 `docs/HANDOFF.md` §Known issues, first entry: the fix it names is a `security definer`
  function called by both actions. It is a trigger, for the reasons in `design.md` §D1. Rewrite
  rather than tick — and note that it describes the orphan as "a UI orphan rather than a hidden
  row", which is true only for a **public** club. A private orphan is reachable from no screen at
  all, by anyone, including its owner.
- [ ] 5.2 The same claim in `src/lib/actions/clubs.ts` and `src/lib/actions/rides.ts` (3.1, 3.2).
- [ ] 5.3 `getYourClubs`'s doc comment — *"A club owned without a membership row would appear on
  neither sub-page; that is a create-flow integrity question"* — is right and can now say the
  question is answered and where.
- [ ] 5.4 `docs/reference/schema.md`: the `club_members` and `ride_members` rows gain the invariant, and
  the `019` line ("only 'member' is self-assignable, and only the club's own owner_id may insert
  'owner'") becomes wrong the moment `030` applies.
- [ ] 5.5 `leaveClub`'s "Registered rather than fixed" note (3.4).

## 6. Review and merge

- [ ] 6.1 Run `reviewer` before the PR, on this change rather than on its own work — including the
  RLS and data-exposure audit. The four new definer functions and the `019` narrowing are what it
  is for.
- [ ] 6.2 One PR per step is wrong here; the branch carries all four steps and the **applies** are
  what sequence them. Say plainly in the PR body which migrations are applied and which are not, and
  do not claim `030` is applied in the PR that deploys the code it depends on — that fact only
  becomes true afterwards, which is exactly the follow-up-PR case `CLAUDE.md` describes.
- [ ] 6.3 Drive it to merged. Committed and pushed is not shipped.
