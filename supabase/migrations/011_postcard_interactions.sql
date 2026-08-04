-- 011: Postcard interactions — comments, per-viewer hides, and reports.
--
-- ---------------------------------------------------------------------------
-- Scope reversal, recorded here because the repo still says otherwise
-- ---------------------------------------------------------------------------
-- CLAUDE.md ("Comments and shares are deliberately out of scope and have no
-- tables") and 009's own header ("Comments and shares are deliberately NOT
-- created here") were both true when written. The product owner reversed the
-- comments half on 2026-08-03. This migration is that reversal; whoever lands
-- it must update those two lines and docs/HANDOFF.md, or the next session will
-- read a settled decision that no longer holds.
--
-- SHARES STAY OUT OF SCOPE, and not for want of effort. It is undefined
-- whether "share" means a native share sheet — which needs no backend at all,
-- not a column — or a repost, which needs a table, an audience rule for the
-- reshared postcard, and an answer for what happens to a repost when the
-- original is deleted or its author blocks the resharer. Those are two
-- different products with two different schemas, and picking one here would
-- be a guess dressed as a decision. OPEN QUESTION for the product owner; do
-- not resolve it in a migration.
--
-- ---------------------------------------------------------------------------
-- KNOWN GAP: reports are write-only
-- ---------------------------------------------------------------------------
-- postcard_reports has no reader. There is no admin role in this project, no
-- moderator claim in the JWT, and no policy below grants anyone but the
-- reporter SELECT on their own rows. A report therefore lands in a table that
-- nobody can triage without opening the Supabase dashboard by hand.
--
-- That is a trust-and-safety hole, not a feature, and it is stated plainly
-- rather than left for someone to discover after a rider files one. The table
-- exists now because the alternative — a Report button that writes nothing —
-- is worse, and because the eventual moderator path is additive (one more
-- SELECT policy keyed on a role claim, no change to these rows). Closing it
-- takes a decision about who moderates, which is not a schema question.
--
-- Second gap in the same table: postcard_id is ON DELETE CASCADE, so deleting
-- the reported postcard erases the reports about it. For a live complaint that
-- is arguably correct — the content is gone — but it does destroy the pattern
-- evidence a repeat offender would leave. Preserving it means a report that
-- outlives its subject, which needs somewhere to keep a copy of what was
-- reported. Not built; recorded so the choice is visible.
--
-- ---------------------------------------------------------------------------
-- Checked, not assumed: postcards already has a DELETE policy
-- ---------------------------------------------------------------------------
-- "Authors can delete their own postcards" (009 §3) exists, is `to
-- authenticated`, and 010 did not touch it — confirmed against the live
-- project's pg_policies before writing this file. Nothing to add. What IS
-- added below is a comment on that policy recording the half that no cascade
-- can do: the Storage object at image_path is not deleted with the row.
--
-- Settled decisions carried in here:
--   #1 no anonymous access         -> every policy `to authenticated`, anon revoked
--   #2 blocking is enforced in RLS  -> private.is_blocked, never a blocks query
--   #7 username is the display name -> nothing here stores a name

-- ---------------------------------------------------------------------------
-- 1. postcard_comments
-- ---------------------------------------------------------------------------
-- A comment has no audience of its own. It inherits the postcard's, and the
-- policies below express that as an EXISTS against postcards rather than by
-- restating the club predicate — the same trick postcard_likes (009 §4) and
-- the storage.objects read policy (010 §2) already use. The subquery runs
-- under the CALLER's row security, so "can I see this comment" resolves to
-- "can I see its postcard" by construction and cannot drift from the policy
-- 009 owns. A second copy of `club_id is null or is_club_member(club_id)`
-- would be a predicate somebody has to remember to keep in step, and the one
-- that drifts is always the one nobody reads.
--
-- Threads are not built. There is no parent_id: a flat list is what the feed
-- shows, and nesting brings its own visibility question (does a reply to a
-- blocked rider's comment survive?) that nothing has asked for yet.

create table public.postcard_comments (
  id uuid default uuid_generate_v4() primary key,
  postcard_id uuid references public.postcards(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  body text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  -- 1000 characters, and the number is arguable rather than arbitrary. A
  -- comment is a reaction to a photo, so it should not be able to outweigh the
  -- thing it reacts to — 009 capped a caption at 2000. 1000 is roughly 150
  -- words, comfortably past any real comment, and it bounds a 50-comment
  -- thread at ~50 KB of text on a phone connection.
  --
  -- The floor is on the TRIMMED length, so a comment of nothing but spaces is
  -- refused; the ceiling is on the raw length, so padding cannot be used to
  -- smuggle a longer body past a trimmed check. RLS enforces authorization,
  -- never validity, so both live here rather than in the client.
  constraint postcard_comments_body_length check (
    length(btrim(body)) >= 1 and length(body) <= 1000
  )
);

alter table public.postcard_comments enable row level security;

comment on table public.postcard_comments is
  'A comment inherits its postcard''s audience. Every policy delegates to postcards via EXISTS rather than restating the club predicate — see 009 §4 for the same shape on likes.';

-- Reading one postcard's comments, oldest first. Ascending, unlike the feed's
-- own descending index: a photo's comments read as a conversation from the
-- top, where the feed reads newest-first.
create index postcard_comments_postcard_id_idx
  on public.postcard_comments (postcard_id, created_at);

-- Not for a screen — for the ON DELETE CASCADE from profiles. Deleting an
-- account has to find that rider's comments, and without this it is a seq scan
-- of every comment in the app. Same reason 009 indexed postcard_likes.user_id.
create index postcard_comments_author_id_idx
  on public.postcard_comments (author_id, created_at desc);

-- The block clause is about the COMMENTER, not the postcard: on a postcard two
-- riders can both see, a rider you blocked must not appear in the comments.
-- Symmetric via the helper, so this holds in both directions from one row.
-- Your own comment is unconditional, so you never lose sight of what you wrote.
create policy "Comments follow postcard visibility"
  on public.postcard_comments for select to authenticated
  using (
    exists (select 1 from public.postcards p where p.id = postcard_comments.postcard_id)
    and (
      author_id = auth.uid()
      or not private.is_blocked(auth.uid(), author_id)
    )
  );

-- "Cannot comment on what you cannot see" is the EXISTS clause, and it
-- inherits the block and club predicates from the postcards select policy for
-- free — so a blocked rider cannot comment on the blocker's postcard either,
-- without this policy naming blocks at all.
create policy "Riders can comment on visible postcards, as themselves"
  on public.postcard_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.postcards p where p.id = postcard_comments.postcard_id)
  );

-- NO UPDATE POLICY AND NO UPDATE GRANT. Editing a comment means designing
-- "edited" — whether it is disclosed, from when, and what a reply to the old
-- text means — and none of that exists. Same shape as postcard_likes and
-- blocks in 009: a table with no mutable column carries no UPDATE grant, so
-- the refusal holds even if a future policy is written too permissively.
--
-- The remedy for a comment you regret is DELETE, which is granted below.

-- Two independent rights in one policy: your own comment, or any comment on a
-- postcard you authored. The second is moderation on your own post, and it is
-- the reason the delete right is not simply `author_id = auth.uid()`.
--
-- The EXISTS runs under the caller's RLS, and the postcards select policy's
-- author branch is unconditional, so this keeps working for a postcard in a
-- club the author has since left.
--
-- CAUTION, and this cost a review to find: this policy does NOT let an author
-- remove a comment they cannot see. An earlier revision of this comment claimed
-- it did, on the grounds that a SELECT policy only constrains a DELETE that
-- uses RETURNING. That is wrong — Postgres applies the SELECT policy whenever
-- the statement READS columns, and a WHERE clause reads them. Measured:
--
--   author sees own postcard        1
--   author sees blocked comment     0
--   delete ... where id = '<it>'    DELETE 0
--
-- So the harassment case this branch exists for — block a rider, then clear
-- their comment off your own photo — silently does nothing through any query a
-- client would write. Only a bare unqualified `delete from postcard_comments`
-- reaches it, which no caller can use because it would sweep every comment
-- they are allowed to delete.
--
-- The branch is still correct and still worth having: it covers every comment
-- the author CAN see, which is the ordinary case. The invisible case is served
-- by public.moderate_comment() in §1b, which is security definer for exactly
-- the reason private.is_blocked is — the actor cannot read the row they must
-- act on.
create policy "Riders delete their own comments, authors moderate their own postcard"
  on public.postcard_comments for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1 from public.postcards p
      where p.id = postcard_comments.postcard_id
        and p.author_id = auth.uid()
    )
  );

