# Design — act on postcard reports

Every measurement in this file was taken against **DEV (`fpmrimzxadewsaiwpsel`) on
2026-08-24**, in a rolled-back transaction where it required creating anything. Re-derive
rather than trust: each one carries the query that produced it.

---

## D1 — The read surface lives in `private`, and this is the decision the change turns on

**The owner's constraint:** *"reachable only by the project owner's dashboard connection
(`postgres`), never by `anon`, `authenticated` or `service_role` via PostgREST."*

**The naive implementation of that constraint does the opposite.** A view created in `public`
by a migration is born with a full grant to `authenticated` and `service_role`, because
Supabase installs default privileges on that schema and a migration runs as `postgres`.
Measured, then rolled back:

```sql
do $$ declare v text; begin
  create view public.__acl_probe_pd297 as select 1 as x;
  select relacl::text into v from pg_class where relname = '__acl_probe_pd297';
  raise exception 'PROBE view=% creator=%', v, current_user;
end $$;
-- PROBE view={postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,
--             service_role=arwdDxtm/postgres} creator=postgres
```

`arwdDxtm` includes `r` — SELECT. The source of it is `pg_default_acl`, which carries **two**
entries for schema `public`, one per creating role:

```sql
select pg_get_userbyid(defaclrole), nspname, defaclobjtype, defaclacl::text
  from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace;
-- postgres      | public | r | {postgres=…,authenticated=…,service_role=…}
-- supabase_admin| public | r | {postgres=…,anon=…,authenticated=…,service_role=…}
```

Note the asymmetry: the `postgres` entry omits `anon`, the `supabase_admin` entry does not.
So `anon` escapes by luck of which role runs the migration, which is not a safety property
worth relying on.

Three things then compound:

1. **PostgREST publishes `public`.** The view is an endpoint the moment it exists.
2. **`security_invoker` defaults to `false`.** The view executes as its owner, `postgres`, and
   `postgres` has `rolbypassrls = true` (`select rolname, rolbypassrls from pg_roles`). So the
   view reads *through* every RLS policy in the system.
3. **That is exactly what the view is for.** Triage has to see reports the reporter filed and
   postcards in clubs the owner is not a member of. The bypass is the feature; the reachability
   is the defect.

Put together: `create view public.postcard_reports_triage as select … from postcard_reports
join postcards join profiles` publishes, to every signed-in rider holding the publishable key
already in the bundle, **every report, the identity of every reporter, and the caption and
image path of every reported postcard — including private-club postcards they are not a member
of, postcards they have hidden, and postcards by riders who have blocked them.** It is a
one-line migration and it would pass CI, because `openspec/` and `supabase/tests/` cannot see a
grant that a default privilege installed.

**`private` inverts every one of those three.** Measured, same session, rolled back:

```sql
do $$ declare v text; begin
  create view private.__acl_probe_pd297 as select 1 as x;
  select coalesce(relacl::text,'NULL (owner-only)') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname = '__acl_probe_pd297' and n.nspname = 'private';
  raise exception 'PRIVATE VIEW ACL=%', v;
end $$;
-- PRIVATE VIEW ACL=NULL (owner-only)
```

`pg_default_acl` has **no row for `private` at all**, so an object created there is born with
`relacl = NULL`: the owner and nobody else. And the schema itself is already narrow:

```sql
select nspname, nspacl::text from pg_namespace where nspname in ('public','private');
-- public  | {…,anon=U/…,authenticated=U/…,service_role=U/…}
-- private | {postgres=UC/postgres,service_role=U/postgres}
```

`anon` and `authenticated` hold **no USAGE on `private`**. `service_role` does — `031` granted
it so the deletion function could resolve its worker, and `rls_test.sql:4171` asserts exactly
that, correcting `052`'s verification block which claimed otherwise.

So the barriers, counted honestly per role:

| Role | Schema USAGE | Object privilege | PostgREST route | Barriers |
|---|---|---|---|---|
| `anon` | no | no | no | 3 |
| `authenticated` | no | no | no | 3 |
| `service_role` | **yes** | no | no | 2 |
| `postgres` (dashboard) | yes | owner | n/a | reaches it |

**The explicit `revoke all … from anon, authenticated, service_role` is written anyway**, on
every object this change creates, even though all three are already born without the grant. It
costs three lines and it is the layer that survives someone running `alter default privileges
in schema private …` in a future migration. `011` §5 makes the same argument for its tables:
the grant is the layer that holds when a policy is written too permissively.

