-- 106 — The hidden list cannot detect a block (PD-298)
-- ===========================================================================
--
-- Supersedes `105`'s `public.my_hidden_postcards`. Proposal:
-- openspec/changes/undo-a-block-or-a-hide/, `design.md` D4 — REWRITTEN by this
-- change, because the mitigation D4 adopted does not hold.
--
-- ---------------------------------------------------------------------------
-- THE PROPERTY THIS FUNCTION HAS, AND WHY IT IS THE WHOLE POINT
-- ---------------------------------------------------------------------------
-- ** NOTHING IN A RETURNED ROW MAY VARY WITH ANOTHER RIDER'S ACTIONS. ** Every
-- column here is a fact about the caller's own `postcard_hides` row and its
-- identity. Not the caption, not the author, not the place, not the image, not
-- whether unhiding would restore anything.
--
-- That sentence is the reason this file exists. `restorable` and the preview
-- columns are NOT a missing feature and re-adding one is not an improvement to
-- a dull screen — it is the defect below, back.
--
-- ---------------------------------------------------------------------------
-- WHAT WENT WRONG IN 105 — a pre-merge review, before either function had a
-- caller
-- ---------------------------------------------------------------------------
-- `105` returned `restorable`, computed as `011`'s `postcards` SELECT qual
-- minus the hide conjunct:
--
--     not private.is_blocked(auth.uid(), p.author_id)
--     and (p.club_id is null or private.is_club_member(p.club_id))
--
-- ** FOR A POSTCARD WITH `club_id IS NULL` THE SECOND CONJUNCT IS VACUOUSLY
-- TRUE, so `restorable` reduces to `not is_blocked(me, author)`. ** And the
-- same change ships `public.my_blocked_riders()`, which tells a rider their own
-- OUTBOUND blocks. The two together are a block detector, and the rider drives
-- it on their own schedule:
--
--   1. hide one non-club postcard by each rider you want to monitor;
--   2. poll this list;
--   3. a row that turns unrestorable while its author is absent from
--      my_blocked_riders() has exactly one remaining cause — ** that rider
--      blocked you **.
--
-- Deterministic, repeatable, and the precise attack D4 claimed to mitigate,
-- against a property `supabase/tests/rls_test.sql` defends in as many words
-- ("the blocked rider is not told they were blocked") and decision #2 rests on.
--
-- ** NULLING THE PREVIEW COLUMNS MITIGATED NOTHING. ** The rider already knows
-- who authored the postcard they themselves chose to hide, so `restorable`
-- beside the always-returned `postcard_id` was the entire signal. `105` emptied
-- the payload and left the channel.
--
-- ** THE THREE-WAY COLLAPSE WAS ONLY EVER TWO-WAY. ** D4 named a third reason —
-- "the author deleted their account" — which cannot produce an unrestorable
-- row: `profiles → postcards → postcard_hides` all cascade ON DELETE, so that
-- case removes the hide row from the table entirely. `105.10` asserts exactly
-- this. Two reasons, one of them the block, is a far weaker set to hide a
-- signal in than three.
--
-- ---------------------------------------------------------------------------
-- WHY THERE IS NO PREDICATE THAT FIXES IT, AND WHAT SHIPPED INSTEAD
-- ---------------------------------------------------------------------------
-- For a non-club postcard the ONLY reason to withhold is a block. So:
--
--   * withholding IS the signal, and
--   * not withholding discloses an author's photo, caption and username to
--     someone they blocked — decision #2, far worse than the leak it fixes.
--
-- No third predicate exists between those two, because the input the predicate
-- would have to be blind to is the only input it has. ** So the list stops
-- differentiating at all. ** Two columns, the same two for every row, whatever
-- any other rider has done.
--
-- The cost is a duller screen: the client renders a neutral row per hidden
-- postcard with a "Remove from this list" action, and cannot show a thumbnail.
-- It could not show one anyway — D3 measured that the Storage postcard policy
-- resolves its EXISTS as the CALLER under the same hide conjunct, so no path
-- on this list can ever sign, restorable or not.
--
-- The rejected richer alternative is recorded in `design.md` D4 rather than
-- here: a preview SNAPSHOTTED into `postcard_hides` at hide time would be
-- constant with respect to every later action and so would carry no signal —
-- but it means storing a copy of another rider's content in a row keyed to
-- someone else, and it is a schema change nobody has asked for.
--
-- ---------------------------------------------------------------------------
-- WHY A DROP AND NOT A `create or replace`
-- ---------------------------------------------------------------------------
-- ** `create or replace function` CANNOT CHANGE A FUNCTION'S OUT PARAMETERS. **
-- The `returns table (...)` list is exactly that, so replacing eight OUT columns
-- with two raises `42P13 cannot change return type of existing function`. The
-- drop is required, and it is written without `if exists` on purpose: `105`
-- creates this function and filename order is apply order, so a missing
-- function here means the chain was applied out of order and should fail loudly.
--
-- The drop takes the function's grants with it, so the `revoke`/`grant` pair
-- below is not decoration — a bare `create` inherits Supabase's project default
-- (`alter default privileges in schema public grant execute on functions to
-- anon, authenticated`), which is an EXPLICIT grant to anon that decision #1
-- forbids and that a `revoke ... from public` alone does not touch.
--
-- ---------------------------------------------------------------------------
-- ORDERING
-- ---------------------------------------------------------------------------
-- ** Free in both directions, because the dropped object has no observer. **
-- `105` is on DEV only and was applied 2026-09-05; `my_hidden_postcards` has
-- never had a caller in any deployed bundle — the screen that will call it is
-- being written against THIS signature. So this is `090`'s class: a destructive
-- file whose removed object no bundle can observe.
--
-- On the PROD promotion the pair applies in filename order, `105` then `106`,
-- and PROD never serves the eight-column version at all.
--
-- ---------------------------------------------------------------------------
-- ADVISORS: NET ZERO
-- ---------------------------------------------------------------------------
-- One `security definer` function in `public` leaves and the same name comes
-- back, so `authenticated_security_definer_function_executable` still fires
-- twice for `105`+`106` together and DEV stays at THIRTY-NINE. Run
-- `get_advisors(security)` rather than trusting that; a fortieth means
-- something landed here that this file did not intend.