-- updated_at cannot move today: there is no UPDATE grant, so no client can
-- write it. The trigger is here anyway, for one reason — the day editing is
-- designed, the grant is a one-line change, and a one-line change is exactly
-- the kind that ships without anyone remembering that the column would then be
-- client-writable. Reuses 009's function; nothing new is created.
create trigger postcard_comments_set_updated_at
  before update on public.postcard_comments
  for each row execute function public.set_updated_at();

-- There is deliberately no comment_count on postcards, for the same reason 009
-- refused a like_count: a count column has to be one number, and the correct
-- number is per-viewer. A comment from a rider you blocked must not be counted
-- for you. Counting rows under RLS gives that for free and cannot drift from
-- the rows it summarises.

-- ---------------------------------------------------------------------------
-- 1b. Moderating a comment the author cannot see
-- ---------------------------------------------------------------------------
-- The one job the DELETE policy above cannot do, and the reason is structural
-- rather than a bug in the policy: RLS filters a statement by what the caller
-- may READ, so an author whose blocked harasser commented on their photo issues
-- a delete that matches zero rows. The policy is not too strict — it is being
-- evaluated against a row the caller is not allowed to see in the first place.
--
-- Security definer is the same instrument 009 reached for with
-- private.is_blocked, and for the same reason: the actor cannot read the row
-- their action depends on. The authorization is not weakened, it is moved —
-- `p.author_id = auth.uid()` inside the function is the entire grant, and it is
-- checked against auth.uid() rather than anything the caller passes.
--
-- Hardened per 005: `set search_path = ''`, every name schema-qualified, execute
-- revoked from public and anon. Unlike is_blocked this one lives in `public`
-- and IS published by PostgREST — it has to be, a client calls it — so the
-- narrowness of what it does is the whole defence. It deletes exactly one
-- comment, on a postcard the caller authored, and returns whether it did.
create or replace function public.moderate_comment(comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.postcard_comments c
  using public.postcards p
  where c.id = comment_id
    and p.id = c.postcard_id
    and p.author_id = auth.uid();

  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

comment on function public.moderate_comment(uuid) is
  'Removes one comment from a postcard the caller authored, including one the caller cannot see because they blocked its author. Security definer because RLS filters a DELETE by what the caller may read — see 011 §1b.';

revoke all on function public.moderate_comment(uuid) from public, anon;
grant execute on function public.moderate_comment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. postcard_hides
-- ---------------------------------------------------------------------------
-- Hiding is DIRECTIONAL AND PER-VIEWER, and that is the whole difference
-- between this table and blocks. A block row is directional but symmetric in
-- effect: both parties vanish for each other, which is why it needs a
-- security definer helper to resolve a row the blocked party cannot read. A
-- hide only ever affects the rider who wrote it, so it needs no helper, no
-- symmetry, and no read privilege on anyone else's rows. Nobody hides anything
-- from anybody but themselves.
--
-- (postcard_id, user_id) composite PK, matching postcard_likes. It doubles as
-- the idempotency mechanism — a caller writing `on conflict do nothing` can
-- press Hide twice without an error — and it is the exact index the feed
-- predicate in §3 probes.

create table public.postcard_hides (
  postcard_id uuid references public.postcards(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  primary key (postcard_id, user_id)
);

alter table public.postcard_hides enable row level security;

comment on table public.postcard_hides is
  'Per-viewer and one-directional, unlike blocks. A row here only ever removes a postcard from its own user_id''s feed; it is invisible and inert for everyone else.';

-- The PK serves the feed predicate. This serves the profiles cascade and a
-- "hidden posts" screen if one is ever designed.
create index postcard_hides_user_id_idx on public.postcard_hides (user_id, created_at desc);

create policy "Riders see only their own hides"
  on public.postcard_hides for select to authenticated
  using (user_id = auth.uid());

-- No visibility requirement on the postcard, deliberately, and this is the
-- same reasoning blocks' INSERT policy uses. Two arguments:
--
--   a) a hide row for a postcard you cannot see is inert. It can only ever
--      remove something from your own feed, so the worst case is a row that
--      does nothing.
--   b) requiring visibility here would be circular. The hide is precisely what
--      makes the postcard invisible, so a WITH CHECK that reads the postcards
--      policy would be testing a predicate this very row is about to flip —
--      correctness would then rest on Postgres's same-command row visibility
--      rules rather than on anything written down.
create policy "Riders can hide postcards for themselves only"
  on public.postcard_hides for insert to authenticated
  with check (user_id = auth.uid());

