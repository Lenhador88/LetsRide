# Design — a tag, not a second audience

## Context

Every fact in this table was read from the live database, the migration chain, `src/`,
`supabase/tests/rls_test.sql` and the committed Figma snapshot on **2026-08-09**, against
`zwprydcyryvudhurbnye` (PROD) with RLS bypassed via the Supabase MCP.

**One passage below does quote `CLAUDE.md`, and says so at the point of use** — §D1's account of the
`029` club cascade is `CLAUDE.md`'s `clubs` row, verbatim, not `029`'s file header. An earlier
revision of this section claimed nothing was quoted and §D1 attributed the sentence to the migration;
the substance was right and the provenance was invented, which is the more corrosive of the two
because it reads as primary evidence.

| Fact | Value | How to re-derive |
|---|---|---|
| `postcards` columns | `id, author_id, club_id, image_path, caption, created_at, updated_at` — **no `ride_id`** | `information_schema.columns` |
| `postcards` grants to `authenticated` | **table-level** SELECT, INSERT, UPDATE, DELETE; `pg_attribute.attacl` empty | `aclexplode(c.relacl)` vs `aclexplode(a.attacl)` |
| `ride_messages` grants | INSERT is **per column** (`author_id, body, id, ride_id`); SELECT/DELETE table-level | same |
| `notifications` grants | UPDATE is **per column** (`read_at` alone) | same |
| `postcards` SELECT policy | `author_id = auth.uid() OR (NOT is_blocked(auth.uid(), author_id) AND (club_id IS NULL OR is_club_member(club_id)) AND NOT EXISTS(postcard_hides …))` | `pg_policies` |
| `postcards` INSERT `with check` | `author_id = auth.uid() AND (club_id IS NULL OR is_club_member(club_id)) AND image_path LIKE 'postcards/<uid>/%'` | `pg_policies` |
| `postcards` UPDATE | policy exists — `using (author_id = auth.uid())`, `with check` = the INSERT one | `pg_policies` |
| `postcard_comments` UPDATE | **no policy, no grant** | `pg_policies`, `aclexplode` |
| `rides` SELECT policy | `organizer_id = auth.uid() OR (NOT is_blocked(auth.uid(), organizer_id) AND ((is_public AND (club_id IS NULL OR is_club_public(club_id))) OR (club_id IS NOT NULL AND is_club_member(club_id))))` | `pg_policies` |
| `private.is_ride_crew(ride)` | `security definer`, `search_path = ''`; organizer **or** any `ride_members` row, no status filter | `pg_get_functiondef` |
| `private.is_club_member(club)` | `security definer`; reads `auth.uid()` **internally** | `pg_get_functiondef` |
| `rides.organizer_id` FK | `ON DELETE CASCADE` | `pg_constraint` |
| `postcards.club_id` FK | `ON DELETE CASCADE` | `pg_constraint` |
| `postcards` triggers | `enforce_participation_gate` (BEFORE INSERT, `WHEN current_user='authenticated'`), `postcards_set_updated_at` (BEFORE UPDATE) — **nothing imposes `created_at`** | `pg_get_triggerdef` |
| `postcards` indexes | `pkey`, `image_path_key`, `(author_id, created_at desc)`, `(club_id, created_at desc) WHERE club_id IS NOT NULL`, `(created_at desc)` | `pg_indexes` |
| `notifications_event_key` | `(user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id) NULLS NOT DISTINCT` | `pg_indexes` |
| Migration files / applied | **40 / 40** on both projects; `041` free | `ls` vs `list_migrations` |
| `Ride - Journal (Postcards/Timeline)` | `2226:4865`, flow **Rides / View ride**, epic **In progress** | `npm run figma -- tree` |
| A ride picker anywhere in the design | **none** — the `Create ride` frame inside the *Create postcard* flow is a stray v1 ride composer, not a postcard one | `npm run figma -- ls "Create postcard"` |
| A compose affordance on the Journal frame | **none**, hidden layers included | `npm run figma -- tree … -- --all` |