drop function public.my_hidden_postcards(timestamptz, int);

create function public.my_hidden_postcards(
  before_at timestamptz default null,
  before_id uuid        default null,
  page_size int         default 20
)
returns table (
  postcard_id uuid,
  hidden_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- `security definer` for the reason `105` gave and this file keeps: `011`
  -- puts the hide conjunct INSIDE the `postcards` SELECT qual, so a hidden
  -- postcard is unreadable by the very rider who hid it, and their own
  -- `postcard_hides` rows would otherwise join to nothing.
  --
  -- ** THE JOIN TO `postcards` IS HERE FOR ONE PREDICATE AND READS NO COLUMN
  -- ANYONE SEES. ** It survives only to exclude a self-hide, below. The join to
  -- `profiles` that `105` carried is gone with the author username it fed;
  -- nothing here needs a second rider's row at all, which is the property
  -- stated in the header made structural.
  select h.postcard_id, h.created_at
    from public.postcard_hides h
    join public.postcards p on p.id = h.postcard_id
   where h.user_id = (select auth.uid())
     -- ** A SELF-HIDE IS EXCLUDED (Q5), unchanged from 105. ** The author
     -- branch of the `postcards` policy is unconditional, so a rider's hide of
     -- their own postcard is inert — the postcard is still on every screen they
     -- look at, and listing it would offer to "unhide" something never hidden.
     -- The row itself is left alone: 7.2, `hidePostcard` is not changed.
     and p.author_id <> (select auth.uid())
     -- ** COMPOSITE KEYSET CURSOR — the LOW finding in the same review. **
     -- `105` ordered by `(created_at desc, postcard_id desc)` but cursored on
     -- `created_at < before_at` ALONE, so two hides sharing a `created_at` that
     -- straddle a page boundary lost one row silently. `created_at` defaults to
     -- `now()`, which is the TRANSACTION timestamp, so two hides written in one
     -- statement or one transaction share it exactly — unreachable through
     -- today's client, one batched write away from reachable, and invisible
     -- when it happens.
     --
     -- The tiebreaker is `postcard_id`, which is the second sort key and part
     -- of the primary key, so the pair is unique and the page boundary is
     -- exact. ** The client must pass BOTH halves ** — `before_id` alone
     -- defaults to null and the predicate degrades to `105`'s lossy one, which
     -- is what 106.4 asserts in both directions. Both halves come straight off
     -- the last row of the previous page; they are the only two columns there
     -- are.
     and (
       before_at is null
       or h.created_at < before_at
       or (before_id is not null
           and h.created_at = before_at
           and h.postcard_id < before_id)
     )
   order by h.created_at desc, h.postcard_id desc
   -- `greatest(…, 0)` for the reason 085's and 086's accessors carry it:
   -- Postgres raises `LIMIT must not be negative`, so without it a client
   -- passing -1 gets a 500 from an endpoint that should return nothing. It
   -- changes no in-range input.
   limit least(greatest(coalesce(page_size, 20), 0), 50);
$$;

comment on function public.my_hidden_postcards(timestamptz, uuid, int) is
  'This rider''s own postcard_hides rows, newest first, and NOTHING ELSE (106, PD-298 — supersedes 105''s eight-column version). security definer because 011 puts the hide conjunct INSIDE the `postcards` SELECT qual, so a hidden postcard is unreadable by the rider who hid it. ** THE RETURNED ROW MAY NOT VARY WITH ANOTHER RIDER''S ACTIONS, AND THAT IS THE POINT OF THE FUNCTION. ** 105 returned `restorable` — 011''s qual minus the hide conjunct — with the preview columns NULLed when it was false. For a postcard with club_id IS NULL that predicate reduces to `not is_blocked(me, author)`, and the same change ships my_blocked_riders(), which names the rider''s own outbound blocks: hide one non-club postcard per rider you want to monitor, poll this list, and a row turning unrestorable whose author is absent from your own block list means THAT RIDER BLOCKED YOU. rls_test.sql defends "the blocked rider is not told they were blocked" in as many words. Nulling the payload mitigated nothing, since the rider already knows who wrote the postcard they chose to hide. There is no predicate that fixes it — for a non-club postcard the only reason to withhold is the block, so withholding IS the signal and not withholding discloses an author''s photo to someone who blocked them — so the list stops differentiating: two columns, identical in shape for every row. A rider''s own postcard is still excluded (Q5). Paginate with the composite cursor (before_at, before_id) taken from the last row of the previous page; before_at alone drops rows that share a created_at across a page boundary.';

revoke all on function public.my_hidden_postcards(timestamptz, uuid, int) from public, anon;
grant execute on function public.my_hidden_postcards(timestamptz, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. The signature IS the mitigation, so read it back rather than the body:
--
--   select pg_get_function_result(oid), pg_get_function_arguments(oid),
--          prosecdef, proconfig, provolatile
--     from pg_proc where proname = 'my_hidden_postcards';
--   -- TABLE(postcard_id uuid, hidden_at timestamp with time zone)
--   -- before_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
--   --   before_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 20
--   -- t | {search_path=} | s
--
-- 2. The grants, which the drop removed and this file put back BY NAME:
--
--   select has_function_privilege('authenticated','public.my_hidden_postcards(timestamptz,uuid,int)','execute'),  -- t
--          has_function_privilege('anon',         'public.my_hidden_postcards(timestamptz,uuid,int)','execute');  -- f
--
-- 3. ** THE EIGHT-COLUMN VERSION IS GONE AND NOT MERELY SHADOWED. ** An
--    overload would leave 105's leak reachable under its old argument list:
--
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'my_hidden_postcards';   -- 1
--
-- 4. No policy, CHECK, trigger, index, column or table changes here. The
--    counts stay pinned in rls_test.sql rather than in this comment.
--
-- 5. Advisors: THIRTY-NINE on DEV, unchanged — a drop and a create of the same
--    name in the same schema is net zero.