-- Unhide. No visibility requirement, for the reason 009 gave for unliking: a
-- hidden postcard is by definition out of view, so a policy that required
-- seeing it would make the hide impossible to undo.
create policy "Riders can unhide only their own hide"
  on public.postcard_hides for delete to authenticated
  using (user_id = auth.uid());

-- No UPDATE policy and no UPDATE grant: a hide has no mutable column.

-- ---------------------------------------------------------------------------
-- 3. Hidden postcards leave the feed — in RLS, not in a query filter
-- ---------------------------------------------------------------------------
-- Decision #2's argument is about blocks, but it applies verbatim here: a
-- postcard filtered out by one `lib/data` function and not by the next is
-- hidden on the screens someone remembered. The predicate belongs in the
-- policy, where every reader gets it.
--
-- Dropped by catalog lookup rather than by name, the same way 009 §6 did it.
-- Policies for one command are OR'd, so a leftover SELECT policy under a name
-- this file did not predict would silently restore every hidden postcard. The
-- loop also asserts, by construction, the "exactly one SELECT policy per
-- table" invariant that supabase/tests/rls_test.sql checks globally.
--
-- Everything else about the policy is 009's, unchanged: same name, same author
-- branch, same block clause, same club predicate.

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.postcards', pol.policyname);
  end loop;
