# Tasks — a fan-out's recipient set SHALL be the set that can read the row

**Status: implemented, applied to DEV, suite green at 1545 assertions (2026-08-17). Not yet on
PROD.** The open items are §4.5, §4.6 and §5.

**What the ticks below rest on, because this file is a claim like any other.** `060` and the suite
changes were written and applied **in the main thread**; this agent owns the proposal artifacts and
holds no database tool. Ticks in §1–§4.4 rest on that session's reported results — the DEV
readings quoted in `proposal.md` §Why, `list_migrations` at 59 before and 60 after, advisors at 9
with the definer-executable count at 7, and a green `npm test`. **They are not this agent's own
measurements**, and §4.6 re-takes every one of them against PROD rather than inheriting them.

**No `src/` file changes**, so `tsc`, ESLint, `next build` and `npm run test:unit` are unaffected
by this change and are not gates for it. `npm test` (the RLS suite) is, and `supabase/**` changing
is what makes it run in CI.

## 1. Pre-flight — re-verify, do not trust the proposal

- [x] 1.1 **Derive `rides` SELECT and `clubs` SELECT from the live database, not from
      `proposal.md`.** Read `qual` from `pg_policies` and diff across projects. `can_read_ride`
      and `can_read_club` are those texts with the candidate substituted for every `auth.uid()`;
      the proposal's copies are evidence, not the source
      (`candidate-relative-visibility` §*The restatement is derived at build time*). Both
      confirmed on DEV 2026-08-17: `rides` SELECT verbatim as `055` recorded it, `clubs` SELECT
      `(is_public OR (owner_id = auth.uid()) OR private.is_club_member(id))`.
- [x] 1.2 **Copy the current bodies verbatim** for the rollback, with `pg_get_functiondef` on
      `private.is_club_member(uuid)`, `private.notify_ride_joined()` and
      `private.notify_ride_created_in_club()`, and `obj_description` for the comments. Pasted into
      `060`'s header as a **copy**, not a reconstruction. `design.md` §D6 says why the revert order
      matters: restore `is_club_member` first, drop the three new predicates last.
- [x] 1.3 **Re-verify both defects were still live**, so the change was not repairing something
      already repaired: `rides` SELECT still had no `ride_members` / `is_ride_crew` arm; the
      `036/054:` assertion still passed; 055.6 and 055.6b still asserted zero.
- [x] 1.4 **Re-verify `059`'s early return is present in the live function** and copy its exact
      text, since `060` reproduces it verbatim ahead of the union (N4).
- [x] 1.5 **Confirm `is_club_member`'s current grants and caller set** — `has_function_privilege`
      for `authenticated`, and the count of calling policies, so task 3.13 asserts a measured
      number. Confirmed: **10** calling policies.
- [x] 1.6 **Confirm `pg_class.relforcerowsecurity` is false for `public.clubs` and
      `public.rides`.** The wrapper, `can_read_ride` and `can_read_club` all depend on it — see
      `proposal.md` §Impact. Recorded in `060`'s header so the trap is discoverable from the
      object.

## 2. The migration (`060`)

- [x] 2.1 `create function private.is_club_member_for(candidate uuid, target_club_id uuid)` —
      `054`'s two arms with `candidate` substituted. `stable`, `security definer`,
      `set search_path = ''`, every reference schema-qualified.
- [x] 2.2 `create or replace function private.is_club_member(target_club_id uuid)` as the
      one-line wrapper. **Same signature, so the OID and the grants survive and no policy is
      recreated.** Stays `security definer` — `design.md` §D2's last paragraph says why `invoker`
      breaks all ten callers.
- [x] 2.3 `create function private.can_read_ride(candidate uuid, target_ride uuid)` from task
      1.1's text, calling `is_club_member_for(candidate, …)`, `is_blocked(candidate, …)` and
      `is_club_public(…)`.
