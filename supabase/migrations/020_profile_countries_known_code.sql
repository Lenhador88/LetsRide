-- 020: a country code must be a country.
--
-- 014 gave `profile_countries.country_code` a shape check — `^[A-Z]{2}$` — and
-- said so plainly: "this constraint is the whole of the referential discipline".
-- Membership of the actual ISO 3166-1 list lives in `COUNTRY_CODES`
-- (src/lib/countries.ts) and is checked by Zod alone. So `ZZ` stores
-- successfully today and renders, forever, as a blank flag beside its own code
-- — `countryFlag` maps it to two regional indicators nothing pairs, and
-- `countryName` falls back to the code itself.
--
-- Cosmetic rather than dangerous, and still worth the migration: once the client
-- owns the mutation path, `COUNTRY_CODES.includes(value)` is advice.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against the hosted project 2026-08-05
-- ---------------------------------------------------------------------------
--   profile_countries rows .................................... 5
--   distinct codes ............................ ES, FR, NL, PT, RO
--   rows failing the shape check .............................. 0
--   rows failing the membership check below ................... 0
--
-- Zero violating rows, so the constraint is added VALIDATED. Re-run before
-- applying if this has been sitting:
--
--   select country_code, count(*) from public.profile_countries group by 1 order by 1;
--
-- ---------------------------------------------------------------------------
-- No `countries` table, and the list is generated rather than typed
-- ---------------------------------------------------------------------------
-- 014 declined a reference table deliberately — nothing joins against one, and
-- it would be 195+ rows of data this app never reads. That decision stands; the
-- spec restates it as a requirement ("the picker's list stays the client's").
--
-- **The 249 values below were extracted from `src/lib/countries.ts` by script,
-- not transcribed.** That matters more than it sounds: this is the third
-- hand-kept pairing in the repo (011's report reasons and 003's reserved
-- usernames are the others) and every one of them carries the same standing risk
-- — nothing automatically reconciles the SQL copy with the TypeScript one. What
-- reduces the risk here is that the copy was machine-made once. Regenerate it
-- the same way if the list ever changes:
--
--   node -e "const s=require('fs').readFileSync('src/lib/countries.ts','utf8'); ..."
--
-- Verified at extraction: 249 codes, no duplicates, every one matching
-- `^[A-Z]{2}$` — so this constraint is strictly narrower than 014's and does not
-- contradict it.
--
-- ---------------------------------------------------------------------------
-- 014's shape check is kept
-- ---------------------------------------------------------------------------
-- It is now redundant — every member of the list below is two uppercase letters
-- — and it stays anyway, for two reasons. Dropping it is a removal in a phase
-- defined as additive, and it is the constraint that names *case* as the rule,
-- which is the thing a rider sending `nl` actually violates. Two constraints
-- also give two different error identities to a client that eventually wants to
-- tell "not a code" from "not a country".

alter table public.profile_countries
  add constraint profile_countries_code_is_assigned
  check (country_code = any (array[
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

comment on constraint profile_countries_code_is_assigned on public.profile_countries is
  'The 249 assigned ISO 3166-1 alpha-2 codes, generated from src/lib/countries.ts (020). Kept in step by hand — regenerate rather than edit by eye.';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 2 — the shape check from 014 and the membership check from 020.
--   select count(*) from pg_constraint
--    where conrelid = 'public.profile_countries'::regclass and contype = 'c';
--
-- Expected: t — validated, not NOT VALID.
--   select convalidated from pg_constraint
--    where conname = 'profile_countries_code_is_assigned';
--
-- Expected: 249 — the list did not lose an entry to a stray comma.
--   select cardinality(string_to_array(
--           substring(pg_get_constraintdef(oid) from '\{(.*)\}'), ','))
--     from pg_constraint where conname = 'profile_countries_code_is_assigned';
--
-- ZZ, XX and lowercase `nl` are all asserted rejected in the RLS suite, and NL
-- asserted accepted so this cannot pass by refusing everything.
