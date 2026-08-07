-- 035: close the same whitespace hole on postcard_comments that 034 found.
--
-- Linear PD-116's review; `034` §2 names this table as carrying the identical
-- gap and deliberately did not reach across to fix it. This is that fix.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
-- `011` bounds a comment with
--
--   check (length(btrim(body)) >= 1 and length(body) <= 1000)
--
-- and its own comment says that floor means "a comment of nothing but spaces is
-- refused". It does — spaces, and **only** spaces. `btrim(text)` with no second
-- argument strips U+0020 and nothing else. Measured rather than recalled:
--
--   select length(btrim(E'\n\n')), length(btrim(E'\t\t')), length(btrim('   '));
--   -->  2 | 2 | 0
--
-- So a body of newlines or tabs satisfies the constraint, while
-- `commentBodySchema`'s JS `.trim()` — which strips the whole Unicode
-- whitespace class — refuses it. **The client is stricter than the database**,
-- which is the exact inversion CLAUDE.md's "no new integrity rule may live only
-- in a Zod schema" exists to prevent: the publishable key ships in the bundle,
-- so the schema is advisory and the CHECK is the enforcement, and here the
-- enforcement is the weaker of the two.
--
-- Nothing has exploited it. It is closed because a constraint whose own comment
-- overstates it is worse than one that is plainly narrow — the next person to
-- copy this pattern inherits the gap along with the reassurance, which is
-- precisely what happened to `034`'s first draft.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured on PROD 2026-08-07 before writing this
-- ---------------------------------------------------------------------------
--   postcard_comments ................................................ 3
--   bodies that would fail the new floor ............................. 0
--   bodies that pass the old floor and fail the new one .............. 0
--
--   select count(*) filter (where body !~ '\S') from public.postcard_comments;
--
-- **Re-run that before applying.** A tightening CHECK is validated against every
-- existing row, so one whitespace-only comment written between now and the apply
-- turns this migration into a failed transaction rather than a silent problem —
-- loud, but it would need the row cleaning out first.
--
-- ---------------------------------------------------------------------------
-- Ordering: this one is DESTRUCTIVE-direction, and it still needs no code deploy
-- ---------------------------------------------------------------------------
-- docs/ENVIRONMENTS.md sequences a tightening as deploy-then-apply, because the
-- deployed code must already have stopped doing the thing the constraint starts
-- refusing. Here the code never did it: `commentBodySchema` has refused
-- whitespace-only bodies since it was written, and `addComment` parses through
-- it on every call. So there is no code half, and the safe order collapses to
-- "apply whenever". Stated rather than assumed, because "destructive migrations
-- need a deploy first" is the rule and this is a genuine exception to it.

alter table public.postcard_comments
  drop constraint postcard_comments_body_length;

-- `~ '\S'` — "contains at least one non-whitespace character" — rather than a
-- wider `btrim(body, E' \t\r\n')`, because the regex class covers every Unicode
-- whitespace character including the ones a paste can carry (U+00A0 no-break
-- space, U+2028 line separator), and `btrim` with an explicit set only ever
-- covers the characters somebody thought to list. Matches `034` exactly, so the
-- two tables now answer "is this empty" the same way.
--
-- The ceiling is unchanged and still on the RAW length, so padding cannot
-- smuggle a longer body past a trimmed check.
alter table public.postcard_comments
  add constraint postcard_comments_body_length
  check (body ~ '\S' and length(body) <= 1000);

comment on constraint postcard_comments_body_length on public.postcard_comments is
  'A comment must contain a non-whitespace character and be at most 1000 characters (011, floor corrected by 035). The floor is `~ ''\S''` rather than btrim(), which strips spaces only and therefore accepted a body of newlines.';

-- ---------------------------------------------------------------------------
-- Verification — run after applying
-- ---------------------------------------------------------------------------
--   -- the new form, on both tables
--   select conrelid::regclass::text, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conname in ('postcard_comments_body_length', 'ride_messages_body_length');
--
--   -- 0 — nothing was destroyed by the tightening
--   select count(*) from public.postcard_comments;
--
-- And the advisors must still return the documented eight: this changes no
-- policy, no grant and no function.