- [x] 2.4 `create function private.can_read_club(candidate uuid, target_club uuid)` from task
      1.1's `clubs` text — `c.is_public or c.owner_id = candidate or
      private.is_club_member_for(candidate, c.id)`. **Added after review (F2):** a
      `ride_created_in_club` row has two subjects and `036` §3 tests them independently, so
      filtering on `can_read_ride` alone is the *ride-implies-club* derivation that file forbids.
      See `design.md` §D7.
- [x] 2.5 `revoke all on function` all three candidate-relative predicates
      `from public, anon, authenticated`.
- [x] 2.6 `create or replace function private.notify_ride_joined()` — the union unchanged, the
      outer `WHERE` gaining `private.can_read_ride(candidates.recipient, new.ride_id)`.
      **After the union, never inside an arm** (`design.md` §D3). `on conflict do nothing` stays.
      **`can_read_club` is deliberately NOT called** — this type leaves `club_id` NULL.
- [x] 2.7 `create or replace function private.notify_ride_created_in_club()` — `059`'s
      `club_id is null` and `clubs.is_default` early returns reproduced **verbatim and first**,
      then the candidate union of `club_members` with `clubs.owner_id`, then one outer `WHERE`
      carrying the actor exclusion, the block test, `can_read_ride` **and** `can_read_club`.
- [x] 2.8 **Re-issue `comment on function` for both fan-outs**, replacing the stale
      "`is_club_member` … has no owner arm" justification in the one on
      `notify_ride_created_in_club`. Comment each new predicate as a probe, saying why no client
      role may reach it.
- [x] 2.9 **Header states the blast radius**: from the moment this applies, every RSVP and every
      ride creation runs new code inside the rider's own transaction, and a fan-out that raises
      takes that rider's write down with it.
- [x] 2.10 **Confirm no trigger is recreated.** `create or replace` preserves the OID and the
      triggers reference the functions by OID. Re-issuing `create trigger` would be an error.
- [x] 2.11 **Confirm no `when` clause is added anywhere** and that `auth.uid()` appears in the
      wrapper and nowhere else in the file — `036` traps (a) and (b), checkable by inspection.

## 3. Assertions — `supabase/tests/rls_test.sql`

Per `openspec/config.yaml`: a policy change with no new assertion is not finished. **Compare label
sets rather than counts** when reconciling against the previous run — a count cannot tell a rename
from a loss.

- [x] 3.1 **Flip 055.6.** The crew member blocked with the organizer now gets **no row written**.
      Label rewritten so it reads as a closed gap with a pointer at `can_read_ride`, not as a new
      assertion beside a dead one. Asserted with the block pair exchanged as well (N1).
- [x] 3.2 **Flip 055.6b.** The ex-club-member on a private club's ride crew now gets **no row
      written**, with no block anywhere in the fixture (N2).
- [x] 3.3 **N11 — the ownerless owner receives `ride_created_in_club` AND reads it back under
      their own session.** The read-back is the assertion that matters; a row count does not cover
      a defect whose shape is a row that exists and is unreadable.
- [x] 3.4 **N12/N13 — no regression.** The whole crew of a resolvable ride still receives; the
      organizer receives unconditionally, asserted across `is_public` true/false and `club_id`
      null/non-null, and with the organizer holding no crew row.
- [x] 3.5 **N3 — the organizer RSVPing to their own ride still notifies nobody.** The existing
      `036` assertion is the tripwire for the after-the-union rule; confirmed it survives.
- [x] 3.6 **N4 — zero rows for a ride in the club carrying `clubs.is_default`, including for that
      club's owner.** The owner union is what makes this newly worth asserting.
- [x] 3.7 **N5 — zero rows for `club_id is null`.**
- [x] 3.8 **N6/N7 — a club member, and separately the club owner, blocked with the organizer
      receive nothing.** Two assertions, because a single one cannot say which arm was filtered.
- [x] 3.9 **N8 — §060.4b exercises `can_read_club`'s three arms directly** (public, owner,
      member). **Added after review (F2).** A recipient count cannot exercise this conjunct at all
      — it excludes nobody today — and a conjunct nothing exercises is one a later edit deletes
      silently. Paired with an assertion that `notify_ride_joined` does **not** call it, so the
      asymmetry is pinned in both directions.
- [x] 3.10 **N9 — pin `ride_members_status_check` beside the crew arm** (the existing 055.7
      assertion); confirmed it still reads exactly `{going, maybe}`.
- [x] 3.11 **N14 — ordinary members and an `admin`-role member of a non-default club still
      receive.** The `admin` row is inserted as the table owner, with the reason recorded (no
      client can).
- [x] 3.12 **N16/N17 — the read side is untouched.** 055.7's "no crew arm" assertion stays green;
      added assertions that `ride_messages` SELECT/INSERT still carry **both** halves of `034`'s
      intersection and that `041`'s postcard `WITH CHECK` still carries both halves of its tag
      gate. These are the reason the cheap option was refused, and an unasserted reason decays
      into a preference.
- [x] 3.13 **N18 — `has_function_privilege` is false for `authenticated`, `anon` and
      `service_role`** on `private.can_read_ride(uuid,uuid)`, `private.can_read_club(uuid,uuid)`
      and `private.is_club_member_for(uuid,uuid)`. Name the role; do not attempt the call (`031`).
- [x] 3.14 **N19 — `is_club_member` is unchanged for its callers.** Same answer for a member, an
      ownerless owner and a non-member; `authenticated` still holds `EXECUTE`; and **its `prosrc`
      is pinned by equality, not by `like`** — **strengthened after review (F5)**, because an arm
      added to the *wrapper* leaves every policy `qual` byte-identical and still satisfies a
      `like '%is_club_member_for%'` match while making `can_read_ride` silently narrower than the
      policy. See `design.md` §D2.
- [x] 3.15 **§060.1 pins `rides` SELECT's full `qual` text**, labelled with
      `private.can_read_ride`; **§060.1b pins `clubs` SELECT's**, labelled with
      `private.can_read_club`. The two existing structural pins stay; these are the ones that
      catch a rewrite of the middle of either policy.
- [x] 3.16 **Idempotence on the new sets.** Leave-and-rejoin, and create-delete-create, still
      produce one row per recipient — `notifications_event_key` with `nulls not distinct`.
- [x] 3.17 Run `PGPASSWORD=postgres npm test`. **Green at 1545 assertions.** Re-derive with
      `grep -c "NOTICE:  ok"` and reconcile **label sets** against the previous run.

## 4. Apply and verify

- [x] 4.1 **Hand-exercise both affected write paths on DEV first, in a rolled-back
      transaction** — an RSVP and a ride creation — before the file applies anywhere. A trigger
      that raises takes the rider's write with it.
- [x] 4.2 Apply to DEV (`fpmrimzxadewsaiwpsel`). `list_migrations` read **59 before, 60 after**,
      against `ls supabase/migrations/`.
- [x] 4.3 **Read the advisors** — `get_advisors(security)`. **9 advisors, definer-executable count
      still 7**, so neither new predicate added one. A new WARN would have meant a function landed
      in `public` or a `revoke` did not, and would have been a failed apply.
- [x] 4.4 **Verify the objects, not the recorded text.** `pg_get_functiondef` for all five
      functions, `obj_description` for the comments, `has_function_privilege` for the grants. A
      recorded statement differing from `md5sum` of the file is the norm for a large migration and
      is not drift.
- [ ] 4.5 **Measure the fan-out cost on DEV** for a club with a realistic membership, so
      `proposal.md` §Impact's per-candidate claim is a measurement rather than an assumption —
      and it is now **two** predicates per candidate rather than one. *Open: not yet run; the
      claim in the proposal is still an expectation and is labelled as one.*
- [ ] 4.6 **Apply to PROD (`zwprydcyryvudhurbnye`)** and re-run 4.1, 4.3 and 4.4 against it rather
      than inheriting DEV's results. `npm run db:drift` afterwards. *Open: DEV only so far.*

## 5. Close out

- [ ] 5.1 Update `docs/reference/schema.md` if it records either fan-out's recipient set. *Open:
      not checked — outside this agent's remit, and a docs diff is its own review pass.*
- [ ] 5.2 **Check the coordination warning before archiving.** Run commands **A** and **B** in
      `specs/database-enforced-integrity/spec.md`'s header — both must print nothing.
      `grant-club-owner-member-reach` modifies the same requirement, and whichever archives second
      discards the first one's edit unless this delta is still a superset of it. *Open: run it at
      archive time, not now — the answer is a snapshot.*
- [ ] 5.3 `/opsx:archive` — not while the RLS suite is failing, and not before PROD. *Open.*