end
$$;

-- THE AUTHOR'S OWN POSTCARD STAYS VISIBLE TO THE AUTHOR EVEN IF HIDDEN.
--
-- The hide predicate sits inside the second branch, so the unconditional
-- author branch still wins. That is a decision, not an accident:
--
--   * 009 made the author branch unconditional so a rider can never lose their
--     own photo — including one in a club they left. A self-hide that removed
--     it from their own profile grid would reintroduce exactly that loss.
--   * There is no "hidden postcards" screen in the design, so a rider who hid
--     their own postcard would have no way to find the row again and unhide
--     it. Unhide would exist and be unreachable.
--   * "Delete my own postcard" is the affordance for not wanting your own post
--     any more, and it already exists.
--
-- A hide row written against your own postcard is therefore accepted and
-- inert. Refusing it would need a subquery in the INSERT policy — one more
-- denial for the client to handle, buying nothing.
create policy "Postcards are viewable by their audience"
  on public.postcards for select to authenticated
  using (
    author_id = auth.uid()
    or (
      not private.is_blocked(auth.uid(), author_id)
      and (
        club_id is null
        or private.is_club_member(club_id)
      )
      -- `h.user_id = auth.uid()` is not redundant with the postcard_hides
      -- select policy that also enforces it. This subquery inherits that
      -- policy, so today either alone would do — but if the hides policy is
      -- ever loosened, this written predicate is what stops one rider's hides
      -- suppressing everybody's feed. It is also the leading-column probe that
      -- makes the composite PK usable here.
      and not exists (
        select 1 from public.postcard_hides h
        where h.postcard_id = postcards.id
          and h.user_id = auth.uid()
      )
    )
  );

-- What a hide reaches, for free, because they all delegate to this policy via
-- EXISTS: the postcard's likes (009 §4), its comments (§1 above), its Storage
-- object (010 §2), and the ability to like or comment on it at all. One
-- predicate, five surfaces, no restatement. Unhiding restores every one of
-- them — nothing is deleted, exactly as with a block (009 §7).

-- ---------------------------------------------------------------------------
-- 4. postcard_reports
-- ---------------------------------------------------------------------------
-- Read the KNOWN GAP at the top of this file before adding a reader to this
-- table.
--
-- UNIQUE (reporter_id, postcard_id) is the anti-spam mechanism: reporting the
-- same postcard twice is a duplicate, and a caller writing `on conflict do
-- nothing` gets a clean no-op instead of a second row. Same idempotency shape
-- as blocks. Without it, one rider could file ten thousand reports against one
-- postcard and whatever eventually reads this table would be reading a
-- brigading tool rather than a signal.

