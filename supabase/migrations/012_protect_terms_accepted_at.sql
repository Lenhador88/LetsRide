-- 012: The consent stamp stops being client-owned.
--
-- ###########################################################################
-- NOT YET APPLIED TO THE HOSTED PROJECT. Written 2026-08-04; the session that
-- wrote it could not apply it (the Supabase write tool required an approval it
-- did not have). It is verified against the migration chain by the RLS suite,
-- which applies 001-012 to a scratch database on every PR, but the hosted
-- schema and this repo currently DISAGREE.
--
-- Apply it before adding 013 — a queue of unapplied migrations fails in the
-- order nobody tested. Check first, do not trust this line:
--   mcp__Supabase__list_migrations vs `ls supabase/migrations/`
-- ###########################################################################
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- CLAUDE.md names three integrity rules the client must not own: username
-- charset, the onboarding completion stamp, and T&C acceptance. 003 delivered
-- the first two and left the third writable — `profiles.terms_accepted_at` sits
-- on a row covered by "Users can update their own profile", so a rider could
-- PATCH it to null or back-date it with one hand-rolled PostgREST call.
--
-- That matters because the column is evidence. It is the record that a specific
-- rider accepted specific terms at a specific time, and evidence a party can
-- rewrite is not evidence. Nothing in the app reads it yet, which is exactly
-- why this is cheap to fix now and expensive to fix once it is relied upon.
--
-- Recorded as "Open, needing a decision" in docs/HANDOFF.md since the login
-- epic. This is that decision.
--
-- ---------------------------------------------------------------------------
-- What this does
-- ---------------------------------------------------------------------------
-- Two rules, both inside the existing BEFORE UPDATE trigger:
--
--   a) Once set, the stamp is pinned. Clearing it or moving it is silently
--      reverted, the same one-way door 003 gave onboarding_completed_at.
--   b) On the first write, the value is *replaced* with server time, so a
--      back-dated first write is impossible rather than merely reverted.
--
-- KNOWN LIMIT, and it belongs next to (b) rather than in a footnote: this is a
-- BEFORE **UPDATE** trigger, and 002's "Users can insert their own profile"
-- policy still exists. Nothing fires on the INSERT path. That is unreachable
-- today only because `handle_new_user` guarantees the row already exists, so a
-- rider's own INSERT dies on 23505 — not because anything checks. The day an
-- account-deletion flow removes a `profiles` row without its `auth.users` row
-- (Trust & Safety has "delete account" on the roadmap), that rider can insert a
-- fresh row with any consent timestamp they like. Adding a BEFORE INSERT arm is
-- small, but it needs a TG_OP guard (`old` does not exist on INSERT) and an
-- assertion that cannot currently be written against a path 23505 blocks, so it
-- is left as a deliberate follow-up rather than shipped untested.
--
-- (b) is the part worth noticing. Pinning alone would let the very first write
-- claim any timestamp it liked, which is the same hole in a different place.
--
-- ORDER IS LOAD-BEARING. The consent block sits *above* the existing
-- `old.onboarding_completed_at is not null` branch, which returns early. Below
-- it, the guard would never run for an onboarded rider — that is, for every
-- rider who has finished the wizard, which is the entire population this is
-- meant to protect. Asserted directly in the suite.
--
-- ---------------------------------------------------------------------------
-- Why the function keeps its name
-- ---------------------------------------------------------------------------
-- `enforce_onboarding_completion()` now guards a stamp that is not the
-- onboarding one, so the name is narrower than the behaviour. Renaming it means
-- dropping and recreating a live trigger on `profiles` and editing three
-- documents, in exchange for a better name on a function nobody calls by hand.
-- Kept deliberately, and recorded here rather than left for someone to discover
-- and "tidy" — the comment on the function carries both responsibilities.
--
-- No policy changes here, so no policy assertions are added; the two behavioural
-- assertions live in supabase/tests/rls_test.sql under the consent heading.

create or replace function public.enforce_onboarding_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Everything below is a rule about what the *client* may write. The seed, the
  -- signup trigger and any future admin task run as other roles and pass
  -- straight through, which is what keeps this fixable from the dashboard.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if old.terms_accepted_at is not null then
    -- One-way, exactly like completion below: consent already given cannot be
    -- withdrawn by rewriting the record of it. Withdrawing consent is a real
    -- product action and would be a deletion flow, not a null.
    new.terms_accepted_at := old.terms_accepted_at;
  elsif new.terms_accepted_at is not null then
    -- First acceptance: the client says *that* it accepted, the server says
    -- *when*. src/lib/actions/auth.ts sends its own ISO string; it is discarded
    -- here on purpose, so the two do not have to be trusted to agree.
    new.terms_accepted_at := pg_catalog.now();
  end if;

  if old.onboarding_completed_at is not null then
    new.onboarding_completed_at := old.onboarding_completed_at;
    return new;
  end if;

  if new.onboarding_completed_at is not null
     and (new.username is null or new.location is null) then
    raise exception 'onboarding cannot be completed before username and location are set'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_onboarding_completion() is
  'Guards the two profile stamps the client must not own (CLAUDE.md): onboarding_completed_at cannot be claimed early, cleared or back-dated (003), and terms_accepted_at is server-stamped on first write and immutable thereafter (012). Named for the first only; see 012.';

comment on column public.profiles.terms_accepted_at is
  'When this rider accepted the T&C. Server-stamped and immutable under the authenticated role (012) — the client cannot choose, move or clear it.';

-- ---------------------------------------------------------------------------
-- Verification (run against the hosted project after apply)
-- ---------------------------------------------------------------------------
-- As a rider whose stamp is already set, all three must hold:
--
--   update profiles set terms_accepted_at = null where id = auth.uid();
--   -- -> succeeds as a statement, value unchanged
--
--   update profiles set terms_accepted_at = '2020-01-01' where id = auth.uid();
--   -- -> succeeds as a statement, value unchanged
--
--   update profiles set bio = 'x' where id = auth.uid();
--   -- -> bio changes, terms_accepted_at unchanged
--
-- And on a row where it is null, setting it must land on server time rather
-- than on the value sent. The equivalents are asserted in the RLS suite, which
-- runs the whole chain against a scratch database on every PR.
