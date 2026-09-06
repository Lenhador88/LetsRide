<!-- Moved out of docs/HANDOFF.md, which every session is told to read at startup.
     HANDOFF keeps the heading as a signpost and the live parity claim; this
     file is what outlives the apply. -->

# Migrations — the recording artefacts, and what reads as drift

`041`–`048` reached PROD on 2026-08-10 and that apply is finished — `docs/HANDOFF.md` §Migrations
carries the parity claim beside the command that checks it. What is here is what a completed apply
does *not* consume: the ordering chain, the rollback SQL, and the hand reconciliation for every
recorded statement that disagrees with its file.

## The ordering chain — `041 → 044 → 046`

**The order they were applied in still matters, because a *partial* apply can pick a failing one.**
`041 → 044 → 046` is required. `041 → 044` fails **loudly** (`044` grants `insert (… ride_id)`,
which `041` adds). **`044 → 046` fails SILENTLY**: both issue an absolute `revoke update` +
`grant update (…)` list rather than a delta, and `044`'s list still names `id` and `author_id`, so
running `046` first has it reinstated with no error and nothing red. Filename order satisfies both,
so a full in-order apply is always correct.

**`046`'s own header points at a table that no longer exists.** It says *"see docs/HANDOFF.md
§Migrations, which carries the same table"* — that was `THE APPLY ORDER` block, deleted once the
apply completed. Migration files are append-only, so it cannot be corrected in place. The chain
above is what it meant, and the reader it misdirects is exactly the one doing a partial
promotion.

**The absolute-list trap is not confined to that chain — it governs SIX tables.** `044`, `045`,
`046` and `048` all issue ABSOLUTE `revoke` + `grant (…)` lists rather than deltas, so **any**
later migration re-granting one of these must restate the whole column list or it silently
reinstates what its predecessor removed, with no error and nothing red:

| Migration | Tables it left on absolute lists |
|---|---|
| `044`, `046` | `postcards` |
| `045` | `rides`, `clubs` |
| `048` | `postcard_comments`, `club_members`, `ride_members` |

Re-derive rather than trusting the table — a seventh arrives the day anyone writes another
per-column grant:

```sql
select c.relname, count(*) filter (where a.attacl is not null) as columns_with_acl
from pg_class c join pg_attribute a on a.attrelid = c.oid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0
group by 1 having count(*) filter (where a.attacl is not null) > 0 order by 1;
```

**`045`'s two are the ones most likely to be missed.** Its own file header carries no such
warning, and the paragraph that used to record its shape was an apply note that PD-187 deleted
as spent — correctly, except that this clause was the only durable thing in it.

**`054` has NO ordering relationship, and that is recorded rather than left open.** It is a single
`CREATE OR REPLACE FUNCTION` on `private.is_club_member` plus its `COMMENT`: no grant, no column
list, no policy, no table DDL. It is purely additive to a predicate — every read and write that
succeeded before it still succeeds — and no application code reads or depends on the function, so
it may be applied to either project at any time, before or after any pending code deploy, and in
either order relative to `enforce-creator-membership`. **What it does add is a dependency that is
not an ordering one and would not show up in a chain check**: the new arm reads `public.clubs`
while `clubs` SELECT calls the function, and that self-edge is not `42P17` only because
`public.clubs` does not force row-level security. `ALTER TABLE public.clubs FORCE ROW LEVEL
SECURITY` would take every club read in the app down. The RLS suite asserts
`relforcerowsecurity = false` for exactly that reason, and `054`'s header carries the warning so
it is discoverable from `pg_class` rather than only from here.

## Rollback — `git revert` is not the path

**`git revert` of the squash commit is NOT the rollback path.** It would take the files out of the
repo while the grants stay applied, which is precisely the drift `npm run db:drift` exists to
catch. The rollback is the SQL below.

```
042   revoke delete on public.profiles
      ROLLBACK: grant delete on public.profiles to authenticated;
043   create or replace function public.delete_owned_club(uuid)
      ROLLBACK: drop function public.delete_owned_club(uuid);
044   per-column insert/update on postcards
      ROLLBACK: grant insert, update on public.postcards to authenticated;
045   per-column insert/update on rides and clubs
      ROLLBACK: grant insert, update on public.rides, public.clubs to authenticated;
046   postcards UPDATE loses id and author_id
      ROLLBACK: grant update (id, author_id) on public.postcards to authenticated;
047   revoke truncate, references, trigger on the five tables 001 created
      ROLLBACK: grant truncate, references, trigger on public.rides, public.clubs,
                public.club_members, public.ride_members, public.profiles to authenticated;
048   per-column insert/update on postcard_comments, club_members, ride_members
      ROLLBACK: grant insert on public.postcard_comments to authenticated;
                grant insert, update on public.club_members to authenticated;
                grant insert, update on public.ride_members to authenticated;
058   clubs.is_default, its index and CHECK, and the auto-join
      ROLLBACK: -- IN THIS ORDER. Both functions reference is_default, so the
                -- column cannot go first; restore their 033 / 036 bodies from
                -- git, then drop. 059 must be rolled back before 058.
                \i supabase/migrations/033_restore_function_comments.sql  -- complete_onboarding
                -- and re-issue 036 §7.6's notify_club_joined() body, and
                -- 036 §7.5's notify_ride_created_in_club(), and 043's
                -- delete_owned_club(uuid) — all four from those files verbatim.
                alter table public.clubs drop constraint clubs_default_club_is_public;
                drop index public.clubs_one_default_club;
                alter table public.clubs drop column is_default;
                -- The memberships it wrote are NOT undone by this. They are
                -- ordinary club_members rows and deleting them is a decision
                -- about riders' memberships, not a rollback step.
059   the default club's two fan-outs and its deletion guard
      ROLLBACK: -- 060 MUST BE ROLLED BACK FIRST, or this step silently reverts
                -- it. 060 replaces notify_ride_created_in_club() again, so
                -- re-issuing 036 §7.5's body over a database carrying 060
                -- discards 060's owner union AND both readability filters while
                -- appearing to undo 059 alone. create or replace raises nothing.
                re-issue private.notify_ride_created_in_club() from 036 §7.5,
                public.complete_onboarding(text) from 058 §3, and
                public.delete_owned_club(uuid) from 043 — verbatim.
060   the two notification fan-outs, filtered by their subjects' read policies
      ROLLBACK: -- Newest-first, and all THREE drops must follow the re-issues.
                -- The full caller list, because a partial one reads as licence
                -- to drop the unlisted function first: is_club_member's 060
                -- body calls is_club_member_for; can_read_ride and
                -- can_read_club both call it too; notify_ride_joined calls
                -- can_read_ride; notify_ride_created_in_club calls BOTH
                -- can_read_ride and can_read_club.
                --
                -- Every one of these is `language sql` with a string body, so
                -- Postgres records NO dependency and every drop below would
                -- succeed out of order, silently, leaving bodies that fail at
                -- the next RSVP rather than at rollback time.
                --
                -- COMMENT INCLUDED on all three re-issues. Restoring a body and
                -- leaving 060's comment on it is worse than no comment: the
                -- function would still claim a readability filter that is gone.
                re-issue private.notify_ride_joined() from 055 verbatim, and
                private.notify_ride_created_in_club() from 059 §1 verbatim
                -- 059's, NOT 036 §7.5's: 036's predates the default-club early
                -- return, so rolling back to it re-opens the app-wide broadcast
                -- 059 exists to prevent.
                -- Then is_club_member back to its OWN body rather than a
                -- wrapper, from 054 verbatim, comment included.
                \i supabase/migrations/054_club_owner_is_a_member.sql
                drop function private.can_read_club(uuid, uuid);
                drop function private.can_read_ride(uuid, uuid);
                drop function private.is_club_member_for(uuid, uuid);
```

**`058`, `059` and `060` are the entries here whose rollback is ORDER-DEPENDENT in a way a
`drop` cannot express**, and `060` extends the chain rather than starting a second one: it
replaces `notify_ride_created_in_club` for the third time, so the three files have to be undone
newest-first or an older body lands on top of a newer repair with nothing raised.

Four function bodies reference `clubs.is_default`, so dropping the column
first fails on the dependency, and rolling `058` back without `059` leaves `059`'s bodies pointing
at a column that no longer exists. Take them newest-first, functions before column, always.

`041` is absent because it is additive — one column, one index, one FK and an INSERT-policy
replacement — and has no one-statement undo.

## What reads as drift, and why none of it is

**Nothing automated compares the stored SQL against the files** — `npm run db:drift` compares
migration *names* only — so every entry below is a hand reconciliation. **Do not reduce the list to
a count**: one bullet covers five migrations, and three of them record a statement that does **not**
mismatch — the absence of one is what someone re-deriving the pattern from `036`–`040` would not
predict, so it is worth a line. None of it is drift.

- **`npm run db:drift` reports nothing missing from either project** — `041`–`046` applied on
  2026-08-10 and `047`/`048` later the same day. Every remaining entry on this list is a recording
  artefact.
- **`050` is the first entry where DEV's LEDGER cannot reproduce DEV's OBJECT, and that was done
  deliberately.** DEV's recorded statement embeds a function body of 6,680 characters
  (`md5(prosrc)` of the embedded body: `43d7c861…`); DEV's live `search_places` is 6,744
  (`1fc795cf…`). The difference is 64 characters — one comment line, `-- See §2 for where the
  resulting imprecision actually lands.`, absent from the national-pass block — plus a differing
  function comment. Comment-only, so nothing a rider could observe, but a body comment **is**
  `prosrc`, so it broke `md5(prosrc)` as a cross-project check.

  Reconciled 2026-08-11 by re-issuing `create or replace` and `comment on` against DEV through
  **`execute_sql` rather than `apply_migration`**: the ledger already carried a `050` row and a
  second one is drift of a worse kind than the one being fixed. The cost of that choice is this
  bullet — DEV's ledger is now one revision behind its own object, which is `034`'s class made
  permanent on purpose. **Replaying DEV's ledger would not reproduce DEV's object**, so if `050`
  ever needs replaying, take it from the file.

  **PROD's `050` is comment-reduced** (11,444 characters recorded against a 21,753-byte file),
  which is `036`–`040`'s class. Unlike those, this file HAS a `$$` body, so the reduction
  deliberately preserved every comment inside `$fn$` and stripped only the header prose.

  **This bullet has no live subject as of 2026-08-19.** `070` dropped `search_places()` from both
  projects, so the reconciliation query returns zero rows on each — and with a `::regprocedure`
  cast it raises `42883` instead. Keep the bullet as the worked example of a ledger that cannot
  reproduce its own object; do not run the query. What it recorded, for the record: DEV and PROD
  both held `md5(prosrc)` `1fc795cf…` over a 6,744-character body, equal to the repo file's `$fn$`
  block, with comment digest `3d03b385…`.

