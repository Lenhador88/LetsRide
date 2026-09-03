# Running things in this container

> The per-command table, the relay Chromium needs to reach Supabase, and the walk.
> `CLAUDE.md` §Development Workflow has the short list; this is the long one.

## Running things in this container

**Measured 2026-08-06. Re-measure rather than trust — each line is one command.**

| What | How |
|---|---|
| RLS suite | **`PGPASSWORD=postgres npm test`** — without it `psql` prompts and fails, which looks like a broken suite rather than a missing credential. If it says *connection refused*: `pg_ctlcluster 16 main start`. If it then says *password authentication failed*: `alter user postgres with password 'postgres'`. Neither message reads as its own cause. Local is **Postgres 16**, CI is 17 |
| Assertion count | `PGPASSWORD=postgres npm test 2>&1 \| grep -c "NOTICE:  ok"` — **3310**, measured on local Postgres 16 (CI runs 17). **Compare label sets rather than counts** when reconciling two runs: a count cannot tell a rename from a loss. `038` moved this by +36 new and −1 relabelled; `041` by +86 new and −1 relabelled (`authenticated can update postcards (caption edits)`, which `041` turns false at table level and true per column); `042` by +5 new and −1 relabelled (`038: ... and authenticated DOES hold the table-level DELETE grant`, whose expected value `042` flips to false); `043` by +62 new and 0 relabelled; PD-101's ex-member-organizer case (1.4b, labelled `017:` because it constrains that file's UPDATE policy) by +13 new and 0 relabelled; `044` by +17 new and −3 relabelled (`041`'s `created_at` and `updated_at` UPDATE-grant lines, which `041` labelled as pinning a known defect and `044` flips to false, plus its seven-column `string_agg` which is now five); `045` by +39 new and −2 relabelled (`043`'s two ownership `assert_denied` labels, which had to move because `assert_denied` recognises 42501 and nothing else — a missing column grant and a failed `with check` are indistinguishable to it, so both lines would have kept passing while naming the layer that no longer does the work); `046` by +12 new and −5 relabelled (`041`'s `id` and `author_id` UPDATE-grant lines and the `postcards` UPDATE `string_agg`, the `postcards` hand-off `assert_denied` for the same layer-swap reason as `045`, and the `rides` UPDATE policy pin, which moved from `LIKE '%auth.uid() = organizer_id%'` to exact text because the substring survives the precise relaxation the assertion exists to catch); `047` and `048` together by +33 new and −1 relabelled (`045`'s `club_members` table-level UPDATE-grant line, which exists to prove the "cannot promote" case measures RLS rather than a missing grant — `048` makes that grant column-level, so the table-level answer goes false and the label would have kept naming a mechanism that no longer runs; repointed to `has_column_privilege(… 'role', 'UPDATE')`, which preserves the intent exactly); `049` by +23 new and 0 relabelled — it adds a section rather than changing an existing mechanism, which is why nothing had to move; `051`, `052` and `053` together by **+85 new and −2 relabelled**, reconciled by label set against `origin/development` in a scratch worktree rather than by arithmetic (`045`'s `exactly eight columns of rides hold UPDATE`, now `045/051:` and thirteen, because `051` adds the five tile columns and they ARE updatable by design; and `nine gate triggers, one per gated table`, now `ten`, because `051` hangs `enforce_participation_gate` on the ledger — that second one also makes CLAUDE.md's nine-table list environment-dependent until `051` reaches PROD); `054` by **+64 new and −1 relabelled**, and that relabel is an **expected-value flip** rather than a rename — `036: an ownerless owner cannot see their own private club's ride TODAY` pinned the defect as current behaviour, and `054` fixes it, so the line is now `036/054:` and expects 1 where it expected 0. **A session diffing label sets against `development` will find the old label simply gone**; reinstating it re-asserts the defect and turns a correct database red. `036` §7.12c's *behaviour* is unchanged and still right — the club-ride fan-out reads `club_members` directly because a caller-relative helper cannot compute a recipient set — but its stated justification is void, and the withheld notification became a gap (N10) — closed by `060`, which unions the owner in and filters the union by readability, so `036` §7.12c's expected value is inverted a SECOND time and now reads 1; `055` by **+44 new and −1 relabelled**, and that one is a plain rename — `036: … and nobody else on the crew` still reads 1, but only because that fixture's sole other crew member IS the organizer, so it is now `036/055:` with the reason stated; `056` by **+29 new and −1 relabelled**, and that relabel is an **expected-value flip** like `054`'s rather than a rename — `an uppercase username is rejected` asserted the rule `056` removes, so it is now `a username with a non-ASCII letter is rejected — 056 widened the charset to A-Z, not to Unicode`, checked on **both** `C.UTF-8` and `en_US.UTF-8` because a collation-dependent `[A-Za-z]` range would pass locally and fail hosted. One assertion got strictly stronger with no label change: `lower(username) rejects a case-variant of an existing username` used to drop `profiles_username_format` inside a savepoint to reach the index at all, so it was true of a database this repo never ran; capitals now reach the index for real and the scaffolding is gone; `057` by **+1 new and −3 relabelled**, and all three relabels are the same kind — a *boundary that moved* rather than a rule that changed, so each keeps its meaning at a new number and a session diffing label sets will find three lines gone that must not be reinstated (`a username longer than 20 characters is rejected` → `057: … longer than 25 …`; `056: twenty-one characters is still too long, capitals or not` → `056/057: twenty-six …`; and the `pg_get_constraintdef` pin, whose expected string carries the bound verbatim). The one genuinely new line is the POSITIVE at exactly 25, written for real and read back rather than asserted `allowed`, because the rejection at 26 passes on its own against a database where `057` never applied; `058` and `059` together by **+47 new and 0 relabelled** (35 and 12), and that zero is read off the diff rather than off a label-set reconciliation — its change to `rls_test.sql` is `332	0` in `git diff origin/development...HEAD --numstat`, so no existing label can have moved. Two of the 35 are mutation-tested rather than merely green, which is what makes the rest of the section worth its length: making `058`'s exception block re-raise takes the suite down at the raising trigger, and deleting `notify_club_joined`'s early return produces `FAIL 058: joining the welcome club notifies NOBODY — expected 0, got 1`. `059`'s two are mutation-tested the same way — dropping its ride-fan-out early return reads `expected 0, got 2`, and dropping its `is_default` delete guard reads `expected the statement to be rejected, but it succeeded`; PD-102's task 6.1 by **+1 new and 0 relabelled**, a `do $$ ... $$` block deriving every FK into `profiles` from `pg_constraint` rather than the nine-table hand list beside it, which closes a real gap: `034`'s `ride_messages.author_id` and `036`'s `notifications.user_id`/`actor_id` had joined the profiles cascade without ever being added to that list; the reviewer pass on `PD-102` by **+1 new and 0 relabelled** — the row-count sweep alone was vacuous against a future non-cascading FK (reviewer finding #3), so a separate `confdeltype <> 'c'` assertion was added beside it; mutation-tested by hand against the built scratch database, not merely read as green — flipping `postcard_likes_user_id_fkey` to `ON DELETE SET NULL` inside a rolled-back transaction turned it `FAIL 6.1 MUTATION TEST: ... expected 0, got 1`, and a follow-up check (author_id on `postcard_comments`, made nullable for the test) confirmed the row-count sweep reads a false-clean 0 on that same mutation while the row survives with a NULL — which is exactly the gap the new assertion closes and the sweep alone cannot; PD-211's `060` by **+56 new and −11 relabelled**, reconciled by label set against `origin/development` rather than by arithmetic, and **six of the eleven are expected-value flips rather than renames** — the two `055: KNOWN GAP` lines and `036: ride_created_in_club does NOT reach an ownerless owner` are the defects `060` fixes, `055: FOUR rows and no fifth` and its two `flipping going<->maybe`/`leaving and rejoining` siblings drop to three, and `055: ... and UNBLOCKING returns it` is the one line whose *behaviour* `060` changes rather than repairs: the row is no longer written, so there is no backlog to reveal, which is what every other `036` fan-out already did with a block. **Reinstating any of the six re-asserts a defect and turns a correct database red.** The remaining five are renames carrying a `060:` prefix and a restated reason. Two of the 56 are mutation-tested rather than merely green: deleting the `can_read_ride` conjunct from `notify_ride_joined` reads `FAIL 060: THREE rows and no fourth ... — expected 3, got 4` (the suite stops at the first failure, so 055.3's total fires before 055.6's write count, which is the second line the same mutation breaks), and dropping the owner arm from `notify_ride_created_in_club`'s union reads `FAIL 060: ride_created_in_club DOES reach an ownerless owner — expected 1, got 0`; PD-120's `061` by **+58 new and −3 relabelled**, and the three are read off the diff rather than off a label-set reconciliation — `git diff origin/development -- supabase/tests/rls_test.sql | grep '^-' | grep -oE "'[^']*'\\);$"` returns exactly three lines, which is the cheap reconciliation whenever a change only ever *adds* to this file. Two are **expected-value flips**: `029: sixteen FKs reference public.profiles` and its `ON DELETE CASCADE` sibling are now `029/061:` and seventeen, because `ride_reads.user_id` joins the profiles cascade — **reinstating either at 16 turns a correct database red**. The third is a plain rename with the expected value unchanged at 0: `and none of the five deliberate omissions acquired one` is now `six`, because `ride_reads` takes no `enforce_participation_gate` trigger, following `023`'s reason for `feed_reads`. Four of the 58 are mutation-tested rather than merely green, one per mechanism the section exists to pin: dropping `ride_has_unread`'s third coalesce arm reads `FAIL 061: ... and another rider's message still lights their dot — the rides.created_at arm — expected t, got f`; dropping its `author_id <> auth.uid()` reads `expected f, got t` on the own-message line; narrowing the timestamp trigger to `before insert` reads `expected t, got f` on the UPDATE arm; and dropping the visibility `EXISTS` from the INSERT `WITH CHECK` reads `expected an RLS denial, but the statement succeeded` on the blocked-organizer case — which is the one that would have shipped `034`'s leak again in a new table; PD-166's `062` by **+36 new and −1 relabelled**, and that relabel is an **expected-value flip** rather than a rename — `041: ... and may SELECT it, or the Journal query could not filter on it` asserted the grant `062` revokes, so it is now `062:` and expects false. It is kept in place rather than deleted because it is the record of why the grant existed; **reinstating it at true re-opens the channel and turns a correct database red.** Six more lines changed MECHANISM without changing their label, which a label-set diff cannot see and a `-U0` diff can: every read of `postcards.ride_id` in the `041` section had to move off `authenticated`, four to the table owner (they verify a fixture rather than a permission) and two — `041.13`'s and `041.14`'s Journal-query counts — to `public.ride_journal_postcard_ids`, which IS the Journal query now. Every rider in those cases can see the ride they are asked about, asserted in the same block, so the accessor's ride conjunct moves none of the expected values; PD-174's `063` by **+25 new and 0 relabelled**, read off the diff rather than off a label set — `git diff origin/development --numstat -- supabase/tests/rls_test.sql` is additions-only, so no existing label can have moved. Five of the 25 are mutation-tested rather than merely green, and two of those four are the assertions that caught real defects in the first cut of `063`: reverting the seat-holder exemption to the narrower "exclude the writer's own row" count turns the suite red on `a member of an OVER-SUBSCRIBED ride can still change their RSVP`, and removing the organizer exemption turns it red on `an organizer restores their own crew row`. The other two pin the mechanism — dropping the `for no key update` leaves a crew of 3 on a cap of 2 under two concurrent joins, and counting the writer's own row breaks the upsert case at exactly the cap; PD-114's `067` by **+54 new and −2 relabelled**, and both relabels are the deliberate whole-list grant pins firing on the migration that moved them, which is what they exist for: `045: exactly ten columns of rides hold INSERT…` is now `045/067:` and **thirteen**, and `045/051: exactly thirteen columns … UPDATE` is now `045/051/067:` and **fourteen**. Neither is an expected-value flip — the intent is unchanged and only the list grew — but a session diffing label sets against `development` finds both simply gone, and reinstating either at the old count turns a correct database red. **`064`, `065` and `066` are missing from this narrative and that is drift rather than a claim that they moved nothing** — it ended at `063` and was not extended by the three changes between, so re-derive from the diff rather than reading the gap as zero; PD-253's `068` by **+21 net (20 labels plus one harness line) and −0 lost, with 1 rename**, and the arithmetic reconciles exactly, which is the label-set check rather than a substitute for it. The rename is in the existing `015` block: `advancing the watermark clears the badge` → `nothing newer than the watermark clears the badge`, because `068` stamps `now()` for the table **owner** too, so a watermark can no longer be written into the past and the fixture had to move the postcard instead. The same block also switches its reader from `000a` to `000b` — `000a` authored the postcard under test and `068` now excludes an author's own row, so read as `000a` the assertion would answer zero for the wrong reason and pass while testing nothing; PD-273's `069` by **+23 net and −0 lost, with 6 relabelled**, reconciled by label set against `origin/development`. Twenty-two are the new `069:` ledger block and the twenty-third is a POSITIVE at the widened `place_id` bound, written because a one-sided rejection test passes unchanged against a database where `069` never applied — `057`'s lesson applied to a boundary that moved the other way. **All six relabels are boundary moves or count changes rather than expected-value flips**, so each keeps its meaning at a new number and reinstating any of them turns a correct database red: the two gate-trigger counts 10 → 11 (`069:`), the two `101-character GERS id` rejections → 513, renamed to *provider id* (`066/069:`, `067/069:`), and the two profiles-FK counts 17 → 18 (`029/061/069:`), because `place_search_attempts.user_id` joins the profiles cascade. Three of the twenty-two are worth more than a green tick: **the ceiling firing at the 21st attempt is the assertion `051` could not make at all** — its subquery form raised `42P17` before reaching it, which is why `052` exists; the backdate case asserts the value is REPLACED rather than the statement refused, which is what a table-level grant plus a trigger buys and a column grant would not; and the fixture tops up to the ceiling by **measuring** what is already there rather than counting the inserts above it, because `assert_allowed` rolls its statement back inside a savepoint and a hand-written total is one row out — it was, on the first pass, and the ceiling test then passed for the wrong reason; PD-273's `070` by **−201 lost and 0 new, with 0 relabelled** — removing the `037`, `039`, `040`, `049` and `050` sections (places, its search and its locality resolver, all dropped by `070`) is a pure deletion, confirmed against the pre-removal file: `git diff` reads `1740	0` — 1740 lines removed, zero added, so no remaining label moved or changed meaning. **None of the 201 removed labels should ever be reinstated**: the objects they named (`places`, `search_places()`, `locality_centroid()`) no longer exist once `070` applies, so a correct database cannot pass them. The two FK-absence assertions in the `066`/`067` sections stay but were **repointed**, which is a mechanism change a label-set diff cannot see: they asked `information_schema` for a foreign key whose target table was `places`, and once `070` drops it that count is 0 by construction — passing for ever while testing nothing, and blind to the columns growing a FK to something else entirely. Both now key on the COLUMN (`pg_constraint` joined to `pg_attribute`, `location_place_id` / `start_place_id`), which asks the question that outlives the provider, and both carry a `/070` prefix saying so; PD-297's `076` by **+29 new and 0 relabelled**, read off the diff rather than off a label set — `git diff --numstat origin/development -- supabase/tests/rls_test.sql` is additions-only, so no existing label can have moved. The six that carry the weight name a **role** rather than calling the object — `has_schema_privilege('authenticated', 'private', 'usage')`, `has_table_privilege('service_role', …)` and the three `has_function_privilege` lines — which is `031`'s lesson and the only shape that works here: this suite runs as the table owner, for whom neither the schema barrier nor the missing grant exists, so a test that merely selected from the queue would pass against a database that had granted it to the world. Two more are the ones a design change would trip rather than a permission change: `to_regclass('public.postcard_report_queue') is null` catches the whole surface being built in the schema PostgREST publishes, and `prosecdef` is false catches the take-down acquiring a `security definer` it does not need and the advisor that would come with it. **Two of the twenty-nine cannot fail on this database and their labels say so** — `service_role` holds Supabase's project default on `postcard_reports`, installed by a `pg_default_acl` a scratch database inherits none of, so deleting `076` §3b's revoke leaves the local suite green (mutation-tested). They state the intent; the measurement is `076`'s §Verification against the hosted project, and the three anti-vacuity probes beside them — grant inside a savepoint, watch the predicate flip, roll back — are what prove the assertion can read a real ACL at all; PD-293's `077` by **−32 removed and +21 new, so the total FALLS from 1763 to 1752** — the first entry in this narrative where it does, and the reason it can is that `077` is a removal: 25 `063:` labels go with the capacity section (deleted outright and replaced with a tombstone saying why the old shape cannot be ported — with no column there is no cap to set), 3 `018:` labels go with `rides_max_riders_range`, and 4 are renames where a count moved (`045`'s INSERT grant list thirteen→twelve and UPDATE fourteen→thirteen, `createRide`'s nine-column write→eight, `updateRide`'s eight→seven). **Do not reinstate any of the 25** — a correct database has no capacity trigger to assert against. The 21 additions are where the value is, because the risk in a removal is never the thing removed: the four objects asserted gone **by name** (the trigger, the function in *every* schema — `063` moved it `public`→`private` mid-build, so a schema-scoped check would pass against a leftover — the column, the CHECK), and four negatives proving what `077` did **not** take with it: `023`'s consent gate still refuses an un-onboarded rider on `ride_members` (same table, same verb, same `23514` `063` raised — this is the assertion that distinguishes a removed capacity rule from a removed participation one), a seat still cannot be moved onto an invisible private-club ride (`42501`, `063.7b`'s trap, carried over precisely because dropping the trigger is when someone would assume that path opened), `009`'s block predicate still hides a crew row from the blocker, and a stale client's `insert into rides (…, max_riders, …)` is refused `42703` rather than silently dropping the field; PD-301's `078` by **+49 new and 3 relabelled**, reconciled by label set against a rebuilt pre-`078` tree rather than by arithmetic. **Two of the three relabels are the class this row exists for** — `029/061/069: eighteen FKs reference public.profiles` and its `ON DELETE CASCADE` sibling are now `029/061/069/078:` and **nineteen**, because `push_devices.user_id` joins the profiles cascade, so **reinstating either at 18 turns a correct database red**; the third (`029: no row anywhere still references the deleted rider` → `029/078:`) is a plain rename. Four of the 49 arrived from the `reviewer` pass rather than the task list, and both gaps they close are the same shape — a rule stated in a comment that the database did not enforce: `078.1j` pins that `service_role` holds nothing either (Supabase's project default grants it everything, so a table that merely omits the revoke reads exactly like the assertion passing — `076`'s precedent, six days older), and `078.11a–c` pin the installation id to a lowercase UUID, because §1's whole residual-risk argument rests on the id being unguessable and a bare length bound let any rider call `register_push_device('1', …)` and silently take over whichever device held it. `078.11c` is the POSITIVE, written because the two rejections pass unchanged against a database where the shape was never tightened. Two of the task-list 45 are mutation-tested against the rejected `unique (token)` design in a rolled-back transaction: the shared-phone case **passes** under it and does not discriminate, while the rotation case reads 2 and register→rotate→release leaves a row carrying the old token —  those two are the only assertions in the set that see the leak; PD-270's `079` by **+15 new and 0 relabelled**, read off the diff rather than a label set — `git diff --numstat origin/development -- supabase/tests/rls_test.sql` is additions-only, so no existing label can have moved. **Two of the 15 exist because the first thirteen could not see the predicate that matters most.** `count_unseen_postcards()` scopes its watermark with `and r.club_id is null`, and every 79xxx rider had exactly one `feed_reads` row — an app-wide one — so a function with that predicate DELETED passed all thirteen unchanged. `079.0` gives `79001` a club watermark before the baseline is captured, and it is a real trap rather than a decoy because `068`'s `stamp_feed_read` trigger stamps every row at the transaction's frozen `now()`: drop the predicate and the comparison becomes `created_at > now()` against postcards stamped at exactly `now()`, a strict inequality that excludes all of them. `079.6` is the case that does not merely miscount — a rider holding **two** club watermarks and none app-wide makes the scalar subquery raise `21000 more than one row returned by a subquery`, which `countUnseenPostcards` swallows to `0`, so the tile would read zero for ever with nothing red anywhere. Both were mutation-tested **independently**, which is the part worth copying: with `079.0`'s decoy in place the mutation fails `079.1` at `expected 1, got 0`, and with it disabled the same mutation fails `079.6` with the literal production error — one mutation, two distinct red lines, so neither assertion is passing on the other's behalf. A sixteenth line asserts the delta baseline sits under 90: every `079` assertion is a delta against whatever `seed.sql` and 16,600 lines of earlier fixtures leave readable, and if that baseline ever reaches the function's `limit 100` the cap saturates and the `+1` and `+2` assertions fail for a reason unrelated to the rule under test; PD-193's `080` by **+25 new and 3 relabelled**, and the arithmetic reconciles exactly (1816 → 1841), which is the label-set check rather than a substitute for it. **All three relabels are count moves rather than expected-value flips**, so each keeps its meaning at a new number and reinstating any of them turns a correct database red: `045/067/077`'s INSERT grant list twelve → **thirteen** and `045/051/067/077`'s UPDATE list thirteen → **fourteen** (both gain `timezone`, which is the deliberate whole-list pin firing on the migration that moved it — exactly what `067` did to the same two lines), and `067`'s rides trigger count five → **six**. Four of the 25 are worth more than a green tick. **`080.5` is the one to read, because it is a defect the `reviewer` pass found in the first cut of this very file and it is mutation-tested against it.** `080` originally put `timezone` into `067`'s location group — `clear_ride_map_tiles` NULLing it beside the coordinate — which is the obvious next step and is wrong: `updateRide` resolves `departure_at` against the zone the edit form was RENDERING in, so a save changing the meeting point AND the departure time carries an instant expressed in a zone the clearing trigger drops, and 080.4's guard correctly declines to shift it because the statement did move the instant. Measured on DEV: 09:00 Lisbon saved with a new address and 09:30 typed rendered **10:30**. The control case — address changed, time untouched — was right throughout, which is what made it asymmetric rather than obvious. The zone is out of the group now, `067`'s function is untouched by `080`, and re-adding `new.timezone := null` to it turns the suite red at exactly `expected 09:30, got 10:30` (mutation-tested by patching `067`'s file and replaying the chain). **The two `assert_allowed` calls that had to be rewritten are the harness catching a real mistake rather than a style note**: that helper refuses an UPDATE by design, because RLS filters one to zero rows instead of raising, so it would pass against a policy that forbade the write entirely — both are now a plain statement followed by a read of the stored value. **The `rides_timezone_is_bounded` pair is worth copying**: the CHECK is UNREACHABLE through the trigger (a BEFORE row trigger runs before CHECK constraints, and the trigger normalises anything absent from `pg_timezone_names` to NULL first), so the obvious `assert_rejected` fails against a correct database — it is asserted in BOTH directions instead, including the refusal with the trigger disabled inside a savepoint, which is what proves the constraint is a real floor under `session_replication_role = replica` rather than `018`'s dead-constraint trap. **And the trigger-order assertion names EVERY `BEFORE` row trigger on `rides`, not the three location ones**, because `array_agg(... order by tgname)` compared against those same three names sorted is a tautology with respect to order — it catches a rename and reads like an ordering test. Two triggers already sort between `clear_ride_map_tiles` and `enforce_ride_timezone` (`enforce_participation_gate`, `enforce_ride_club_audience`), so the filtered version was blind to a third landing there. **PD-321's `084` by +27 new and 6 relabelled, and PD-329's `083` by +100 new and 8 relabelled** — 127 together, 2018 → 2145, reconciled by label set against `origin/development`. **Fourteen of the fourteen relabels are count moves rather than expected-value flips**, so each keeps its meaning at a new number and reinstating any of them turns a correct database red: the gate-trigger total in four places (13 → 15, `ride_invites` fourteenth and `feedback` fifteenth, including the `like '%…BEFORE INSERT triggers%'` pin on the function's own comment), the FKs into `profiles` (22 → 25 — `feedback.user_id`, and BOTH of `ride_invites`' rider keys, which is the `036` user_id/actor_id pairing again), the fan-out function and trigger counts (6 → 9, and their `like` patterns widened from `retract_postcard_liked` by name to `retract\_%`), and the two `notifications_type_check` equality pins (five types → eight). **The type pins are the ones to read before touching**: `055`'s exists to refuse a SECOND `ride_joined` type addressed at the organizer, and it is an equality precisely so a new type has to be defended rather than absorbed — `083`'s three are three different events with three different recipients, which is why they were admitted and why the label now says so. **§060.1's `rides` SELECT qual moved too**, and that one is the pin whose own message says to update `private.can_read_ride` rather than re-pin the string; here both were required, and `083.6` — an AGREEMENT between the policy and the helper across seven roles rather than two hand-written expectations — is what fails if only one of them moves. **`083.8` is mutation-tested three ways** and the result is worth knowing because it is not what the assertion's own comment predicted: hoisting the invite arm out of the block-dominated group is caught FIRST by §060.1's text pin, then by `083.6`, and only reaches `083.8` when both copies are hoisted and the pin is lazily re-pinned. All three paths were walked and reverted. **PD-325's `085`/`087` and PD-328's `086` by +134 together, 2145 → 2279, with 9 relabelled** — reconciled by label set against `origin/development`. **Eight of the nine are count moves rather than expected-value flips**, so each keeps its meaning at a new number and reinstating any of them turns a correct database red: the gate-trigger total in four places (15 → 16, `club_join_requests` sixteenth, including the `like '%…BEFORE INSERT triggers%'` pin on the function's own comment, which `085` rewrites), the FKs into `profiles` (25 → 26 — one key and not two, unlike `083`'s pair, because a request records only "rider A asked to join club C" and the other party is a club rather than a second identified rider), the fan-out function and trigger counts (9 → 11, then 12 with `087`'s), and the two `notifications_type_check` equality pins (eight types → ten). **The ninth is not a count and is the one to read**: `054`'s *"no policy predicate in public references admin at all"* is now FALSE by design, because `club_join_requests` names admin as the **authority** to answer a request rather than as an **audience** for club content. Bumping it to 2 would have hidden that distinction behind an arithmetic edit, so it is REPLACED with a carve-out by table name plus a second assertion pinning that exactly two arms on that one table use `private.is_club_admin` — the rest of `public` still has to read zero, which is what fails if `admin` ever gains reach over rides, postcards, threads or the roster. **One assertion changed SHAPE and is NOT strictly stronger**, which is worth knowing before anyone simplifies it: the fan-out `WHEN`-clause guard read `tgqual is not null` = 0, and `087`'s retraction legitimately carries one — a guard on the status TRANSITION, without which every no-op UPDATE would retract — so the flat zero would have refused a correct trigger. The replacement tests CONTENT, and content is evadable where a flat refusal was not: Postgres deparses `CURRENT_ROLE`, `USER` and `SESSION_USER` to their own spellings, so a check naming only `current_user` misses three of the four and `when (… and current_role = 'authenticated')` would disable the retraction while reading clean. It therefore names all four, and its sibling pins `087`'s WHEN by its **text** rather than counting how many exist — a count cannot say WHICH trigger carries the clause, so the delete arm could acquire one while `..._on_answer` lost its own and neither number would move. Four are mutation-tested rather than merely green: `085.25` (move the approval notification above the membership write and the row becomes permanently unreadable), `086.4` (remove the outer `can_read_club` gate and `083`'s invitee reads a private club's postcard correlation), and `087.1` — **the assertion whose absence let a real defect through review-and-suite alike**: `085` hung the retraction on DELETE while `decline_club_join_request` UPDATEs, so a declined request left every admin a permanent "X asked to join" notification with no control able to clear it, and `085.26` did not see it because it asserts the wrong zero (that a decline WRITES nothing, which was always true). Drop `087`'s trigger and `087.1` reads `expected 0, got 2`. `102` (PD-362) by **+30 new and 0 relabelled**, plus **2 assertions whose EXPECTED VALUE moved from 0 to 1** — both of which encoded the defect rather than a requirement, and both now say so at their site: the hider's own like in `011`'s hide block (a rider who liked a postcard and then hid it could not withdraw the like, for ever) and `051`'s ex-member precondition (which the change makes strictly stronger — the tile is now proven refused to a rider who CAN read their own surviving crew row). **A changed expectation is not a relabel and is worth counting separately**: a relabel means the suite renamed what it tests, while this means the database changed what it does. |
| Unit tests | `npm run test:unit` — **3184 across 119 files on a clean tree**. **`ios/` took this UP by 25**, because `no-service-role-key.test.ts` gained `ios` in its `SCANNED_DIRS` and emits a case per file walked — a native project is the one artifact here that cannot be revoked once it is on devices, so it is the strongest candidate on that list rather than the weakest. **It deliberately skips `ios/App/App/public`**, the bundle `cap sync` copies in: that directory is derived from `src/`, which the same test already walks, and it exists only on a machine that has run `cap sync` — gitignored, so CI never sees it. Left in, the total read 2561 locally and 2168 on the runner, which is this row's own scratch-file trap at 400× the size. Verify the skip still holds rather than trusting it: run `npx cap sync ios`, re-run, and the number must not move. **`079` (PD-270) took this DOWN by four, and a falling total is the case this row does not otherwise cover.** `columns.test.ts` emits one case per `.select(` literal it finds by walking `lib/data/`, `lib/actions/` and `RouteGuard.tsx`; `countUnseenPostcards` stopped building a query and now calls `count_unseen_postcards()`, so its column list left the client and its generated cases left with it. Nothing was deleted and no coverage was lost — the guarantee moved to the RLS suite, which gained 13 assertions for the same rule and can pin what a client-side query never could. **So a drop here is not automatically a loss**, exactly as the rise below is not automatically a gain; both move with what the walkers find. **One new file under `src`/`scripts` is worth +2 here, not +3**, and counting the suites that walk `src/` is what gets that wrong — measure it: `echo "export const probe = 1" > src/lib/__probe.ts; npx vitest list --run \| grep -c " > "; rm src/lib/__probe.ts`. **Two** of them run `it.each` over the walked list — `no-service-role-key.test.ts` and `no-geoapify-key.test.ts`. `use-server-exports.test.ts` walks `src/` as well but emits **two fixed cases** whatever it finds ("is empty", "still checks any that come back"), so it does not move with the file count; its two `it.each` calls iterate literal fixtures. **There is deliberately no per-story breakdown of how the total got here** — two successive revisions of this row carried one and both were wrong, the second while claiming to be exact, and the branches it decomposed are squash-merged and gone, so it cannot be re-measured at all. `git log` is where a total's history lives. **Do not read a rise as "tests were added"**: the two scanners above move whenever a *source* file is added, not only a test. `registry.test.mjs` does the same over every `docs:check` claim, so adding one entry to `scripts/docs/registry.mjs` also raises this by one. It also moves for an **untracked scratch script**, so a leftover `scripts/.tmp-probe.mjs` reads one higher and looks like a gained test. Delete scratch files before quoting this, or the number measures your working tree rather than the suite |
| **Walking the app** | See below. It is the only gate that renders anything |
| `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` plus the key from the Supabase MCP `get_publishable_keys`. Gitignored — `git check-ignore -v .env.local` to be sure |
| OpenSpec CLI | `npm run openspec` — `@fission-ai/openspec`. The bare `openspec` npm name is a 0.0.0 stub |
| Doc-claims sweep | `npm run docs:check` — PD-155. Runs the declared registry in `scripts/docs/registry.mjs` against measured ground truth (dependency/migration/test counts, contrast ratios, `next build` route counts) and reports every disagreement; a stale claim it doesn't yet cover is not proof the doc is right, only that nobody registered it. RLS-backed claims skip cleanly with no Postgres rather than reading as a false pass |
| Doc claims in CI | `npm run docs:check:cheap` — the same registry filtered to claims measurable with a local command (no Postgres, no second `next build`, no second `test:unit`). **This is a CI step**, between Unit tests and Build, so these claims are checked on every PR that runs the job at all; the full sweep stays a local/review-time run. A skip is fatal here — see `CLAUDE.md` §Branching & CI |

### The walk, and the relay it now needs

**Point it at DEV.** The walk signs in and writes, so aiming it at `letsride` means a real
session against real riders' data. `Letsride-dev` is `fpmrimzxadewsaiwpsel`; both refs ship in
the client bundle and neither is a secret.

```bash
DEV=fpmrimzxadewsaiwpsel
KEY=$(...)   # the DEV publishable key — mcp__Supabase__get_publishable_keys, or Vercel's Preview env

NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://$DEV.supabase.co node scripts/supabase-relay.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NEXT_PUBLIC_SUPABASE_ANON_KEY=$KEY \
  NODE_USE_ENV_PROXY=1 npm run dev
WALK_EMAIL=... WALK_PASSWORD=... npm run walk
```

#### The credentials are not a blocker any more, and no secret needs committing

**DEV has email confirmation OFF, so a session can mint its own account in one call** —
`GET /auth/v1/settings` reports `"mailer_autoconfirm": true` on `Letsride-dev` and `false` on
`letsride`, which is the per-environment split decision #6 wants.

So the walk is never blocked on credentials — mint one:

```bash
curl -sS -X POST "https://$DEV.supabase.co/auth/v1/signup" -H "apikey: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"walk-<something>@letsride.dev","password":"<generate one>"}'
# returns access_token immediately — no confirmation step on DEV
```

Then stamp onboarding, or the walk lands in the wizard rather than on `/postcards`:

```sql
update profiles set username = '...', location = '...',
  terms_accepted_at = now(), onboarding_completed_at = now() where id = '<uid>';
```

**Use an `@letsride.dev` address.** `supabase/seeds/development.sql` refuses to run while any
account outside that domain exists, so a walk account on any other domain quietly blocks the
seed. (It is blocked today regardless: `pedro88email@gmail.com` is a real DEV account.)

`walk@letsride.dev` / username `walkrider` exists, onboarded, owning one ride and one message.
**Its password is deliberately not written down anywhere** — test-account credentials are never
committed and the recipe above makes a stored one unnecessary. Make a fresh account rather than
hunting for this one's password.

**Chromium in this container cannot reach Supabase at all.** Measured 2026-08-06, and it is not
a flake or a flag: `curl -x $HTTPS_PROXY .../auth/v1/health` returns 401 — tunnel open, host
allowed — while the same fetch from a Chromium page launched with `--proxy-server=$HTTPS_PROXY`
hangs until aborted, with no response, no `requestfailed`, and no entry in the agent proxy's own
`recentRelayFailures`, where a genuinely blocked host *does* appear. Bare,
`--ignore-certificate-errors`, `--disable-quic` and `--disable-http2` all hang identically.

Now that the *browser* is the Supabase client rather than the dev server, that costs sign-in and
therefore the entire walk. `scripts/supabase-relay.mjs` forwards one origin over the hop that
works — real project, real RLS, real JWTs, no application
change. Its header carries the full measurement and the warning that it terminates TLS and must
never become a development convenience.

`NODE_USE_ENV_PROXY=1` is separately not optional: Node's `fetch` ignores `HTTPS_PROXY`, so the
relay itself cannot reach Supabase without it.

**A clean run is `65/65 guard, navigation and sign-out checks correct` on a DEV where the walk
account owns a ride and a club — and that figure is ARITHMETIC, not a measured run.** The measured
one is `47/47`, 2026-08-24 on PD-293's branch, against a local `npm run dev` through the relay,
`WALK_FIXTURES=1`, zero FAILs. PD-358 then added `checkInviteLanding`, which contributes **9
assertions per landing route** (5 signed out, 4 signed in) **across two routes** — `/rides/join`
and `/clubs/join` — so 47 + 18 = 65. **Nobody has run it**: this container's Chromium cannot reach
Supabase without the relay, and CI's `walk` job is skipped until the repository variable `WALK_CI=1`
exists. So treat 65 as the number to expect and 47 as the number anyone has actually seen, and
replace this paragraph with a measurement the first time the walk is run against DEV.

It was `48/48` before 47 and `077` dropped the `max_riders survives it` assertion with the field it
read. **If the invite phases are excluded and it comes back 48, the field is back.**

The `48/48` it replaces was 47/47 measured 2026-08-12, plus the consent-box assertion PD-214
added to the refused-signup phase, which has **not** been run against DEV. **The account that measures the full total
is whoever currently organises the earliest-departing ride, not a fixed name**: `checkEditRetention`
picks the first candidate whose form renders **and stays submittable after it flips the public box**
(PD-311 — a clubless ride disables Save one way round, and the phase falls through to the club form
rather than clicking a disabled button), and `discoverDetailPaths` hands it whichever
ride is soonest regardless of who created it or when. **That follows from the section order, not
from one sort**: `getRides` orders the upcoming window ascending and the previous one descending,
so the soonest ride is first in the DOM only because the upcoming section is drawn first. A DEV
with nothing upcoming hands over a departed ride instead — see §The walk on why the fixture is
dated a year out. Re-derive who currently qualifies rather than trusting a name written here:

```sql
select p.username, r.title, r.departure_at
  from public.rides r join public.profiles p on p.id = r.organizer_id
 where r.departure_at >= now() order by r.departure_at asc limit 1;
```

The account that organises that row is the one whose run exercises the `club_id` restore
assertion — `retain.ts`'s hardest control type — rather than landing on that ride's edit form as
someone else ("not this rider's"), falling through to the club one, and skipping it. A
freshly-minted account usually measures one lower for exactly that reason: its own fixture ride is
dated a year out **on creation** (`provision()`, below), so it is rarely the earliest row on a DEV
that has accumulated others; the SQL to mint a password for whichever account the query above
names is in §Test accounts.

Five phases count what they *ran* rather than a fixed constant — `checkFormRetention`,
`checkCreateClubRetention`, `checkEditRetention`, `checkEditProfileRetention` and
`checkRefusedSignup` all return it — and three of the five actually vary at runtime: the club
`<select>` and the ride/club edit form are drawn only for a rider who has somewhere to put them,
and `runRefusedSignup` skips entirely when the browser's session is not on the writable-project
allowlist. So the total falls on a thinner database or a wrongly configured environment, and the
run says which parts it skipped rather than shrinking silently. Count them from the output rather
than from here: 5 refused-sign-in assertions, 4 refused-signup assertions when the ref gate passes
(0 when it does not), 9 refused-ride-create assertions (8 with no club, so the club `<select>` is
not drawn), 4 refused-club-create assertions, 2 or 3 refused-edit assertions (2 on the club edit
form, which has no select), 4 refused-profile-edit assertions, then `all N taps navigated`,
`no stamp re-read`, `the shell stayed mounted`, `the splash never painted`, then 7 signed-in guard
rules, 4 sign-out assertions and 5 signed-out guard rules. The walk discovers detail routes from
the lists, checks twelve route-guard redirects in both signed-in and signed-out states, asserts
sign-out leaves no `sb-*` key in `localStorage`, no `sb-*` cookie and no reachable screen, and makes
five bottom-tab taps across the four tabs to prove a navigation costs no `my_onboarding_state()`
re-read, does not remount
the shell and never paints the splash.

**The refused-edit phase is the one that has been wrong twice, and both times it read green.**
It flips the public checkbox, submits a **whitespace-only** required field — which satisfies HTML
`required` and is refused by `.trim().min(1)` in both schemas, before either action issues a query
— and reads the choices back. The two traps, because a third form will hit them: the edit forms
carry **no `noValidate`**, so an out-of-range number is blocked by the browser and no action ever
runs; and both draw a live `role="alert"` the instant the box is unticked, so accepting that as
proof of a refusal makes every assertion below it vacuous. The refusal assertion reads
`role="status"` — the action's own error — for exactly that reason.

**The refused-create phase is PD-199's**, and it is the one that found what nothing else could.
It fills `/rides/new`, submits a whitespace-only `meeting_point` — refused by `rideSchema`'s
`.trim().min(1)` before any network call and by `018`'s `rides_meeting_point_length` at the
database, so the phase cannot write a ride at either layer — and reads every field back.
**That refusal was `max_riders = 0` until `077` (PD-293) dropped the column**, which is why the
phase now carries one assertion fewer: the separate `max_riders survives it` check is gone, and
`meeting_point` carries the refusal as well as its own retention. A shrunken count here is a
field that no longer exists, not a skip. It reported seven text fields and a checkbox surviving while the club
`<select>` read `""`, twice: once for a `defaultValue` restore, and again after the select was
made controlled. `src/lib/actions/retain.ts` carries what that measured, and it is the reason
the two selects also need an effect.

**PD-203's three phases close most of the gap between "wired on nine forms" and "asserted on
two", and record what they deliberately still leave open.** `checkCreateClubRetention` submits
a whitespace-only `name` — refused at both layers, by `clubSchema`'s `.trim().min(1)` and by
`018`'s `clubs_name_length` CHECK, exactly as `018` bounds `rides.meeting_point` — and is the one
phase covering a controlled text
input, an uncontrolled textarea and an uncontrolled checkbox in a single refusal.
`checkEditProfileRetention` is the only phase touching the one form where `retaining`'s
`defaultValue` fallback ever reaches a *stored* value (`state.retained.location ?? profile.location
?? ''`) rather than an empty string, and asserts that fallback on load before submitting anything.
**Its refusal trigger is a 101-character location, and it cannot be delivered with
`page.fill()` — measured 2026-08-24, on a red run.** `075` (PD-286) made every field on this
form optional, so the old whitespace trigger now SUCCEEDS; `max(100)` is what still refuses. But
**every field carries `maxLength`, and `fill()` honours it**, so the 101 characters arrived as
100, the action accepted them, and the phase failed *while writing a 100-character location over
the walk account's stored one* — the same self-destroying-fixture failure in a new form.

So the phase drives the refusal the way a patched client would: the native value setter past
`maxLength`, plus the `input` event React listens for. **Since PD-286 there is no value this
form's own DOM will let a typist submit that the action refuses**, which is why that is the
honest shape rather than a contrivance — `maxLength` is an editing constraint, and `018`'s
`profiles_location_length` is what actually holds the line.

**Nothing in the repo seeds that account's location**, so confirm it is non-null before reading
a failure here as a regression:

```sql
select location from public.profiles where id = (select id from auth.users where email = '<WALK_EMAIL>');
```

**Last run: 2026-08-24, `18/18` screens and `47/47` checks, on PD-293's branch at `fd7d146`.**
That run is what answered the question `077` raised and nothing else could: `tsc`, ESLint,
Vitest, `next build` and the RLS suite are all green against a DEV whose `rides` has no
`max_riders`, and **only the walk can say whether the ride detail and the edit form still
render**. They do — the edit form drew every control populated, with no `max_riders` field and no
`42703`. The previous run was `18/18` and `48/48` against `development` at `92095e1`, before the
column went.

**Two things that run did NOT cover, and neither is a defect in that branch.** The edit-retention
phase fell through to the **club** form — the walk's discovered ride belongs to another rider, so
`/rides/detail/edit` drew the "not yours" screen — which skips the `club_id` `<select>` restore,
the control `retain.ts` singles out as hardest to get right. And `LocationPrimingSheet`'s
`blocked` copy (PD-170) has been rendered by nothing: `locationPrimingState` hides the row for
any rider who has a position, and the walk account's profile city is `Amsterdam`, so neither the
row nor the sheet can appear for it. **Exercising that branch needs a fixture with no
`profiles.location` and a refused permission**, which is a walk phase nobody has written.
— the first run since the client render migration, and the run that verified PD-279, PD-286,
PD-284 and PD-285 render at all. `/onboarding/location -> /postcards` passed, which is the
deleted route reaching the guard's catch-all through a real browser rather than through the
`curl` probe in `CLAUDE.md`.

**One unexplained flake, seen once in three consecutive runs**: the signed-in guard block
reported `/auth/signup -> /auth/signup` and `/onboarding/username -> /auth/login`, i.e. the guard
answering as if there were no session, on a run whose every other assertion passed. Both were
green on the runs either side. Recorded rather than explained — re-run before treating either as
a regression.
`checkRefusedSignup` reuses the walk's own already-registered address and proves only the DEV
branch of `signUp` — with confirmation ON (PROD) GoTrue's duplicate-signup mitigation returns
success instead, so the `alreadyRegistered` branch this phase exercises is unreachable there; the
comment above it in `scripts/walk.mjs` says so. **It runs after the real sign-in below, not beside
`checkRefusedSignIn`, and only behind `refWritable` — the one place the project-ref allowlist is
checked, shared with `fixturesPermitted`'s gate on `provision()`'s writes** (`runRefusedSignup`) —
a real `signUp` call is a write with no schema or database layer backing its refusal the way
a whitespace-only `meeting_point` backs the ride phase, so "the address is already registered" being true is a fact
about the environment, not a guarantee, and it needed a session to read the project ref from
before it could be trusted to run at all. The phase call site also carries the `.catch()`
every other new PD-203 phase has; broken and reverted by hand to confirm it reports a failure
rather than aborting the run. The remaining two of the nine `retaining` forms are recorded as
deliberately unexercised in the same file, next to `checkRefusedSignup`:
`/auth/forgot-password`'s one refusal is blocked by the browser's own `type="email"` validation
before any submit reaches the action, and `CreatePostcardForm`'s submit stays disabled until a
Storage upload finishes, which this container's Chromium cannot complete.

**The refused-sign-in phase submits a wrong password twice, and the second attempt is the one
that matters** (PD-196). React resets a `<form action={fn}>` on the failure path too, so the
email is restored from `defaultValue` rather than held in component state. The two attempts
differ only in how the address got into the field: typed, and **assigned to the DOM with no
`input` event** — which is what a password-manager fill looks like to React when it lands
before hydration. Measured: a build holding the address in `useState` passes the typed case and
fails the second, so seeding only with `page.fill` would gate nothing for an autofilling rider.
Each attempt asserts its own refusal before its email, because a submit that never happened
leaves the field filled too.

**The walk no longer visits `/clubs/detail/about`, and a reader comparing totals should know
why.** That route was deleted outright by the club-detail merge — its own page docstring says so
and nothing in `src/` links to it — but `scripts/walk.mjs` kept it in the club sub-page list, so
every run reported a 404 against a screen that was *meant* to be gone. Removed 2026-08-20 with
PD-274, which is when the walk first ran with credentials again; a run that used to read `19/19`
with one red mark reads `18/18` clean.

**Measured 2026-08-20**, signed in as an owner-supplied DEV account owning one ride and no club:
`18/18` screens and `45/45` guard, navigation and sign-out checks. The refused-edit phase is the
one that did not exercise — it needs a ride *or* club the walk account owns at the time the phase
runs.

**The screens figure is data-dependent and is not a pass/fail number.** The detail routes are
discovered rather than hardcoded, so a list with no rows yields no path and the total shrinks —
`13/13` against a DEV with a club but no ride, `16/16` once the ride is there, `18/18` measured
2026-08-12 with a ride, a club and one visible postcard. **Read the `N/N` for equality, not for
the value**, and read the skip notices above it for what was not covered. The checks figure above
is the pass/fail one — read it for equality too, since its total moves with what the walk account owns.

**So the walk provisions what it needs** — a shrunken figure looks exactly like success while
meaning the ride detail was never opened, which is how PD-125 shipped a switcher nobody had
seen:

```bash
WALK_FIXTURES=1 RELAY_UPSTREAM=https://$DEV.supabase.co \
  WALK_EMAIL=... WALK_PASSWORD=... npm run walk     # 18/18 on a DEV that reported 13/13 without it
```

It creates a ride and a club **through `/rides/new` and `/clubs/new`** rather than by insert,
which exercises the two create forms end to end — nothing else in this repo submits them. It
fills **only what is missing**, so it is idempotent and needs no cleanup pass; a second run
creates nothing and still walks the same routes.

**The club is created FIRST and the ride is attached to it (PD-311).** `EditRideForm` refuses the
edit that would leave a ride with no audience at all (`narrowsToNobody` — PD-338), so a clubless
ride is one `checkEditRetention` cannot submit whenever its flip lands on private. Because `wanted`
asks only for what is missing, `owned.club` is passed in too: a rider who already has a club still
gets a clubbed ride rather than a clubless one.

**What actually closes PD-311 is the candidate gate, not this ordering.** `provision()` never
ticks the public box, so its fixture ride is private (PD-320's default) and the phase's flip is
private → **public**, a widening that was permitted under the old guard and is permitted under the
new one. The refused direction —
clubless *public* → private — is only reachable on a ride the account **already owned**, which
`provision()` by construction never creates. So the reorder is insurance against the composer's
default flipping back, and the gate below is the fix.

The ride is dated a year out on purpose, and
the reason changed shape when `/rides` grew its Past rides section rather than going away:
a departed fixture used to vanish from the list, so the next run created another that nothing
listed and nothing removed. It is now filed under Past rides instead — no longer a leak, but
`discoverDetailPaths` takes the first `?id=` link in DOM order, so on a DEV where every ride has
departed the walk would check the ride detail screen's *past* variants believing it held an
upcoming ride. A year out keeps the fixture at the top of the upcoming section, which every
phase after provisioning assumes.

**A fixture that was asked for and did not arrive fails the run**, and the report comes from the
**re-read, never from the attempt**. Printing `+ created a ride` straight after the click lets an
RLS or validation refusal read `(no rides to open)` → `+ created a ride` → green → exit 0, which
is the skip-reads-as-pass failure this whole section exists to close.

**Writes are off by default, and the guard reads the session rather than an env var.** The first
version of that guard required `RELAY_UPSTREAM` and refused PROD's ref in it — but that variable
configures the *relay*, a sibling process, and nothing tied it to what the app under test was
pointed at, so with PROD in `.env.local` the documented command passed the guard and would have
created public fixture rides in real riders' feeds. **A check on a value describing a different
process is not a check.**

`authenticatedProjectRef()` reads the `iss` claim of the session the browser is actually
holding — `https://<ref>.supabase.co/auth/v1`, minted by GoTrue from its own configuration, so
it names the real project even when every byte arrived via `http://localhost:3001`. `letsride`
is not on an allowlist, and an unreadable ref refuses too, so it fails closed:

```
(fixtures not created — refusing to create fixtures against "zwprydcyryvudhurbnye" — only fpmrimzxadewsaiwpsel is writable)
(fixtures not created — could not read which project the browser signed in to — refusing to write rather than guessing)
```

**Realtime does not survive the relay, and this is the one gap the walk cannot close.**
`scripts/supabase-relay.mjs` forwards HTTP and drops the `upgrade` header, so
`ws://localhost:3001/realtime/v1/websocket` fails and the ride chat's subscription never
connects. A message sent through the composer still appears, because the optimistic path draws it
and the refetch confirms it — so a green walk proves the chat renders and sends, and proves
**nothing** about live delivery. Teaching the relay to proxy the upgrade is the fix if that ever
needs covering.

**The walk suppresses that one console error and says so**, because `/rides/detail/chat` is on
the route list now and an always-red gate is a gate nobody reads. The filter is deliberately
narrow — the relay's own origin and the Realtime path, nothing else — and the count is printed
rather than swallowed:

```
  (Realtime NOT exercised — 1 relay WebSocket failure(s) suppressed; the relay does not proxy the upgrade)
```

**Network, measured — a blocked host fails as `curl: (56) CONNECT tunnel failed`, not as a
timeout:**

| Host | From the shell | Meaning |
|---|---|---|
| `*.supabase.co` | **401** | **Reachable.** 401 is the correct answer to an unauthenticated REST call |
| `*.vercel.app` | 403 at the proxy | Blocked. Use the Vercel MCP tools |
| `api.github.com` | 403 on `/repos/...` | Effectively refused. Use the GitHub MCP tools |

---