create table public.postcard_reports (
  id uuid default uuid_generate_v4() primary key,
  reporter_id uuid references public.profiles(id) on delete cascade not null,
  postcard_id uuid references public.postcards(id) on delete cascade not null,
  reason text not null,
  note text,
  created_at timestamptz default now() not null,
  -- INFERRED, NOT READ FROM THE DESIGN. design/ in this checkout holds only its
  -- README — the Figma snapshot has never been pulled here, so `npm run figma
  -- -- text "Report"` cannot answer what the real reason list is. These six are
  -- the common denominator of every platform's report sheet, not a transcription
  -- of ours. Verify against the Report frame when the snapshot is next captured;
  -- adding a value is a cheap drop-and-recreate of this one constraint, and
  -- removing one is not, so the list is kept short on purpose.
  constraint postcard_reports_reason check (
    reason in ('spam', 'harassment', 'hate', 'nudity', 'violence', 'other')
  ),
  -- Same bound and same trimmed/raw split as a comment body, for the same
  -- reason. The note is optional; an empty string is not a note.
  constraint postcard_reports_note_length check (
    note is null or (length(btrim(note)) >= 1 and length(note) <= 1000)
  ),
  constraint postcard_reports_one_per_rider unique (reporter_id, postcard_id)
);

alter table public.postcard_reports enable row level security;

comment on table public.postcard_reports is
  'Write-only in practice: no admin role exists, so only the reporter can read their own rows and nobody can triage. See the KNOWN GAP note in migration 011.';

-- Reporting a postcard does not hide it. They are separate rows and separate
-- rights on purpose — a rider may want one, the other, or both, and an action
-- that writes both is a `lib/actions` decision, not a schema one.
create policy "Riders see only the reports they filed"
  on public.postcard_reports for select to authenticated
  using (reporter_id = auth.uid());

-- You report as yourself, and only something you can currently see. The EXISTS
-- inherits the block, club and hide predicates from §3 without naming any of
-- them.
create policy "Riders can report visible postcards, as themselves"
  on public.postcard_reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (select 1 from public.postcards p where p.id = postcard_reports.postcard_id)
  );

-- NO UPDATE AND NO DELETE, neither policy nor grant. A report is a statement of
-- fact at a moment in time; letting the reporter rewrite or withdraw it would
-- make the table useless as evidence the moment it acquires a reader, and
-- there is nothing here worth editing — the remedy for a mistaken report is
-- that nobody is currently reading it.

-- ---------------------------------------------------------------------------
-- 5. Grants on the new tables
-- ---------------------------------------------------------------------------
-- RLS needs BOTH a table grant and a permitting policy, so the grant is the
-- second, independent layer — the one that still holds if a future policy is
-- written too permissively. 009 §5's argument, applied at creation time.
--
-- Note what is NOT granted: UPDATE anywhere in this migration, and DELETE on
-- postcard_reports. A caller writing an upsert against hides or reports must
-- use `on conflict do nothing`, never `on conflict do update` — the latter
-- needs UPDATE and will refuse with 42501.

revoke all on public.postcard_comments from anon, authenticated;
revoke all on public.postcard_hides    from anon, authenticated;
revoke all on public.postcard_reports  from anon, authenticated;

grant select, insert, delete on public.postcard_comments to authenticated;
grant select, insert, delete on public.postcard_hides    to authenticated;
grant select, insert         on public.postcard_reports  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The Storage object a postcard DELETE leaves behind
-- ---------------------------------------------------------------------------
-- 009's DELETE policy is present and correct (checked, see the header). What
-- no policy can do is delete the image: Postgres and Supabase Storage are two
-- systems with no foreign key between them, so `delete from postcards` leaves
-- the object at image_path in the bucket — billable, and unreachable, since
-- 010's storage SELECT policy resolves visibility through the postcards row
-- that no longer exists.
--
-- 010 §3 already recorded this as an open gap and named the mechanism: the
-- uploader holds DELETE on their own folder. The comment goes on the policy
-- itself so it is found by whoever writes deletePostcard, not only by whoever
-- reads migrations in order.
comment on policy "Authors can delete their own postcards" on public.postcards is
  'Deleting the row does NOT delete the Storage object at image_path — Postgres and Storage are separate systems with no cascade between them. The calling action must remove the object in the same request, under the caller''s own session (010 grants exactly that DELETE), or it is left billable and unreachable.';

-- Rows that DO cascade with a postcard, because they are all part of it:
-- its likes (009), its comments, its hides, and its reports. Deleting a
-- profile cascades the same way through author_id / user_id / reporter_id.