**`private` currently holds zero tables and zero views** — only functions
(`select relkind, count(*) from pg_class … where nspname='private'` returns rows for `f` only).
This change introduces the first of each, which is why the placement gets a full argument
rather than a citation.

---

## D2 — The view bypasses RLS on purpose, and that is stated rather than hidden

`security_invoker` is left at its default (`false`), so the view runs as `postgres` and sees
every row. Setting `security_invoker = true` would be worse in a way that is easy to get
backwards: the invoker *is* `postgres`, who has `BYPASSRLS`, so it would change nothing about
what the dashboard sees — while suggesting to the next reader that the view is RLS-constrained
when it is not.

The honest framing, and it belongs in the migration header: **this view is a deliberate
RLS bypass, and the only thing standing between it and every rider is that no PostgREST role
can reach it.** Negative case 4 in the proposal is that sentence turned into an assertion.

---

## D3 — What the view exposes, and what it deliberately does not

Triage needs to answer three questions: what was reported, by how many people, and is this
rider a repeat subject. Everything beyond that is data minimisation.

**In:** report id, `created_at`, `reason`, `note`, `reporter_id` (uuid only), `postcard_id`,
the postcard's `author_id`, the author's `username`, `caption`, `image_path`, `club_id`, the
postcard's `created_at`, a per-postcard report count and distinct-reason list, and a count of
prior take-downs against the same author (joined from the ledger, D5).

**Out, and each for a reason:**

- **`auth.users` in any form.** No email, no sign-in metadata, no confirmation state. The
  reported rider is a uuid plus a username. Nothing in triage needs an email address, and a
  view that joined `auth.users` would put one behind an object whose whole defence is that it
  is unreachable — defence in depth means not putting it there in the first place.
- **The reporter's username or profile.** A uuid is enough to see "the same rider filed six of
  these"; a name is not needed to look at a photo and decide. `postcard_reports_one_per_rider`
  already caps one report per rider per postcard, so brigading shows up as distinct uuids.
- **The reporter's own note being attributed on screen to a named person.** Same reason.

`image_path` is **required**, not optional: it is the only way to find the Storage object that
the take-down cannot delete (D7).

---

## D4 — The take-down is `security invoker`, and this deviates from the issue

The issue names `public.moderate_comment` (`011` §1b) as the precedent. **The narrowness is
adopted; the `security definer` is not, and the reason matters.**

`moderate_comment` is `security definer` because *a rider calls it* and the rider cannot read
the row their action depends on — a comment by someone they blocked. The authorization is not
weakened, it is moved: `p.author_id = auth.uid()` inside the function is the entire grant.

Neither half is true here. The caller is `postgres` at the dashboard, who **owns the tables and
already has `BYPASSRLS`**, so there is nothing to escalate to. `security definer` would add a
standing escalation that buys nothing today and becomes a live hazard the moment someone
widens the EXECUTE grant — which is precisely the failure `029` shipped in the other direction
and `031` had to repair. A `security invoker` function in `private`, owner-only, can only ever
do what its caller could already do by hand.

**What is adopted from the precedent, exactly:**

- It takes **one `uuid`** and deletes **one row** from **one table**, named literally.
- It returns what it did rather than succeeding silently, so "the id was wrong" is
  distinguishable from "it worked".
- `set search_path = ''` and every name schema-qualified, per `005`.
- `revoke all … from public, anon, authenticated, service_role`, written explicitly even though
  the object is born owner-only.

**Why it is a function at all, rather than the owner typing `delete from postcards where id =
…`:** the ledger write (D5) and the delete must be one transaction, and a hand-typed `delete`
is one keystroke away from a missing `where` clause. A function that names its own `where` is
the narrow-by-construction version of the same operation.

---

## D5 — The cascade STAYS, and an append-only ledger is what survives

`011`'s header records the gap: `postcard_reports.postcard_id` is `ON DELETE CASCADE`, so
deleting a reported postcard erases the reports about it, destroying repeat-offender evidence.
`rls_test.sql:1687` already asserts the cascade happens and its label says so.

**Decision: keep the cascade. Add a ledger.** Both halves are deliberate.

