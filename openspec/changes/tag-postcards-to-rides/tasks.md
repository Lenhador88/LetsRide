## 0. Before any SQL — four answers, two re-derivations

- [x] 0.1 **Pre-flight, MEASURED 2026-08-09 against `zwprydcyryvudhurbnye` (PROD) and
  `fpmrimzxadewsaiwpsel` (DEV) via the Supabase MCP, RLS bypassed — true counts, not per-viewer:**

  | Fact | Value |
  |---|---|
  | `postcards.ride_id` | **does not exist**; `ride_id` is on `ride_members`, `ride_messages`, `notifications` only |
  | `postcards` grants to `authenticated` | **table-level** SELECT, INSERT, UPDATE, DELETE — `attacl` empty |
  | `postcards` UPDATE policy | **exists** — `using (author_id = auth.uid())`, `with check` = the INSERT one |
  | `postcards` triggers | `enforce_participation_gate` (BEFORE INSERT), `postcards_set_updated_at` (BEFORE UPDATE) — **nothing imposes `created_at`** |
  | `rides.organizer_id` FK | `ON DELETE CASCADE` |
  | `private.is_ride_crew` | `security definer`, `search_path=''`, organizer or any `ride_members` row, no status filter |
  | `private.is_club_member` | reads `auth.uid()` **internally** — unusable at fan-out |
  | `postcards` indexes | 5, including `(club_id, created_at desc) WHERE club_id IS NOT NULL` — the shape to copy |
  | Migration files / applied | **40 / 40 on both projects**, zero drift; `041` free |
  | Security advisors | **8**, matching `CLAUDE.md`'s table |

  Two of these change the shape of the work. The **table-level grant** means the column is not
  additive: it arrives writable and re-writable. The **absent `created_at` trigger** is a
  pre-existing defect this change files rather than fixes (proposal §Two defects).

- [ ] 0.2 **Q1 — product owner, non-blocking.** Is the Journal readable by anyone who can see the
  ride, or crew-only like the chat? Default: **anyone who can see the ride**. Each postcard is
  already filtered by its own audience, so a non-crew viewer learns nothing they could not read in
  their feed; chat is narrower because it is a conversation, not content. Build proceeds on the
  default — flipping it later is one conjunct and a handful of assertions.
- [ ] 0.3 **Q2 — designer, blocking task 4.11 alone.** How does a postcard acquire a ride? **No frame
  draws it**, in either place it could live (`design.md` §D5). Default: a **Ride** select on
  `CreatePostcardForm` mirroring its Club select, plus a sticky action on the Journal deep-linking to
  `/postcards/new?ride=<id>` with the select pre-filled and still editable. Groups 1–3 do not depend
  on the answer, and neither does the rest of group 4 — the Journal screen itself (4.8, 4.9) is a
  read and ships whichever way this lands.
- [ ] 0.4 **Q3 — product owner, non-blocking.** Journal order: newest-first, or chronological?
  Default: **newest-first**, matching every other list in the app. The index serves a backward scan,
  so flipping it costs no schema change.
- [ ] 0.5 **Q4 — product owner, blocking the follow-up and not this change.** Does the deferred
  `postcard_on_ride` notification go to the whole crew or to `going` only? Default: **the whole
  crew**, matching `private.is_ride_crew` — but the recipient set is a **three-way** intersection,
  not the two-way one an earlier revision of this task recorded: riders who can see the **ride**, who
  are on its crew, **and** who can see the **postcard**. `036`'s SELECT requires every non-NULL
  subject column to resolve, and a `postcard_on_ride` row carries two; `is_ride_crew` is
  `security definer` and survives blocking the organizer and leaving a private club, so crew alone —
  and crew ∩ postcard-visible — both still write ghost rows. `design.md` §D6 has the policy text.
  The product question is only `going`-vs-both; the three conjuncts are not negotiable.
- [x] 0.6 Re-derive the migration number rather than trusting this file. It reads **041** at write
  time, 2026-08-09. `ls supabase/migrations/` against `list_migrations` on **both** projects, **and**
  `grep -rn "0[0-9][0-9]_[a-z_]*\.sql" openspec/changes/*/` — `enforce-creator-membership` still
  claims `029`/`030`, both long taken, and renumbers into whatever is free the day it is picked up.
