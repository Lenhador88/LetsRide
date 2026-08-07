-- 034: Per-ride group chat — the messages table, and the crew-only rule.
--
-- Builds `Ride - Chat` (2226:4999). Linear PD-116; the epic is PD-115 and the
-- proposal is openspec/changes/add-ride-chat/.
--
-- ---------------------------------------------------------------------------
-- The audience is the parent's AND the crew's — an intersection, not a swap
-- ---------------------------------------------------------------------------
-- Every child table in this schema so far inherits its parent's audience
-- exactly, expressed as an EXISTS against the parent so the predicate has one
-- home: postcard_likes (009 §4), postcard_comments (011 §1), the storage.objects
-- read policy (010 §2).
--
-- A message needs *more* than that, because `rides` SELECT admits any signed-in
-- rider to a public ride — decision #1's "visible to any signed-in rider" — and
-- a ride's chat is not that. **Seeing a ride is not being on it**, and a group
-- chat every rider in the app can read because the ride is public is not what
-- the design draws: the header counts `10 riders`, which is the crew.
--
-- ** The first draft of this file read that as "so use the crew predicate
-- INSTEAD of the EXISTS", and it shipped a leak. ** Kept here because the
-- reasoning is seductive and the failure is silent. `private.is_ride_crew` is
-- `security definer`, so it reads `rides` and `ride_members` as the owner and
-- answers "is there a membership row" — a question with no opinion about
-- blocks, private clubs, or whether the ride is visible at all. And a
-- `ride_members` row outlives every event that takes the ride away. So a crew
-- predicate on its own left two states live, both measured against the suite
-- before the conjunct below was added:
--
--   * A crew member who **blocks the organizer** loses the ride, the roster and
--     the detail screen, and keeps reading and posting in that ride's chat. The
--     author arm below hides only the organizer's own messages; every other
--     rider's stay. Decision #2 names chat in its list of things a block must
--     remove *simultaneously*, so this is that decision contradicted directly.
--   * A crew member who **leaves a private club** keeps reading that club's ride
--     chat. `022` pins a private club's rides to `is_public = false`, so `rides`
--     hides them — and nothing removes the `ride_members` row. That one is a
--     leak rather than an inconsistency.
--
-- The fix is a conjunction: the parent EXISTS **and** the crew helper. The
-- EXISTS runs under the CALLER's row security, so it re-uses the rides SELECT
-- policy rather than restating any of it, and the two predicates answer
-- different questions — "may I see this ride" and "am I on it".
--
-- `private.is_club_member` has the identical `security definer` shape and no
-- such gap, which is what makes copying it verbatim the specific trap: `clubs`
-- deliberately carries no block predicate, so there is nothing for a definer
-- call to skip past. `rides` carries two.
--
-- ---------------------------------------------------------------------------
-- Crew includes the organizer, who may hold no ride_members row at all
-- ---------------------------------------------------------------------------
-- This is the arm that is easy to leave out, and leaving it out locks a host out
-- of their own ride's chat.
--
-- `withOrganizer` in src/lib/data/rides.ts encodes "the organizer is on their
-- own ride by construction, whether or not they ever pressed Yes!" — in
-- application code, where no policy can see it. `createRide` does insert a
-- `ride_members` row, but as a *second* round trip with no transaction, so the
-- state where it is missing is reachable on demand rather than only on error;
-- that is the first entry in docs/HANDOFF.md §Known issues and the subject of
-- openspec/changes/enforce-creator-membership/.
--
-- That change is unshipped, so this file must not assume it. The organizer arm
-- below is therefore load-bearing today. **If enforce-creator-membership ever
-- lands, the arm becomes redundant rather than wrong** — a trigger would
-- guarantee the membership row the arm exists to survive the absence of. Leave
-- it: an invariant enforced in two places is cheap, and this one is the
-- difference between a host reading their own chat and not.
--
-- ---------------------------------------------------------------------------
-- Settled decisions carried in here
-- ---------------------------------------------------------------------------
--   #1 no anonymous access        -> every policy `to authenticated`, anon revoked
--   #2 blocking is enforced in RLS -> private.is_blocked, never a blocks query
--   #5 onboarding is required      -> §5 adds the ninth participation-gate trigger
--   #7 username is the display name -> nothing here stores a name

