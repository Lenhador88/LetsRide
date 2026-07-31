-- Stand-in for the parts of Supabase the migrations depend on, so the policy
-- suite can run against a plain Postgres instance in CI.
--
-- Fidelity matters more than convenience here. An earlier version of this
-- harness did not reproduce Supabase's default grants, so a migration that
-- revoked execute from PUBLIC passed locally and was still callable in
-- production. Anything this file gets wrong is a bug the suite cannot see.

create schema if not exists auth;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Supabase derives this from the request JWT. Here it reads a session setting
-- so a test can switch identity with set_config('test.uid', ...).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

-- Roles are cluster-wide, so they may already exist from a previous run.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  -- Stands in for supabase_auth_admin: the role that inserts into auth.users
  -- during signup, and therefore fires the handle_new_user trigger.
  if not exists (select 1 from pg_roles where rolname = 'auth_admin') then
    create role auth_admin nologin;
  end if;
end
$$;

grant usage on schema auth to auth_admin;
grant insert, select on auth.users to auth_admin;
grant usage on schema public to anon, authenticated;

-- Supabase lets both roles resolve auth.uid(); the RLS policies call it on
-- every query, so without this the suite fails for a reason production does
-- not have.
grant usage on schema auth to anon, authenticated;

-- Supabase grants anon and authenticated broad privileges in `public`, including
-- execute on functions. Reproducing that is what makes a revoke test meaningful:
-- an explicit grant needs an explicit revoke, and without these lines a test
-- asserting "anon cannot call this" passes for the wrong reason.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;

-- Assertions. Each raises on failure, so psql -v ON_ERROR_STOP=1 turns any
-- failure into a non-zero exit for CI. All are security invoker, so they
-- evaluate under the role the test has assumed and RLS applies normally.

create or replace function assert_eq(actual anyelement, expected anyelement, label text)
returns void
language plpgsql
as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  % — expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end;
$$;

-- Runs the statement and requires it to be refused by RLS.
create or replace function assert_denied(stmt text, label text)
returns void
language plpgsql
as $$
begin
  begin
    execute stmt;
  exception
    when insufficient_privilege then
      raise notice 'ok    % (denied)', label;
      return;
    when others then
      raise exception 'FAIL  % — expected an RLS denial, got %: %', label, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  % — expected an RLS denial, but the statement succeeded', label;
end;
$$;

-- Runs the statement, requires it to succeed, then unwinds the subtransaction so
-- the write leaves no trace for later assertions.
create or replace function assert_allowed(stmt text, label text)
returns void
language plpgsql
as $$
declare
  undo constant text := 'assert_allowed_undo';
begin
  begin
    execute stmt;
    raise exception using errcode = 'P0001', message = undo;
  exception
    when others then
      if sqlerrm = undo then
        raise notice 'ok    % (allowed)', label;
        return;
      end if;
      raise exception 'FAIL  % — expected the statement to be allowed, but it errored: %', label, sqlerrm;
  end;
end;
$$;
