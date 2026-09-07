-- 113: a rider states a home country — the ADDITIVE half. PD-428.
--
-- Specification: `openspec/changes/require-a-home-country-at-onboarding/`.
-- `design.md` §D4 (why this is an ordinary rider-owned column and not a fifth
-- server-owned one), §D5 (why the removal rule is a coercion), §D9 (why the
-- value arrives as a column write and not as an RPC parameter) and §D8 (why the
-- refusal is a separate file) are the four sections this file implements.
--
-- ---------------------------------------------------------------------------
-- THIS RE-ADDS A STEP `075` REMOVED, AND THAT IS DELIBERATE
-- ---------------------------------------------------------------------------
-- `075` (PD-286) deleted the onboarding location step and took the location arm
-- out of `complete_onboarding` and out of the trigger below. It was CORRECT and
-- it is not being reversed by accident. Read the two together:
--
--   `075` removed a FREE-TEXT TOWN, asked as the second of two screens, that
--   nothing in the product could do anything with. A typed town is not a filter,
--   is not a position, and could not be aggregated — one market, one town field,
--   no consumer. Dropping it removed a step that bought the rider nothing.
--
--   `113` adds a CLOSED-VOCABULARY COUNTRY, one of 249 assigned ISO 3166-1
--   alpha-2 codes, because the app is now a ten-market product and the country
--   is the filter that makes "rides near me" answerable at all when a rider has
--   no device fix and no town. It is a different question with a different
--   answer type, and the ten-market case is what answers `075` rather than
--   ignoring it.
--
-- So the next reader sees a REVERSAL WITH A REASON, not a loop. If a third
-- change proposes removing this step, the thing it has to argue against is the
-- market count and the filter, not the screen count.
--
-- A country is NOT a position, and this file must not be read as one:
-- `design.md` §D6. There is no centroid, no `RiderLocationSource`, no `near
-- <country>` label and no IP lookup. PD-419's decline rule is untouched.
--
-- ---------------------------------------------------------------------------
-- `complete_onboarding` IS NOT TOUCHED BY THIS FILE, AND ITS SIGNATURE NEVER
-- CHANGES. The next author will reach for it — do not.
-- ---------------------------------------------------------------------------
-- The obvious shape is `complete_onboarding(p_location text, p_country text
-- default null)`. It is wrong for a mechanical reason (`design.md` §D9):
--
--   * `create or replace` CANNOT ADD A PARAMETER. Postgres identifies a function
--     by its argument types, so that statement creates an OVERLOAD rather than
--     replacing anything, and `complete_onboarding(text)` and
--     `complete_onboarding(text, text)` both exist afterwards.
--   * Two candidates is `PGRST203`. A call supplying only `p_location` matches
--     the one-argument function exactly AND the two-argument one through its
--     default, and PostgREST reports the ambiguity rather than picking — on the
--     one call EVERY SIGNUP makes.
--   * Avoiding that means `drop function public.complete_onboarding(text)` and
--     creating a new one, which also drops `021`'s revoke/grant pair and `025`'s
--     footer grant, and puts a PostgREST schema-cache reload in front of the
--     wizard's terminal call.
--
-- The column write costs none of that. `authenticated` already holds
-- column-scoped UPDATE on this table under its own row's UPDATE policy
-- (`auth.uid() = id`), and the two CHECKs below bind EVERY writer rather than
-- only the callers of one function.
--
-- `114` is the file that makes the country REQUIRED, by adding one guard to
-- `complete_onboarding`'s body. It is a separate file because one file cannot be
-- both sides of a deploy — see §Ordering.
--
-- ---------------------------------------------------------------------------
-- ORDERING — apply this BEFORE the new bundle serves
-- ---------------------------------------------------------------------------
-- Everything here strictly WIDENS what the database accepts, so it is a no-op
-- for the bundle deployed today (which never names the column) and it survives a
-- rollback of the code. The reverse order is `096`'s defect exactly: a newer
-- bundle writing `home_country` against a database without it earns `PGRST204`
-- on every country submit, and there is no screen to fall back to.
--
--   1. apply THIS file                      <- additive, safe against the old bundle
--   2. merge and deploy the country step; confirm the deployment is READY with
--      `aliasError` null — merged is not serving (`070`)
--   3. apply `114`, which arms the refusal
--
-- `114` MUST NOT be folded in here and MUST NOT exist on disk before step 2:
-- the moment it applies, an old bundle's `complete_onboarding({p_location:
-- null})` — the call every signup makes today — starts raising `check_violation`
-- for a column the old bundle has no screen to fill in, and every new rider is
-- permanently stuck on the username step. That is the same split `108`/`109`
-- took, for the same reason.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured on DEV (fpmrimzxadewsaiwpsel) 2026-09-07
-- ---------------------------------------------------------------------------
--   `profiles` has no `home_country` column                       confirmed
--   `enforce_onboarding_completion`  prosecdef f, search_path ""  confirmed
--     md5(prosrc) af228c43e105973fe46f02d7df8b8cd8, 4418 bytes — byte-identical
--     to `075` §2, so no migration has replaced the body since
--   `complete_onboarding(text)`      prosecdef t, search_path ""  confirmed
--     md5(prosrc) 1a5aaf004acb6e68eee5039fba133ae0, 8282 bytes — the value this
--     file must leave UNCHANGED
--
-- There are no rows to violate either constraint (the column is being created),
-- so both are added VALIDATED rather than NOT VALID.

-- --- §1  The column -------------------------------------------------------
-- Nullable, no DEFAULT, no backfill. All three are the requirement rather than
-- an omission — see the column comment in §3.
alter table public.profiles
  add column home_country text;

-- --- §2  Two constraints, two error identities ----------------------------
-- `020`'s pattern, kept for `020`'s own reason: the shape check names CASE AND
-- SHAPE as the rule, which is what `nl` and `NLD` violate, and the membership
-- check names ASSIGNMENT, which is what `ZZ` violates. The second is strictly
-- narrower than the first and does not contradict it.
--
-- Considered and rejected (`design.md` §D3): a shared
-- `private.is_assigned_country_code(text)` immutable function behind both
-- constraints. It reads better and is a worse trap — Postgres does not
-- re-validate a CHECK when the function behind it changes, so a list edited in
-- the function silently leaves already-stored rows violating a constraint that
-- reports itself as valid. `014` and `020` both declined a `countries` reference
-- table for the reason that stands unchanged: nothing joins against one.
alter table public.profiles
  add constraint profiles_home_country_shape
  check (home_country is null or home_country ~ '^[A-Z]{2}$');

comment on constraint profiles_home_country_shape on public.profiles is
  'Case and shape: two uppercase ASCII letters, or NULL (113). Deliberately redundant against profiles_home_country_is_assigned — it is the constraint a lowercase `nl` or a three-letter `NLD` violates, which is a different error identity from "not a country".';

-- **The 249 values below were extracted from `src/lib/countries.ts` by script,
-- not transcribed** — this is the fourth hand-kept pairing in the repo (`020`'s
-- copy of the same list, `011`'s report reasons and `003`'s reserved usernames
-- are the others) and every one carries the same standing risk: nothing
-- automatically reconciles the SQL copy with the TypeScript one. What reduces it
-- is that the copy was machine-made once. Regenerate the same way if the list
-- ever changes — the codes live in a space-separated `CODES` string built from
-- seven concatenated literals, so a regex over a single quoted run finds only
-- the first 37 of them:
--
--   node -e "const s=require('fs').readFileSync('src/lib/countries.ts','utf8');
--     const b=s.slice(s.indexOf('const CODES ='), s.indexOf('export const COUNTRY_CODES'));
--     const c=[...b.matchAll(/'([^']*)'/g)].map(m=>m[1]).join(' ').split(/\s+/).filter(Boolean);
--     console.log(c.length, new Set(c).size, c.filter(x=>!/^[A-Z]{2}$/.test(x)).length)"
--
-- Verified at extraction 2026-09-07: 249 codes, 249 distinct, 0 failing the
-- shape check — and the resulting literal is byte-identical to `020`'s, which is
-- the cross-check that the two copies still agree today.
alter table public.profiles
  add constraint profiles_home_country_is_assigned
  check (home_country is null or home_country = any (array[
    'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
    'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS',
    'BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN',
    'CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE',
    'EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF',
    'GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM',
    'HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM',
    'JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC',
    'LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK',
    'ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA',
    'NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG',
    'PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW',
    'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS',
    'ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO',
    'TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI',
    'VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
  ]::text[]));

comment on constraint profiles_home_country_is_assigned on public.profiles is
  'The 249 assigned ISO 3166-1 alpha-2 codes, generated from src/lib/countries.ts (113), same list and same method as 020''s constraint on profile_countries. Kept in step by hand — regenerate rather than edit by eye.';

-- --- §3  The NULL contract, written where `list_tables` shows it -----------
-- `028`'s lesson: a database comment is the one piece of documentation no edit
-- to CLAUDE.md can reach. The permanent-NULL contract is the single most
-- load-bearing fact about this column and it belongs here, not only in a
-- proposal that gets archived.
comment on column public.profiles.home_country is
  'The rider''s own stated home country as an ISO 3166-1 alpha-2 code (113, PD-428). NULL means THE RIDER WAS NEVER ASKED — every account that existed before this column did, plus anyone whose completion write landed before 114. It is NOT "unknown pending a backfill": this column is NEVER backfilled, from an IP lookup or anything else, and those riders are NEVER re-prompted — 114 refuses a completion without one, and a rider already carrying a completion stamp never reaches that guard again. So NULL is a permanent, first-class population and EVERY READ TOLERATES IT FOR EVER: no query may inner-join on it, no filter may treat its absence as a default country, and the profile editor''s field stays OPTIONAL (design.md §D5) because making it required would re-prompt that population through the back door. A country is a FILTER, never a position — no centroid, no distance, no "near" label (design.md §D6). Once set it cannot be cleared by the client: enforce_onboarding_completion coerces a NULL back to the stored value, silently, exactly as it does for username (038).';

-- --- §4  Grants — a bare additive widening of `025`'s allowlist ------------
-- `025` revoked table-level SELECT, INSERT and UPDATE on `public.profiles` from
-- `authenticated` and re-granted an explicit column allowlist, and stated the
-- standing cost in as many words: **every column added to `profiles` from now on
-- is invisible to `authenticated` until it is added to these grants.** Its
-- sanctioned fix is a bare additive `grant` naming only the new column, which is
-- what this is. `025`'s own lists are NOT re-issued — restating them would make
-- a second copy to keep in step, and `avatar_url` must never be named again
-- (`grant select (avatar_url)` raises `42703` against a database that has had
-- `024`, which is an apply-time abort, not a stale comment).
--
-- ** THREE STATEMENTS, ONE PRIVILEGE EACH, AND THAT IS NOT STYLE. ** The
-- one-line form the task list drafts —
--
--   grant select, insert, update (home_country) on public.profiles to authenticated;
--
-- — is `025`'s DEFECT 1 running in the GRANT direction, and it is worse there.
-- Postgres attaches a column list to the IMMEDIATELY PRECEDING privilege only,
-- so that statement means: grant SELECT **table-wide**, grant INSERT
-- **table-wide**, and grant UPDATE on `home_country`. It would hand
-- `authenticated` table-wide SELECT and INSERT on `profiles` back — re-exposing
-- `terms_accepted_at`, `onboarding_completed_at`, `terms_version` and
-- `analytics_opt_out_at` to any `select=*` on any member list, which is the exact
-- exposure `025`, `030` and `096` exist to close — and it would report success.
-- Reproduced rather than recalled, on DEV inside a rolled-back transaction
-- 2026-09-07: after the one-line form,
-- `has_table_privilege('authenticated','public.profiles','select')` reads TRUE.
--
-- Each privilege therefore carries its own parenthesised column list. The
-- footer asserts the table-wide reads are still false, which is the check that
-- catches a future author collapsing these three lines back into one.
--
-- No `anon` grant, ever (decision #1). There is no anonymous access anywhere in
-- this app and `is_public` never means "visible to the internet".
--
-- Why this column is NOT server-owned like the four that are (`design.md` §D4):
-- `terms_accepted_at`, `onboarding_completed_at`, `terms_version` and
-- `analytics_opt_out_at` are each EVIDENCE ABOUT a rider, produced by the
-- server, which the rider must not be able to author — a consent timestamp the
-- client chooses is not consent. The home country is the opposite: a FACT THE
-- RIDER STATES ABOUT THEMSELVES and is shown back to them, like the town, the
-- bike and the bio. Its integrity question is "is this a real country", which a
-- CHECK answers completely; it is not "who said so and when", which only a grant
-- can answer. And the practical half decides it: a server-owned column cannot be
-- EDITED without a new `security definer` RPC per edit, and a country picked
-- wrongly out of 249 has one obvious transition and no reason to route it
-- through SQL. What keeps the grant honest is §5's trigger arm, not the grant.
grant select (home_country) on public.profiles to authenticated;
grant insert (home_country) on public.profiles to authenticated;
grant update (home_country) on public.profiles to authenticated;

-- --- §5  The trigger: once set, never removed -----------------------------
-- Reproduced WHOLE from the DEPLOYED `prosrc` (md5 af228c43e105973fe46f02d7df8b8cd8),
-- every comment verbatim, per `033`'s reconciliation rule and `075` §2's own
-- practice — NOT from `023`'s or `075`'s file text, because later migrations
-- have replaced this body and a copy taken from a file silently drops whatever
-- arrived after it. The ONLY edit is the `home_country` arm below.
--
-- Which arm came from where, carried forward from `038`'s header because the
-- next author restating this body will need it:
--
--   the `current_user <> 'authenticated'` gate ....... 003 (kept by 012, 023)
--   the `tg_op = 'INSERT'` branch, both its arms ..... 023 §1.14 (075 removed
--                                                     the location conjunct)
--   the username coercion ............................ 038
--   the home_country coercion (NEW) .................. 113
--   the terms_accepted_at one-way / server-stamp ..... 012
--   the onboarding_completed_at one-way early return . 003 §6b
--   the completion guard's username arm .............. 003, narrowed by 075
--   the completion guard's consent arm ............... 023 §1.13
--
-- It stays `security invoker` — `033`'s footer requires it and the reason is
-- structural, not stylistic: the body opens by returning early unless
-- `current_user` is `authenticated`, which as `security definer` would be false
-- on EVERY call, so the guard would never fire for anyone. That is the defect
-- `022` shipped in the opposite direction. `prosecdef` must still read `false`
-- after this applies; it is in the footer.
--
-- Neither trigger on `profiles` is recreated (`038`'s §D5): recreating them
-- churns `pg_trigger` for nothing and risks a window in which the table has no
-- BEFORE trigger at all. Both point at this function by name and neither is
-- column-scoped, which is load-bearing — a trigger scoped `OF username` would
-- never fire for a `home_country`-only PATCH and this whole arm would be
-- silently dead. The footer counts it.
--
-- A `security definer` function is NOT covered by the `current_user` gate and
-- that is stated rather than closed, exactly as `038` stated it. `114` will add
-- a `home_country` guard inside `complete_onboarding` for that reason; nothing
-- else writes this column from inside a definer function today.
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

  -- 023 §1.14: the INSERT arm. `old` does not exist here, hence the TG_OP guard
  -- 012 named as the reason it deferred this.
  if tg_op = 'INSERT' then
    -- A row cannot be born with a chosen consent timestamp. Same rule as the
    -- first-acceptance branch below: the client says *that* it accepted, the
    -- server says *when*.
    if new.terms_accepted_at is not null then
      new.terms_accepted_at := pg_catalog.now();
    end if;

    if new.onboarding_completed_at is not null then
      -- 075: the location conjunct came out of this test, and the message with
      -- it. This is the arm no prose in this repo mentioned, which is why the
      -- body was reproduced from the deployed prosrc rather than from 023.
      --
      -- Deliberately NOT quoting the removed predicate here: a comment naming a
      -- retired pattern is counted by every grep for it (CLAUDE.md's comment
      -- trap), and the footer's verification query greps this very body.
      --
      -- 113: NO home_country conjunct is added here, and none is added to the
      -- UPDATE arm's completion guard either. The requirement that a completion
      -- carry a country lives in `complete_onboarding` and ONLY there (114) —
      -- 075's measurement 1 is why: that RPC is `security definer`, so inside it
      -- `current_user` is the OWNER and this function's gate above short-circuits
      -- before any arm here is evaluated. An arm added here would refuse a
      -- support-path write for a rider who has no country and would still let
      -- the RPC through, which is the wrong half of the door.
      if new.username is null then
        raise exception 'onboarding cannot be completed before a username is set'
          using errcode = 'check_violation';
      end if;
      if new.terms_accepted_at is null then
        raise exception 'onboarding cannot be completed before the terms are accepted'
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end if;

  -- 038: once set, never unset. Coerced rather than raised, matching the consent
  -- rule below — see the header for why, and for why the assertions covering this
  -- check the stored value rather than a SQLSTATE.
  --
  -- **This must stay ABOVE the `old.onboarding_completed_at` early return.**
  -- Below it, it is dead code for every already-onboarded rider, which is the
  -- entire population it protects — and it would still pass a suite that only
  -- tested a mid-wizard fixture. It is first in the UPDATE path so that a future
  -- rule arriving with an early return of its own cannot orphan it.
  --
  -- Keyed on `old.username`, so a rider mid-wizard who has chosen a name is
  -- covered too: that is the route by which a taken name could otherwise be
  -- freed and re-taken. A rename is untouched and still permitted (proposal Q1);
  -- only the removal is refused.
  if old.username is not null then
    new.username := coalesce(new.username, old.username);
  end if;

  -- 113: the same rule for the home country, and it is placed HERE for 038's
  -- reason, which is not negotiable — **above the `old.onboarding_completed_at`
  -- early return.** Below it this arm would be dead code for every
  -- already-onboarded rider, and an already-onboarded rider is the ONLY
  -- population that can ever have a country to lose: 114 refuses a completion
  -- without one. A version placed below would still pass a suite that tested a
  -- mid-wizard fixture, which is precisely the trap 038 documented.
  --
  -- Keyed on `old.home_country`, so NULL -> NULL is not a removal and this never
  -- fires for the population that was never asked — the whole population on the
  -- day this applies, and a permanent one thereafter (see the column comment).
  --
  -- Coerced rather than raised, and here that choice is load-bearing rather than
  -- merely consistent: this file hangs new code inside EVERY profile edit's own
  -- transaction, on an already-shipped write path. A raise would be a live
  -- outage the first time the profile editor sent a blank country field; a
  -- coalesce degrades to a no-op. The profile editor's country field is
  -- OPTIONAL by decision (design.md §D5), so a rider blanking it gets the stored
  -- value back and sees no error — 038's accepted behaviour, and the reason the
  -- assertions covering this check the STORED VALUE and never a SQLSTATE. An
  -- assertion written as assert_rejected(..., '23514', ...) would FAIL against a
  -- correct implementation.
  if old.home_country is not null then
    new.home_country := coalesce(new.home_country, old.home_country);
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

  if new.onboarding_completed_at is not null then
    -- 075: the location conjunct came out of this test too, same as the INSERT
    -- arm above. What remains is the username rule and, below it, 023's consent
    -- rule. The removed predicate is not quoted, for the reason given there.
    if new.username is null then
      raise exception 'onboarding cannot be completed before a username is set'
        using errcode = 'check_violation';
    end if;

    -- 023 §1.13. Note this reads `new`, not `old`: the branch above has already
    -- resolved what the row's consent stamp will actually be, so a rider
    -- accepting the terms and finishing the wizard in one statement is
    -- permitted, and one who never accepted is not.
    if new.terms_accepted_at is null then
      raise exception 'onboarding cannot be completed before the terms are accepted'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- The comment IS restated here, and `075` declining to restate it is not a
-- counter-precedent: `075` removed nothing from the enumeration (the comment
-- never claimed a location was required), whereas this file adds a FOURTH rule
-- to a function whose comment enumerates them. `028`'s lesson is that an
-- enumeration which omits a rule is how the next reader concludes there are only
-- three. `create or replace` keeps the OID and therefore `038`'s comment, so
-- without this line the new arm would be invisible to `list_tables`.
comment on function public.enforce_onboarding_completion() is
  'Guards the profile fields the client must not own (CLAUDE.md): onboarding_completed_at cannot be claimed early, cleared or back-dated (003) and cannot be claimed without consent (023 §1.13); terms_accepted_at is server-stamped on first write and immutable thereafter (012), on INSERT as well as UPDATE (023 §1.14); username cannot be removed once set (038); home_country cannot be removed once set (113). The last two are silently COERCED back rather than raised — assertions covering them must read the stored value, never a SQLSTATE — each keyed on its own old value so it covers a rider mid-wizard, and both placed above the completion early return because below it neither would ever run for an onboarded rider. Since 075 there is no location requirement on any arm. Named for the first rule only; see 012.';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. The column exists, is nullable, has no default. Expected: text | YES | NULL.
--
--   select data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles'
--      and column_name = 'home_country';
--
-- 2. Both constraints exist and both are VALIDATED. Expected: 2 rows, both t.
--
--   select conname, convalidated from pg_constraint
--    where conrelid = 'public.profiles'::regclass
--      and conname like 'profiles_home_country%' order by conname;
--
-- 3. The list did not lose an entry to a stray comma. Expected: 249.
--
--   select cardinality(string_to_array(
--           substring(pg_get_constraintdef(oid) from '\{(.*)\}'), ','))
--     from pg_constraint where conname = 'profiles_home_country_is_assigned';
--
-- 4. The grants landed, scoped to the GRANTEE — `postgres` and `service_role`
--    hold everything by Supabase default, so a table-wide count reads wrong
--    against a correct database (015's recorded footer bug). Expected: t, t, t.
--
--   select has_column_privilege('authenticated','public.profiles','home_country','select'),
--          has_column_privilege('authenticated','public.profiles','home_country','insert'),
--          has_column_privilege('authenticated','public.profiles','home_country','update');
--
-- 5. ** THE ONE THAT CATCHES THE ONE-LINE GRANT. ** 025's revoke must still
--    stand: nothing on this table is readable or insertable TABLE-WIDE. If
--    either of these reads true, §4 was collapsed into a single statement and
--    the four server-owned columns are exposed again. Expected: f, f.
--
--   select has_table_privilege('authenticated','public.profiles','select'),
--          has_table_privilege('authenticated','public.profiles','insert');
--
-- 6. And the four server-owned columns are individually still closed.
--    Expected: f, f, f, f.
--
--   select has_column_privilege('authenticated','public.profiles','terms_accepted_at','select'),
--          has_column_privilege('authenticated','public.profiles','onboarding_completed_at','select'),
--          has_column_privilege('authenticated','public.profiles','terms_version','select'),
--          has_column_privilege('authenticated','public.profiles','analytics_opt_out_at','select');
--
-- 7. `anon` holds nothing on the new column. Expected: f, f, f.
--
--   select has_column_privilege('anon','public.profiles','home_country','select'),
--          has_column_privilege('anon','public.profiles','home_country','insert'),
--          has_column_privilege('anon','public.profiles','home_country','update');
--
-- 8. The new arm is in the body, and it is ABOVE the early return. Expected:
--    t | t. The second is a POSITION comparison, not a presence one, because
--    "the arm exists" passes just as well when it is dead code.
--
--   select prosrc like '%coalesce(new.home_country, old.home_country)%'      as arm_present,
--          strpos(prosrc, 'coalesce(new.home_country, old.home_country)')
--            < strpos(prosrc, 'new.onboarding_completed_at := old.onboarding_completed_at') as above_early_return
--     from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc;
--
-- 9. The posture did not move. Expected: f | {search_path=""}. Security INVOKER
--    (033) or the `current_user` gate stops meaning anything.
--
--   select prosecdef, proconfig from pg_proc
--    where oid = 'public.enforce_onboarding_completion'::regproc;
--
-- 10. Both triggers still present, still NOT column-scoped. Expected 2 | 0.
--     A trigger scoped `OF username` would still be BEFORE UPDATE, would still
--     read correctly at a glance, and would never fire for a country-only PATCH.
--
--   select count(*)                                as triggers,
--          count(*) filter (where tgattr <> '')    as column_scoped
--     from pg_trigger
--    where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--
-- 11. ** `complete_onboarding` IS UNCHANGED — this file must not touch it. **
--     Expected: 1 row, `p_location text`, md5 1a5aaf004acb6e68eee5039fba133ae0.
--     More than one row is an overload and is PGRST203 on every signup.
--
--   select pg_get_function_identity_arguments(oid), md5(prosrc)
--     from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'complete_onboarding';
--
-- 12. No new security advisors. This file creates no function in `public` that
--     did not already exist — the only function it touches is a
--     `create or replace` of an existing TRIGGER function, which is not
--     PostgREST-reachable — so the
--     `authenticated_security_definer_function_executable` count SHALL NOT move.
--     DEV read 42 before this applied. Anything else is unexpected and belongs in
--     `docs/reference/migrations.md` §Security advisors.
--
--   get_advisors(security)
--
-- 13. The participation gate is untouched. Expected: 22 on DEV, and 0 rows for
--     `profiles` — an UPDATE on `profiles` is deliberately NOT gated, so an
--     account that never called `accept_terms()` can still set a username.
--
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--   select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where t.tgname = 'enforce_participation_gate' and c.relname = 'profiles';
