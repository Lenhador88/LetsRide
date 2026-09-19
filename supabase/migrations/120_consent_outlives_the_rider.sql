-- 120: the proof that a rider accepted the terms outlives the rider, and
-- carries nothing that points back at them.
--
-- PD-458, answering `add-account-deletion`'s Q4 — open since 2026-08-06, and
-- the last one of that change's four still open.
--
-- ---------------------------------------------------------------------------
-- What is wrong today
-- ---------------------------------------------------------------------------
-- `012` argues at length that `profiles.terms_accepted_at` is evidence, and
-- `030` added `terms_version` so it can say WHAT was agreed and not only when.
-- Both die with the rider: `profiles` cascades from `auth.users`, so the moment
-- an account is deleted there is nothing left saying its owner ever accepted
-- anything. The app actively relies on that assertion — `023` refuses content
-- writes from a rider who has not accepted — so it is not a record we keep for
-- tidiness.
--
-- ---------------------------------------------------------------------------
-- The decision, and it OVERRIDES this change's own design
-- ---------------------------------------------------------------------------
-- Product owner, 2026-09-18: ** keep a de-identified record. **
--
-- ** Design D10 recommended a salted one-way hash of the subject's uuid. That
-- is refused. ** The id space is enumerable from `auth.users`, so a hash is a
-- lookup table away from being the id itself, and holding one is holding an
-- identifier of an account we said we erased. The record keeps the terms
-- version and when it was accepted, and nothing that singles anybody out.
--
-- ** The cost of refusing the hash, stated rather than buried: ** D10 wanted it
-- so the record could confirm or refute ONE named claimant's specific claim
-- when they supplied their own uuid. It can no longer do that. What survives is
-- that a consent to version X existed on day D — an aggregate, not a per-person
-- receipt. The owner chose that trade knowing it, and it is cheap to reverse in
-- either direction.
--
-- ** This is a data-protection posture recommended by a session and accepted by
-- the product owner on that basis, not legal advice. ** If counsel is ever
-- engaged for the Terms page, this goes with it.
--
-- ---------------------------------------------------------------------------
-- Why the count could itself identify, and what this file does about it
-- ---------------------------------------------------------------------------
-- PD-458 asks the build to settle this deliberately rather than shipping a
-- timestamp at full precision. One row per deletion, timestamped to the
-- microsecond, is a join away from `auth.users` at these volumes: a row stamped
-- at the moment an account vanished names that account by correlation, however
-- few columns it has.
--
-- Two answers, both taken:
--
--   * ** The acceptance time is stored as a DATE, not a timestamp. ** Day
--     precision is what the evidence claim actually needs — "this version was
--     accepted on this day" — and it collapses the correlation to everyone who
--     signed up that day.
--   * ** There is no deletion timestamp at all, and this table deliberately has
--     no `created_at`. ** That column is the trap: a `default now()` would
--     record the deletion moment at full precision under a name that reads like
--     bookkeeping, re-introducing exactly the correlation the first answer
--     removes. A row's own insertion time is the one thing this table must not
--     know.
--
-- The residual: the number of rows discloses how many accounts have been
-- deleted, which is not personal data about any of them.

-- ---------------------------------------------------------------------------
-- §1. The table
-- ---------------------------------------------------------------------------
-- In `private`, which is the barrier, and `117`'s `system_alerts` is the
-- precedent for every line of this section. `CLAUDE.md` §Supabase Rules asks a
-- new table to decide whether `service_role` keeps its default grants; a table
-- created in `private` never receives them, because Supabase sets its default
-- privileges on `public`. So this is outside that rule rather than an exception
-- to it, and the same is true of `rls_enabled_no_policy`'s candidate set.
create table private.consent_records (
  id uuid default uuid_generate_v4() primary key,
  -- The document that was agreed to. NULLABLE, and a NULL here is a fact rather
  -- than a gap: `030` ruled out backfilling a version for consents recorded
  -- before the column existed, because a version invented for one of them is a
  -- fabricated evidence record. Those riders' rows say "unknown", honestly.
  terms_version text,
  -- DAY precision, on purpose — see the header. The source is
  -- `profiles.terms_accepted_at`, which `012` made server-owned, so this is not
  -- a value any rider ever chose.
  accepted_on date not null
  -- ** NO created_at, NO deleted_at, NO subject id, NO hash of one. ** Each of
  -- those is a re-identification path and the header says why for each. A
  -- column added here later must answer that first.
);

-- `CLAUDE.md`: every new table gets RLS in the same migration, no exceptions.
-- Belt and braces rather than the barrier, exactly as `117` measured it: `anon`
-- and `authenticated` hold no USAGE on `private` and PostgREST publishes
-- `public` alone, while `service_role` holds USAGE and BYPASSES RLS — so what
-- stops it is the absent table grant below, and a policy here would protect
-- nothing from it.
alter table private.consent_records enable row level security;

