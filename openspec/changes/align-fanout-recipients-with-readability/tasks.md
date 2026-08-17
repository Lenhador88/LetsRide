# Tasks — a fan-out's recipient set SHALL be the set that can read the row

**Nothing here blocks on an open question.** Q1 in `proposal.md` is answered by task 1.1 rather
than trusted; Q2–Q6 are non-blocking and carry defaults.

**No `src/` file changes**, so `tsc`, ESLint, `next build` and `npm run test:unit` are unaffected
by this change and are not gates for it. `npm test` (the RLS suite) is, and `supabase/**` changing
is what makes it run in CI.

**The migration file is `060` and is written in the main thread.** These tasks describe the work,
not who does it. Re-derive the number with `ls supabase/migrations/` against `list_migrations`
before writing anything — this repo has had that number wrong in both directions.

## 1. Pre-flight — re-verify, do not trust the proposal

- [ ] 1.1 **Derive `rides` SELECT from the live database, not from `proposal.md`.** Read
      `qual` from `pg_policies` on **both** projects (`fpmrimzxadewsaiwpsel`,
      `zwprydcyryvudhurbnye`) and diff the two. `can_read_ride`'s body is that text with the
      candidate substituted for every `auth.uid()`; the proposal's copy is evidence, not the
      source (`candidate-relative-visibility` §*The restatement is derived at build time*).
      A difference between the two projects stops the build.
- [ ] 1.2 **Copy the four current bodies verbatim** for the rollback, with
      `pg_get_functiondef` on `private.is_club_member(uuid)`,
      `private.notify_ride_joined()`, `private.notify_ride_created_in_club()` and — for the
      comment text — `obj_description`. Paste them into `060`'s header as a **copy**, not a
      reconstruction. `design.md` §D6 says why the revert order matters: restore
      `is_club_member` first, drop the two new predicates last.
- [ ] 1.3 **Re-verify both defects are still live**, so the change is not repairing something
      already repaired: `rides` SELECT still has no `ride_members` / `is_ride_crew` arm; the
      `036/054:` assertion still passes; 055.6 and 055.6b still assert zero.
- [ ] 1.4 **Re-verify `059`'s early return is present in the live function** and copy its exact
      text, since `060` must reproduce it verbatim ahead of the union (N4).
- [ ] 1.5 **Confirm `is_club_member`'s current grants** with `has_function_privilege` for
      `authenticated`, so task 4.4 can assert they are unchanged rather than assert a number
      nobody measured.
- [ ] 1.6 **Confirm `pg_class.relforcerowsecurity` is false for `public.clubs` and
      `public.rides`.** The wrapper and `can_read_ride` both depend on it — see `proposal.md`
      §Impact. Record the trap in `060`'s header so it is discoverable from the object.

## 2. The migration (`060`)

- [ ] 2.1 `create function private.is_club_member_for(candidate uuid, target_club_id uuid)` —
      `054`'s two arms with `candidate` substituted. `stable`, `security definer`,
      `set search_path = ''`, every reference schema-qualified.
- [ ] 2.2 `create or replace function private.is_club_member(target_club_id uuid)` as the
      one-line wrapper. **Same signature, so the OID and the grants survive and no policy is
      recreated.** Stays `security definer` — §D2's last paragraph says why `invoker` breaks all
      ten callers.
- [ ] 2.3 `create function private.can_read_ride(candidate uuid, target_ride uuid)` from task
      1.1's text, calling `is_club_member_for(candidate, …)`, `is_blocked(candidate, …)` and
      `is_club_public(…)`.
- [ ] 2.4 `revoke all on function` both new predicates `from public, anon, authenticated`.
- [ ] 2.5 `create or replace function private.notify_ride_joined()` — the union unchanged, the
      outer `WHERE` gaining `private.can_read_ride(candidates.recipient, new.ride_id)`.
      **After the union, never inside an arm** (§D3). `on conflict do nothing` stays.
- [ ] 2.6 `create or replace function private.notify_ride_created_in_club()` — `059`'s
      `club_id is null` and `clubs.is_default` early returns reproduced **verbatim and first**,
      then the candidate union of `club_members` with `clubs.owner_id`, then one outer `WHERE`
      carrying the actor exclusion, the block test and `can_read_ride`.
- [ ] 2.7 **Re-issue `comment on function` for both fan-outs**, replacing the stale
      "`is_club_member` … has no owner arm" justification in the one on
      `notify_ride_created_in_club`. Add a comment on each new predicate saying it is a probe and
      why no client role may reach it.
- [ ] 2.8 **Header states the blast radius**: from the moment this applies, every RSVP and every
      ride creation runs new code inside the rider's own transaction, and a fan-out that raises
      takes that rider's write down with it.
- [ ] 2.9 **Confirm no trigger is recreated.** `create or replace` preserves the OID and the
      triggers reference the functions by OID. Re-issuing `create trigger` would be an error.
- [ ] 2.10 **Confirm no `when` clause is added anywhere** and that `auth.uid()` appears in the
      wrapper and nowhere else in the file — `036` traps (a) and (b), checkable by inspection.

## 3. Assertions — `supabase/tests/rls_test.sql`

Per `openspec/config.yaml`: a policy change with no new assertion is not finished. **Compare
label sets rather than counts** when reconciling the run against the previous one — a count cannot
tell a rename from a loss.

