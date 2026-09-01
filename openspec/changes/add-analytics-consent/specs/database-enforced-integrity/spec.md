# database-enforced-integrity (delta)

## ADDED Requirements

### Requirement: A column added to a table whose grants are an absolute allowlist SHALL state its grant decision explicitly

Six migrations in this repo replaced a table-level grant with an **absolute** `revoke` plus an
explicit column allowlist, because a bare `revoke select (col)` against a table-level grant is a
documented no-op (`025` §DEFECT 1). On such a table, **a column added later is invisible to
`authenticated` until somebody names it**, and a column named later is visible to everyone the
row policy admits.

Every migration adding a column to one of those tables SHALL state, in the file, which of the three
lists the column joins and why — including when the answer is "none of them". Silence is not a
decision; it is `025`'s standing cost collecting.

Two further rules follow, and the second is the one this repo has already been bitten by:

- **A migration that needs to widen an allowlist SHALL issue a bare additive `grant` naming only
  the new column.** It SHALL NOT restate the list.
- **If a migration ever must restate one, it SHALL carry the full current list plus its addition.**
  `044` and `046` are the worked example and they fail SILENTLY: both issue an absolute `revoke
  update` + `grant update (…)` rather than a delta, and `044`'s list still names `id` and
  `author_id`, so running `046` first reinstates exactly what `046` removed with no error and
  nothing red (`docs/reference/migrations.md` §The ordering chain).

**The set of affected tables SHALL be re-derived, never read off a list.** That reference's own
table names six tables and its own re-derive query returns **20** on DEV as of 2026-09-01,
`profiles` and `feedback` among them:

```sql
select c.relname, count(*) filter (where a.attacl is not null) as columns_with_acl
from pg_class c join pg_attribute a on a.attrelid = c.oid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0
group by 1 having count(*) filter (where a.attacl is not null) > 0 order by 1;
```

#### Scenario: A new column on `profiles` states its grant decision
- **WHEN** a migration adds a column to `public.profiles`
- **THEN** the file SHALL say whether the column joins `025`'s SELECT, INSERT and UPDATE lists, and
  why
- **AND** if it joins none, the file SHALL name the accessor through which the client reaches it
  instead, or state that no client reaches it at all

#### Scenario: Widening an allowlist does not restate it
- **WHEN** a migration grants a client role a privilege on a new column of such a table
- **THEN** the statement SHALL name only that column
- **AND** the privileges the table already had SHALL be unchanged afterwards, verified by
  `has_column_privilege` per column rather than by reading the migration

#### Scenario: A column with no grant is invisible rather than broken
- **GIVEN** a column on `profiles` in none of `025`'s three lists
- **WHEN** any code path reads the caller's own profile row
- **THEN** it SHALL use an explicit projection that omits the column, never `select('*')`
- **AND** adding the column to `OWN_PROFILE_COLUMNS`, `PUBLIC_PROFILE_COLUMNS` or
  `VIEWED_PROFILE_COLUMNS` SHALL turn the reading screen into a `42501` on the error boundary —
  which is `025` §DEFECT 2d and is a build error, not a leak

### Requirement: A rider's preference SHALL NOT become an authorization gate

A column recording what a rider *wants* SHALL NOT be read by any policy, CHECK, grant or trigger
that decides what a rider *may do*. The moment it is, a preference has become a permission and a
rider who expresses one gets a degraded app they never asked for.

The distinction is not stylistic. This repo's gates — `023`'s participation gate, `019`'s role
rules, the block helper — all answer "is this rider allowed". A preference answers "what did this
rider choose", and the two have different failure directions: a wrong gate refuses a legitimate
write, a wrong preference produces slightly wrong data.

The one shape that is permitted is a trigger that **normalises a column and never refuses a row**.

#### Scenario: A preference is not tested by anything that can refuse
- **WHEN** the objects reading a preference column are enumerated
- **THEN** none SHALL be a policy `using`/`with check` clause, a CHECK constraint, or a trigger with
  a `raise` reachable from that read
- **AND** any trigger that does read it SHALL only ever assign to a column of `NEW`

#### Scenario: A rider who expresses a preference loses no capability
- **GIVEN** two riders identical but for the preference
- **WHEN** each performs every write path the app offers
- **THEN** the outcomes SHALL be identical, row for row, error for error
