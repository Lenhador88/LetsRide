# Analytics — the questions, and which ones we can already answer

Companion to [`observability.md`](observability.md), which is about what
*breaks*. This one is about what riders *do*.

**The finding that shapes everything here: most of it is already recorded.**
`profiles` carries `created_at`, `terms_accepted_at`, `username` and
`onboarding_completed_at` on every row, and every domain table carries a
timestamp. So the onboarding funnel — the highest-value question on this page —
is four counts against one table, not an events pipeline. Re-derive it rather
than trusting the sentence:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='profiles' and column_name like '%_at';
```

The queries live in [`scripts/db/analytics.sql`](../../scripts/db/analytics.sql)
and every one of them was run against DEV before being written down.

## What each number is for

A query with no decision attached is a number nobody acts on, so each row names
the decision it changes. Ordered by how much it would change what we build next.

| # | Question | What it changes | Source |
|---|---|---|---|
| 1 | Of riders who sign up, how many accept terms → set a username → complete? | whether onboarding is the leak | `profiles` |
| 2 | How long does completion take, and does anyone resume? | whether the resumable wizard earns its complexity | `profiles` |
| 3 | *Which* step rejects them — is it the username being taken? | the likeliest single fix in the funnel | **nothing — see below** |
| 4 | % of rides with no RSVP at all but the organizer, and how many drew no `going` | whether the core promise works at all | `rides` + `ride_members` |
| 5 | Postcards per author; how concentrated posting is | whether the feed is a product or one person talking | `postcards` |
| 6 | Club adoption **excluding the default club** | whether clubs are adopted | `clubs` + `club_members` |
| 7 | Riders with a deliberate write in 7 / 30 days | the only honest retention measure at this size | eight tables |
| 8 | Which screens throw, for how many riders | see [`observability.md`](observability.md) | **partly missing** |
| 9 | Are riders hitting the search / map-tile ceilings? | search fails loudly, tiles fail silently | the two spend ledgers |
| 10 | Blocks, reports and hides, as raw totals | a safety signal before it is a legal one | three tables |

Eight of the ten are SQL today. One needs events (#3) and one needs client-side
error reporting (#8) — and both of those are decisions, not tasks. Verify the
count rather than trusting it: `analytics.sql` supplies a query for every row
above except 3 and 8.

## Three definitions decide whether these numbers mean anything

They are stated in full at the top of
[`analytics.sql`](../../scripts/db/analytics.sql), where anyone editing a query
will actually hit them, rather than repeated here where the two copies would
drift. In short: **the default club is not a join a rider made** (so it is
excluded from adoption *and* from activity — otherwise finishing the wizard reads
as engagement), **crew is `going` or `maybe`** (counting only `going` files a ride
with five maybes under "nobody came"), and **activity is one union used twice**
(the snapshot and question 7 must stay identical).

Each is a way to produce a confident, wrong number, which is why they lead the
file rather than sitting in a footnote.

## The one thing SQL cannot answer

Question 3 — *which* onboarding step turns a rider away — leaves no row behind.
A rider who tries three usernames, finds all three taken and closes the tab has
written nothing: `profiles` still shows them at "consented, no username", the
same as a rider who never tried. The stage is visible; the cause is not.

That is the one genuine case for an events table here, and it is narrow enough
to build without a general analytics system: an insert-only ledger recording
*that* a username attempt was rejected, never the string attempted. The shape is
already proven twice — `place_search_attempts` records that a rider searched and
deliberately holds no column that could store the term, because a place search
is frequently a home address.

**Worth building only if the funnel says riders are actually stalling there.**
Run question 1 first.

## What we are deliberately not measuring yet

Retention cohorts, attribution, session length, cross-session funnels, and
anything that would need a hosted analytics SDK. There is no traffic to make any
of them meaningful, and each one carries the dependency, consent and store-label
costs set out in [`observability.md`](observability.md) §The open decision:
client-side error reporting.

Revisit when real riders are signing up daily, not before.

## Running them

```bash
psql "$DEV_DATABASE_URL" -f scripts/db/analytics.sql
```

or paste a block into the Supabase MCP `execute_sql` tool, which is how they
were verified. **These are operator queries** — run with elevated access, never
by the app and never through a rider's session. Nothing here is reachable under
RLS, and none of it should become a screen without its own visibility rules.