- [ ] 3.1 **Flip 055.6.** The crew member blocked with the organizer now gets **no row written**.
      Rewrite the label so it reads as a closed gap with a pointer at `can_read_ride`, not as a
      new assertion beside a dead one. Assert with the block pair exchanged as well (N1).
- [ ] 3.2 **Flip 055.6b.** The ex-club-member on a private club's ride crew now gets **no row
      written**, with no block anywhere in the fixture (N2).
- [ ] 3.3 **N10 — the ownerless owner receives `ride_created_in_club` AND reads it back under
      their own session.** The read-back is the assertion that matters; a row count does not
      cover a defect whose shape is a row that exists and is unreadable.
- [ ] 3.4 **N11/N12 — no regression.** The whole crew of a resolvable ride still receives; the
      organizer receives unconditionally, asserted across `is_public` true/false and `club_id`
      null/non-null, and with the organizer holding no crew row.
- [ ] 3.5 **N3 — the organizer RSVPing to their own ride still notifies nobody.** The existing
      `036` assertion is the tripwire for the after-the-union rule; confirm it survives.
- [ ] 3.6 **N4 — zero rows for a ride in the club carrying `clubs.is_default`, including for that
      club's owner.** The owner union is what makes this newly worth asserting.
- [ ] 3.7 **N5 — zero rows for `club_id is null`.**
- [ ] 3.8 **N6/N7 — a club member, and separately the club owner, blocked with the organizer
      receive nothing.** Two assertions, because a single one cannot say which arm was filtered.
- [ ] 3.9 **N8 — pin `ride_members_status_check` beside the crew arm** (the existing 055.7
      assertion); confirm it still reads exactly `{going, maybe}`.
- [ ] 3.10 **N13 — ordinary members and an `admin`-role member of a non-default club still
      receive.** Insert the `admin` row as the table owner and record why (no client can).
- [ ] 3.11 **N15/N16 — the read side is untouched.** Keep 055.7's "no crew arm" assertion green;
      add assertions that `ride_messages` SELECT/INSERT still carry **both** halves of `034`'s
      intersection and that `041`'s postcard `WITH CHECK` still carries both halves of its tag
      gate. These are the reason the cheap option was refused, and an unasserted reason decays
      into a preference.
- [ ] 3.12 **N17 — `has_function_privilege` is false for `authenticated`, `anon` and
      `service_role`** on `private.can_read_ride(uuid,uuid)` and
      `private.is_club_member_for(uuid,uuid)`. Name the role; do not attempt the call (`031`).
- [ ] 3.13 **N18 — `is_club_member` is unchanged for its callers.** Assert the same answer for a
      member, an ownerless owner and a non-member, and assert `authenticated` still holds
      `EXECUTE` on it (task 1.5's measurement).
- [ ] 3.14 **D5 — pin `rides` SELECT's full `qual` text**, with a label naming
      `private.can_read_ride`. Keep the two existing structural pins; this is the third, and the
      only one that catches a rewrite of the middle of the policy.
- [ ] 3.15 **Idempotence on the new sets.** Leave-and-rejoin, and create-delete-create, still
      produce one row per recipient — `notifications_event_key` with `nulls not distinct`.
- [ ] 3.16 Run `PGPASSWORD=postgres npm test`. Re-derive the assertion count with
      `grep -c "NOTICE:  ok"` and reconcile **label sets** against the previous run.

## 4. Apply and verify

- [ ] 4.1 **Hand-exercise both affected write paths on DEV first, in a rolled-back
      transaction** — an RSVP and a ride creation — before the file applies anywhere. A trigger
      that raises takes the rider's write with it.
- [ ] 4.2 Apply to DEV (`fpmrimzxadewsaiwpsel`). Confirm `list_migrations` against
      `ls supabase/migrations/`.
- [ ] 4.3 **Read the advisors** — `get_advisors(security)`. The
      `authenticated_security_definer_function_executable` set SHALL be unchanged at 7. A new WARN
      means a function landed in `public` or a `revoke` did not: treat it as a failed apply.
- [ ] 4.4 **Verify the objects, not the recorded text.** `pg_get_functiondef` for all four
      functions, `obj_description` for the three comments, `has_function_privilege` for the
      grants. A recorded statement differing from `md5sum` of the file is the norm for a large
      migration and is not drift.
- [ ] 4.5 **Measure the fan-out cost on DEV** for a club with a realistic membership, so
      `proposal.md` §Impact's per-candidate claim is a measurement rather than an assumption.
- [ ] 4.6 Apply to PROD (`zwprydcyryvudhurbnye`) once DEV is green, and re-run 4.3 and 4.4
      against it. `npm run db:drift` afterwards.

## 5. Close out

- [ ] 5.1 Update `docs/reference/schema.md` if it records either fan-out's recipient set.
- [ ] 5.2 **Check the coordination warning before archiving.** Run the `grep` and the `diff` in
      `specs/database-enforced-integrity/spec.md`'s header: `grant-club-owner-member-reach`
      modifies the same requirement, and whichever archives second discards the first one's edit
      unless this delta is still a superset of it.
- [ ] 5.3 `/opsx:archive` — not while the RLS suite is failing.
