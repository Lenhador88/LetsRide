-- 128: a rider who has accepted the terms may search for a place — the town
-- step's lookup works again. Found by PD-477's proposal review.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, MEASURED ON DEV 2026-09-22
-- ---------------------------------------------------------------------------
-- `069` hung `enforce_participation_gate` on `place_search_attempts`, and the
-- `search-places` proxy writes that ledger row BEFORE it calls the vendor. The
-- gate reads `private.may_participate()`, which requires BOTH stamps —
-- `terms_accepted_at` AND `onboarding_completed_at`.
--
-- PD-445 then put a town typeahead on `/onboarding/town`, the wizard's LAST
-- step, whose submit (`setHomeTown`) is what writes the completion stamp. So
-- the rider on that step can never hold it, every lookup there is refused, and
-- the step falls through to its country select every time:
--
--   consented, not onboarded  insert into place_search_attempts
--                             -> 23514 "complete onboarding and accept the terms
--                                before writing to place_search_attempts"
--   onboarded                 -> allowed
--
-- (Both as `authenticated`, in a rolled-back transaction, against two DEV
-- accounts.) Every rider onboarded since PD-445 finished with a country and no
-- town, and PD-477's *Use my current location* would have been refused the same
-- way.
--
-- ---------------------------------------------------------------------------
-- WHY CONSENT IS THE RIGHT GATE HERE, AND NOT A LOOSENING OF DECISION #5
-- ---------------------------------------------------------------------------
-- `069`'s own reason for the gate was consent: "A rider who has not accepted
-- the terms must not be able to spend our vendor budget." It was written when
-- no wizard step searched, so the stricter two-stamp gate cost nothing.
-- Decision #5 says an incomplete rider is held in the wizard and `023` refuses
-- their CONTENT writes. This row is not content — it records THAT a rider
-- searched, never what — and the only search an incomplete rider can reach is
-- the wizard's own town step. The per-rider and application-wide ceilings in
-- `069`'s INSERT policy are untouched and still bind this rider.
--
-- So this ledger moves from the participation gate to a CONSENT gate. Every
-- other gated table keeps `enforce_participation_gate` exactly as it is; the
-- shared function is not edited.
--
-- ---------------------------------------------------------------------------
-- ORDERING — none
-- ---------------------------------------------------------------------------
-- It only widens who may insert, and no bundle's code changes with it. It is
-- safe on either side of any deploy.

-- --- §1  The consent gate -------------------------------------------------
-- `security definer` so it can read `profiles` whatever the caller's grants,
-- `search_path` pinned empty, and no EXECUTE for any client role — the shape
-- `069`'s other trigger functions take. The `current_user` test lives in the
-- trigger's WHEN clause, never here: inside a definer body `current_user` is the
-- owner (`023` §2).
create or replace function public.enforce_consent_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.terms_accepted_at is not null
  ) then
    raise exception 'accept the terms before writing to %', tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_consent_gate() is
  'T&C consent alone, for place_search_attempts only (128). The participation gate (023) also requires the onboarding stamp, which the wizard''s town step cannot hold — it is the step that writes it. Raises 23514 like the participation gate, so search-places'' `forbidden` mapping is unchanged.';

revoke all on function public.enforce_consent_gate() from public, anon, authenticated;

-- --- §2  Swap the ledger's trigger ----------------------------------------
drop trigger if exists enforce_participation_gate on public.place_search_attempts;
create trigger enforce_consent_gate
  before insert on public.place_search_attempts
  for each row when (current_user = 'authenticated')
  execute function public.enforce_consent_gate();

-- --- §3  The shared function's comment, restamped from the trigger count ---
-- `docs/reference/schema.md` §The participation gate: read the count, never
-- the comment. Twenty-four before this file, twenty-three after it.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, one BEFORE INSERT trigger per gated table — twenty-three since 128 moved place_search_attempts to enforce_consent_gate. Count pg_trigger rather than this string (docs/reference/schema.md §The participation gate).';