Four of those decide everything below.

1. **The grants are table-level.** So the column arrives writable and re-writable, by default, in
   the same statement that creates it. Every other decision here is downstream of that.
2. **`private.is_ride_crew` is `security definer` and a `ride_members` row outlives everything.**
   Blocking the organizer, leaving the club and the club turning private all take the ride away and
   leave the crew row standing. `034` measured both and shipped the leak in draft.
3. **`rides.organizer_id` cascades.** A ride is not a durable object; it dies with one person's
   account. Anything hanging off `rides` must survive that or it is destroying third-party content.
4. **Nothing draws a picker or a compose button.** How a postcard *gets* a ride is undesigned in
   both places it could live, so §D5 is a designer question with a default, not an inference.

---

## D1. `on delete set null`, not `on delete cascade`

**Decision: `on delete set null`.**

`cascade` reads correct — a journal entry with no ride is a loose end — and it is the option that
destroys other people's content. `rides.organizer_id` is `ON DELETE CASCADE`, so a ride dies when
its organizer deletes their account. Chain them and rider A deleting their account deletes rider B's
postcards, because B once tagged one to A's ride.

That is not an analogy to `029`; it is the same defect. **`CLAUDE.md`'s `clubs` row** — quoted, and
the provenance matters because this is the load-bearing citation — records that `clubs.owner_id`
cascading into `postcards.club_id` meant *"deleting an owner would destroy every postcard every
other member ever posted there — `009` reasoned that link out correctly for a club deleted **by** its
owner and never considered it arriving as a side effect of a third party's erasure."* `029` is the
migration that fixed it, by transferring the club instead. A `ride_id` cascade re-creates the defect
one migration later, on the table `029` was protecting.

It also contradicts a requirement already drafted in the sibling `add-account-deletion` change —
*Content the departing rider authored SHALL be removed, and content they merely touched SHALL NOT
be*. A postcard by B tagged to A's ride is content A merely touched. `set null` satisfies it
exactly; `cascade` violates it silently, with no failing assertion anywhere, because nobody would
think to select B's rows after deleting A's account for a reason involving rides.

**The rejected middle option** — transfer the ride to a remaining crew member, as `029`'s
`transfer_owned_clubs` does for clubs — is refused on the same ground `CLAUDE.md` already states: a
club is a shared institution and a ride is *one person's plan*. There is nobody to give it to. The
transfer exists for clubs precisely because the alternative was destroying other members' content,
and here `set null` achieves that without inventing a successor.

**`set null` carries no orphan trap here, and the reason is the whole change.** `029` treats
`rides.club_id`'s `ON DELETE SET NULL` as a trap because a private club's ride left with `club_id`
NULL and `is_public` false becomes visible to its organizer alone — nulling that column *changed the
audience*. Nulling `postcards.ride_id` changes the audience by exactly nothing, because `club_id`
still decides and always did. **If `set null` were dangerous here, that would be evidence the column
had become an audience axis.** It is not, so it is not.

Two consequences, both stated rather than discovered:

- **The `set null` sweep runs privileged.** A referential action is applied by the system, not under
  the deleting rider's row security, so it writes rows that rider can neither see nor update. That
  is correct and it means the UPDATE policy and the withheld column grant of §D3 do **not** gate it
  — a fact worth writing down before someone "fixes" the inconsistency by adding a policy.
- **A rider deleting their account silently empties the Journals of every ride they organised.**
  Other riders' postcards survive in the feeds they were posted to; only the grouping is lost, and
  nobody is told. That is the honest description of `set null` and it is the price. The alternative
  is worse and there is no third option.

## D2. The tag gate is crew ∩ ride-visible, not "any ride you can see"

**Decision: both conjuncts, matching `034`'s SELECT policy in the write direction.**

Three candidates:

