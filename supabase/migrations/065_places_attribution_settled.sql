-- The `places` table comment carries the attribution position, and that position
-- changed. PD-191 settled it on 2026-08-18: Overture publishes the Places theme
-- under CDLA Permissive 2.0 and Apache 2.0, not ODbL.
--
-- **Why this needs a migration at all.** `037` put the open question in the table
-- comment deliberately — its header says the point is that the question "travels
-- with the data instead of with a session". That worked: a `data` agent running
-- `list_tables` reads the comment, not this repo's markdown. So turning the flag
-- in the docs and leaving the comment behind would leave the one artifact
-- designed to outlive a session asserting the retracted position, to exactly the
-- audience it was written for.
--
-- `037` and `039` must not be edited (both set this comment; `039` last), so the
-- correction is a new file that re-states the whole comment. Everything below the
-- attribution sentences is `039`'s text verbatim — this file changes the licence
-- position and nothing else.
--
-- **Comment-only. No DDL, no policy, no grant, no data.** Nothing to assert in
-- the RLS suite: `obj_description` is not a privilege.

comment on table public.places is
  'Self-hosted place index for ride meeting points (037), built from Overture Maps open data — NOT rider content: no owner, no author, loaded out of band by `\copy` and readable by every signed-in rider. ATTRIBUTION IS SETTLED (PD-191, 2026-08-18) and it is NOT ODbL: Overture publishes the Places theme under CDLA Permissive 2.0 and Apache 2.0, with no share-alike, and CDLA §3 exempts what an application renders ("Results") from carrying the licence text. Measured over 527,725 sampled rows — roughly 72% of the extract — ZERO cite OpenStreetMap; the sources present are Overture, meta, Foursquare, Microsoft, AllThePlaces, PinMeTo, DAC and Krick, so an "© OpenStreetMap contributors" credit would name a contributor that supplied nothing. The credit is paid ONCE, on /legal/attributions, and a screen rendering a place result owes nothing further. INFERRED, not measured: the per-source table at docs.overturemaps.org/attribution/ says some sources carry "special terms" and could not be read (that host is egress-blocked; the summary came through WebSearch). Geoapify''s map tiles are a separate vendor with an unconditional OpenStreetMap credit of their own — a different line on the same page, never merged into this one. Search it through public.search_places(), never with an ad-hoc ILIKE — the function carries the guard that keeps a broad query off a full-table scan, and since 039 it also carries the per-token AND and the name-over-address ranking that make a widened search useful rather than merely wider. `search_text` is generated from name, brand, street and locality; never write to it and never name it in a `\copy` column list. POI rows only — Overture''s addresses theme (17.8M NL rows, 1.5 GB) is deliberately not imported, so a residential address is not findable here.';