- **`069` is the inverse of every entry above: DEV is the reduced one and PROD is byte-exact.**
  Applied to PROD 2026-08-19 through a reduction that deliberately preserved the comments inside
  `$$`, then proved by diffing the resulting OBJECTS against DEV, which already had the file —
  eight digests over `pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`,
  `information_schema.columns`, `pg_indexes`, the grants, the two widened CHECKs and the function
  comments. **Seven matched and one did not**, which is the whole value of comparing objects rather
  than text: `public.sweep_place_search_attempts`'s body is **946 characters on PROD and 248 on
  DEV**. PROD equals the file (`md5(prosrc)` `6a8dfaac…`, byte-identical to its `$$` block); DEV's
  apply stripped the in-body comment explaining why `query_canceled` is caught by name. Comment
  only, so no behavioural difference — but it means **DEV cannot reproduce its own `069` object**,
  exactly as `050` cannot, and a future reconciliation should take `069` from the file rather than
  from DEV's ledger.

  **`049` needs no entry of its own beyond DEV's reduced form**, already noted in
  `docs/HANDOFF.md` §Migrations: same reduction, same class, and its body was verified by the same
  digest.
- **`047` and `048` match their files on NEITHER project, and both are comment edits rather than
  drift.** DEV ran each file verbatim and the recorded statement was byte-identical at apply time;
  the pre-PR review then corrected one wrong sentence in each header — `048`'s policy count (nine,
  measured ten) and `047`'s advisor arithmetic (8+1, where `delete_owned_club` is already inside
  the nine) — so the files moved and the rows did not. This is `037`'s class, where `039` edited
  its comments and changed no SQL.

  **PROD's rows are additionally comment-REDUCED**, which is `036`–`040`'s class: nothing can pipe
  a file into `apply_migration`, so each was reduced to its executing statements. Neither file has
  a `$$` body, so no `prosrc` is at stake and the reduction is total. **It was proven by an object
  diff rather than assumed** — the stronger check `036` established. Over `postcard_comments`,
  `club_members`, `ride_members`, `rides`, `clubs` and `profiles`, a digest of every column ACL,
  every table ACL and every column comment is **identical on both projects**:

  ```sql
  -- md5(string_agg(...)) over pg_attribute.attacl, pg_class.relacl and col_description
  -- DEV and PROD both: 1f1b251f28288821e3cd621ddba8edd0   (2026-08-10)
  ```

  Recompute rather than trusting that hash — it moves the day anything re-grants those six tables,
  which is the point of recording it.
- **DEV's `046` statement is NO LONGER byte-identical to its file, and PROD's IS.** This is the
  inverse of the drift you would expect, and it is worth reading before concluding either database
  is wrong. DEV recorded 8837 chars; the file is 9857, because the header comment **grew by 1020
  chars after the DEV apply**, inside the squash-merged PR — so the intermediate version is in no
  local commit. **The executing SQL is identical on both**: from `revoke update on public.postcards`
  to EOF it is `744cad894a8f40115fa7a1e10340b96f`, 2228 chars. PROD ran the committed file, so
  PROD's `md5(statements[1])` is `da47b0fa…` = `md5sum` of the file, and DEV's is `9ec9b7a2…`,
  which is what the file used to be. Compare the *executing* slice, not the whole statement, when
  a header has moved.
- **DEV's `045` statement IS byte-identical to its file**, like `041` and `044`:
  `md5(statements[1])` equals `md5sum supabase/migrations/045_rides_clubs_server_owned_created_at.sql`
  — both `a8534fda14169b6bf2d024ea95983499` at apply time, 2026-08-10. Recompute rather than trusting
  the hash; a later comment edit moves it.
- **DEV's `044` statement IS byte-identical to its file**, like `041` and unlike `042`/`043`:
  `md5(statements[1])` on DEV equals `md5sum supabase/migrations/044_postcards_server_owned_timestamps.sql`
  — both `4bc4fc5b4f4d6db3d0821fef97537b5c` at apply time, 2026-08-10. The trailing-newline class
  that `042` and `043` fell into is avoided by including the file's final `\n` in the string passed
  to `apply_migration`, which is the whole difference; recompute rather than trusting this hash,
  because a later comment edit to the file will move it and make the row look like the others.
- **DEV's `043` statement is its file minus the final newline, and that was PROVEN rather than
  assumed.** `apply_migration` takes a string and the argument cannot carry the file's trailing
  `\n`, so this is `042`'s row again rather than a new class. Recompute both forms rather than
  trusting a hash written here; the second is the one that matches
  `md5sum supabase/migrations/043_delete_owned_club.sql`, and `octet_length(statements[1])` comes
  back exactly one byte under `wc -c`:

  ```sql
  -- md5(statements[1])            -- raw: will NOT equal md5sum of the file
  -- md5(statements[1] || chr(10)) -- this one does
  ```

  The stronger check was also run, and it is the one to copy: the OBJECT that landed was diffed
  against the object the file produces. `md5(prosrc)`, `md5(pg_get_functiondef(oid))` and
  `md5(obj_description(oid,'pg_proc'))` for `public.delete_owned_club(uuid)` are identical on DEV
  and on the scratch database `npm test` builds by applying the file with `psql`, and `prosecdef`
  is `t` with `proconfig[1] = 'search_path=""'` on both. That is stronger than comparing the text
  that produced them, which is `036`'s lesson.
- **DEV's `041` statement IS byte-identical to its file**, so it does **not** join the reduced-form
  list below: `md5(statements[1])` on DEV equals `md5sum supabase/migrations/041_postcard_ride_tag.sql`
  — both `28ac654156c67f8f1a668bba2eee70b2` at apply time, 2026-08-09. Recorded because the *absence*
  of a mismatch is what someone re-deriving the pattern from `036`–`040` would not predict, and
  because a later comment edit to that file will move the hash and make it look like the others.
- **DEV's `042` statement differs from its file by exactly one trailing newline, and nothing else.**
  `apply_migration` takes a string and the argument cannot carry the file's final `\n`, so the raw
  comparison disagrees while the content is identical. Per the rule below, no hash is written here
  — recompute both forms; it is the second that matches:

  ```sql
  -- md5(statements[1])            -- raw: will NOT equal md5sum of the file
  -- md5(statements[1] || chr(10)) -- this one equals `md5sum supabase/migrations/042_*.sql`
  ```

  Two traps in the same row. `length(statements[1])` reads ~39 short of `wc -c` and that is **not**
  a truncation — `length` counts characters, `wc -c` counts bytes, and the header is full of
  em-dashes; use `octet_length`, which comes back exactly one byte under the file. And the row was
  **re-applied once**, deliberately: the first apply carried a header sentence claiming the RLS
  suite asserts `service_role`'s grant, which it does not and cannot (see `042` §3), so the row was
  dropped and re-applied from the corrected file rather than left saying something untrue. That is
  the `034` reconciliation shape, run immediately instead of deferred.
- **PROD's recorded statements for `036`–`040` are comment-reduced, not the files.** Nothing can
  pipe a file into `apply_migration`, so each was reduced to its executing statements (preserving
  comments inside `$$` bodies, which are part of `prosrc`) and then verified by diffing every
  resulting object against DEV — function, trigger, policy, column, index and grant hashes all
  matched. The object diff is the stronger check.
- **DEV's `034` statement is one revision behind the file** while its *schema* matches exactly:
  the second post-review correction went on as a delta (`alter constraint`, `drop`/`create
  policy`) rather than a re-apply. PROD got the file verbatim, so the canonical record is correct
  and only the disposable database is out. Reconcile whenever convenient:

  ```sql
  -- then re-run apply_migration with the file's contents
  drop table public.ride_messages cascade;
  drop function private.is_ride_crew(uuid);
  delete from supabase_migrations.schema_migrations where name = 'ride_messages';
  ```

- **`037` matches under no form**, because `039` edits its *comments* — the `SUPERSEDED BY 039`
  banners and its verification footer — which changes the file and no SQL.

## Recomputing a hash, and why none belongs in prose

**Do not write a file hash into this file.** Any later comment edit moves it, and both attempts to
record one were wrong within the same commit that wrote them. **A hash is only worth recording for
a migration that has already shipped and nothing will edit again.** Recompute instead, and
**compare the raw `md5sum` first** — only a caller that dropped the trailing newline needs the
stripped form, which is a property of how that one was applied and not of the tool:

```bash
md5sum supabase/migrations/0NN_*.sql                                # raw
printf '%s' "$(cat supabase/migrations/0NN_*.sql)" | md5sum         # stripped
# via the Supabase MCP: list_migrations -> md5(statements[1])
```

## Applied state — the per-project log

**`list_migrations` prints 110 rows on DEV and 100 on PROD against 107 files. The DEV surplus is
not a gap; the PROD shortfall IS one, and it is `101` through `107`.** DEV is level
with the repo at `107`. `103`/`104` were applied only once the build carrying them was **confirmed
serving** — `READY` on the merge sha with `aliasError` null, never merely "after the merge":
`CLAUDE.md` §Supabase Rules names that distinction with a measured incident behind it (a destructive
file applied 102 seconds after a merge, out from under a Preview still calling what it dropped), and
`103` is exactly the class it describes. Reconciled name by name on 2026-08-31, again for `096`
on 2026-09-01, again for `101`/`102` on 2026-09-03, and again for `103`/`104` on 2026-09-04 —
**both recorded WITHOUT their numeric prefix** (`creator_membership`, `club_member_owner_arm`),
which is the majority convention here: `098`, `100` and `101` are the same and only `102` carries
one.

**`107_a_club_may_outlive_its_last_member` (PD-98) — applied to DEV 2026-09-05, recorded as
`a_club_may_outlive_its_last_member` (no numeric prefix, the majority convention above).**
`clubs.owner_id` becomes nullable so a club whose last member erases their account can survive,
ownerless, when third-party postcards are in it — `029` §2's belief that such a club holds postcards
"entirely their own by construction" is false, and the cascade was destroying content belonging to
riders who had already left.

**MIGRATION-FIRST, and the reason is that the file has no unsafe side rather than that
migration-first is a default.** No client writes `owner_id` on an existing row (`authenticated`
holds INSERT and SELECT on it and no UPDATE), so there is no `PGRST204` shape; no FK is added, so no
`PGRST201`/HTTP 300 shape; **and the policy delta is provably a no-op against every row existing at
apply time**, because the column was `NOT NULL` until the file's first statement, making
`owner_id is not null` universally true for every pre-existing row. The only rows the delta can
affect are ones the file's own last statement can create. **`107` changes no `src/` file at all** —
the narrowing keeps a NULL `owner_id` off the wire, so `owner_id: string` in `src/types/index.ts`
stays honest — which is also why there is no confirmed-serving gate here.

**Applied REDUCED and proved by object diff — §Applying a large file's case.** The file is 64 KB;
the executing statements with their in-`$$` comments preserved are 31 KB. The reduction was proved
BEFORE it was sent: it was applied to a second local database, the RLS suite ran green against it at
the same 3484 assertions, and all five object hashes (functions, policies, triggers, columns,
constraints) matched the database built from the full file exactly. After applying, the eleven
functions the file writes hash **identically** on DEV and on the locally-validated build —
`540e557d7668c5765257dce06334f091` — and the whole-schema policy hash matches too. **So
`md5(statements[1])` does NOT equal the file's `md5sum` here, and that is the norm rather than
drift.**