- [x] 0.7 Re-read the seven columns holding UPDATE on `postcards` **in the same session** the
  migration is written, from `pg_class.relacl` / `pg_attribute.attacl`. Do not copy them from
  `proposal.md`; that list is a snapshot and the re-grant is the one statement in this change that
  fails silently when it is stale.

## 1. `041_postcard_ride_tag.sql` — the column, the gate, the grant

- [x] 1.1 Header, in `034`'s and `036`'s style, stating: that this is additive **and inert** (no
  trigger on any existing write path, unlike `036`); the retention window in words (§the cascade
  window); that SELECT is **deliberately untouched**; that the `set null` sweep runs privileged and
  is not gated by the withheld grant; and that `postcards.created_at` is client-writable and is
  **not** this change's to fix.
- [x] 1.2 `alter table public.postcards add column ride_id uuid references public.rides(id) on delete set null;`
  — nullable, no CHECK, no uniqueness, and **no constraint tying it to `club_id`** (`design.md` §D4).
- [x] 1.3 `create index postcards_ride_id_idx on public.postcards (ride_id, created_at desc) where ride_id is not null;`
  — the leading column serves the `set null` sweep, the pair serves the Journal query. Copy
  `postcards_club_id_idx`'s shape exactly.
- [x] 1.4 `column` comment saying what the column is: a tag, not an audience, and `club_id` still
  decides who sees the row.
- [x] 1.5 Replace the `postcards` INSERT policy, preserving its three existing conjuncts verbatim and
  adding one:
  `and (ride_id is null or (exists (select 1 from public.rides r where r.id = ride_id) and private.is_ride_crew(ride_id)))`.
  Policy comment naming both halves and why neither may be dropped.
- [x] 1.6 **Leave the `postcards` UPDATE policy completely alone** — no `ride_id` conjunct in `using`
  or `with check`. An earlier revision of this task added one, calling it "unreachable, since the
  column has no UPDATE grant". **That is false**: a column privilege gates the SET list, an RLS
  `WITH CHECK` is evaluated over the whole new row, so the conjunct fires on a *caption* edit and
  reproduces exactly the lockout `design.md` §D3 exists to reject. The tripwire that replaces it is
  assertion 2.9, which goes red if the column is ever granted UPDATE. State the omission in the
  header, or the next reader adds it back for symmetry with `club_id`.
- [x] 1.7 `revoke update on public.postcards from authenticated;` then
  `grant update (<the seven from 0.7>) on public.postcards to authenticated;` — **read from 0.7, not
  from any document**.
- [x] 1.8 Confirm no `grant` is issued to `anon` anywhere in the file, and that SELECT and DELETE
  policies are untouched.
- [x] 1.9 Diff `pg_policies.qual` for `postcards` SELECT before and after as **text**. It must be
  byte-identical. A prose claim does not discharge this task.

## 2. `supabase/tests/rls_test.sql` — the assertions (`openspec/config.yaml`: a policy change with no new assertion is not finished)