| | Rule | Verdict |
|---|---|---|
| **(a)** | Bare FK — tag anything | **No.** A FK is checked with RLS bypassed, so it accepts a private club's ride the tagger cannot see. The postcard does not leak, but the *Journal surface* of that ride gains a stranger's content, and the deferred notification would carry it to a crew the tagger cannot otherwise reach. That is an injection channel into a private club, built out of a column that "only tags" |
| **(b)** | Any ride the tagger can see | **No.** Closes (a) — an invisible ride fails the `EXISTS` — but leaves every public ride writable by every signed-in rider. It is also the *opposite* rule to the one this ride's other content surface already has, and two content surfaces on one ride with two different write audiences is a rule nobody will remember correctly |
| **(c)** | Ride-visible **and** crew | **Yes** |

(c) is chosen for four reasons, in order of weight:

1. **It is the rule the app already enforces for this ride's other content.** `034`: *"Seeing a ride
   is not being on it."* A journal of a ride is what the people who rode it posted.
2. **`postcards` INSERT already works this way for the other FK.** `club_id` requires
   `private.is_club_member(club_id)` — you must belong to what you post into. (c) is that sentence
   applied to the second reference, not a new principle.
3. **It is the rule the deferred notification needs.** A fan-out to the crew whose actor need not be
   crew is a channel from outside the crew into it. Deciding it now costs nothing; deciding it later
   means the notification change either inherits a hole or retracts a grant riders have used.
4. **It fails closed.** A rider who cannot satisfy it loses a tag. A rider who should not satisfy it
   and does gains a surface in someone else's ride.

**Neither conjunct may be dropped**, and the two answer different questions — *may I see this ride*
and *am I on it*. `is_ride_crew` is `security definer` with `search_path = ''`, so inside it there is
no RLS at all: it will happily confirm the crew row of a rider who has blocked the organizer, or who
left the private club the ride belongs to. `034` measured both states before adding the `EXISTS`.
`private.is_club_member` has the identical shape and no such gap only because `clubs` carries no
block predicate, which is what makes copying that shape verbatim the specific trap.

**What (c) is not.** For a public ride, crew membership is one RSVP away — `ride_members` INSERT
requires only that the ride be visible. So (c) is a real boundary for private-club rides and for
blocked riders, and for a public ride it is an opt-in rather than a wall. That is correct: pressing
*Maybe* **is** declaring participation, which is the question the gate asks. It is recorded in the
proposal's defect list so nobody builds anti-spam on top of it.

## D3. `ride_id` is set at INSERT and is never updatable

**Decision: grant `authenticated` INSERT and SELECT on the column, and no UPDATE.**

The obvious alternative is to let the `with check` do the work on both verbs — the same conjunct on
INSERT and UPDATE, so retagging is gated exactly as tagging is. It has a trap that a policy cannot
get out of:

> **A `with check` is evaluated against the whole new row on every UPDATE, and a policy cannot see
> `OLD`.** Author tags ride R while on its crew, later leaves the crew — or blocks the organizer, or
> the club goes private — and then edits their caption. The `with check` re-evaluates
> `is_ride_crew(R)`, which is now false, and refuses the caption edit. The author is locked out of
> editing their own postcard by a condition about somebody else's ride, and there is no error message
> that could explain it.

Escaping that needs a `BEFORE UPDATE` trigger comparing `OLD.ride_id IS DISTINCT FROM NEW.ride_id`,
which is a second enforcement instrument, a second place the rule lives, and a new advisor surface —
for a feature nothing has asked for. `postcards` has an UPDATE policy that **no code calls**: there
is no `updatePostcard` action in `src/lib/actions/`.

### The UPDATE policy is therefore left completely alone — including no "harmless" copy of the conjunct

An earlier revision of this change put the same conjunct in the UPDATE `with check` "so that granting
the column later cannot open a hole by omission", on the reasoning that it was unreachable while the
column grant was withheld. **That reasoning is wrong and the error is worth keeping visible, because
it is the one a careful reader reconstructs from first principles:**

