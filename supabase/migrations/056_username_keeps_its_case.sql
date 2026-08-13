-- 056: a username stores the case the rider typed; uniqueness stays case-insensitive.
--
-- Linear PD-226. Product owner, 2026-08-13, chosen explicitly: `Pedro` renders as
-- `Pedro`, and `pedro`, `PEDRO`, `PeDrO` are unavailable to everyone else.
--
-- ---------------------------------------------------------------------------
-- What changes, and the one thing that must NOT
-- ---------------------------------------------------------------------------
-- 003 §4 wrote two rules and only one of them is the impersonation fix:
--
--   profiles_username_lower_key   unique on lower(username)   <- UNTOUCHED
--   profiles_username_format      username ~ '^[a-z0-9_]{3,20}$'
--
-- The index is what makes registering the case-variant of an existing rider
-- impossible, and 003's own header says so: "the index is the one that would
-- still hold if the charset rule were ever relaxed to allow capitals". This is
-- that relaxation, and it is the reason the index exists in that shape. Making
-- uniqueness case-SENSITIVE is out of scope and would reopen 003 Q4 — two names
-- differing only by case are indistinguishable in a member list, which is a
-- working impersonation vector.
--
-- So exactly one of the two rules moves:
--
--   profiles_username_format      username ~ '^[A-Za-z0-9_]{3,20}$'
--
-- ---------------------------------------------------------------------------
-- The trap: the reserved list was lowercase BECAUSE the charset was
-- ---------------------------------------------------------------------------
-- 003 §4's comment reads, verbatim: "The charset constraint above already forces
-- lowercase, so a lowercase list is exhaustive." That sentence is load-bearing,
-- and relaxing the charset without touching the reserved check turns it into a
-- hole rather than a stale comment:
--
--   update profiles set username = 'Admin';   -- passes both CHECKs
--
-- `'Admin' <> ALL (ARRAY['admin', ...])` is TRUE, so the row is written. The
-- rider then renders as `Admin` on every byline, member list and ride crew,
-- which is the whole thing 003 §4's denylist exists to prevent — reachable as a
-- direct PostgREST call, because the client has never been a trust boundary
-- here. `letsride`, `support` and the sixteen route segments go the same way.
--
-- The fix is to fold the column, not to enumerate the cases: a case-blind
-- comparison against the same lowercase list. The list itself is unchanged,
-- name for name, so `src/lib/validation/__tests__/profile.test.ts`'s
-- "the TS denylist and the migration denylist contain exactly the same names"
-- still has something to compare against — it is repointed at this file, which
-- is now where the live constraint is defined.
--
-- ---------------------------------------------------------------------------
-- The second trap: `.eq('username', …)` becomes wrong, and `.ilike()` is not the fix
-- ---------------------------------------------------------------------------
-- `isUsernameTaken` (src/lib/data/profile.ts) filtered `.eq('username', …)`,
-- correct only because every caller pre-lowercased and every stored value was
-- lowercase. With stored capitals it reports `Pedro` free while `pedro` exists,
-- and the rider is then refused 23505 on submit — PD-146's exact shape, arriving
-- by a new road.
--
-- PostgREST cannot express `where lower(username) = lower($1)`:
--
--   .eq()     case-sensitive. The defect above.
--   .ilike()  case-insensitive LIKE, and LIKE reads `_` as a single-character
--             WILDCARD. Usernames contain underscores by charset, so `my_name`
--             would match a stored `myXname` and report a free name taken.
--             PostgREST exposes no ESCAPE clause, so this cannot be repaired at
--             the call site.
--   .imatch() case-insensitive POSIX (`~*`). Correct only if the caller has
--             already proven the value holds no regex metacharacter, and it
--             cannot use profiles_username_lower_key — a sequential scan on a
--             table sized for thousands of riders.
--
-- Hence §3: one function, in the database, that says the rule once and uses the
-- index 003 built for exactly this query ("the availability check runs
-- `where lower(username) = $1`" — 003 §4).
--
-- **It is `security invoker`, and that is the security-relevant decision in this
-- file.** `security definer` would be the reflex — 021's accessors are — and it
-- would be wrong here in a way nothing would go red over. `isUsernameTaken`
-- reads under the block-aware `profiles` SELECT policy today: to a rider blocked
-- by the holder of a name, the name reads FREE. That asymmetry is deliberate,
-- pinned from both sides in supabase/tests/rls_test.sql §038.3, and reconciled on
-- screen by `usernameVerdict` (PD-146). As `security definer` this function would
-- answer for rows the caller cannot see, which does not fix the asymmetry — it
-- converts it into a channel that reports the EXISTENCE of a blocked rider's
-- username to the party they blocked. Invoker keeps the answer byte-identical to
-- what `.eq()` returned, case-folding aside.
--
-- 031's lesson applies to the grant: a function the client cannot reach is worse
-- than none, because nothing local can see it. The footer asserts EXECUTE by
-- role rather than by calling it, which is the shape 031 prescribes, and the
-- suite carries the same assertion.
--
-- ---------------------------------------------------------------------------
-- NO DATA MIGRATION, and 003's NULL-ing must not be repeated
-- ---------------------------------------------------------------------------
-- The new charset is strictly WIDER than the old one: every string matching
-- '^[a-z0-9_]{3,20}$' matches '^[A-Za-z0-9_]{3,20}$'. No stored row can be
-- invalidated by this file, so there is nothing to rewrite and nothing to
-- salvage. Measured on letsride-dev 2026-08-13 rather than argued:
--
--   select count(*) from public.profiles
--    where username is not null and username !~ '^[A-Za-z0-9_]{3,20}$';   --> 0
--
-- 003 §4 set non-conforming usernames to NULL, which it could afford pre-launch
-- and flagged as "a data-loss event with real users". Nothing here does that,
-- and nothing here may: the widening makes it unnecessary by construction.
--
-- `handle_new_user()` needs no change either, and the reason is that 003 §5
-- already removed the thing that would have broken. Its email-derived fallback —
-- `split_part(new.email, '@', 1)`, which could yield dots, plus signs and
-- capitals — is gone; the body inserts `id` alone. Read off letsride-dev
-- 2026-08-13, not recalled:
--
--   begin insert into public.profiles (id) values (new.id)
--         on conflict (id) do nothing; return new; end;
--
-- So it yields `username` NULL, which both CHECKs admit through their `username
-- is null or …` arm, before and after this file. The warning 038 left standing
-- is unchanged and still applies: seeding a username there from OAuth or
-- user_metadata is a write that must carry these rules in its own body.
--
-- ---------------------------------------------------------------------------
-- The cost, stated rather than denied: two new homoglyph PAIRS
-- ---------------------------------------------------------------------------
-- Case folding collapses the case dimension, so no *account* collision is
-- opened — `PedrO` cannot be registered beside `pedro`. What capitals do add is
-- rendering confusion between characters that fold DIFFERENTLY: uppercase `I`
-- against lowercase `l`, and uppercase `O` against digit `0`, both of which are
-- near-identical in most sans-serif faces. `Iron` and `lron` are two distinct,
-- simultaneously registerable names. The lowercase-only charset already carried
-- `0`/`o` and `rn`/`m`, so this is a widening of a class that was never closed,
-- not a new class — and closing it properly is a confusable-skeleton check, not
-- a charset rule. Recorded as an accepted cost of the decision, not as a defect.
--
-- ---------------------------------------------------------------------------
-- Ordering: ADDITIVE — apply BEFORE the code deploy, never after
-- ---------------------------------------------------------------------------
-- Both constraint changes are pure widenings, and §3 is additive. Old code
-- against this database keeps working: it sends lowercase, which is still legal,
-- and it still filters `.eq('username', …)`, which is still correct while every
-- stored value is lowercase. New code against the old database is the half that
-- does not compose — `username_exists` would not exist and the availability
-- check would 42883 — so the only rule is the ordinary one: apply before the
-- code deploy, or with it. Additive first, which is 021's lesson and not this
-- file's.
--
-- The heading above said "applies in either direction" until the review pass
-- before this file's PROD apply, and that is kept as a warning rather than
-- silently corrected: it is the SCANNABLE half, a session skimming headings
-- before a promotion gets the opposite of the paragraph beneath it, and it had
-- already propagated into docs/HANDOFF.md as "needs no ordering care". Only one
-- direction composes. The reversed order is not a slow migration or a locking
-- risk — it is a rider on the onboarding username step being told "That username
-- is not available" for a name that is free, because the old CHECK refuses the
-- capital and the client reads 23514 as a taken name.

-- ---------------------------------------------------------------------------
-- 1. The charset admits capitals
-- ---------------------------------------------------------------------------
-- Drop and add in ONE `alter table`, so there is no instant — not even inside a
-- transaction someone might run statement-at-a-time — in which the column has no
-- format rule at all. The name is reused deliberately: 038's header, the
-- openspec requirement and the suite all refer to `profiles_username_format`, and
-- a rename would silently orphan every one of them.

alter table public.profiles
  drop constraint profiles_username_format,
  add constraint profiles_username_format
    check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');

-- ---------------------------------------------------------------------------
-- 2. The reserved list is compared case-blind
-- ---------------------------------------------------------------------------
-- `lower(username) not in (…)` rather than seventeen extra spellings. The list
-- is byte-identical to 003 §4's; only the comparison changed. Extending it still
-- needs a migration, which remains the right side of that trade for a list this
-- stable — and if it starts churning, the answer is still a `reserved_usernames`
-- table checked from a trigger, not a longer CHECK.

alter table public.profiles
  drop constraint profiles_username_not_reserved,
  add constraint profiles_username_not_reserved
    check (
      username is null or lower(username) not in (
        'admin', 'support', 'letsride', 'me', 'new', 'settings',
        'auth', 'onboarding', 'legal', 'api',
        'dashboard', 'rides', 'clubs', 'friends', 'profile', 'inbox', 'garage'
      )
    );

-- ---------------------------------------------------------------------------
-- 3. The availability check gets a case-insensitive lookup it can actually call
-- ---------------------------------------------------------------------------
-- `security invoker` — the default, written nowhere, and asserted in the footer
-- rather than assumed. See the header: as `security definer` this would report
-- the existence of a blocked rider's username to the party they blocked.
--
-- `stable` because it reads the table and nothing else. `search_path = ''` for
-- 002's reason, which does not depend on definer-ness: an empty search_path
-- means a caller cannot shadow `profiles` with their own table, and every name
-- here is schema-qualified so it still resolves (`lower` lives in `pg_catalog`,
-- which is always searched).
--
-- Returns a boolean rather than the row, deliberately. The caller wants "is this
-- name reachable", and returning the id or the stored casing would hand a rider
-- the exact spelling of a name they cannot have, for no purpose the field needs.

create or replace function public.username_exists(p_username text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles
     where lower(profiles.username) = lower(p_username)
  );
$$;

comment on function public.username_exists(text) is
  'Case-insensitive availability check for the onboarding username field (056): true when a profile the CALLER can see holds this name, folded. security invoker on purpose — it answers under the block-aware profiles SELECT policy, exactly as the .eq() filter it replaced did, so a name held by a rider who has blocked the caller still reads free (PD-146, reconciled on screen by usernameVerdict). Advisory only: profiles_username_lower_key is what decides, and setUsername handles the 23505.';

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, which `anon` and
-- `service_role` both inherit. Decision #1 means no reach for `anon`; the
-- deletion Edge Function has no use for this. 021's shape.

revoke all on function public.username_exists(text) from public, anon;
grant execute on function public.username_exists(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. Both constraints, by definition rather than by count. Expected the relaxed
--    charset and a `lower(username) <> ALL (…)` reserved rule.
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.profiles'::regclass
--      and conname in ('profiles_username_format', 'profiles_username_not_reserved');
--
-- 2. The impersonation fix is untouched. Expected exactly 1.
--
--   select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
--    where c.relname = 'profiles_username_lower_key' and i.indisunique
--      and pg_get_indexdef(i.indexrelid) like '%lower(username)%';
--
-- 3. The function is INVOKER with its search_path pinned. Expected f | {search_path=""}.
--    prosecdef reading `t` here is the defect this file argues against at length.
--
--   select prosecdef, proconfig from pg_proc
--    where oid = 'public.username_exists(text)'::regprocedure;
--
-- 4. The client can reach it and `anon` cannot — asserted by ROLE, per 031,
--    because calling it as the owner proves nothing about either. Expected t | f.
--
--   select has_function_privilege('authenticated', 'public.username_exists(text)', 'execute'),
--          has_function_privilege('anon', 'public.username_exists(text)', 'execute');
--
-- 5. No row was rewritten. Expected the same count as before applying, and 0.
--
--   select count(*) as rows,
--          count(*) filter (where username is not null
--                             and username !~ '^[A-Za-z0-9_]{3,20}$') as violating
--     from public.profiles;
--
-- 6. POSITIVE: the case a rider types is what is stored. Expected `Pedro`.
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--     update public.profiles set username = 'Pedro' where id = '<uuid>';
--     select username from public.profiles where id = '<uuid>';
--   rollback;
--
-- 7. NEGATIVE: every case-variant of a taken name is refused, by the INDEX
--    (23505) and not by the charset rule. Each must fail:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<other uuid>","role":"authenticated"}';
--     update public.profiles set username = 'pedro' where id = '<other uuid>';
--     update public.profiles set username = 'PEDRO' where id = '<other uuid>';
--     update public.profiles set username = 'PeDrO' where id = '<other uuid>';
--   rollback;
--
-- 8. NEGATIVE: the reserved list no longer walks through in title case. Expected
--    23514 on every one:
--
--   update public.profiles set username = 'Admin'    where id = '<uuid>';
--   update public.profiles set username = 'ADMIN'    where id = '<uuid>';
--   update public.profiles set username = 'LetsRide' where id = '<uuid>';
--
-- 9. The advisors must still return the documented nine. This file adds no
--    `security definer` function, no policy and no table, so a new WARN — in
--    particular a tenth `authenticated_security_definer_function_executable` —
--    means §3 was applied with the keyword this header spends four paragraphs
--    refusing.