-- ---------------------------------------------------------------------------
-- §1. private.is_ride_crew
-- ---------------------------------------------------------------------------
-- Same shape as private.is_club_member (005) and private.is_club_public (022):
-- `security definer`, `stable`, `set search_path = ''`, and in `private` so
-- PostgREST cannot publish it. That last point is why this adds **no security
-- advisor**: the six `authenticated_security_definer_function_executable` WARNs
-- CLAUDE.md tabulates are all `public.` functions. Schemas outside PostgREST's
-- search path are not exposed, which is the whole reason 005 created `private`.
--
-- `security definer` rather than a plain EXISTS in the policy, for a reason that
-- is not obvious and would otherwise be rediscovered: `ride_members` SELECT
-- carries its own `private.is_blocked` clause, so a policy reading that table as
-- the caller asks a question whose answer depends on the *blocklist* as well as
-- on membership. Your own row survives that clause today (`user_id = auth.uid()`
-- is unconditional), so a plain EXISTS would happen to work — by luck, on a
-- predicate someone else owns and may narrow. Asking as the definer makes "am I
-- on this ride" a question about membership and nothing else.
--
-- **That last sentence is the helper's job and NOT the audience** — read the
-- header before using it anywhere else. Answering only the membership question
-- means it also steps past the block and private-club arms of the `rides`
-- policy, which is why every policy below pairs it with an EXISTS against
-- `rides` evaluated as the caller. The helper is half of a conjunction by
-- design; on its own it is a leak.
--
-- It reports only on the calling user, like is_club_member: there is no
-- parameter for *whose* membership, so it cannot be turned into a probe of
-- somebody else's.
create or replace function private.is_ride_crew(ride uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rides r
    where r.id = ride and r.organizer_id = auth.uid()
  ) or exists (
    select 1 from public.ride_members m
    where m.ride_id = ride and m.user_id = auth.uid()
  );
$$;

comment on function private.is_ride_crew(uuid) is
  'Is the caller on this ride — organizer, or holder of a ride_members row of either status (034)? Deliberately stricter than the rides SELECT policy: seeing a ride is not being on it. Lives in `private` so PostgREST does not publish it.';

