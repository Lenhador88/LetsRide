-- 071: `rides` gets an index on `departure_at`.
--
-- The rides list grew a second window on 2026-08-19 — "Previous rides", every
-- ride behind the start of today — and that window is what makes this table's
-- only ordering column worth an index. Before it, `rides` was scanned and
-- sorted on `departure_at` with no index at all (the five that existed are the
-- primary key, `organizer_id`, `(club_id, created_at)` and the two partial
-- `map_*_path` ones), and that was tolerable because the one query bounded
-- itself: rides scheduled *ahead* are as many as riders have planned, and no
-- more.
--
-- The previous-rides window has no such ceiling. It is every ride ever created,
-- and it grows monotonically for the life of the app. The failure it produces
-- is not a slow page on day one — it is a seq scan whose range widens every
-- week, which is the kind that is invisible until it is not.
--
-- ---------------------------------------------------------------------------
-- WHY ONE PLAIN BTREE AND NOT TWO, OR A DESC ONE
-- ---------------------------------------------------------------------------
-- The two windows sort in opposite directions — upcoming ascending, previous
-- descending — and a btree is scannable backwards at no cost, so one ascending
-- index serves both. `create index ... (departure_at desc)` would be the same
-- index with the same cost and a name implying a direction it does not need.
--
-- It is deliberately NOT a composite with `club_id` or `organizer_id`. Those
-- two filters already have their own indexes, and the planner combining a
-- selective equality with this ordering is the ordinary case; a composite would
-- serve one filter and be dead weight for the other two call sites (unfiltered,
-- and the `mine` join arm).
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT FIX
-- ---------------------------------------------------------------------------
-- Row-level security still evaluates `private.is_blocked` and
-- `private.is_club_member` per candidate row, so a viewer with narrow
-- visibility — a new rider in no clubs — still walks deep into history before
-- twenty rows pass. The index removes the sort and gives the walk an order to
-- follow; it does not make the policy cheaper. A real history screen wants
-- keyset pagination, the shape `036` §9 uses for notifications.
--
-- Additive and reversible: `drop index if exists public.rides_departure_at_idx;`
-- No policy changes, so no new assertion in `supabase/tests/`.

create index if not exists rides_departure_at_idx
  on public.rides using btree (departure_at);

comment on index public.rides_departure_at_idx is
  'Orders both windows of the rides list (071). Ascending serves the descending previous-rides scan too — a btree reads backwards. Added when the list stopped being upcoming-only and its second window became unbounded by anything.';