**A HAND-EXERCISE GATE ran before it applied, because it hangs a trigger on `postcards` DELETE — an
already-shipped write path.** `CLAUDE.md`'s rule, run against DEV in one transaction that created
the column change, the function and the trigger, exercised five paths and rolled back; steps 1 and 2
used REAL rows deleted by their real author with `role authenticated` and a matching
`request.jwt.claims`. All five passed, including the one that matters — **the cascade case, where the
reap runs inside the rider's own erasure transaction and a raise would abort the erasure itself**.
The rollback was confirmed rather than assumed (15 clubs / 11 postcards / 24 profiles / `owner_id`
still NOT NULL / 2 triggers, read back immediately after).

**Adds NO advisor: DEV stays at 39, RUN rather than derived** — 36
`authenticated_security_definer_function_executable` WARNs + 2 `rls_enabled_no_policy` INFOs + 1
`auth_leaked_password_protection`. The one new function, `private.reap_ownerless_club`, is in
`private`. (The advisor keys on `has_function_privilege('authenticated', …)` rather than on the
schema, so `private` is a safe over-approximation and not the mechanism.) Suite **3488**, from 3440.

**Seven existing assertions moved deliberately and each is annotated with why** — five plain-text
pins of the `clubs` SELECT policy string (060, 081.6, 085.1, 089.7, 099.9), two md5 pins at 093.7
(the policy and `private.can_read_club`, which must always move together or not at all), the trigger
count at 041 (2 → 3, the first change ever to move it), and 081.16b, which flips false → true
**exactly as its own message anticipated** — it exists "so closing it is deliberate". 081.16b's
behavioural assertions are untouched: the welcome club is still deleted by this arm.

**`105_a_block_and_a_hide_can_be_undone` (PD-298) — applied to DEV 2026-09-05, recorded as
`a_block_and_a_hide_can_be_undone` (no numeric prefix, the majority convention above).** Two
`security definer` accessors in `public` — `my_blocked_riders()` and
`my_hidden_postcards(timestamptz, int)` — plus `blocks_blocker_id_created_at_idx`. **Purely
additive and inert, so it has no ordering constraint in either direction**: no policy, CHECK,
grant, column or trigger moves, an older bundle never calls either function, and a newer bundle
against the old database gets a PostgREST 404 on two reads that gate nothing else. Applied WHOLE
— `md5(statements[1])` on DEV equals the file's raw `md5sum`, `b0a42e23d24342fe6e959e5621a369fa`,
so this one is not §Applying a large file's case and needs no object diff.