-- Absolute rather than a delta, for the same reason `117` gave: nothing in this
-- schema is client-reachable and this file should not depend on a default
-- privilege to keep it that way.
revoke all on table private.consent_records from public, anon, authenticated;

comment on table private.consent_records is
  'One row per DELETED account that had accepted the terms, keeping the version and the day of acceptance after the rider and their profile are gone (120, PD-458, answering add-account-deletion Q4). ** IT HOLDS NO SUBJECT ID AND NO HASH OF ONE, AND THAT REFUSES DESIGN D10 DELIBERATELY ** — the id space is enumerable from auth.users, so a salted hash is a lookup table away from being the id itself. The cost is that this cannot confirm or refute one named claimant''s claim, which is what D10 wanted the hash for; what it can say is that a consent to a version existed on a day. ** THERE IS NO created_at AND THAT IS THE LOAD-BEARING ABSENCE ** — a default now() would record the deletion moment at full precision, and one row per deletion timestamped to the microsecond is a join away from auth.users at these volumes; accepted_on is a DATE for the same reason. The only writer is private.retain_consent_record, a BEFORE DELETE trigger on public.profiles, so it is written by the cascade from auth.users and no deletion path can bypass it — the delete-account Edge Function is not involved and was not changed. A profile with terms_accepted_at NULL writes NOTHING: there was no consent, and a row saying "unknown" would be a fabricated one. terms_version NULL is different and is honest — 030 refused to backfill a version for consents predating the column. RETENTION is indefinite and there is no sweep. Nobody reads this from the app: anon and authenticated hold no USAGE on private, PostgREST publishes public alone, and service_role — which holds USAGE and bypasses RLS — is stopped by the absent table grant, which a table created in private gets by default because Supabase sets its default privileges on public. Read by the table owner at the dashboard.';

-- ---------------------------------------------------------------------------
-- §2. The writer
-- ---------------------------------------------------------------------------
-- A BEFORE DELETE row trigger on `public.profiles`, and the mechanism was
-- measured before it was chosen: a cascading delete performs a real DELETE on
-- the child table and fires its row triggers, verified on DEV inside a
-- rolled-back transaction against a scratch parent/child pair.
--
-- ** Why a trigger and not a step in the Edge Function. ** PD-458 requires that
-- `delete-account`'s re-authentication proof — already verified live — is not
-- disturbed, and a function step can be forgotten, reordered, or bypassed by
-- any other path that deletes a profile. A trigger cannot: `042` revoked the
-- DELETE grant on `profiles`, so the only thing that reaches this table is the
-- cascade from `auth.users` and the table owner. It also needs no redeploy,
-- which is why this migration has no ordering constraint against one.
--
-- SECURITY DEFINER because the role performing the cascade is whatever GoTrue's
-- admin delete runs as, and no role holds INSERT on a table in `private`. The
-- function is in `private`, so it adds no `security definer` advisor of the
-- `public` classes `CLAUDE.md` accounts for.
create or replace function private.retain_consent_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No consent, no record. A row asserting an unknown acceptance would be worse
  -- than no row at all — see the table comment.
  if old.terms_accepted_at is not null then
    insert into private.consent_records (terms_version, accepted_on)
    values (old.terms_version, old.terms_accepted_at::date);
  end if;
  return old;
end;
$$;

comment on function private.retain_consent_record() is
  'BEFORE DELETE on public.profiles: copy the terms version and the DAY of acceptance into private.consent_records, then let the delete proceed (120, PD-458). Writes nothing when terms_accepted_at is NULL. Never writes the subject id, a hash of it, or any time other than the acceptance day — see the table comment for why each of those is refused. security definer because the cascade from auth.users runs as a role holding no INSERT on a table in private; in `private` so it adds no security advisor of the public security-definer classes. A failure here fails the whole deletion, deliberately and for 117''s reason: a silent half-erasure is worse than a retried one.';

create trigger retain_consent_record
  before delete on public.profiles
  for each row
  execute function private.retain_consent_record();

revoke all on function private.retain_consent_record() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- No client role can reach the table, by schema or by grant. Expect f, f, t for
-- the schema and f, f, f for the table:
--
--   select has_schema_privilege('anon', 'private', 'usage'),
--          has_schema_privilege('authenticated', 'private', 'usage'),
--          has_schema_privilege('service_role', 'private', 'usage');
--   select has_table_privilege('anon', 'private.consent_records', 'select'),
--          has_table_privilege('authenticated', 'private.consent_records', 'select'),
--          has_table_privilege('service_role', 'private.consent_records', 'select');
--
-- The trigger exists and fires on DELETE alone — an UPDATE that clears
-- `terms_accepted_at` must write no row, and `012` refuses that update anyway:
--
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid = 'public.profiles'::regclass and not tgisinternal;
