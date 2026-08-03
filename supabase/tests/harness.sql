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

-- Minimal stand-in for the parts of Supabase Storage migration 010's policies
-- touch: the storage.objects metadata row, storage.buckets (only so the
-- bucket-creation insert has somewhere to land), and the one helper function
-- those policies call. Storage's actual file service — the S3-compatible
-- backend and the HTTP API that receives multipart uploads — has no Postgres
-- equivalent and is out of scope: this suite tests RLS on the metadata row,
-- which is the only part of Storage that is actually Postgres.
--
-- storage.foldername's body is copied from Supabase's own definition rather
-- than reinvented, because a policy that calls the real function in
-- production and a differently-behaved stand-in here is worse than no
-- stand-in at all — it is a pass that means nothing.
create schema if not exists storage;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now()
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end;
$$;

grant usage on schema storage to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;

-- Supabase grants broad default privileges on storage.objects to both roles,
-- same as it does in `public` before 002/007 tighten it — RLS is the actual
-- gate, which is exactly what makes "anon cannot read/write storage.objects"
-- a meaningful assertion rather than one that passes for the wrong reason
-- (a missing grant instead of an absent policy). storage.buckets gets no
-- grant: nothing in the app queries it, and 010 writes to it only once, as
-- the migration role, which bypasses RLS/grants entirely — same as every
-- other migration in this chain.
grant select, insert, update, delete on storage.objects to anon, authenticated;

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

-- Runs the statement and requires it to be refused by a specific SQLSTATE.
-- Distinct from assert_denied, which only recognises an RLS refusal (42501):
-- constraints and trigger guards raise 23514 / 23505, and a test that accepted
-- "any error" would pass when the wrong rule fired. Naming the SQLSTATE is what
-- makes "rejected by the charset check" different from "rejected as a duplicate".
create or replace function assert_rejected(stmt text, expected_sqlstate text, label text)
returns void
language plpgsql
as $$
begin
  begin
    execute stmt;
  exception
    when others then
      if sqlstate = expected_sqlstate then
        raise notice 'ok    % (rejected %)', label, sqlstate;
        return;
      end if;
      raise exception 'FAIL  % — expected SQLSTATE %, got %: %', label, expected_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  % — expected the statement to be rejected, but it succeeded', label;
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