**Adds exactly two advisors, DEV 37 → 39, and the count was RUN rather than derived** (the
proposal's +2 was arithmetic): one
`authenticated_security_definer_function_executable` per function, both named in the payload, no
new `rls_enabled_no_policy` because the file creates no table. PROD stays at 37 until the
promotion. The definer-function count moved 34 → 36.

**`106_the_hidden_list_cannot_detect_a_block` (PD-298) — applied to DEV 2026-09-05, recorded as
`the_hidden_list_cannot_detect_a_block` (no numeric prefix, the majority convention above).
It replaces `105`'s `my_hidden_postcards` because that function shipped the leak it was written
to prevent** — found by the pre-merge review, before either accessor had a caller. `105` returned
`restorable`, which is `011`'s `postcards` SELECT qual minus the hide conjunct; **for a postcard
with `club_id IS NULL` the club conjunct is vacuously true, so it reduces to
`not is_blocked(me, author)`**, and the same change ships `my_blocked_riders()`, which names the
rider's own outbound blocks. Subtract one from the other and an unrestorable row whose author is
absent from your block list means *that rider blocked you* — deterministic, and on a schedule the
rider controls. The function now returns `(postcard_id uuid, hidden_at timestamptz)` and nothing
that can vary with another rider's actions; `design.md` D4 is rewritten around the finding, and
it also records that `105`'s "three reasons collapse into one" was only ever **two** reasons,
because a deleted author cascades the hide row away (`105.10` asserts it).

**A DROP and a CREATE, not a `create or replace`** — replacing eight OUT parameters with two
raises `42P13`. Two consequences the file states rather than inherits: the drop discards the
grants, so the `revoke … from public, anon` + `grant … to authenticated` pair is re-issued **at
the new three-argument signature** (`timestamptz, uuid, int` — `106` also fixes `105`'s
single-column keyset cursor against a two-column sort), and it discards `security definer`,
`stable` and the pinned `search_path`, all three restated and pinned in `106.1`.
**Ordering-free in both directions and NOT the destructive class in practice**: `105` is DEV-only,
`my_hidden_postcards` has never had a caller in any deployed bundle, and the screen that will call
it is being written against `106`'s signature — `090`'s case, a removed object no bundle can
observe. On the PROD promotion the pair applies in filename order and PROD never serves the
eight-column version at all. Applied WHOLE — `md5(statements[1])` on DEV equals the file's raw
`md5sum`, `7f8daa425ec696d54addcb5ccfbe1a2b`.

**Adds NO advisor: DEV stays at 39, RUN rather than assumed.** One `security definer` function in
`public` leaves and the same name comes back, so `105`+`106` together still account for exactly
two `authenticated_security_definer_function_executable` WARNs and the definer-function count
stays at 36. The suite moved 3431 → 3440, which is a net figure over **fifteen `105` labels
removed and twenty-four added** — compare label sets, not counts.

**`103_creator_membership` + `104_club_member_owner_arm` (PD-103) — applied to DEV 2026-09-04,
after the merge was confirmed serving; they are the ordering case rather than an exception to it.** `103` hangs two `AFTER INSERT` seeding
triggers (`private.establish_club_owner_membership`, `private.establish_ride_organizer_membership`,
both with **no `WHEN` clause**, so they bind the seed and `service_role` too), backfills any
existing orphan with `joined_at` from the parent's `created_at`, repairs a demoted owner row by
**UPDATE**, and adds `private.protect_ride_organizer_membership` as a `BEFORE DELETE` guard.
`104` then replaces `019`'s `club_members` INSERT policy so `role = 'member'` is its only role arm.

**The order is deploy → `103` → `104`, and only one direction is unsafe.** Applying `103` while a
bundle that still issues the second insert is serving is an instant outage: `23505` on a row the
trigger already wrote, then that bundle's own compensating delete removes the club it just made.
The reverse gap — a bundle with no second insert against a database with no trigger — makes
orphans, and `103`'s backfill repairs exactly those, so it is self-healing **for the server**.
**It is NOT self-healing for an already-loaded browser tab**: this is a client-rendered SPA, so a
tab that loaded the pre-merge bundle keeps its JS and goes on issuing the plain insert from an
event handler with nothing to trigger a chunk refetch. From the moment `103` applies, that tab
gets `23505`, its own compensating delete removes the club, and every attempt reports failure —
for as long as the tab lives, which on mobile is days. That population is the whole reason the
change carries a transitional group 1 (an idempotent upsert, deployed and left to **soak**), and
**a PROD promotion should use it** rather than collapsing the steps the way the DEV apply did,
where the tab count was effectively zero. `104` is last because
it is only safe once the deployed bundle has stopped sending `role: 'owner'`.

**Applied only once the merge was confirmed SERVING on DEV** — deployment `dpl_EMxU7N3P…` `READY`
on `60e700f` — which is why the commit that ADDED these files claimed `102` and the follow-up claims
`104`. An earlier revision claimed `104` in the adding commit, and that was the pre-merge review's
most serious finding: the client half ships in the same PR and no longer writes the membership row,
so a skipped apply would have made the orphan permanent while the record said it was fixed. Adds **no** advisor: all three
functions live in `private`, so `authenticated_security_definer_function_executable` does not fire
and both projects stay at thirty-seven. Pre-flight on DEV, RLS bypassed: 17 clubs / 27 rides /
24 profiles, **0 orphans of either kind**, 0 `admin` rows, 1 private club — so the backfill had
nothing to repair on DEV and is a guard for the PROD apply rather than the main event.

**It also binds every FIXTURE in the repo, which the proposal did not anticipate** — a seeding
trigger with no `WHEN` clause fires for `supabase/tests/seed.sql`, `supabase/tests/rls_test.sql`
and `supabase/seeds/development.sql`, each of which stated the owner/organizer tuple the database
now owns, so each raised `23505` on its *own* insert (never inside the trigger — the trigger's
insert runs first and succeeds, so `on conflict do nothing` on it would have fixed nothing). The
tuples were removed rather than the trigger loosened: a fixture stating that row models a client
that no longer exists.

**`102_own_row_reads_survive_the_parent` (PD-362) — applied to DEV 2026-09-03, and it has NO
ordering constraint in either direction.** It hoists the own-row branch out of the block conjunct on
three SELECT policies (`ride_members`, `postcard_likes`, `postcard_comments`) and adds an explicit
`exists` against `rides` to `ride_members`' UPDATE **WITH CHECK**. It widens a read no shipped bundle
can currently obtain, narrows a write path no shipped screen offers (nothing in `src/` moves a seat
between rides — `setRideAttendance` upserts status on one `ride_id`, verified by grep), and removes
nothing, so an older bundle cannot observe it and a newer one needs no new column. **Applied
REDUCED** — the file is 17 KB and mostly commentary — **and proved by object diff rather than by the
recorded text**: `md5(string_agg(...))` over the four policies' `qual` + `with_check` is
`27bd51a7c54cb57201287772463eb709` on both DEV and a local database built from the file itself. Adds
no advisor (no new `security definer` function): both projects stay at thirty-seven.

**PROD is at `100`, so `101` is awaiting promotion**
(`101_retire_club_thread_waves`, PD-373 — destructive, and **NOT `090`'s case**: `090`'s "no unsafe
side" held because the client that could observe the dropped objects was already gone from the
bundle *being promoted*; here PD-372's `club_thread_waves` retirement is confirmed serving only on
DEV, PROD's `main` bundle still reads and writes the table, and `101` must wait until the
`development` → `main` promotion carrying PD-372 is confirmed serving before it applies to PROD —
`docs/HANDOFF.md`'s §Applied state entry for `101` has the measured detail). DEV's **surplus rows** are files applied there in increments: `063` in
three — `ride_capacity_is_enforced`, `…_exemptions`, `ride_capacity_moves_to_private`, where PROD
holds the one consolidated file — and `080` in two, `rides_carry_their_meeting_points_zone` plus
`rides_zone_is_not_cleared_with_the_location_group`. **DEV keeps all three `063` rows even though
`077` has dropped everything they built**; a recorded row is a statement that a file ran, never a
claim that its objects survive. **Count rows against files rather than reading a surplus as drift**,
and re-derive both rather than trusting the numbers in this heading — they have been wrong here
before, in the direction of reading one row too few.

```bash
ls supabase/migrations/*.sql | wc -l    # 107
```
```
mcp__Supabase__list_migrations zwprydcyryvudhurbnye   # PROD — 100 rows, last `100_club_thread_fan_outs_test_membership`
mcp__Supabase__list_migrations fpmrimzxadewsaiwpsel   # DEV  — 110 rows, last `a_club_may_outlive_its_last_member`
```

**`080`–`091` were promoted to PROD on 2026-08-30 around #348's build**, in the grouping
`CLAUDE.md` §Supabase Rules carries: `080`–`088` and `091` before it served, `090` before it too
(the destructive exception its own header earns), `089` after `app.letsride.social` was confirmed
`READY` on the merge sha `191d906` with `aliasError` null.

**Verified by OBJECT rather than by the recorded statement**, per `CLAUDE.md` §Supabase Rules — the
whole point being that a reduced apply and a real difference look identical in the recorded text.
Functions (`md5(prosrc)`, `prosecdef`, volatility), triggers, policies across `public` **and**
`storage`, constraints, and function EXECUTE grants for `anon` and `authenticated` all hash
identically across the two projects. **One function differs and it is not this promotion's:**
`sweep_place_search_attempts`, whose PROD body is 946 characters against DEV's 248 — `069`'s
comment-only reduction, already recorded in `docs/reference/migrations.md`.

`036`'s hand-exercise gate was run against PROD for all four non-inert files (`083`, `085`, `091`,
`089`), in rolled-back transactions as `authenticated`: club and ride creation, an RSVP, an invite
with its accept and decline, a link minted, claimed and revoked, a join request declined and another
approved, and promote/demote/remove. Nothing raised, and the fan-outs' rows were counted rather
than assumed — including the one `089` writes, whose `actor_id` equals its recipient, which the
admin cannot read and which the clear retracts.

**`078` and `079` both went to PROD on 2026-08-25 BEFORE the #310 promotion build served**, which
is the additive half of the `069`/`070` rule applied twice in one sitting. `079` in particular had
to: the client calls its RPC, so code deployed ahead of the function answers `PGRST202`, which
`countUnseenPostcards` swallows to `0` — a tile reading zero with nothing red anywhere.

**Verified by OBJECT rather than by the recorded statement**, per §Supabase Rules, and the check
earned its place: `078` is 28.5 KB and was applied as a reduction, which trimmed two comments
*inside* a `$$` body. The diff caught it — `register_push_device` was 1625 characters against DEV's
2013, behaviour identical and text not — and it was re-applied verbatim. All five hashes now match
DEV (`pg_get_functiondef`, `pg_get_constraintdef`, `pg_indexes`, `information_schema.columns`, the
table comment), `079`'s `md5(prosrc)` is `880bf43d014570a72b734e232ac4a6cc` on both, and
`get_advisors(security)` on PROD returns exactly 13.

**`079`'s recorded statement on DEV is a 79-character stub and that is not drift** — it was applied
with `execute_sql` by an agent whose toolset carries no `apply_migration`, so the row was written by
hand. Per `CLAUDE.md` §Supabase Rules the check is the OBJECT, and it passes: `md5(prosrc)` is
`880bf43d014570a72b734e232ac4a6cc` on DEV and on a scratch database built from the file by
`run.sh`, with `prosecdef` false and `search_path=""` on both.

**`076` and `077` went to PROD on 2026-08-25 in OPPOSITE orders round the same build, which is
the whole rule in one sitting** — `069`/`070`'s lesson repeated deliberately rather than
rediscovered. `076` is additive and nothing reads it, so it went **before** the #304 promotion
merged. `077` drops a column and went **after** `app.letsride.social` was confirmed resolving to
a `READY` deployment on the promotion sha `95602ca` with `aliasError` null — not after the merge.
PROD's app selected `max_riders` in `getRide` and `getRideForEdit`, and in those two only, so
applying early would have 400'd the ride detail and the edit screen. **`RIDE_SELECT` never named
it, so the rides LIST was never at risk**; count the call sites rather than reasoning from "the
ride reads", which is how an earlier draft of this line had the list going down too:
`git grep -c max_riders <sha> -- src/lib/data/rides.ts`.

**Verified on PROD after `077`**: column 0, `enforce_ride_capacity` 0 rows in `pg_proc` in every
schema, trigger 0, `rides_max_riders_range` 0, `rides` CHECKs 8, `ride_members` down to
`enforce_participation_gate` and `notify_ride_joined`, `authenticated` grants 12 INSERT / 13
UPDATE / 16 SELECT, `enforce_participation_gate` on 11 tables — every figure identical to DEV.
Advisors re-read: **exactly ten**, unchanged.

**`076`'s verification turned up drift on DEV and repaired it, and the lesson is the reusable
part.** DEV's `private.remove_reported_postcard` body did not match the committed file: the
session that applied `076` there had stripped the comments *inside* the `$$` body, which changes
`prosrc`. PROD was applied from the file's body verbatim and matched first time. DEV was
re-applied with `create or replace`; file, DEV and PROD now all read
`b75fbeb68177de435038f8c69e883e45`. Comment-only, so no behaviour ever differed — but it is
exactly what §Supabase Rules warns about when reducing a large migration to its executing
statements, and it was invisible until somebody diffed the object. Applying it first would be a rider-visible outage for the length of
a build, which is exactly the window `070`'s header exists to describe.

**`076` (PD-297) went to PROD on 2026-08-25, and it is the one migration in this file whose
promotion order did not matter.** It is purely additive and **no code reads it** — the objects
live in `private`, which PostgREST does not route, so no build can call them and no build can
break for want of them. That is the opposite of `074`, two paragraphs below, where the promotion
build reads a column and a missing one puts a "try again" panel on five screens. It was verified the way every other object here is
verified — by object rather than by recorded text:

```sql
-- against PROD, after applying
select count(*) from private.postcard_report_queue;                                  -- answers
select has_schema_privilege('authenticated', 'private', 'usage');                    -- f
select has_table_privilege('service_role', 'private.postcard_report_queue', 'select'); -- f
select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'remove_reported_postcard';            -- f
```

**Reading the queue is an owner action and always will be.** There is no admin role in this
schema and `076` deliberately did not invent one, so triage is the Supabase dashboard's SQL
editor: `select * from private.postcard_report_queue;` to see what is waiting, and
`select private.remove_reported_postcard('<postcard_id>');` to take one down. **Keep the
function's return value** — it carries the reports it is about to destroy, which cascade away
with the postcard, and it names the Storage object at `image_path` that no cascade reaches. The
runbook is `076`'s §Operating it footer.

**`074` and `075` reached PROD on 2026-08-24, ahead of the build that reads them** — the
additive-first order, since the code for both is merged to `development` and not promoted. `075`
was applied from a comment-stripped reduction that PRESERVES the comments inside its `$$` bodies
(stripping those changes `prosrc`), and proved by object rather than by text: `md5(prosrc)` for
`complete_onboarding`, `enforce_onboarding_completion` and `username_exists` is identical on both
projects, with matching `prosecdef` and `proconfig`.

**`071`, `072` and `073` reached PROD on 2026-08-24**, ahead of the build that reads them, and
were verified by comparing OBJECTS against DEV rather than by the recorded statement — `md5` over
the `postcards` columns, its constraints, the `authenticated` column grants and the `rides`
indexes, all four equal on both projects. They were applied from a comment-stripped reduction of
the files (no `$$` body in any of the three, so nothing in `prosrc` could move), which is
CLAUDE.md §Supabase Rules' technique for a file too large to retype safely.

**`074` must be APPLIED BEFORE the promotion build serves, and this rule is now the standing one
for this column family rather than a note about two files.** They were "additive, so the ordering
is the ordinary one" right up until something read the column: `POSTCARD_SELECT` names
`taken_place_name` and now `taken_country_code`, PostgREST answers `42703` for a column that does
not exist, and `unwrapList` throws — so a production build promoted ahead of the migration puts a
permanent "try again" panel on the home feed, the club feed, the postcard thread, `/profile` and
`/profile/detail`. That is `069`'s shape, one paragraph below, rather than `070`'s.

**`074` is necessary for the flag and not sufficient, and the missing half is a DEPLOY rather
than a migration.** `taken_country_code` can only ever be filled from the country
`search-places` returns, and neither project's deployed build returns one — PD-279 added
`country_code` to `shape.ts` after both were deployed. So until the owner redeploys the function,
every postcard written stores NULL there and `PostcardCard` falls back to the pin: the column is
correct, applied and empty. DEV is the one that matters first, and DEV is also the project running
the *older* build of the two (CLAUDE.md §Supabase Rules).

**Nothing can catch this for you.** `db:drift` is not in `ci.yml` and needs two connection strings
no session holds; `docs:check` cannot reach PROD; `columns.test.ts` reads migration *files*, so it
is blind to what is applied. The check is `list_migrations` against PROD before the merge:

```
mcp__Supabase__list_migrations zwprydcyryvudhurbnye   # 074 must be there first
```

**`072` and `073` were one change and had to promote together** — the record of why, because the
same shape will recur. `072` adds the place columns and `073` drops the provider id `072` should
never have added *and* fixes a real defect in `072`'s own coupling constraint — an arm comparing
the nullable marker with `=` evaluates to NULL rather than FALSE, and **a CHECK accepts NULL**, so
`072` alone admits a coordinate with no marker, which is the exact shape `064`'s own assertion
exists to refuse. They went to PROD in filename order in one sitting, so that hole never existed
there.

**`071` records its filename prefix, and that took a correction.** `apply_migration`'s `name`
argument is what `db:drift` compares, and it was passed as `rides_departure_at_index` — every other
row carries the `NNN_` prefix, so the bare name would have read as a missing file on both sides of
that comparison for ever. Fixed in place with an `update` on
`supabase_migrations.schema_migrations`. Pass the **filename stem**, prefix included.

**`069` and `070` reached PROD on 2026-08-19, either side of the promotion build**, which is the
worked example of the additive/destructive split: `069` applied before the `main` build served,
`070` only after `app.letsride.social` was confirmed resolving to a `READY` deployment on the
promotion sha with `aliasError` null. The deployed proxy fails closed on its ledger insert, so
`069` arriving after instead would have returned 502 on every production search for the length of
a build. `070` took PROD from 350 MB to **13 MB** (DEV: 14 MB).
`npm run db:drift` compares migration *names*, so it reads those two extra rows as a difference;
the objects are identical, which is the comparison that decides.

**`060`–`068` reached PROD on 2026-08-19 around #269, and how they were applied is worth
carrying.** Each file was reduced to its executing statements — every `--` comment outside a
string or a `$$` body stripped, every comment *inside* a `$$` body preserved, so `prosrc` is
untouched — and applied through `apply_migration` in filename order. That is `CLAUDE.md`
§Supabase Rules' technique for a file too large to retype, used here for a different reason: nine
files at 195 KB is a lot of hand-copied production DDL, and a reduction plus a proof is safer than
nine verbatim transcriptions.

**The proof is the objects, never the recorded text**, exactly as that section prescribes. After
the eight pre-merge files, eight digests over PROD matched DEV, and after `063` the function and
trigger digests matched too:

```sql
-- run on both refs and compare; see git log for the full query
md5(string_agg(pg_get_functiondef(oid), …))   -- public + private
md5(string_agg(pg_get_triggerdef(oid), …))    -- public
-- plus pg_policies, information_schema.columns, pg_indexes, pg_constraint,
-- and role_table_grants / role_column_grants for anon + authenticated
```

**What that establishes is AGREEMENT BETWEEN THE PROJECTS, not fidelity to the repo — and the
obvious reading of it is the wrong one.** DEV is not a verbatim reference: it took six of these
eight reduced as well, and `065` and `066` were applied to both projects from **byte-identical**
recorded text, so for those two the comparison is circular by construction. Measure it rather than
assume DEV is clean — a normally-applied file records within a couple of hundred bytes of its
size, so a reduced one stands out by ratio:

```sql
select version, name, length(array_to_string(statements,'')) as recorded
  from supabase_migrations.schema_migrations where version >= '20260817103815' order by version;
-- against `ls -l supabase/migrations/`. 067 and 068 record at 99.6% — that is the control.
```

**Fidelity to the repo has a different anchor, and it is the one to cite:** `supabase/tests/run.sh`
applies the chain **verbatim** to a scratch database on every PR touching `supabase/**`, and the
`061` and `063` sections below diff their objects against exactly that. Cross-project equality is
what says PROD now matches what DEV has been serving.

**One digest did NOT match, and it is pre-existing rather than this promotion's.** The
`obj_description` of three functions differs between the projects — `enforce_ride_club_audience`,
`my_onboarding_state` and `propagate_club_privacy_to_rides`, all three from `022`/`021`, none
touched by `060`–`068`. Comments only: no privilege, no body, no behaviour. It is the kind of drift
`028`/`033` exist to repair, and nothing measures it today.

**`068` is PD-253's and is on BOTH projects — DEV 2026-08-19, PROD 2026-08-19 (#269).** Two live defects on `feed_reads`,
neither introduced by it — `061` found both while building `ride_reads` and deliberately refused to
inherit them.

`stamp_feed_read`, a `BEFORE INSERT OR UPDATE` trigger, takes `last_seen_at` away from the device
clock. **The argument is `061` §3's and it is not tamper-resistance** — forging your own watermark
suppresses your own dot, which is self-harm; it is that `club_unread_counts()` compares that value
against `postcards.created_at` and `rides.created_at`, which `044` and `045` make server-generated,
and a comparison with a different clock on each side is wrong in a way nothing logs. And
`club_unread_counts()` gains `author_id <> auth.uid()`, so a club stops badging a rider for their
own postcard.

**`markClubSeen` and `markFeedSeen` still send `last_seen_at`, and that is required rather than
leftover.** PostgREST builds `on conflict … do update set` over the columns the request body
carries, so dropping it would leave a SET list of the two key columns. Measured end to end through
the real client path on DEV, with the client clock forged to `3000-01-01`: the INSERT arm stored
`00:19:14`, the `DO UPDATE` arm `00:19:31` and then `00:19:35` — server-stamped every time, and
advancing, which is the half a trigger alone does not prove. (Incidentally: `Prefer:
resolution=merge-duplicates` **without** the `on_conflict` query parameter answers 409, so both
halves of what supabase-js sends are load-bearing.)

**What it does not fix, stated because the fix reads retroactive and is not:** a watermark already
written from a skewed clock stays skewed. No backfill could repair it — the true instant was never
recorded by anything — so it is forward-only and self-heals on that rider's next visit.

**The rides arm keeps no `organizer_id <> auth.uid()`, deliberately.** PD-253 names only the
postcard arm, and creating a ride in a club fans out (`055`/`060`), so an organizer's own ride
badging their own club is plausibly wanted rather than obviously wrong. Assertion `068.3` pins the
decision, so changing the behaviour means changing a test that says why.

**`067` is PD-114's and is on BOTH projects — DEV 2026-08-18, PROD 2026-08-19 (#269).** It lets a ride's start be **picked**
rather than only geocoded: one column (`start_place_id`), `rides_geocode_coupling` replaced by a
three-armed `rides_location_coupling`, a length CHECK, two `BEFORE UPDATE` triggers and two
**additive** grants. No policy, no index, no FK to `places`.

**It is the first migration here where two writers share a column group, and the whole file is
about which one wins.** A rider's pick outranks the geocoder's guess, and `start_place_id` is what
distinguishes them — no flag, no enum. `clear_ride_map_tiles` (rewritten) drops the group when the
text or the pick changes; `protect_picked_ride_location` (new) restores a picked coordinate a
geocode tried to move. **Neither raises**, so on UPDATE a mixed statement is *normalised* rather
than refused, and the coupling CHECK is what catches an INSERT or an UPDATE that fires neither
trigger. Do not read a green mixed UPDATE as the constraint being decorative — the RLS suite
asserts all three mechanisms separately for exactly that reason.

The trap `051` left and this file had to work around: `clear_ride_map_tiles` fired on a
`meeting_point` change and NULLed the location columns **unconditionally**, so one statement
carrying new text *and* a picked coordinate lost the coordinate with no error. Reproduced on DEV in
a rolled-back transaction before the rewrite, and it is why `updateRide` sends all three location
columns in the same statement as the text.

**One residual, stated rather than accepted silently:** a statement supplying a *new* place id but
no new coordinates keeps the row's old coordinates under the new id. Constraint-legal, wrong data,
and undecidable from `OLD`/`NEW` — the app always sends the three together. Recorded in the
migration header.

**`066` is PD-259's and is on BOTH projects — DEV 2026-08-18, PROD 2026-08-19 (#269).** It gives `clubs` its own location —
`location_name`, `location_place_id`, `latitude`, `longitude` — from a picked `public.places` row,
with three CHECKs, two **additive** grants and **no policy, no trigger, no index and no backfill**.

Three things a reader will otherwise reach the wrong conclusion about:

- **There is no foreign key behind `location_place_id`, and that is the decision rather than an
  omission — now load-bearing rather than merely convenient.** `066` wrote it against
  `public.places`, which was reloaded wholesale, so a FK would have blocked every reload for ever
  or silently wiped every club's location on one. **`070` dropped that table**, so the column now
  holds a third party's opaque id (`geoapify:...`) with nothing on our side to point at. It is
  provenance and can dangle; nothing in the database will say so.
- **The grants are additive `grant insert (…)` / `grant update (…)`, NOT a re-stated list.** `045`
  made both verbs column-level on `clubs` and `058` revoked `is_default`; an absolute re-grant
  written from a document rather than from the database is `044`/`046`'s trap, and it fails
  silently. `rls_test.sql` §066 pins both exact lists and asserts `created_at` and `is_default`
  are still unreachable.
- **No policy, and adding one would be the bug.** The columns live on `clubs`, so `001`'s SELECT
  policy already governs them: a private club's location is visible to its members and nobody
  else, for free. A policy here could only widen what is already correct.

The distance filter is deliberately **client-side over the page `getExploreClubs` already
fetches** — tens of rows, no second round trip, no index. `066` §4 names the trigger for moving it
into SQL: a club count that outgrows `CLUBS_PAGE_SIZE`, at which point the question changes from
"sort these fifty" to "find the nearest fifty of five thousand".

**`064` is PD-255's and is on BOTH projects — DEV 2026-08-18, PROD 2026-08-19 (#269).** It adds five nullable columns to
`postcards` — `taken_at`, `taken_at_offset_minutes`, `taken_latitude`, `taken_longitude`,
`taken_location_precision` — with four CHECKs and two absolute grant statements, and **no policy,
no trigger, no index and no backfill**. The specification is
`openspec/changes/capture-photo-time-and-place/`.

Three things about it that a reader will otherwise reach the wrong conclusion about:

- **It issues no UPDATE statement, and that absence IS the mechanism.** `044`, `046` and `062`
  between them made all three verbs column-level on this table, so a column added today arrives
  holding nothing — insert-only costs zero statements, and *touching* UPDATE is `044`/`046`'s trap.
  `rls_test.sql`'s assertion that UPDATE is exactly `caption, club_id, image_path` is the proof and
  must stay green. The consequence is decided rather than discovered: **a rider who published a
  location they regret can only delete the postcard.**
- **`taken_at` is the one column here the client MUST be able to write**, because the value exists
  only in the rider's own file. `044`'s take-the-grant-away instrument is unavailable, so it is
  BOUNDED instead — not in the future (it is the ride Journal's sort key, so PD-163 arrives again
  otherwise) and not before **1995**, the year `DateTimeOriginal` was specified. A `1900` floor,
  which is what the story's first cut proposed, admits both garbage values that actually turn up:
  the epoch-0 placeholder and the 1904 Mac epoch.
- **`taken_at_offset_minutes` exists because resolving a zone-less EXIF timestamp against
  `APP_TIME_ZONE` is broken, and the failure is invisible.** A Helsinki rider's photo taken a
  minute ago resolves to 59 minutes in the future, the CHECK refuses it, and the honest client-side
  response is to drop it — a capture time silently NULL for every zone east of Amsterdam, at
  exactly the window in which people post. The fallback is now the **device's own offset at the
  capture date**, and the offset used is stored, so the camera's wall clock is recoverable exactly.
  It is a column rather than a follow-up because an offset is unrecoverable after the fact, the
  same way EXIF is: deferring does not postpone the cost, it discards the data.

**The privacy model is the part to read before touching any of it.** The composer offers Hide
(default), Region and Precise, and **the mode decides what is UPLOADED, not what is displayed** —
because RLS is row-level, so a policy that lets a rider read the postcard lets them read every
granted column on it, and there is no way to show a photo while hiding where it was taken. Region
rounds to 2 decimal places **in the browser, before the request is built**, and
`postcards_coarse_location_is_rounded` is what makes that claim true against a client this app
does not control. `062`'s reasoning arrives inverted here: a coordinate is comparable *and*
externally resolvable, and unlike `ride_id` the mitigation cannot be a grant — the upload-time
choice is the only line of defence there is.

**One question is open with the product owner and it blocks nothing already merged**, in the
proposal's §Open questions: whether a rider needs to be able to see their own published location
before PD-257 draws one.

**The other was ANSWERED on 2026-08-18 — `Hide` does NOT cover the capture time** (PD-265, product
owner, verbatim: *"Hide does not hide capture time."*). `taken_at` is uploaded under every mode,
the hint string stays scoped to "the photo's location", and the requirement forbidding a wider
string is now **permanent rather than pending an answer** — which is the half most likely to be
misread, since the old wording invited a future session to treat the ban as expiring the day the
question closed.

**`063` is RETIRED by `077` (PD-293) — the trigger, the function and `rides.max_riders` are all
dropped, and the section below is the record of what it did rather than a description of a live
rule.** Product owner decision, 2026-08-24: the design draws no capacity affordance anywhere, so an
enforced cap could only ever reach a rider as an unexplained refusal, and that is worse than no cap.
Nothing in it was wrong; it was solving the wrong half of the problem. It is kept because a session
reading `ride_members` will ask what used to bound it, and because the race it names — a
check-then-insert losing two riders to the last seat — is the reason any future cap must be a
trigger and not a branch in front of the upsert.

**`063` was PD-174's and was on BOTH projects — DEV 2026-08-18, PROD 2026-08-19 (#269).** It hung
`private.enforce_ride_capacity()` on `ride_members` as a `BEFORE INSERT OR UPDATE` trigger, so
`rides.max_riders` finally counts against a crew — it had been enforced by nothing since `001`,
with `018` bounding the value and saying in its own header that it bounded nothing else. Read the
file's header for the four decisions; the two that a reader will otherwise reach the wrong
conclusion about are that it is a **join gate rather than an invariant** (lowering a cap below the
current crew is allowed, evicts nobody, and leaves a legal over-subscribed ride) and that **two
riders are exempt from the count entirely** — anyone who already holds a `ride_members` row, and
the ride's organizer. The first is why a `BEFORE INSERT` trigger can sit under an upsert at all
(`setRideAttendance` upserts, and a `BEFORE INSERT` trigger fires even when the upsert resolves to
an `UPDATE`); the second is why the app can show an organizer on their own ride. **The organizer
exemption is the only way a WRITE TO `ride_members` can push a crew past `max_riders`, and it
adds at most one row.** Note the scope of that sentence: **lowering a cap exceeds it by an
unbounded amount**, which is the headline decision two lines up, so `crew <= max_riders + 1` is
**not** an invariant and a count, a "seats left" figure or an assertion built on it breaks on a ride
whose cap was lowered from 20 to 2 with 6 riders aboard — the exact state the join gate exists to
permit.

**There is no deploy-order constraint**, unlike `021`/`025`. The trigger is additive and the code
change is a message: applied before the deploy, a refused rider gets `setRideAttendance`'s generic
"the ride may no longer be available" instead of "this ride is full"; deployed before the apply,
the new branch is unreachable. Neither breaks anything, so either order was safe — PROD took
it after #269 deployed, which is the order a tightening gets by default.

**Verified by object diff** — `md5(prosrc)` for the function is `0015cff04030bad9d016c3d794d323ba`
(5322 chars) on DEV **and** on the scratch database `run.sh` builds from the file verbatim, with
**exactly one** row for that function name and it in `private` — the schema is what keeps a trigger
function off the PostgREST surface, and the revoke is the second lock rather than the only one, the
same shape `notify_ride_joined` has on this table. **Rebuild
that database before believing a mismatch**: a scratch DB left holding the last mutation test reads
as drift and is not, which cost one round here. `prosecdef` true,
`has_function_privilege` false for both `authenticated` and `anon`, and the trigger reads
`BEFORE INSERT OR UPDATE ... FOR EACH ROW` with no `WHEN` clause. Advisors re-read afterwards:
**ten**, unchanged — the capacity function is `security definer` but holds no client EXECUTE, so it
is not a ninth `authenticated_security_definer_function_executable`, and
`auth_leaked_password_protection` is still the only outstanding one.

**Two defects were found by the `reviewer`-style read of the proposal and fixed before merge**, and
both are worth knowing because the wrong version is the one a reader reaches first. Excluding only
the writer's own row from the count is enough on a ride exactly AT its cap and **not** on one OVER
it, so a lowered cap froze the RSVPs of the crew it had just promised not to evict — the fix is an
EXISTS exemption for anyone already holding a row. And the organizer needed an exemption of their
own: `getRide` renders a host with no `ride_members` row as `going`, so without it the app showed an
organizer on a ride the database refused to let them onto, which `createRide`'s browser-side rollback
makes reachable today. Both have assertions, and both assertions were mutation-tested — reverting
either exemption turns the suite red at the intended line.

**Hand-exercised on DEV before it applied**, per `CLAUDE.md` §Supabase Rules' rule for a trigger on
an already-shipped write path: one transaction, rolled back, covering a join on a capped ride, the
exact upsert `setRideAttendance` issues, a leave, a join on an uncapped ride, `createRide`'s two
statements at `max_riders = 1`, and the refusal on the full ride that made. **No ride on either
project is over its cap** — measured before and after: DEV has 2 capped rides of 6 (1/20 and 2/20),
PROD 1 of 2.


**`062` is PD-166's and is on BOTH projects — DEV 2026-08-17, PROD 2026-08-19 (#269).** It revokes table-level SELECT on
`public.postcards` from `authenticated` and re-grants seven columns — `ride_id` is not among them —
adds `public.ride_journal_postcard_ids(ride uuid)`, the `security definer` accessor the ride Journal
filters through, and **restates the `ride_id` column comment**, because `041` had put the grant
claim it revokes into `pg_description`, which is where this repo states a per-column contract and
where `docs/reference/schema.md` sends its readers. The product owner chose that shape (option A on PD-166, 2026-08-17) over
accepting the channel; `041` had granted the column deliberately, because **Postgres checks a column
privilege to FILTER as well as to return**, so the Journal's `.eq('ride_id', …)` and the correlation
channel wanted the identical grant. `041`'s assertion of that grant is inverted in place in
`rls_test.sql` rather than deleted — it is the record of why the grant existed.

**Nothing deployed reads the column**, so there is no `021`/`025`-style split to sequence:
`POSTCARD_SELECT` dropped it in PD-165 and `columns.test.ts` pins that no query names it. PROD takes
it at the next promotion, and it is safe to apply before or after that deploy either way.

**Verified by object diff, per `CLAUDE.md` §Supabase Rules' rule for a reduced apply** — the header
comments were dropped to pass the file as a string, so `md5(prosrc)` for the accessor is
`aaa5ed13bfd18879df1a4b5fa9a4c38a` on DEV **and** on the scratch database `run.sh` built from the
file verbatim. Grants read back scoped to their grantee: table-level SELECT `false`, `ride_id`
SELECT `false`, `ride_id` INSERT still `true`, `anon` still 0. The `postcards` SELECT policy `qual`
is `c8fb49b026866743283b3d7ecfbc5122`, unmoved — this file changes a grant, not a policy. **The
column comment is covered by the same diff and was added to the file after that first apply**, so it
was applied separately and checked the same way: `md5(col_description('public.postcards'::regclass,
…))` is `a226977205df557336b735bacf661c72` on DEV and on the scratch database. One consequence, named
rather than discovered: DEV's *recorded* statement for `062` is now a statement short of the file.
That is benign — `db:drift` compares names, `CLAUDE.md` §Supabase Rules already calls a
recorded-vs-file mismatch the norm and prescribes comparing the object, and PROD takes the file whole
at promotion. **Its cause is not the usual one and is worth naming**, because `062` *is* also a reduced
apply — the header comments were dropped, two sentences up — and a reduced apply explains a shorter
recorded *text*, never a missing *statement*. This mismatch is the second kind: the `comment on
column` was added to the file **after** the first apply, on a review finding, and applied out of band. Advisors
re-read afterwards: **ten**, the eighth `authenticated_security_definer_function_executable` being
the new accessor, and `auth_leaked_password_protection` still the only outstanding one.

**The accessor returns ids, not rows, and that is the safety argument.** Inside a `security definer`
body the `postcards` SELECT policy does not run, so its visibility filter is a restatement of `011`'s
`qual` — fenced the way `060` fences `can_read_ride`, by pinning that `qual` as whole text under the
accessor's own name. Because it returns ids, the caller still reads the postcards under its own RLS:
a drifted restatement could name an id, never render a row. Ride visibility needs no new
restatement — it is `private.can_read_ride`, already pinned by `060.1`.

**One consequence worth knowing before building a screen:** a "tagged to a ride" badge on a feed
postcard is no longer possible client-side, even on a rider's own postcard. Nothing in the design
draws one; a screen that wants one needs its own accessor.

**`061` is PD-120's and is on BOTH projects — DEV 2026-08-17, PROD 2026-08-19 (#269).** It adds `public.ride_reads` — the
per-ride chat read watermark behind the header dot — with three policies, a `BEFORE INSERT OR
UPDATE` timestamp trigger, and `public.ride_has_unread(uuid)`. Purely **additive**: nothing dropped,
no existing policy altered, no grant revoked, no row touched, so apply-then-deploy is its order and
there is no split to sequence.

**It was verified by object diff rather than by reading the apply back**, which is the check
`CLAUDE.md` §Supabase Rules prescribes for a reduced apply: `md5(string_agg(...))` over
`pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`, `information_schema.columns`, `pg_indexes`
and the grants is `71c0b43b2e3f5d15b048558b4420d4c4` on DEV **and** on a scratch database with the
file applied verbatim by `run.sh`. The one difference before that hash excludes it is the seven
`service_role` grants Supabase adds by default, which is the same fact that makes every grant
assertion in the suite scoped to its grantee. Advisors re-read afterwards: **nine, unchanged**, with
`auth_leaked_password_protection` still the only outstanding one.

**`ride_reads` takes no `enforce_participation_gate` trigger**, following `023`'s reason for
`feed_reads`, so that count stays at ten. The count that does move is the FKs into `profiles`,
16 → 17, and the suite asserts it.

**`060` is PD-211's and is on BOTH projects — DEV 2026-08-17, PROD 2026-08-19 (#269).** It is
**additive** (three new functions, three replaced bodies, no DDL on any table, no policy, no
trigger and no grant to a client role), so apply-then-deploy is its order and either sequence is
safe here because no application code calls any of it.

It repairs both halves of a defect `036` §7.5 named the class of — *"a row nobody can ever read is
worse than no row"* — where two fan-outs addressed recipient sets their subject's SELECT policy
does not resolve:

- **Too wide.** `055`'s crew arm wrote rows to riders who hold a `ride_members` row and cannot
  read the ride. Both routes above are now filtered out at fan-out by
  `private.can_read_ride(candidate, target_ride)`.
- **Too narrow.** `036` §7.5 withheld `ride_created_in_club` from a club owner holding no
  membership row, justified by `private.is_club_member` having no owner arm. `054` gave it one on
  2026-08-12, voiding the premise. `060` unions `clubs.owner_id` in **and** filters the union by
  `can_read_ride`, so the recipient set is measured against the read policy rather than derived
  from a claim about another function's body — which is the drift that produced this story.

**A third helper, `private.can_read_club`, came out of the proposal review and is the finding
worth carrying.** A `ride_created_in_club` row sets **both** `ride_id` and `club_id`, and `036`
§3's conjuncts 4 and 5 test the two subjects independently — so filtering that fan-out on the ride
alone *derives* club-visibility from ride-visibility, which `036` §3 forbids by name. It excludes
nobody today (every candidate is a `club_members` row or `clubs.owner_id`, and `clubs` SELECT has
an arm for each), which is exactly the latency `036` §7.5 was in when it was written. The state
that opens it is nameable: `041` records that `is_club_member` avoids `is_ride_crew`'s gap *"only
because `clubs` carries no block predicate"*, and decision #2's logic argues for adding one — after
which a member blocked with the CLUB OWNER but not the RIDE ORGANIZER passes `can_read_ride`, fails
`clubs` SELECT, and gets a permanently unreadable row. `notify_ride_joined` deliberately does
**not** call it: that type leaves `club_id` NULL, so conjunct 5 is vacuous for it, and the
asymmetry is asserted in both directions.

**The cheap end was refused, and the reason is worth carrying:** giving `rides` SELECT a crew arm
would have dissolved the first half with no fan-out change, and it is wrong twice. A top-level
crew arm sits outside the `not private.is_blocked(auth.uid(), organizer_id)` conjunct, so a rider
who blocked the organizer reads the ride again — decision #2. Put it under the block conjunct and
it closes only the left-the-club route. And **any** crew arm collapses `034`'s `ride_messages`
intersection and `041`'s postcard ride-tag gate into their crew halves, which is the leak `034`
shipped in draft and fixed. `055.7`'s assertion that no crew arm exists is therefore now
load-bearing rather than explanatory.

**`private.is_club_member` is now a one-line wrapper** over
`private.is_club_member_for(candidate, target_club_id)`, which holds `054`'s body. Signature, OID
and grants unchanged, so none of its ten calling policies is recreated or changes meaning; the
split exists so the caller-relative and candidate-relative readings cannot drift. Neither new
helper is executable by `authenticated`, `anon` or `service_role` — `can_read_ride` is a block
oracle and `is_club_member_for` a private-club membership oracle.

**The one behaviour change a rider could notice** is that a suppressed notification is no longer
recoverable: `055` wrote the unreadable row and unblocking revealed it, and there is now no row to
reveal. That matches every other `036` fan-out, each of which suppresses at fan-out when a block
stands (§7.1), and §7.6's rule that a notification records an event at an instant.

**`docs/reference/migrations.md` carries `060`'s rollback, and the order-dependence chain now runs
to three files.** `058`, `059` and `060` each replace `notify_ride_created_in_club`, so they have to
be undone newest-first: following `059`'s rollback line verbatim against a database carrying `060`
re-issues `036` §7.5's body and **silently reverts `060`'s entire repair on that fan-out** while
appearing to undo `059` alone. `create or replace` raises nothing. `060`'s own entry re-issues
`059`'s body rather than `036`'s, for the same reason in the other direction — `036`'s predates the
default-club early return.

**The residual hazard is stated rather than hidden.** `can_read_ride` and `can_read_club` RESTATE
`rides` and `clubs` SELECT, and the first has been rewritten twice (`017`, `022`). The fence is two
assertions — §060.1 and §060.1b pin each `pg_policies.qual` **textually**, matched whole rather than
with `like`, each naming its helper. If either fails, that helper is stale and must be updated in
the same change; re-pinning the string alone silently restores PD-211. A third assertion closes the
step below it, which the review caught: the policy pin says nothing about the helper bodies the
policy text delegates to, so an arm added to the `is_club_member` **wrapper** rather than to
`is_club_member_for` would leave `rides` SELECT's text unchanged, satisfy a substring match, and
make `can_read_ride` silently narrower than the policy — PD-211's own shape. The wrapper's `prosrc`
is therefore pinned by **equality**.

Verified on DEV by object rather than by claim: all six function digests —
`md5(pg_get_functiondef)` and `md5(obj_description)` for `is_club_member`, `is_club_member_for`,
`can_read_ride`, `can_read_club`, `notify_ride_joined` and `notify_ride_created_in_club` —
captured on the local scratch database that applied the **file** and re-read **identically** on
DEV, 6/6. **DEV's recorded statement for `060` is therefore one revision behind its object**, and
that is the `050`/`055` precedent rather than a new case: `can_read_club` and the second fan-out
conjunct arrived after the `apply_migration`, and were re-issued through **`execute_sql`, not a
second `apply_migration`** — the ledger already carries a `060` row and a second is drift of a
worse kind. Compare the object, never the recorded text. That is the
check `CLAUDE.md` §Supabase Rules prescribes for an apply that had to be reduced to its executing
statements, and it is stronger than comparing the text that produced them. Also re-verified on DEV:
zero client-role EXECUTE on either new helper, `authenticated` keeps EXECUTE on `is_club_member`,
the ten calling policies still ten, both fan-outs carry the `can_read_ride` filter, neither body
mentions `auth.uid()`, `059`'s `is_default` early return survived the rewrite, both triggers still
bound with no `when` clause, and advisors still **nine** with no tenth
`authenticated_security_definer_function_executable` — which is the check that proves the two new
definers really are unreachable.


**`056` is PD-226's and is on BOTH projects, applied 2026-08-13.** It relaxes
`profiles_username_format`'s charset to `A-Za-z0-9_` so a username keeps the case the rider
typed, makes `profiles_username_not_reserved` fold with `lower()` — without which `Admin` walks
through a list that was exhaustive only because the charset forced lowercase — and adds
`public.username_exists(text)`, `security invoker` so the availability read keeps running under
the block-aware `profiles` SELECT policy. **`profiles_username_lower_key` is untouched**, so
`003` Q4's impersonation fix stands: `Pedro` and `pedro` still cannot coexist.

Verified by object rather than by row count on **both**: both constraint definitions, the index
still unique on `lower(username)`, `prosecdef` false, `proconfig {search_path=""}`, EXECUTE true
for `authenticated` and false for `anon`, 0 violating rows. Five object digests — `md5(prosrc)`,
the two `pg_get_constraintdef`s, the function comment and `pg_get_indexdef` on
`profiles_username_lower_key` — captured on DEV and re-read identically on PROD, 5/5.
`md5(statements[1])` on PROD equals the file's md5 byte-for-byte minus its trailing newline, so
the hand-transcribed apply carries no drift. Advisors still nine on both, with **no tenth**
`authenticated_security_definer_function_executable`, which is the check that `security invoker`
really survived the transcription. Advisory: DEV's recorded statement no longer equals the file,
because the §Ordering heading was corrected after DEV's apply — a comment outside every `$$`
body, so all five object digests are unchanged. Compare the object, never the recorded text.

**It needed ordering care, and the claim here used to say the opposite.** The charset only widens,
so no *stored row* is ever in violation — that part was right and is why there is no data
migration. But `056` is **additive** (it adds `public.username_exists`), so it is
`docs/ENVIRONMENTS.md`'s apply-**then**-deploy case: new code against the old database does not
compose. Deploy first and `username_exists` is absent, the availability read 42883s behind a
`.then()` with no `.catch()` so nothing renders, and — the rider-visible half — `usernameSchema`
no longer lowercases, so `Pedro` reaches the *old* CHECK, is refused `23514`, and
`src/lib/actions/onboarding.ts` renders **"That username is not available."** for a name that is
free. On the one screen this change exists to fix, with onboarding not skippable (decision #5).

So it was applied to PROD **before** the promotion merged, not after. Behaviour re-proved on PROD
inside a `DO` block that raised to roll back: `PedroCase` stored as typed, every case-variant
refused `23505` by the index rather than `23514` by the charset, `Admin` and `LetsRide` refused
`23514`, `username_exists` true for both `PEDROCASE` and `pedrocase` and false for `pedrocas`, and
true for `my_name` while false for `myXname` — the `_`-as-LIKE-wildcard trap that ruled `.ilike()`
out. 4 rows, 2 named, 0 residue afterwards.

**`ENVIRONMENTS.md`'s numbered steps put the apply at 5 and the `main` merge at 4**, which is the
right order for a *destructive* migration and the wrong one for an additive migration whose code
ships in the same promotion. Read the migration's own §Ordering header, not the step number.

**`057` widens `profiles_username_format` to `^[A-Za-z0-9_]{3,25}$` and is on BOTH projects,
applied 2026-08-14.** Product owner's ask, on a bound `003` simply picked. One number moves: the
charset stays `A-Za-z0-9_` (`056` widened it to ASCII letters and deliberately not to Unicode),
the minimum stays 3, and `profiles_username_lower_key` and `profiles_username_not_reserved` are
untouched — uniqueness still folds and the seventeen reserved names are still compared folded.

**It needed no ordering care, and the reason is worth more than the conclusion**: the old pattern
is a strict *subset* of the new one, so no stored row can be orphaned in either direction and
neither order loses anything. They are still not equally good. Applying first leaves the client
merely stricter than the database — the status quo of every unwidened field in this app.
Deploying first has the client accept 25 while the database refuses `23514`, which
`setUsername` maps to **"That username is not available."** — so a rider is told a free name is
taken, on the one screen onboarding cannot be skipped past, with the live availability check
saying "available" right up to the submit that refuses it. **That is a graceful WRONG answer
rather than a raw error**, and stating it the other way round is what makes a session relax about
ordering: `src/lib/actions/onboarding.ts` has always handled `23505` (the unique index, PD-146's
shape) and `23514` (this CHECK) separately. It was applied first, on both.

Verified by object on **both**: `pg_get_constraintdef` reads
`CHECK (((username IS NULL) OR (username ~ '^[A-Za-z0-9_]{3,25}$'::text)))`, 0 rows violating the
new pattern, `profiles_username_not_reserved` still containing `lower(username) <> ALL`, and
`profiles_username_lower_key` still present. Hand-exercised on DEV as `authenticated` — not as
the owner, for whom the *grant* that carries the rider's own write does not have to exist — in a
`DO` block that raised to roll back: 25 characters accepted and read back, 26 refused `23514`, a
space refused, `Admin` refused, 0 residue.


**`049` and `050` both reached PROD on 2026-08-11**, so the chain is level across both databases
for the first time since `048`. `050` was applied *ahead of* the PROD places load rather than
after it, and that ordering is the point rather than a preference: `050` is the candidate cap,
and **the load is what arms the cost it bounds**. On a loaded table with no `050`, `straat` — one
token, 28.7% of the rows, the most ordinary thing a Dutch rider types — costs 11,458 ms and dies
on the 8 s statement timeout, so a rider gets an error having burned the timeout's worth of a
free tier's CPU. Applying it afterwards would have opened exactly that window.

Neither file changes a table, policy, column or index; both replace one function body.

**PROD's DATABASE is now ahead of `main`, and that is safe for one reason worth stating here
rather than 70 lines down.** `049` and `050` exist only on `development` until the next
promotion, so a replay from `main` would produce `048` against a database running `050`. The
usual argument — "the deployed client already truncates to the same eight tokens" — is *not* what
makes this safe, and it was deleted from this section because its premise (`places` holds 0 rows)
is now false. What makes it safe: **both files only ever narrow or bound `search_places`, and
nothing in `src/` renders a place result at all**, so no deployed code path can observe either
version. Promote normally; do not read the inversion as a reason to hold.

`041`–`046` were applied to PROD on 2026-08-10, on the owner's instruction, in strict filename
order with each digest checked against its file; `047` and `048` followed the same day, DEV first
and PROD after the review pass. The security advisors agreed nine-for-nine across both databases
at that point, and `049` adds none — it is `create or replace` on a function that was already
`security invoker`, which is asserted rather than assumed (`049.4`).

```bash
# via the Supabase MCP: list_migrations on zwprydcyryvudhurbnye and fpmrimzxadewsaiwpsel
#   BOTH at 59 rows ending 059_default_club_fan_out_and_deletion — LEVEL as of
#   2026-08-16.
#   057 applied to both ahead of the code that widens the Zod bound, which is
#   the free-but-preferable order its own header sets out; 056 was applied to
#   PROD ahead of the promotion that deploys ITS code, which is the ordering the
#   section above explains. Everything below describes the earlier PD-201 apply
#   of 051-054 rather than 055's, 056's or 057's:
#   Verified by OBJECT FINGERPRINT, not by trusting the row count: 19 labelled
#   components as md5(string_agg(...)) over pg_get_functiondef, pg_get_triggerdef,
#   pg_policies, information_schema.columns, pg_indexes, pg_constraint, the
#   comments and the grants — captured on DEV, re-run identically on PROD, 19/19.
#   That is the acceptance test for a reduced apply, and it is stronger than
#   comparing the text that produced the objects.
#   051 was reduced by script and NOT hand-transcribed, so PROD's recorded
#   statement for it does not equal md5sum of the file — expected, same class as
#   036-040. 052, 053 and 054 recorded byte-identical, so they carry no drift.
#   The reducer had two tokenizer bugs found before applying: it did not handle
#   double-quoted identifiers, so the apostrophe in the policy name
#   "Organizers read their own rides' render attempts" opened a false string
#   literal and left ~30 comment lines unstripped. Every $$ body was separately
#   proved byte-for-byte against the original, so prosrc is unaltered.
#   051's trigger was hand-exercised on a real PROD ride in a rolled-back
#   transaction: an unrelated column edit LEFT THE TILES INTACT (the WHEN clause
#   scoping correctly), a meeting_point change cleared them, and nothing raised.
#   050 IS on PROD: #179 loaded places into production behind it rather than after
#   it, which is the right order — PROD carries 736,538 places rows, so the
#   candidate cap is guarding a loaded table there, not an empty one. That is
#   still true of PROD and no longer of DEV: 070 dropped the table there, which
#   makes 049/050 dead code on DEV and live code on PROD until the promotion.
ls supabase/migrations/*.sql | wc -l     # 107 — DEV at 107, PROD at 100 (101-107 await promotion)
# ** docs:check verifies the FILE COUNT ONLY. ** Its regex matches the two levels above and
# compares neither, so a stale `DEV at N` passes 42/42 for ever. Read them off list_migrations.
```


**PROD was TWELVE behind and is level again** — `080`–`091` promoted 2026-08-30 around #348's
build. The order they went in is the part worth keeping, because the next gap is ordered the same
way: `080`–`088` and `091` before the build served, every one additive; `090` before it too,
destructive and the one exception in the OTHER direction, its header carrying the check that earns
it — no bundle can observe the object it removes, because nothing in `src/` names the trigger or
its function, no client role ever held EXECUTE on it, and the serving client already degrades
correctly for a `ride_invited` row whose invite is not live; and `089` LAST, after the build was
confirmed serving, on `070`'s footing, because `notificationCopy` and `NotificationsListItem`'s
`describe` are exhaustive switches and one decline landing under an older bundle takes that rider's
notifications screen down. Three carried a reason beyond the ordering rule:

- **`082` renames what `081` creates**, so the reverse errors, and the client calls RPCs that exist
  only after `082` — stopping between them serves `PGRST202` with nothing red.
- **`083` is additive in schema and NOT inert.** It replaces `private.can_read_ride`, which every
  existing notification fan-out calls **inside a rider's own RSVP and ride-creation transaction**,
  so `036`'s hand-exercise gate fires. Run on DEV (six paths, rolled back, green) and again on
  PROD before the promotion, along with `085`'s and `091`'s.
- **`089` hangs a fan-out on the DECLINE path**, which is live, so `036`'s gate fires for it too —
  a raise inside that trigger takes the admin's own decline down with it. Run on both, each time
  against a scratch private club with an ask, a decline and a clear, all rolled back: the decline
  wrote ONE notification whose `actor_id` equals its `user_id`, the requester could read it, the
  admin could not, the clear retracted it, nothing raised, zero residue.
  `088` needed none: three `security definer` RPCs, no trigger and no policy. **`090` needed none
  either, and for the opposite reason to `088`'s** — it hangs nothing on a live write path, it
  REMOVES something from one, so the withdrawal path simply does one thing less inside the
  organizer's transaction. The gate exists for new code running in a rider's transaction; there is
  none.

`083` was applied by CLAUDE.md's reduction technique and proved by object diff rather than by
reading the recorded statement; §Applying a migration too large to pass as a string has the method.

**`055` is PD-129's and is now on both projects.** It replaces one function body —
`private.notify_ride_joined()` — and adds no table, policy, grant or trigger DDL. Both databases
agree on the object, which is the check that matters: `md5(prosrc)` is
`a4c1332fe109aa3c56111794a37aaab2` at **1035 characters** on DEV and PROD, and the function
comment digests agree too. `prosecdef`, an empty `search_path`, and no EXECUTE for `authenticated`
or `anon` all re-verified on PROD. The live RSVP path was exercised on **both** inside rolled-back
transactions — on PROD, two RSVPs wrote three rows, the organizer notified by each, the `maybe`
rider notified by the actor's join, the actor never, nothing raised and zero residue.

**PROD's recorded statement for `055` is a comment-stripped form, and this one was an error rather
than a technique.** The first PROD apply extracted the file's executing statements with a bare
`grep -v '^--'`, which strips the comments **inside** the `$$` body too — the exact thing
`CLAUDE.md` §Supabase Rules says to preserve, because it changes `prosrc`. It was caught
immediately by the digest check (PROD read `98a46c7f…` at 586 characters against DEV's 1035) and
reconciled by re-issuing `create or replace` through **`execute_sql`, not `apply_migration`** —
the ledger already carried a `055` row and a second is drift of a worse kind, which is the `050`
precedent. **The lesson is the digest, not the mistake:** a stripped body is behaviourally
identical and invisible to every other check, so nothing but comparing `md5(prosrc)` across the
two projects would have found it.

**`md5sum` of the file therefore equals neither database's recorded statement for `055`** —
DEV's because a comments-only fix landed after its apply, PROD's for the reason above. That is
the ordinary case rather than a named exception: a reduced recorded statement is the norm for a
large migration on both projects, and `CLAUDE.md` §Supabase Rules carries the query that measures
it instead of a list to check against. Compare the digest of the object, never the recorded text.

**It carried a KNOWN GAP that was asserted rather than latent, and `060` closed it.** `rides`
SELECT holds neither a `ride_members` nor an `is_ride_crew` arm, so *on this crew* and *can see
this ride* are different sets — the crew fan-out wrote some rows `036` §3's resolvability `EXISTS`
then hid. Two measured routes: a rider on a public ride who blocks the organizer, and a rider who
RSVPs to a private club's ride and then leaves the club. `055` deliberately did not narrow the
recipient set, because excluding riders blocked with the organizer closes the first route, misses
the second, and reads as complete. `060` narrowed it properly — see §Migrations, above.

**DEV's recorded statement for `049` is the reduced form** — the file's §1–§4 prose replaced by a
pointer to it, because `apply_migration` takes SQL as a string and the full file is 20 KB of
mostly comment. The *function body* was verified identical rather than eyeballed: `md5(prosrc)`
agrees between DEV and the repo file's `$fn$` block. **Compare the digest, not a length** —
`length(prosrc)` counts **characters** and the body holds 28 multi-byte em dashes, so a
byte-oriented check (`wc -c`) reads 6,802 against a character count of 6,774 and looks like drift
when nothing has drifted. This is the same class of asymmetry
[`docs/reference/migrations.md`](docs/reference/migrations.md) reconciles for `036`–`040`, and it
reads like drift if you compare `md5sum` of the file against `md5(statements[1])`.

**`050`'s applied body had genuinely drifted on DEV, and the digest is what caught it.** Applying
`050` to PROD from the file produced `md5(prosrc) = 1fc795cf…`; DEV read `43d7c861…`. The
difference was 64 characters — one comment line, `-- See §2 for where the resulting imprecision
actually lands.`, absent from the national-pass block — plus a differing function comment. Both
comment-only, so nothing a rider could observe, and precisely the kind of nothing that makes a
digest check useless if left. Reconciled the same day by re-issuing `create or replace` and
`comment on` against DEV **through `execute_sql`, not `apply_migration`**: the ledger already
carries a `050` row, and a second one is drift of a worse kind than the one being fixed. The
cost of that choice — DEV's ledger can no longer reproduce DEV's object — is catalogued where
this repo keeps such things, [`docs/reference/migrations.md`](docs/reference/migrations.md)
§What reads as drift, rather than only here. Both projects now agree, so this is a check that
works rather than one that always disagrees:

```sql
-- expect identical digests on both refs, and both equal to the repo file's $fn$ block
select md5(prosrc), md5(obj_description(oid, 'pg_proc')) from pg_proc
 where oid = 'public.search_places(text,double precision,double precision)'::regprocedure;
--   both: 1fc795cfb8fc6e631c4bab6e056ed89e · 3d03b3859a949834c7f3f387ffb935d2
```

**What the finished apply did not consume is [`docs/reference/migrations.md`](docs/reference/migrations.md)** —
the `041 → 044 → 046` ordering chain and the link in it that fails silently, the rollback SQL for
`042`–`048`, and the hand reconciliation for every recorded statement that disagrees with its file.
Read it before concluding either database has drifted.

## Applying a large file

**Applying a migration too large to pass as a string.** `apply_migration` takes SQL as a string,
so a 61 KB file has to be reduced to its executing statements **preserving comments inside `$$`
bodies** — then **proved by diffing the resulting objects against the database that already has the
file applied correctly**: `md5(string_agg(...))` over `pg_get_functiondef`, `pg_get_triggerdef`,
`pg_policies`, `information_schema.columns`, `pg_indexes` and the grants. **A recorded statement
that does not equal `md5sum` of its file is therefore the NORM for a large migration**, on both
projects, and it reads exactly like drift. Compare the OBJECT, never the recorded text;
§What reads as drift, and why none of it is has the reconciliation SQL.

## Security advisors

**Security advisors: thirty-nine on DEV and thirty-seven on PROD, and only one is outstanding.**
The two-advisor difference is `105`+`106` awaiting promotion — `106` adds none of its own, being
a drop and a create of the same `security definer` name — which is the ordinary shape of a gap —
a one- or two-advisor difference between the projects is almost always a pending promotion, never
a finding on its own. Re-derive
rather than trust the number — `get_advisors(security)`, or, without the payload,

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and has_function_privilege('authenticated', p.oid, 'execute');
```

— but the *shape* is durable, because all but one are things this repo chose, and a bare count
cannot tell a session whether a new WARN is expected:

| Count | Advisor | Why it is there |
|---|---|---|
| 36 on DEV, 34 on PROD | `authenticated_security_definer_function_executable` (WARN) | Every `security definer` RPC in `public` — the onboarding accessors (`021`), the recovery-grant pair (`026`), the moderation and club-management RPCs, the push-device pair (`078`), the ride and club invite RPCs (`083`, `085`, `091`), `introduce_to_club` (`097`), and the two moderation-reversal accessors (`105`, DEV only until it promotes; `106` REPLACES one of them and is net zero here, because the drop and the create cancel). Every one is `security definer` **by design**, and each is narrow on purpose: takes a row id and never a rider id, writes or answers exactly one row for its caller, and has ONE raise site so it cannot be used as an oracle. **This advisor fires once per such function, so a migration adding two adds two**, and a migration whose functions live in `private` adds none, because PostgREST does not publish `private`. Count them off `get_advisors` rather than off this cell |
| 2 | `rls_enabled_no_policy` on `password_reset_grants` and `push_devices` (INFO) | Correct by design: `026` and `078` revoke everything on their table from the client roles, so a policy would be the thing that granted reach |
| 1 | `auth_leaked_password_protection` (WARN) | **The only genuinely outstanding one.** A dashboard click, owner-only |

An unexpected advisor is one **not** in that table. A one-advisor difference between the projects
is almost always a pending promotion.
