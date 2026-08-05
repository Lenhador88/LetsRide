-- 019: `club_members.role` stops being self-assignable.
--
-- **This closes a live defect, not a future one.** The INSERT policy 008 left in
-- place reads `auth.uid() = user_id AND (the club is public OR you own it)`. It
-- constrains *who the row is for* and says nothing whatever about `role`; the
-- only rule on the column is 001's three-value enum CHECK. `joinClub` omits the
-- column and leans on the `'member'` default — which is a convention in our
-- code, and PostgREST does not read our code. **Any rider can join any public
-- club as `admin` today**, with one hand-rolled request against a publishable
-- key that already ships in the bundle.
--
-- It is visible, too, which is what makes it worth a migration rather than a
-- note: `/clubs/[id]/members` renders the value, labelling `owner` and `admin`
-- and drawing an owner ring, so a forged role shows to every member of the club.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against the hosted project 2026-08-05
-- ---------------------------------------------------------------------------
--   club_members rows ......................................... 3
--   rows with role = 'admin' .................................. 0
--   rows with role = 'owner' .................................. 2
--   rows this policy would have refused
--     (role <> 'member' and not (role = 'owner' and user_id = clubs.owner_id))  0
--
-- Zero violating rows, and in any case a policy is not retroactive — existing
-- rows are untouched by a WITH CHECK. The count is recorded because it answers
-- the question that actually matters: has anyone already used this. Nobody has.
--
--   select count(*) from public.club_members cm join public.clubs c on c.id = cm.club_id
--    where cm.role <> 'member' and not (cm.role = 'owner' and cm.user_id = c.owner_id);
--
-- ---------------------------------------------------------------------------
-- Why a WITH CHECK addition rather than a constraint or a trigger
-- ---------------------------------------------------------------------------
-- The rule is *authorization* — which role you may claim depends on who you are
-- relative to the club — so it belongs in the policy, beside the clause it
-- qualifies. A CHECK constraint cannot see `clubs` at all, and a trigger would
-- put half of one rule in a second place. Same reasoning 017 used for the club
-- membership predicate on `rides`.
--
-- `admin` becomes insertable by nobody, which is deliberate and is the whole
-- design of the column today: nothing has ever written it, and the invitations
-- feature that would is unbuilt. When it ships it brings its own policy — see
-- the UPDATE note below.
--
-- ---------------------------------------------------------------------------
-- No UPDATE policy, and that is Q10's answer rather than an omission
-- ---------------------------------------------------------------------------
-- `club_members` has SELECT, INSERT and DELETE policies and no UPDATE — so
-- promotion is impossible for everyone, including the club owner. That is the
-- product owner's ruling (design.md Q10): promotion stays impossible until the
-- invitations feature designs it, and the absence is *recorded* rather than
-- papered over with a policy nothing calls. The RLS suite pins it with an
-- assertion, so the day someone adds an UPDATE policy they have to delete a test
-- that says why it was not there.

drop policy if exists "Users can join public clubs" on public.club_members;

create policy "Users can join public clubs, as a member unless they own it"
  on public.club_members for insert to authenticated
  with check (
    auth.uid() = user_id

    -- Unchanged from 008: you may only add yourself, and only to a club that is
    -- public or that you own. Reproduced verbatim rather than referenced,
    -- because a policy is replaced whole.
    --
    -- The subquery reaches `clubs` under RLS. That does not recurse: the `clubs`
    -- SELECT policy calls `private.is_club_member`, which is `security definer`
    -- and therefore reads `club_members` with RLS off. This is the shape 008
    -- already relied on; it is noted here so the next reader does not have to
    -- re-derive that it is safe.
    and exists (
      select 1 from public.clubs c
       where c.id = club_members.club_id
         and (c.is_public or c.owner_id = auth.uid())
    )

    -- 019. Two arms and no third: `member` is what joining means, `owner` is
    -- what creating means, and `admin` is claimable by nobody.
    --
    -- The `owner` arm is not a courtesy — `createClub` inserts the club row and
    -- then its own `role = 'owner'` membership row as a second round trip, so
    -- without this arm club creation stops working entirely.
    and (
      role = 'member'
      or (
        role = 'owner'
        and exists (
          select 1 from public.clubs c
           where c.id = club_members.club_id and c.owner_id = auth.uid()
        )
      )
    )
  );

comment on column public.club_members.role is
  'owner | admin | member. Only ''member'' is self-assignable, and only the club''s own owner_id may insert ''owner'' (019). ''admin'' is insertable by nobody and writable by nobody — there is no UPDATE policy on this table, which is design.md Q10''s answer and not an oversight.';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 3 — select, insert, delete. NOT four: the absence of UPDATE is the
-- assertion, so this number is load-bearing.
--   select count(*) from pg_policies where tablename = 'club_members';
--
-- Expected: 0 — every club_members policy is `to authenticated`.
--   select count(*) from pg_policies
--    where tablename = 'club_members' and roles::text[] <> array['authenticated'];
--
-- Expected: t — and that is not a mistake. `authenticated` DOES hold the
-- table-level UPDATE grant, so a promotion attempt is filtered to zero rows by
-- the absence of an UPDATE policy rather than refused by a missing privilege.
-- Both are asserted in rls_test.sql. An earlier draft of this footer predicted
-- "0 rows", which is wrong twice over: has_table_privilege is scalar and always
-- returns exactly one row, and the value is true. An operator running it as
-- written would have concluded the migration had not applied.
--   select has_table_privilege('authenticated', 'public.club_members', 'update');
--
-- Expected: t — the new policy carries the role rule.
--   select with_check like '%role%' from pg_policies
--    where tablename = 'club_members' and cmd = 'INSERT';