- [x] 2.1 Fixtures: two clubs (one public, one private), three rides (public/no club, public club's,
  private club's), an organizer, a crew member of each status, a non-crew rider who can see the
  public rides, a non-member of the private club, and a blocked pair.
- [x] 2.2 **Audience unchanged, widening direction**: a non-member of private club C sees zero rows
  for a C-scoped postcard tagged to a ride they are on the crew of.
- [x] 2.3 **Audience unchanged, narrowing direction**: an app-wide postcard tagged to a private club's
  ride is still returned to a rider who cannot see that ride.
- [x] 2.4 Crew member (`going`) tags successfully; crew member (`maybe`) tags successfully — identical
  rights, no status filter.
- [x] 2.5 Non-crew rider who **can** see a public ride is refused. Attributable to the crew conjunct.
- [x] 2.6 Non-member of a private club is refused for that club's ride, **and remains refused while
  holding a `ride_members` row** inserted as the table owner. Attributable to the visibility conjunct.
- [x] 2.7 Crew member who has blocked the organizer is refused — asserted **separately** from 2.6, so
  removing either conjunct fails a case the other does not.
- [x] 2.8 Crew member who has left the private club is refused — asserted separately again.
- [x] 2.9 `has_column_privilege('authenticated','public.postcards','ride_id','UPDATE') = false`. **Name
  the role; do not attempt the write** (`031`). This is the tripwire standing in for the conjunct 1.6
  removes.
- [x] 2.9a **A caption edit on a *tagged* postcard still succeeds after its author leaves the crew.**
  Set up the author as crew, tag, remove the crew row, then `update postcards set caption = …`. It
  must pass. This is the case that goes red the day somebody adds the `ride_id` conjunct to the UPDATE
  policy, and its label SHALL point at `rls_test.sql:719-727` — the *contrasting* `club_id` case,
  which is asserted as a refusal and is accepted because `club_id` is updatable.
- [x] 2.10 **Rewrite `rls_test.sql:977`, which `041` turns red.** It asserts
  `has_table_privilege('authenticated','public.postcards','update') = true`; after the
  revoke-and-regrant that is **false** while every column-level answer stays true — the shape
  `notifications` already has (measured on DEV: table `false`, column `true`). Replace it with
  per-column `has_column_privilege` assertions and a label saying the table-level answer is now
  deliberately false. **This is a behaviour change to a passing test, not a rename** — leaving it is
  a red suite, and "fixing" it by flipping the expected value to `false` without the per-column
  replacement drops the coverage entirely.
- [x] 2.11 The six unambiguous re-granted columns asserted with `has_column_privilege(…,'UPDATE')`,
  so an omission in 1.7 fails here rather than in production: `id, author_id, club_id, image_path,
  caption, updated_at`.
- [x] 2.11a `created_at`'s UPDATE grant asserted **separately, labelled as pinning a known defect** —
  `PD-163`, the client-writable feed sort key and pagination cursor. `041` preserves it because this
  change must not silently alter an unrelated column, **but the assertion SHALL NOT be worded as an
  invariant**: it records the status quo so that fixing `PD-163` is a deliberate edit to a labelled
  line rather than a surprise failure.
- [x] 2.12 `has_column_privilege('authenticated','public.postcards','ride_id','INSERT')` and `'SELECT'`
  are both true. **The SELECT half was inverted by `062` (PD-166)** — the assertion is still in
  `rls_test.sql`, relabelled and expecting `false`, because it is the record of why the grant existed.
  INSERT is unchanged.
- [x] 2.13 A rider cannot set `ride_id` on another rider's postcard — pre-existing rule, new reason
  to try.
- [x] 2.14 **The club/ride orthogonality**, which no assertion covered: a rider who is a member of
  club C and crew of an unrelated public ride R tags a C-scoped postcard to R successfully, and a
  crew member of R who is **not** in C gets zero rows for it. This is `ride-journal`'s
  *SHALL NOT be constrained to agree* requirement, and without it the tempting agreement trigger
  could be added with a green suite.
- [x] 2.15 **A club owner and an `admin` get no elevated read** into a ride's Journal — the row of
  the role table with no other assertion behind it. Insert the `admin` row as the table owner and say
  why in the label: `club_members` has no UPDATE policy, so `admin` is unreachable through the client
  (`036`'s finding, unchanged).
- [x] 2.16 Delete a ride: postcards survive with `ride_id` NULL, asserted **from the other rider's
  session**, not the deleter's.
- [x] 2.17 The set of riders who can select a postcard is identical before and after its tag is
  nulled — the audience-invariance assertion.
- [x] 2.18 Blocking, both directions, still removes a rider's postcards from the Journal query
  specifically (not only from the feed).
- [x] 2.19 A `postcard_hides` row still removes the postcard from the Journal query.
- [x] 2.20 `anon` holds no grant on `postcards.ride_id` in any verb.
- [x] 2.21 A rider with `terms_accepted_at` NULL still cannot insert a postcard, tagged or untagged.
- [x] 2.22 **A nonexistent ride id and an invisible one both raise `42501`** — the error shape is a
  property of the gate, not an accident. Measured 2026-08-09 on DEV in a rolled-back transaction:
  `WITH CHECK` is evaluated before the FK's `AFTER ROW` referential trigger, so `23503` is
  unreachable while the visibility conjunct stands. The assertion pins that, because removing the
  conjunct would reintroduce the distinction as a real oracle.
- [x] 2.23 Run the whole suite and reconcile by **label set**, not count — a count cannot tell a
  rename from a loss. Baseline is 958 assertions; re-derive with
  `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`. **2.10 changes an existing label**, so
  expect exactly one removal alongside the additions and confirm it is that one.

## 3. Apply, and verify against the live databases

- [x] 3.1 Apply to **DEV** first. Then `get_advisors(security)` — expect **8**, unchanged. A new WARN
  means a function landed in `public` or a revoke did not.
- [x] 3.2 On DEV, in a rolled-back transaction: insert a postcard tagged to a ride as a crew member,
  as a non-crew rider, and as a non-member of a private club. Three outcomes, by hand, before PROD.
- [x] 3.3 On DEV, confirm the seven UPDATE column grants by query, and confirm `ride_id` is absent
  from them.
- [ ] 3.4 Apply to **PROD**, then re-run 3.1 and 3.3 there. **Deliberately NOT done 2026-08-09** —
  the implementing session was scoped to DEV, and both databases being level beforehand does not make
  promotion that session's call. Nothing gates it: `041` is inert (no trigger on any existing write
  path) and no code depends on it. **Re-derive the seven UPDATE columns against PROD at apply time**
  rather than copying them from `041` §3 — that statement is the one that fails silently when stale.
- [ ] 3.5 `npm run db:drift` — files against both databases. **Not run 2026-08-09**: it needs
  `PROD_DATABASE_URL` / `DEV_DATABASE_URL`, which no session holds. The equivalent was done through
  the MCP instead (`list_migrations` on both against `ls supabase/migrations/`) — DEV 41, PROD 40,
  files 41 — so drift is **known and expected** until 3.4 lands, and `db:drift` will report `041`
  missing from PROD, correctly.

## 4. Code — reads, writes, screens

- [ ] 4.1 `src/types/index.ts`: `Postcard` gains **neither** `ride_id` **nor the embedded ride**, and
  the second half is the one that will surprise whoever picks this up. `062` revoked the client's
  SELECT on the column, so `POSTCARD_SELECT` cannot name it — and a PostgREST embed
  `rides(…)` on a postcard read is a join whose predicate references `postcards.ride_id`, which
  Postgres privilege-checks exactly as it does a target list. **The embed is `42501` too**, which
  takes 4.3 with it. See the note under 4.3 before designing around it.
  (This task read *"gains `ride_id: string | null`… `POSTCARD_SELECT` is `*`, so the raw id arrives
  everywhere"*; PD-165 ended the `*` and PD-166 ended the grant.)
- [ ] 4.2 `src/lib/data/postcards.ts`: `getRideJournal(rideId)` — two steps, because `062` moved the
  filter: `supabase.rpc('ride_journal_postcard_ids', { ride: rideId })` for the ids, then
  `POSTCARD_SELECT` with `.in('id', ids)`. **Order it in the second query** —
  `.order('created_at', { ascending: false }).order('id', { ascending: false })`. **Both keys, and
  the reason is determinism rather than symmetry**: a single-key order leaves a `created_at` tie
  unspecified, which also makes keyset paging on this step repeat and skip rows across page
  boundaries — two riders posting from the same batch upload is enough. Matching the accessor's
  `created_at desc, id desc` exactly is then the free part. **The accessor's own ordering is not
  inherited here**: `.in(…)` does not preserve the order of the list it is handed, whatever `062.5`
  pins about the accessor read directly.
  **The ROWS stay invoker-rights** — no Edge
  Function, no service-role read, and no function returning postcard rows. The accessor is the one
  `security definer` step and it returns ids only; see the amended requirement *"The Journal SHALL be
  read under the caller's own row security"*. The feed's `before` cursor does not carry over as
  written — the accessor takes no page — so either page in the second step or state that a ride's
  Journal is unpaginated.
- [ ] 4.3 **BLOCKED BY `062`, and it is a product question rather than a task.** This read: *"The ride
  embed on the postcard read is RLS-filtered; a NULL embed renders nothing — no chip, no 'Private
  ride', no disabled control. No second lookup on the raw id, ever."* The embed needs SELECT on
  `postcards.ride_id` (see 4.1), so **a postcard cannot show its ride at all** — not the chip, not
  the name, not a fallback. `062`'s header states the same consequence and notes that no frame in the
  design draws such a chip today, which is why it did not block that change.
  **Do not quietly build around it.** Either the chip stays absent — the position `062` recorded, and
  the cheapest — or a second accessor is written for postcard → ride, at which point its visibility
  rule has to be stated the way the Journal's was, because it hands back exactly the correlation
  PD-166 closed. That is the owner's call and it belongs in PD-257's proposal, not in a task list.
  What survives unchanged either way: **no second lookup on a raw id, ever** — there is no longer a
  raw id to look up.
- [ ] 4.4 `src/lib/data/rides.ts`: the crew-rides list backing the composer's select — exactly the set
  the write gate admits, so the picker cannot offer an option the database refuses.
- [ ] 4.5 `src/lib/validation/`: `postcardRideIdSchema`, `''` → `null`, mirroring
  `postcardClubIdSchema`. Message only — the guarantee is `041`'s.
- [ ] 4.6 `src/lib/actions/postcards.ts`: `createPostcard` carries `rideId`. **No `updatePostcard`,
  and no retag action** — the column has no UPDATE grant.
- [ ] 4.7 `src/lib/query/keys.ts`: a `journal(rideId)` key under the `postcards` group, plus its row
  in the header table. `createPostcard` widens its existing invalidation to reach it. **No
  `feed_reads` key or watermark is touched** — the Journal has no unread concept, so `markFeedSeen`
  and `club_unread_counts()` are unchanged and the Journal writes no watermark on open.
- [ ] 4.8 `src/app/(app)/rides/detail/journal/page.tsx` — built from `Ride - Journal
  (Postcards/Timeline)` (`2226:4865`), a scrolling list of `v2 / Component / Postcard` with the drawn
  divider. Gate on the data, never on `isLoading`; `null` is `notFound()`, `undefined` is a skeleton.
- [ ] 4.9 All seven states from `ride-journal`: empty (crew and non-crew variants), loading, error with
  retry, offline (cached-with-marker / `OfflineState`), permission-denied collapsed into empty with the
  decision written down, partial, stale.
- [ ] 4.10 ~~`RidePageMenu` gains the Journal row~~ — **void as written, 2026-08-17: `RidePageMenu`
  is deleted (PD-254).** The sub-page switcher it was is gone, and with it the sheet a Journal row
  would have been added to. What replaces this task: the ride plan already renders a `Journal`
  section (`RideJournalEmpty`, crew only), so there is no row to add and no absence to explain —
  the section becomes populated rather than appearing. The rule this task carried survives the
  component: **the doc comment recording why the Journal has no content must go in the same change
  that gives it content**, because a comment describing a state that has ended is the next
  session's wrong fact. It currently lives in `src/components/rides/RideJournal.tsx`.
- [ ] 4.11 `CreatePostcardForm` gains the Ride select (Q2's default until answered), and the Journal's
  sticky action deep-links to `/postcards/new?ride=<id>` — pre-filled, never hidden.
- [ ] 4.12 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 4.13 `npm run walk` against DEV — the only gate that renders anything. The Journal is a new
  detail route and the walk discovers detail routes from lists; confirm it reaches this one and does
  not silently skip it (a shrunken `N/N` is a skip, not a pass). Read
  `scripts/supabase-relay.mjs`'s header first.

## 5. Documentation and wrap-up

- [ ] 5.1 `CLAUDE.md` §Supabase Rules: the `postcards` row gains `ride_id` — *a tag, never the
  audience; `club_id` is still the audience* — and the applied-state line moves to 41 with its
  verification command intact.
- [ ] 5.2 `docs/reference/product-scope.md`: the Rides row loses "Journal needs `postcards.ride_id`"; the
  Inbox row's excluded notification keeps its entry with an updated reason (the column now exists; the
  fan-out helper does not).
- [ ] 5.3 `docs/HANDOFF.md`: position, each claim beside the command that verifies it.
- [ ] 5.4 `npm run docs:check` — the numeric doc-claims registry.
- [ ] 5.5 File the two defects from `proposal.md` §Two defects as Linear issues, labelled
  `Database`: the client-writable `postcards.created_at`, and the note that `is_ride_crew` is one RSVP
  away on a public ride so nothing anti-spam may be built on it.
- [ ] 5.6 File the `postcard_on_ride` notification as its own Linear issue, in **`Todo AI`** and not
  `Queued (AI)`, pointing at `design.md` §D6 for the recipient-set rule and the missing helper.
- [ ] 5.7 `reviewer` on the final diff, then the PR **against `development`**, then merge it.
- [ ] 5.8 `/opsx:archive` — and read the coordination note at the top of
  `specs/database-enforced-integrity/spec.md` before doing so.