-- RLS expressions are evaluated as the querying role, so that role needs
-- execute. Everyone else is cut off — 005's rule.
revoke all on function private.is_ride_crew(uuid) from public, anon;
grant execute on function private.is_ride_crew(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- §2. ride_messages
-- ---------------------------------------------------------------------------
-- `id` has a default but is deliberately client-suppliable, which is the one
-- column shape here that is about the *client* rather than the schema. The
-- realtime brief (.claude/agents/realtime.md §Ordering and identity) requires a
-- client-generated id at send time so an optimistic row can be reconciled
-- against the server row on arrival instead of matched by guessing at its
-- content. A collision is a primary-key violation, which is the correct answer.
--
-- It discloses nothing, and that is measured rather than assumed: RLS evaluates
-- WITH CHECK *before* the index insert, so a caller who is not on the ride is
-- refused 42501 and never reaches 23505. Only a crew member of that ride can
-- observe a duplicate, and all it tells them is that some message somewhere
-- holds an unguessable uuid.
--
-- No `updated_at`. postcard_comments carries one and 011's own header concedes
-- it cannot move — there is no UPDATE grant — so it is a column that documents
-- an intention rather than a fact. Editing is not designed here either (§4), so
-- the column would be the same dead weight, and a dead column that reads as live
-- is a trap for the next session.
--
-- Ordering is `created_at`, server-generated and never written by the client,
-- because phones disagree: a message from a device with a skewed clock would
-- otherwise sort into the past and simply never be read.
--
-- **`default now()` is not what makes that true** — a default applies only when
-- the column is omitted, and a client can name it. §4b is what makes it true,
-- by granting INSERT per column and leaving this one out. The default is the
-- value; the grant is the guarantee.
create table public.ride_messages (
  id uuid default uuid_generate_v4() primary key,
  ride_id uuid references public.rides(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  body text not null,
  created_at timestamptz default now() not null,
  -- 1000 characters, matching postcard_comments rather than the 2000 a postcard
  -- caption gets, and the direction is the argument: a chat thread holds far
  -- more rows than a comment thread does, so its per-row bound should be tighter
  -- than a comment's, not looser. 1000 is roughly 150 words — past any real
  -- message — and bounds a 200-message thread at ~200 KB on a phone connection.
  --
  -- The floor is `~ '\S'` — "contains at least one non-whitespace character" —
  -- and NOT the `length(btrim(body)) >= 1` that postcard_comments uses, because
  -- **`btrim` with no second argument strips spaces and nothing else**.
  -- Measured on Postgres 16 rather than assumed:
  --
  --   select length(btrim(E'\n\n')), length(btrim('   '));   -->  2 | 0
  --
  -- So the `btrim` form accepts a body of newlines or tabs, while
  -- `rideMessageBodySchema`'s JS `.trim()` refuses it — the client would be
  -- STRICTER than the database, which is the exact inversion CLAUDE.md's "no new
  -- integrity rule may live only in a Zod schema" exists to prevent. The
  -- publishable key ships in the bundle, so anyone can post past the schema; the
  -- thread renders `whitespace-pre-wrap` and there is no delete UI, so the result
  -- is a tall blank bubble in every crew member's chat, permanently.
  --
  -- postcard_comments (011) carries the `btrim` form and therefore the same gap.
  -- Not fixed here — it is a different table's constraint and a separate change
  -- — but recorded so it is a known inheritance rather than a discovery.
  --
  -- The ceiling stays on the RAW length so padding cannot smuggle a longer body
  -- past a trimmed check.
  constraint ride_messages_body_length check (
    body ~ '\S' and length(body) <= 1000
  )
);

alter table public.ride_messages enable row level security;

comment on table public.ride_messages is
  'Per-ride group chat (034). The audience is an INTERSECTION: riders who can see the ride (an EXISTS against rides, under the caller''s RLS) AND who are on its crew (private.is_ride_crew — organizer, or any ride_members row). Neither half alone is the audience — the crew helper is security definer and steps past the block and private-club arms of the rides policy, so using it on its own lets an ex-club-member read a private ride''s chat.';

-- Reading one ride's thread, oldest first — a conversation reads from the top,
-- like postcard_comments and unlike the feed. This is the index the screen's
-- only query uses.
--
-- `id` is in the key as a tiebreaker rather than for lookups, and it is not
-- decoration: `created_at` is not a total order. Two messages sent in the same
-- millisecond — or inserted in one transaction, where `now()` is the
-- transaction's start and therefore *identical* — sort arbitrarily, so the same
-- thread can render in a different order on two devices, and any future keyset
-- cursor over `created_at` alone would skip or repeat rows at the boundary. The
-- read orders by both, so the index has to carry both to stay covering.
create index ride_messages_ride_id_idx
  on public.ride_messages (ride_id, created_at, id);

-- Not for a screen — for the ON DELETE CASCADE from profiles. Account deletion
-- has to find this rider's messages, and without this it is a sequential scan of
-- every message in the app. Same reason 009 indexed postcard_likes.user_id and
-- 011 indexed postcard_comments.author_id.
create index ride_messages_author_id_idx
  on public.ride_messages (author_id, created_at desc);

-- ---------------------------------------------------------------------------
-- §3. SELECT — the crew, minus anyone either party has blocked
-- ---------------------------------------------------------------------------
-- The block clause is about the AUTHOR, not the ride: on a ride two riders are
-- both on, a rider you blocked must not appear in the thread. Symmetric via the
-- helper, so one directional row holds in both directions and no call site may
-- re-check the reverse — 009's rule.
--
-- Your own message is unconditional *within the crew check*, so you never lose
-- sight of what you wrote while you are on the ride. Note what that does NOT
-- say: a rider who leaves the crew loses the whole thread including their own
-- messages, and the messages themselves stay for everyone else. That is
-- deliberate — a conversation is not retracted because one participant left —
-- and it is the negative case most likely to be read as a bug later.
create policy "Ride messages are readable by that ride's crew"
  on public.ride_messages for select to authenticated
  using (
    -- Under the CALLER's row security, so this is the rides SELECT policy
    -- itself — every arm of it, including the two a `security definer` helper
    -- steps past. See the header for the two states this conjunct closes.
    exists (select 1 from public.rides r where r.id = ride_messages.ride_id)
    and private.is_ride_crew(ride_id)
    and (
      author_id = auth.uid()
      or not private.is_blocked(auth.uid(), author_id)
    )
  );

-- "Cannot post to a chat you are not in", as the same helper. A rider who can
-- see a public ride but has not RSVP'd is refused here, which is the whole point
-- of the table having its own predicate.
create policy "Crew post to their own ride's chat, as themselves"
  on public.ride_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    -- Same conjunction as SELECT, and needed for the same reason rather than
    -- for symmetry: without it a rider who blocked the organizer, or who left
    -- the private club, could still post into a ride they cannot see.
    and exists (select 1 from public.rides r where r.id = ride_messages.ride_id)
    and private.is_ride_crew(ride_id)
  );

-- Two rights, one policy: your own message, or any message on a ride you
-- organize. Mirrors 011's "your own comment, or any comment on a postcard you
-- authored" — the host of a ride stands to its chat as the author of a postcard
-- stands to its thread.
--
-- The `rides` EXISTS runs under the caller's row security, and the rides SELECT
-- policy's first arm is `organizer_id = auth.uid()`, so an organizer can always
-- see their own ride however private it is.
--
-- ** The visibility conjunct is here too, and an earlier draft left it out on
-- reasoning that is false. ** That draft said "RLS filters a DELETE by what the
-- caller may READ, so the SELECT policy covers it". It does not, in general:
-- SELECT policies attach to a DELETE only when the statement has to *read* the
-- row — a WHERE or RETURNING naming a column. Measured on Postgres 16 with a
-- row the caller cannot select but does own:
--
--   delete from t where id = 1;   -->  DELETE 0   (SELECT policy applied)
--   delete from t;                -->  DELETE 2   (it was not)
--
-- supabase-js will happily issue that second form. The policy survived anyway,
-- because both arms are self-referential — but the *next* arm someone adds
-- would not, and a comment asserting a guarantee the engine does not give is
-- how that happens. Stated as a conjunct instead of as a claim.
--
-- ** KNOWN GAP, inherited from 011 and deliberately not closed here. ** RLS
-- filters a DELETE by what the caller may READ. So an organizer who has blocked
-- a rider cannot see that rider's messages, and a delete keyed on the message id
-- matches zero rows — silently, because PostgREST reports no error when a delete
-- matches nothing. That is precisely the case moderation exists for. 011 solved
-- it with `public.moderate_comment`, a security definer function that re-checks
-- the authorship itself.
--
-- The equivalent is NOT built, because no delete UI ships in the first pass: the
-- design draws no message-level control (`Ride - Chat - Options` is a chat-level
-- Pin/Mute sheet — Linear PD-121), and the block itself already removes the
-- messages from the blocker's view, which is the remedy a rider actually reaches
-- for. The shape of the fix if it is ever needed is exactly 011 §1b:
-- `public.moderate_ride_message(uuid)`, security definer, re-checking
-- `r.organizer_id = auth.uid()` in its own body, granted to `authenticated`
-- only. Recorded so it is a decision rather than an oversight.
create policy "Riders delete their own messages, organizers moderate their ride"
  on public.ride_messages for delete to authenticated
  using (
    exists (select 1 from public.rides r where r.id = ride_messages.ride_id)
    and (
      author_id = auth.uid()
      or exists (
        select 1 from public.rides r
        where r.id = ride_messages.ride_id and r.organizer_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- §4. NO UPDATE POLICY AND NO UPDATE GRANT
-- ---------------------------------------------------------------------------
-- Same ruling as 011 gave comments, and the same reasoning: editing a message
-- means designing "edited" — whether it is disclosed, from when, and what it
-- does to a reply quoting the old text. None of that is drawn. A sent message
-- that can silently change its own content after someone has acted on it is a
-- worse artifact than one that cannot be edited at all.
--
-- The remedy for a message you regret is DELETE, which §3 grants.
--
-- Both halves matter and are asserted separately: RLS needs a table grant AND a
-- permitting policy, so the missing grant is the outer gate and the missing
-- policy the inner one. Absence is the enforcement here, which is exactly the
-- kind of thing that gets added back by a well-meaning `grant all` — hence an
-- assertion in each direction rather than a comment.
revoke all on public.ride_messages from anon, authenticated;
grant select, delete on public.ride_messages to authenticated;

-- ---------------------------------------------------------------------------
-- §4b. INSERT is granted per COLUMN, and `created_at` is not one of them
-- ---------------------------------------------------------------------------
-- `default now()` applies only when the column is **omitted**. A table-level
-- INSERT grant lets a client name every column, and PostgREST will happily send
-- one — so with `grant insert on public.ride_messages` a rider can stamp a
-- message in the year 3000. On this screen that is not cosmetic: the thread is
-- ordered by `created_at`, so the message pins itself to the end of every crew
-- member's chat permanently, and the only remedy is a delete this pass ships no
-- UI for.
--
-- `postcard_comments` carries the identical exposure and it has never mattered,
-- which is exactly why it was nearly inherited here without being noticed: a
-- comment thread's order is a convenience, and a chat's order **is the product**.
--
-- A column grant rather than a trigger, following `025`'s precedent on
-- `profiles`: it is one statement, it fails the write at the door with `42501`
-- instead of silently rewriting what the client asked for, and it needs no
-- function to keep in step. `id` IS grantable — the client chooses it on
-- purpose, so an interrupted send can be retried with the same id and land as a
-- `23505` that `sendRideMessage` reads as success rather than double-posting.
grant insert (id, ride_id, author_id, body) on public.ride_messages to authenticated;

-- ---------------------------------------------------------------------------
-- §5. The ninth participation-gate trigger
-- ---------------------------------------------------------------------------
-- 023 put this on eight tables. A rider who has not completed onboarding or
-- accepted the terms must not be able to write into a chat either — the same
-- rule, and this is a content write like any other.
--
-- The WHEN clause is not decoration: 023 §2 measured that a `security definer`
-- function sees `current_user` as its OWNER, so a guard inside the body would be
-- true on every call and the gate would never fire. It is evaluated in the
-- caller's context, before the function is entered.
drop trigger if exists enforce_participation_gate on public.ride_messages;
create trigger enforce_participation_gate
  before insert on public.ride_messages
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- 023's comment says "eight BEFORE INSERT triggers" and there are nine now. A
-- database comment is the `data` agent's first read via `list_tables`, so it is
-- the one piece of documentation no edit to CLAUDE.md can reach — 028 and 033
-- exist for exactly this, and leaving it stale would be leaving a wrong number
-- in the only place nobody re-reads.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, nine BEFORE INSERT triggers — the ninth is ride_messages (034); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- ---------------------------------------------------------------------------
-- §6. Realtime
-- ---------------------------------------------------------------------------
-- Membership of `supabase_realtime` is what makes a subscription fire. It is a
-- publication, not a policy, and that distinction is the trap: a client
-- subscribing to a table outside the publication **connects, reports SUBSCRIBED,
-- and silently never receives anything** — indistinguishable from a quiet chat.
-- So it belongs in the migration chain beside the policies rather than as a
-- dashboard click, which would be the same class of undetectable drift as an
-- unapplied migration.
--
-- Realtime evaluates the SELECT policy above per subscriber, so §3's crew and
-- block rules govern delivery too and there is no second copy of them. That is
-- an argument for keeping the rule in one place, not a reason to trust it
-- untested: `.claude/agents/realtime.md` requires confirming a blocked rider
-- receives silence rather than inferring it from the policy.
--
-- Default replica identity is deliberate. `full` is needed only to carry the OLD
-- row on UPDATE and DELETE; this table has no UPDATE at all, and the screen
-- subscribes to INSERT. Setting it `full` would put every column of every
-- deleted row into the WAL for a payload nothing reads.
--
-- supabase/tests/harness.sql creates an empty publication of this name, because
-- `supabase_realtime` is a Supabase artifact that plain Postgres does not have —
-- without it this line would fail the RLS suite and the fix would look like
-- "make the migration conditional", which would let the real one silently not
-- apply.
alter publication supabase_realtime add table public.ride_messages;

-- ---------------------------------------------------------------------------
-- Verification — run against the live project after applying, not just in CI
-- ---------------------------------------------------------------------------
-- The suite runs on plain Postgres and cannot see role grants, exposed RPC
-- endpoints or Supabase defaults. Each of these predicts a number:
--
--   -- 3 policies, all `to authenticated`, and no UPDATE among them
--   select cmd, roles::text from pg_policies
--    where schemaname = 'public' and tablename = 'ride_messages';
--
--   -- 0 — anon holds nothing, decision #1
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'ride_messages' and grantee = 'anon';
--
--   -- 2 — SELECT and DELETE only. INSERT is a COLUMN grant (§4b) and does not
--   -- appear here at all, which is the thing to be careful of: reading 2 and
--   -- concluding "inserts are broken" is the wrong conclusion.
--   select privilege_type from information_schema.role_table_grants
--    where table_name = 'ride_messages' and grantee = 'authenticated';
--
--   -- 4 — id, ride_id, author_id, body. NOT created_at
--   select column_name from information_schema.column_privileges
--    where table_name = 'ride_messages' and grantee = 'authenticated'
--      and privilege_type = 'INSERT';
--
--   -- false — is_ride_crew is not reachable through PostgREST
--   select has_function_privilege('anon', 'private.is_ride_crew(uuid)', 'execute');
--
--   -- 1 — the table is really in the publication
--   select count(*) from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'ride_messages';
--
--   -- 9 — the participation gate reaches ride_messages now
--   select count(*) from pg_trigger where tgname = 'enforce_participation_gate'
--     and not tgisinternal;
--
-- And the advisors: `get_advisors(security)` must still return the documented
-- eight. A ninth would mean is_ride_crew landed somewhere PostgREST publishes.