> **A column privilege gates the SET list. An RLS `WITH CHECK` is evaluated over the whole new row.**
> They are independent mechanisms. Withholding `UPDATE (ride_id)` stops `set ride_id = …`; it does
> nothing to stop the `with check` from re-reading the row's existing `ride_id` during a `set caption
> = …`. So the "unreachable" conjunct fires on every caption edit, and is precisely the lockout the
> box above rejects.

**The repo has already measured this exact mechanism on this exact policy.**
`supabase/tests/rls_test.sql:719-727` asserts *"an author who left a club cannot edit their postcard
in it"*, and the comment above it calls the lockout a documented side effect that is accepted
because *"permitting that edit means dropping the club test entirely — which would let any rider move
a photo into any private club."*

**That justification is exactly what `ride_id` does not have.** `club_id` is updatable, so its
`with check` conjunct is the only thing preventing a move. `ride_id` is not updatable, so its
conjunct prevents nothing and costs the same lockout. The asymmetry is the decision:

| | `club_id` | `ride_id` |
|---|---|---|
| UPDATE column grant | held | **withheld** |
| Conjunct in UPDATE `with check` | required — it is the only guard against a move | **none** — there is no move to guard |
| Author who left the club / crew edits a caption | refused, accepted, asserted at `rls_test.sql:719` | **succeeds**, and this change asserts it |

The assertion is the point. A test that a tagged postcard's caption is still editable by an author
who has left the crew is the thing that goes red the day somebody adds the conjunct back for
symmetry.

**What replaces the discarded safety net** is not a dormant policy line but a live tripwire: the
suite asserts `has_column_privilege('authenticated','public.postcards','ride_id','UPDATE') = false`,
so re-granting the column turns the suite red and forces whoever does it to write the gate
deliberately. That is strictly stronger than a conjunct nobody would remember was load-bearing.

Withholding the column grant instead is `034`'s instrument in the other verb. `034` granted INSERT
per column so `ride_messages.created_at` could not be client-written; `036` granted UPDATE on
`notifications.read_at` alone. This is the third instance and the first on a pre-existing table,
which is the only complication: the table-level UPDATE must be **revoked and re-granted over the
seven columns that hold it today**, read off the database at write time. Omit one and a grant the app
relies on is silently retracted.

**Replay is not the reason.** `036`'s `notifications_event_key` is `NULLS NOT DISTINCT` over the full
tuple, so a repeated fan-out for the same (recipient, type, actor, postcard, ride) collides and is a
no-op — retagging could not have produced a notification storm even if it were allowed. The reasons
are the lockout above, and that relaxing this later is one `grant` while retracting it is not.

**The cost, stated:** a mis-tag is uncorrectable. The remedy is deleting the postcard, which the
DELETE policy already allows its author. That is acceptable at this stage and is the first thing to
revisit if riders complain.

## D4. `ride_id` and `club_id` are orthogonal and are not constrained to agree

**Decision: no constraint between them, in either direction.**

The intuitive rule — *the postcard's club must be the ride's club* — is the tag-becomes-audience
mistake in disguise, and it is not expressible as a CHECK anyway (it references another table), so it
would arrive as a trigger, which is a lot of machinery for a wrong idea.

Work the four combinations and each is coherent under the one rule:

| Postcard `club_id` | Ride | Who sees it in the Journal |
|---|---|---|
| NULL (app-wide) | any ride the author is crew of | everyone who can see the postcard — i.e. everyone not blocked, who has not hidden it |
| club C | a ride of club C | C's members |
| club C | an unrelated public ride | **C's members only** — the ride's other crew see a Journal that is missing it, correctly |
| club C | a ride of private club D (author is in both) | C's members only; D's members who are not in C do not see it, even on D's own ride |

Row three is the one that looks wrong and is right. The Journal is not a place; it is a query, and it
returns what each viewer may see. Row four is the same sentence from the other side.

## D5. How a postcard acquires a ride — a designer question with a default

Nothing in the snapshot draws it: the Journal frame has no compose affordance, hidden layers
included, and the `Create ride` frame sitting inside the *Create postcard* flow is a stray v1 ride
composer. **This is the `Create club` situation** — the epic has no v2 frame, so the composition is
ours and is logged as a deviation rather than inferred as a measurement.

**Default: one control, reachable from two places.**

- `CreatePostcardForm` gains a **Ride** select immediately below its existing **Club** select,
  identical in shape. Options are rides the rider is crew of, most recent first; the empty option is
  "No ride", mirroring `''` → NULL for club.
- The Journal sub-page's sticky action deep-links to `/postcards/new?ride=<id>` with the select
  pre-selected. The select stays editable — a pre-fill, never a hidden field, because a hidden field
  is a value the rider cannot see and did not choose.

The two selects are independent (§D4). The ride list is a data question with a settled answer:
rides the rider is crew of, which is exactly the set the write gate accepts, so the picker cannot
offer an option the database will refuse.

## D6. What the deferred notification inherits, so it does not rediscover it

Written here because the follow-up will be picked up by a session with none of this context, and
`event-fanout-integrity` already carries the general rules it must obey.

**The recipient set is a THREE-way intersection: riders who can see the ride, who are on its crew,
and who can see the postcard.** Read `036`'s SELECT policy rather than recalling it — it drops the
row unless **every** non-NULL subject column resolves under the reader's own RLS:

```
and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = …))
and (ride_id    is null or exists (select 1 from public.rides    sr where sr.id = …))
```

A `postcard_on_ride` row carries **both**, so both must resolve. Each conjunct fails for a different
rider and neither implies the other:

- **The postcard half.** A crew member need not be able to see a postcard tagged to their ride — it
  may be scoped to a club they are not in (§D4 row three).
- **The ride half.** `private.is_ride_crew` is `security definer` and a `ride_members` row outlives
  blocking the organizer and leaving a private club — the load-bearing fact of this entire change
  (§D2). So a rider can be *on the crew* while `rides` SELECT refuses them the ride, which is
  exactly the state `034` measured. Fanning out to the crew alone writes that rider a row whose
  `ride_id` conjunct is false for ever.

An earlier revision of this section named only the postcard half, which still ships ghost rows —
the failure it was written to prevent, one conjunct short. Writing to any of these produces rows
`036`'s policy drops on **every** read, for ever: precisely *A fan-out SHALL NOT write a row that the
read policy can never return to its recipient*, whose failure mode is the one that requirement names
— nothing raises, no count moves, no assertion fails.

**`036`'s two CHECK constraints refuse the new type before any of this matters.**
`notifications_type_check` enumerates five types and `notifications_subject_shape` is a `CASE` over
the same five with **`else false`** — deliberately, per that file's own comment, so an unmatched type
is a `23514` on the first insert rather than a row with no subject. **No existing arm permits
`postcard_id is not null and ride_id is not null`**, which is the shape `postcard_on_ride` needs. So
the follow-up's first migration task is amending *both* constraints, and skipping it fails loudly at
the first fan-out rather than silently — which is the good direction, and is why `else false` is
there.

The helper does not exist. `private.is_club_member` reads `auth.uid()` **internally**, so at fan-out
it computes the *actor's* membership and calls it everyone's — `036` measured this and it is why
`ride_created_in_club`'s recipient set is `club_members` alone. A `postcard_on_ride` fan-out needs a
new `(candidate, club)` helper, or an inlined `EXISTS` per candidate. That work, plus a seventh
trigger on the shipped `postcards` INSERT path with `036`'s whole DEV-exercise gate behind it, is why
the notification is a separate change rather than a task in this one.

Two smaller inheritances: the author is never notified of their own postcard
(*A rider SHALL NEVER be notified of their own action*), and `event-fanout-integrity`'s per-type
recipient table gains its row **when that change ships** — adding it now would be an enumeration
asserting a type that does not exist, which is the failure `add-notifications` named in its own
`Onboarding completion` delta.
