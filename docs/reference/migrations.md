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
      ROLLBACK: re-issue private.notify_ride_created_in_club() from 036 §7.5,
                public.complete_onboarding(text) from 058 §3, and
                public.delete_owned_club(uuid) from 043 — verbatim.
```

**`058` and `059` are the first entries here whose rollback is ORDER-DEPENDENT in a way a
`drop` cannot express.** Four function bodies reference `clubs.is_default`, so dropping the column
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

  Both projects, and the file, now agree on the thing that matters:

  ```sql
  select md5(prosrc), md5(obj_description(oid, 'pg_proc')) from pg_proc
   where oid = 'public.search_places(text,double precision,double precision)'::regprocedure;
  -- DEV and PROD both: 1fc795cfb8fc6e631c4bab6e056ed89e · 3d03b3859a949834c7f3f387ffb935d2
  -- and both equal the repo file's $fn$ block (6,744 chars) and its comment string
  ```

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