**Keeping the cascade** because a report is a complaint *about a piece of content*, and once
the content is gone the complaint has no subject. Retaining reports that point at nothing means
retaining a reporter's identity, their free-text note and a dangling uuid indefinitely, for no
purpose anyone can state — which is the shape of a data-protection finding, not of good
evidence. The alternative considered and rejected: `on delete set null` plus a denormalised
snapshot on every report row, which preserves each reporter's note but multiplies the retained
personal data by the number of reporters and needs its own retention answer per row.

**Adding the ledger** because "we removed it" is the fact a store reviewer, a repeat-offender
judgement and the owner's own next triage session all need, and it is exactly the fact the
cascade destroys. One append-only table in `private`:

- `postcard_id`, `author_id`, the `caption` and `image_path` snapshot, the postcard's
  `created_at`
- `report_count` and the distinct `reasons` at the moment of removal
- `acted_at`, and a free-text `note` from whoever acted
- **no `reporter_id`** — the ledger records what was removed and why, not who complained. The
  reporters' rows cascade away with the postcard and that is the point.

Written by the take-down function in the same transaction as the delete, *before* it, so a
failed delete rolls the ledger row back with it.

**Append-only is enforced the way `011` enforces it on reports**: no UPDATE and no DELETE
grant to anyone but the owner, and the object born owner-only in `private` means that is the
default state rather than something to remember.

---

## D6 — Retention, because the ledger holds personal data

The ledger holds a caption (the rider's own words), an image path (which encodes their uuid)
and their author id. That is personal data and it needs a window stated at creation, not later.

**Default: 24 months from `acted_at`.** Long enough that a rider removed twice a year apart is
visible as a pattern; short enough to defend as proportionate to the purpose.

**Nothing enforces it on a schedule.** This repo has taken no decision on `pg_cron`, and
inventing one inside a moderation story is exactly the scope creep the issue warns against. So
the window is:

- **stated in the table comment**, where the next session reads it,
- **written into the runbook** as a step the owner performs,
- **listed as Q3** so the owner can set a different number or ask for a mechanism.

A retention rule with no mechanism is weaker than one with, and it is stronger than the silence
that a GPS track with no expiry gets. Stating it is what makes the gap visible.

---

## D7 — SQL cannot delete the photo, and the privacy page has already promised it goes

`/legal/privacy` now tells riders: *"Removing a postcard removes its photo, its comments and
its likes with it."* The comments and likes are true — `011` cascades both, and
`rls_test.sql:1680` asserts it. **The photo is not.**

Two independent facts, both already in the repo:

1. `011` §6 and `rls_test.sql:1692`: deleting the postcards row leaves the Storage object at
   `image_path` in place — *"but the Storage object survives — deletePostcard must remove it in
   the same request"*. Postgres and Storage are two systems with no foreign key between them.
2. `scripts/storage/sweep-orphans.mjs`'s header, measured when that script was written:
   `delete from storage.objects` is refused by Supabase's own guard —
   `42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.`

So **no migration, function or trigger this change can write is able to remove the photo.** And
the existing sweeper is not the escape hatch: it signs in *as one rider* and `010` scopes the
DELETE grant to that rider's own `postcards/<uid>/` folder, so it structurally cannot clean up
another rider's object — which is every take-down.

**Therefore the take-down is a documented two-step procedure, and the change owns making step
two findable rather than hoping:**

- Step one is the function: the row goes, the cascades fire, the ledger records `image_path`.
- Step two is the owner deleting that object through the dashboard's Storage browser (or the
  Storage API), which is the only path Supabase permits.
- **`private.postcard_takedowns_pending_photo`** — a second view joining the ledger to
  `storage.objects` and listing every take-down whose object still exists. That turns step two
  from a promise into a list that is empty or is not, and it is what a reviewer can be shown.

