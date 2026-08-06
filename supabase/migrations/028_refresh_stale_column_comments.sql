-- 028: correct a column comment that names a file deleted with the server render.
--
-- =========================================================================
-- ** PURELY ADDITIVE — one `comment on column`. No DDL, no grant, no policy,
-- no data. Safe to apply on its own, in either order relative to a deploy. **
-- =========================================================================
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- `003` set this comment on `profiles.onboarding_completed_at`:
--
--   "NULL = onboarding incomplete; proxy.ts gates every app route on this.
--    Set once, at the end of the wizard; enforced one-way by
--    enforce_onboarding_completion()."
--
-- `src/proxy.ts` was deleted on 2026-08-06 with the client-render migration.
-- Routing now lives in `src/lib/auth/guard.ts`, a pure function applied by
-- `src/components/auth/RouteGuard.tsx` in the browser — which is explicitly
-- **not** a security boundary.
--
-- Two reasons this is worth a migration rather than a shrug:
--
--   1. A database comment is the `data` agent's first read. `list_tables`
--      (verbose) and `\d+` both surface it, so this is the one piece of stale
--      migration-era documentation that no amount of editing `CLAUDE.md` or
--      `docs/HANDOFF.md` can reach. Every other reference was fixed in the
--      same session; this one needed a file.
--
--   2. It understates the current guarantee in the direction that matters.
--      Read literally, it says a *client-side redirect* is what holds
--      decision #5 — which would be alarming, and is exactly the reading the
--      repo's own docs warn against. The truth is stronger: `023`'s
--      `enforce_participation_gate` refuses the writes in the database, so a
--      rider who defeats the guard reaches a screen whose every write is
--      refused.
--
-- Scope check, run against the live project before writing this file — this is
-- the only comment in `public` (column, table or function) still naming
-- `proxy.ts`, a Server Action, `revalidatePath`, middleware, the server render
-- or `@supabase/ssr`:
--
--   select c.relname, a.attname, d.description
--   from pg_description d
--   join pg_class c on c.oid = d.objoid
--   join pg_namespace n on n.oid = c.relnamespace
--   join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
--   where n.nspname = 'public'
--     and (d.description ilike '%proxy.ts%'
--       or d.description ilike '%server action%'
--       or d.description ilike '%revalidatePath%'
--       or d.description ilike '%middleware%'
--       or d.description ilike '%server render%'
--       or d.description ilike '%supabase/ssr%');
--
-- ---------------------------------------------------------------------------
-- Why no assertion is added to supabase/tests/
-- ---------------------------------------------------------------------------
-- The repo's rule is that a migration changing a **policy** must add an
-- assertion. This changes no policy, no grant and no constraint — it changes
-- prose. `enforce_onboarding_completion()`'s one-way behaviour and `023`'s gate
-- are both already asserted, by `003`'s and `023`'s own cases; asserting the
-- text of a comment would test this file against itself.

comment on column public.profiles.onboarding_completed_at is
  'NULL = onboarding incomplete. Set once, at the end of the wizard, and '
  'enforced one-way by enforce_onboarding_completion(). Participation is gated '
  'in the database by 023 enforce_participation_gate, NOT by the client route '
  'guard in src/lib/auth/guard.ts — the guard is a UX affordance and is not a '
  'security boundary.';

-- ---------------------------------------------------------------------------
-- Verification (expect exactly one row, and zero from the scope check above)
-- ---------------------------------------------------------------------------
--   select col_description('public.profiles'::regclass,
--            (select attnum from pg_attribute
--             where attrelid = 'public.profiles'::regclass
--               and attname = 'onboarding_completed_at'));