-- ---------------------------------------------------------------------------
-- Verification (run against the hosted project after apply)
-- ---------------------------------------------------------------------------
-- Every case below is also an assertion in supabase/tests/rls_test.sql, which
-- applies this whole chain to a scratch database on every PR. They are
-- repeated here because that suite runs on plain Postgres and cannot see role
-- grants, PostgREST exposure or Supabase defaults — the gap 003's footer
-- already names.
--
-- Shape — expect three tables, all with rls enabled:
--
--   select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relname in ('postcard_comments', 'postcard_hides', 'postcard_reports');
--
-- Expect zero rows — no policy may target anon or PUBLIC:
--
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public' and not (roles = '{authenticated}');
--
-- Expect zero rows — anon must hold no table privileges:
--
--   select table_name, privilege_type from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public';
--
-- Expect exactly one SELECT policy per table. §3 drops postcards' by catalog
-- lookup and recreates one; more than one here means a leftover, and policies
-- for the same command are OR'd, so the leftover would restore every hidden
-- postcard silently:
--
--   select tablename, count(*) from pg_policies
--   where schemaname = 'public' and cmd = 'SELECT' group by tablename;
--
-- Expect zero rows — no UPDATE policy exists on any table this migration
-- created, and no UPDATE grant backs one:
--
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' and cmd = 'UPDATE'
--     and tablename in ('postcard_comments', 'postcard_hides', 'postcard_reports');
--   select has_table_privilege('authenticated', 'public.postcard_comments', 'update');
--   select has_table_privilege('authenticated', 'public.postcard_reports', 'delete');
--
-- NEGATIVE: an outsider cannot read comments on a private club's postcard, and
-- cannot write one. Expect zero rows, then 42501:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<non-member>","role":"authenticated"}';
--     select id from public.postcard_comments where postcard_id = '<club postcard>';
--     insert into public.postcard_comments (postcard_id, author_id, body)
--       values ('<club postcard>', '<non-member>', 'hello');
--   rollback;
--
-- NEGATIVE: a rider cannot forge an author, cannot edit any comment including
-- their own, and cannot delete a stranger's comment on a stranger's postcard.
-- The first two fail 42501; the third silently touches zero rows, so the
-- surviving row is the evidence:
--
--   insert into public.postcard_comments (postcard_id, author_id, body)
--     values ('<visible postcard>', '<someone else>', 'forged');
--   update public.postcard_comments set body = 'edited' where author_id = '<self>';
--   delete from public.postcard_comments where id = '<someone else''s comment>';
--
-- NEGATIVE: blocked riders' comments are invisible in BOTH directions. Both
-- must return zero rows:
--
--   set local request.jwt.claims = '{"sub":"<blocker>","role":"authenticated"}';
--   select id from public.postcard_comments where author_id = '<blocked>';
--   set local request.jwt.claims = '{"sub":"<blocked>","role":"authenticated"}';
--   select id from public.postcard_comments where author_id = '<blocker>';
--
-- NEGATIVE: a rider cannot read anyone else's hides, and a hide leaves exactly
-- one feed. Expect zero, then the hider's feed one shorter than the control's:
--
--   set local request.jwt.claims = '{"sub":"<other>","role":"authenticated"}';
--   select * from public.postcard_hides;                       -- zero rows
--   select count(*) from public.postcards;                     -- unchanged
--   set local request.jwt.claims = '{"sub":"<hider>","role":"authenticated"}';
--   select count(*) from public.postcards;                     -- one fewer
--
-- NEGATIVE: a rider cannot read another rider's reports, and cannot report the
-- same postcard twice (expect zero rows, then 23505, then a clean no-op):
--
--   set local request.jwt.claims = '{"sub":"<other>","role":"authenticated"}';
--   select * from public.postcard_reports;
--   set local request.jwt.claims = '{"sub":"<reporter>","role":"authenticated"}';
--   insert into public.postcard_reports (reporter_id, postcard_id, reason)
--     values ('<reporter>', '<already reported>', 'spam');
--   insert into public.postcard_reports (reporter_id, postcard_id, reason)
--     values ('<reporter>', '<already reported>', 'spam') on conflict do nothing;
--
-- NEGATIVE: a rider cannot delete another rider's postcard. Filtered by USING,
-- so it succeeds against zero rows — the surviving row is the assertion:
--
--   delete from public.postcards where id = '<someone else''s postcard>';
--   select count(*) from public.postcards where id = '<someone else''s postcard>';