The alternative — leaving the object and calling it acceptable because riders cannot reach it
(`010`'s SELECT policy resolves through a postcards row that no longer exists) — is rejected on
two grounds: the published copy says the photo goes, and "unreachable" is not "removed" for the
content 1.2 is actually about.

---

## D8 — Which assertions the local suite can make, and which it cannot

`supabase/tests/` runs on plain Postgres as the table owner. `031`'s lesson is that an
assertion must name a **role** rather than merely call the thing. There is a second, opposite
trap here, and the suite already documents it in two places
(`rls_test.sql:6616` and `:8772`):

> *harness.sql creates `service_role` but deliberately grants it no table privileges … So
> `has_table_privilege('service_role', …)` is false on this database by design and true on the
> hosted one, and asserting it here would fail for an environment reason rather than a real
> one.*

So the split for this change:

**Assertable locally, and meaningfully** — the harness reproduces Supabase's default with
`alter default privileges in schema public grant all on tables to anon, authenticated`
(`harness.sql:212`), which covers views, so a missing revoke would really show up:

- `has_schema_privilege('anon'|'authenticated', 'private', 'usage')` is false.
- `has_table_privilege('anon'|'authenticated', 'private.<view>', 'select')` is false.
- `has_function_privilege('anon'|'authenticated', 'private.<takedown>(uuid)', 'execute')` is
  false.
- The take-down, called as the owner, removes exactly one postcard and leaves every other row
  standing — asserted by counting the *survivors*, not the deletion.
- The ledger row exists after the take-down and the reports are gone — the cascade and the
  evidence decision, both asserted.
- Every existing `postcard_reports` assertion still passes, unchanged.

**Not assertable locally, and must be verified against DEV after applying** — the precedent is
`042` §Verification item 1 and `047` §Verification step 2, both of which did exactly this:

- `has_table_privilege('service_role', 'private.<view>', 'select')` is false.
- `has_table_privilege('service_role', 'public.postcard_reports', 'select')` is false after D9.
- The PostgREST route: `GET /rest/v1/<view>` with the publishable key and with a real rider's
  JWT both return 404/PGRST205, not a row.

**The anti-vacuity check.** `047` proved its harness still granted what it was testing the
revoke of, by creating a fresh table and reading what the default handed it. This change needs
the same for **views specifically**, because the assertion "authenticated cannot select this
view" is worthless if the harness never grants on views: create a throwaway view in `public`,
assert `authenticated` inherits SELECT on it, drop it. Without that, every negative in the list
above passes on a database where the grant never existed.

---

## D9 — `service_role` already reads every report, and this is where that gets noticed

The owner's constraint says the read path must never be reachable by `service_role`. Measured
on DEV, the **base table** already is:

```sql
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema='public' and table_name='postcard_reports';
-- authenticated | INSERT, SELECT
-- service_role  | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
-- postgres      | (all seven)
```

`011` §5 revoked from `anon, authenticated` and never named `service_role`, so Supabase's
default stands. `service_role` also has `rolbypassrls = true`, so RLS is not a second line here
— the grant is the only line, and it is wide open.

Practically the exposure is small: the service-role key exists in exactly one place, the
`delete-account` Edge Function's secret store. But "the report table is owner-only" is the
sentence this change is being built to make true, and it is not true while that grant stands.

**Recommendation: revoke it, narrowly.** Two checks make this safe rather than brave:

1. **`delete-account` does not touch the table.** `grep` over
   `supabase/functions/delete-account/index.ts` finds no `postcard_reports` and no direct
   delete against it; it calls `auth.admin.deleteUser` and lists/removes Storage objects.
2. **The cascade does not consult privileges.** A referential action runs as the constraint's
   owner, which the suite already asserts for the analogous `042` revoke:
   *"a referential action does not consult table privileges at all — so revoking a grant cannot
   reach it"* (`rls_test.sql:6609`), exercised end to end rather than reasoned about. The same
   assertion shape is owed here for `postcard_reports`.

This is Q5, isolated in its own task group. If the owner would rather leave `service_role`
alone, drop that group; nothing else in the change depends on it.

---

## D10 — What this change does not attempt, recorded so it is not re-argued

- **Notifying anyone that a report arrived.** Email delivery beyond Supabase's auth mails is on
  `CLAUDE.md`'s deliberately-undecided list, and push is not built. This is Q1 and it is the
  part of PD-297 a migration cannot close — see the objection in the report.
- **An in-app admin screen, an admin role, or a moderator claim.** Explicitly out of scope.
- **A report *status* — triaged, dismissed, actioned.** It would need UPDATE on
  `postcard_reports`, which `011` deliberately grants to nobody and argues for at length. The
  ledger records the actions taken; a dismissal leaves no row, and the owner's daily pass is
  ordered by `created_at`. If dismissals need to be recorded, that is a second ledger kind and
  a separate decision.
- **Removing a *rider* rather than a postcard.** Account termination for abuse is a different
  story with a different blast radius (`029`'s club transfer, six Storage folders, the
  cascade). Nothing here approaches it.
