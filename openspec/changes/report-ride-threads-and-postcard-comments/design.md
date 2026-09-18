# Design

## Context

See `proposal.md` §Why for the motivation. What shapes the approach is that **two working
precedents already exist in this repo and both are read, not recalled**:

- `011` + `076` — `postcard_reports`, then sixty-five migrations later its reader
  (`private.postcard_report_queue`, `private.remove_reported_postcard`).
- `094` — `club_thread_reports` with its reader shipped in the same file, which is the shape this
  change copies twice.

Measured on DEV (`fpmrimzxadewsaiwpsel`) 2026-09-18, because every one of these numbers is a claim
this change moves or depends on:

| Reading | Value |
|---|---|
| Migration files on disk / applied on both projects | 116 |
| `enforce_participation_gate` triggers | 22 |
| `public` `security definer` functions executable by `authenticated` | 38 |
| `public` tables | 33, of which 3 have `service_role` revoked (`club_thread_reports`, `postcard_reports`, `push_devices`) |
| Views in `private` | 2 |
| Figma frames matching `*eport*`, `*omment*`, `*hread*` | **0 of 451** each |

The two audiences this change inherits, read off `pg_policies` the same day rather than from the
migration files:

```
ride_threads SELECT
  EXISTS (SELECT 1 FROM rides r WHERE r.id = ride_threads.ride_id)
  AND private.is_ride_crew(ride_id)
  AND (author_id = (SELECT auth.uid()) OR NOT private.is_blocked((SELECT auth.uid()), author_id))

postcard_comments SELECT
  author_id = auth.uid()
  OR (EXISTS (SELECT 1 FROM postcards p WHERE p.id = postcard_comments.postcard_id)
      AND NOT private.is_blocked(auth.uid(), author_id))
```

`postcards` SELECT, which the second of those resolves through, carries the club conjunct, the hide
`NOT EXISTS` and its own block arm. **The own-comment arm sits at top level**, so a rider always
reads their own comment even when the postcard has left their view — which is why a self-report is
reachable at the policy level on the comment surface and is handled as a display decision (D9).

Children read off `pg_constraint`, never remembered (`076` recorded naming one cascade of five):
`ride_threads` → `ride_thread_messages`, `ride_thread_reads`; `postcard_comments` →
`notifications` (via `comment_id`). Every one `ON DELETE CASCADE`. The two new report tables make
three and two.

## Goals / Non-Goals

**Goals:**

- Close App Store 1.2's report bullet on the two UGC surfaces that lack it, with the shape the
  other two already use, so an operator has one procedure and four queues rather than two
  procedures.
- Ship each reader in the same migration as its table. `076`'s title is the rule.
- Leave the audience of each subject as the single source of truth for who may report it.

**Non-Goals (design level, beyond the proposal's scope):**

- No union view over the four queues. A `union all` over four subject shapes loses columns or
  invents nullable ones; the runbook footer carries the one-line union for an operator who wants
  one pane.
- No shared "reports" abstraction in SQL or in TypeScript. Four tables with four policies is more
  text and less coupling than one polymorphic table, and the polymorphic version is what `094` §2
  already refused on measured grounds.
- No rate limit on reporting. The unique key is the anti-brigading mechanism; a rate limit is a
  mechanism nothing has asked for and would need a store of its own.

## Decisions

**D1 — Two tables, not one shared one, and not a widened `postcard_reports`.**
`094` §2's four reasons, re-checked against these two subjects rather than assumed. The decisive
one is still the live reader: `private.postcard_report_queue` inner-joins `postcards`, so a comment
report parked in `postcard_reports` either breaks the operator's queue or disappears from it behind
a `left join`. *Alternative considered:* one `content_reports` table with a subject-kind column and
partial unique indexes. Rejected — it forces a branching `with check` naming every audience, which
destroys the property each INSERT policy exists for, and it makes every future queue a filtered
view over a table whose rows have different meanings.

**D2 — The INSERT policy inherits and names nothing.**
`reporter_id = auth.uid() and exists (select 1 from <subject> s where s.id = …)`. The `EXISTS` runs
under the caller's row security, so "may I report this" *is* "may I read this". *Alternative:*
spelling out `private.is_ride_crew(...)` in the report policy. Rejected — it is a second copy of an
audience that a later change to `108`'s policy cannot reach, and this repo has the drift story
already (`034`'s first draft).

**D3 — `created_at` is withheld from the INSERT column grant, and `id` with it.**
A table-level INSERT grant (`011`'s shape) lets a client stamp the column the operator's queue
orders by. `094` §3 departed from `011` for this reason and this change follows `094`, not `011`.

**D4 — The queue and the take-down live in `private`, are revoked from every client role, and are
`security invoker`.**
Three barriers, none of them alone: no USAGE on `private` for `anon`/`authenticated`, an explicit
revoke naming `service_role` (which *does* hold USAGE since `031`), and PostgREST routing only to
`public`. Not `security definer`, because the only caller is the owner and marking it definer would
add an `authenticated_security_definer_function_executable` finding for a function no session can
call. *Alternative:* a `public` RPC behind an `is_admin` claim. Rejected — that is the admin role
this project has declined three times, and it would put a bypass path on the API surface.

**D5 — Nobody in the app reads a report, and that answer is reapplied rather than re-asked.**
The product owner decided it for club threads on 2026-08-31 (*"a report reaches NOBODY in the
club"*). The reasoning transfers exactly, and on a ride it is sharper: a crew is often four people,
so an unattributed "this thread was reported" flag names the reporter by elimination — and the
organiser, who would read the flag, can also be the reported author. On the comment surface the
same holds for the postcard's author, who already holds a delete right over every comment on their
photo. **They keep the delete and gain no read.** Widening later is possible; narrowing is not,
because a rider who reported under one rule cannot un-report under another.

**D6 — `service_role` is revoked on both tables, and the judgement is written down because there is
no mechanical test for it.**
`076` §3's criterion is *rows the one credential that bypasses RLS must not be able to enumerate*.
A report row is one rider's accusation against another and carries the reporter's uuid; enumerating
them is exactly the reporter-safety failure the existing suite already asserts against for
postcards. So: **revoked**, taking the count from three tables to five. The safety of doing so is
not reasoned twice — `076` measured that a referential cascade runs as the constraint's system
trigger and consults no privileges, so account deletion is unaffected, and the suite repeats that
measurement here because nothing in CI would notice it breaking.

**D7 — Two migration files, `118` then `119`, and the order is required by a comment rather than by
an object.**
The files share no object. They do both restamp `public.enforce_participation_gate()`'s comment,
which enumerates the gated tables and where the last writer wins — so each must compose its
enumeration from the **live** comment (`092`/`093`'s recorded trap) and `118` must land first for
the count to read twenty-three then twenty-four. *Alternative:* one file. Rejected on size — `094`
is 722 lines for one subject, this would be north of a thousand, and this repo already carries a
procedure for migrations too large to pass as a string. Two files also roll back independently.

**D8 — The client makes no cache claim, and the actions go into modules that already make one.**
Nothing readable changes, so `invalidate` would refetch a list to produce identical rows.
`src/lib/actions/__tests__/writers-invalidate.test.ts` checks per **file**, and both
`ride-threads.ts` and `moderation.ts` already claim for their other writes, so the check stays
honest without a new exemption. A new `reports.ts` module would need an exemption entry, which is
the rule going quieter for no benefit — so the actions go where their neighbours are.

**D9 — A self-report is permitted by policy and not drawn.**
Both policies would accept it, exactly as `011` and `094` accept theirs; excluding it needs a second
subquery re-reading the author identity inside a policy whose whole virtue is naming nothing, to
prevent a row that is inert and visible only to an operator who can ignore it. The affordance is
simply absent for the author — a menu row is a display hint, never an authorization.

**D10 — The comment control is inline text, not a per-comment ⋯ sheet.**
No Figma frame exists for any of it (0 of 451, three patterns). `CommentItem` already draws an
inline `Delete` on a 44px floor with a negative margin; `Report` beside it reuses that exactly and
adds no icon to a list that can run to fifty rows. Registered as a guess in
`docs/FIGMA-FIDELITY-TODO.md`, beside the two entries already recording the same gap.

**D11 — The ride thread menu loses its mount gate in the same change that makes it redundant.**
`canRemoveRideThread` exists because the menu had exactly one conditional row and could open empty.
With Report drawn for every non-author, the menu is non-empty for every viewer, so the gate becomes
a condition that is always true — which is worse than no gate, because the next reader cannot tell
whether it is load-bearing. The expression stays, as the delete row's predicate; the *mount* gate
goes, and a component test asserts the non-emptiness that permits it.

**D12 — The comment queue shows the words and not the photo.**
`076`'s queue carries `image_path` because a postcard take-down leaves a Storage object behind that
only the operator can delete. A comment take-down leaves nothing in Storage, and a comment is judged
on its text. Omitting the column keeps the minimum-exposure rule honest; an offensive *photo* is
reportable on the surface that already carries it.

## Risks / Trade-offs

- **Block-then-report is unreachable, and a rider may read that as the button not working** →
  Stated in the specs as a designed consequence with its remedies named. On the comment surface the
  postcard's author retains `public.moderate_comment`, which resolves a row they cannot read. No
  policy fix is attempted, because every one is worse (a definer RPC that must answer about
  invisible rows, or a block-arm exemption that becomes an existence probe).
- **Four queues is four things for an operator to remember** → The `§Operating it` footer in each
  file carries the union query, and each file's runbook is the same three lines as `076`'s.
- **`reason` carries no signal while every client sends `other`** → A design gap, logged, not
  patched with a guess. The CHECK keeps the column honest for the day a reason step is drawn.
- **Reports are erased by the take-down that acts on them, so a repeat offender under-counts** →
  `076` D5's decision, restated in both table comments and both view comments. The alternative is a
  moderation archive with a lawful basis and a retention window, which is a product rather than a
  column.
- **A future session adds a queue view and reaches for `security_invoker = true` to "make it
  safer"** → Each view writes `security_invoker = false` out explicitly, because it is the default
  *and* the entire reason the view can answer, and a load-bearing default nobody can see is how this
  breaks silently.
- **Two files, and only one applies** → Each is independently complete and its client half is
  independently droppable. The build applies both before the bundle ships; if only one lands, ship
  only that subject's affordance.

## Migration Plan

1. `118_report_a_ride_thread.sql` — table, indexes, policies, grants, gate trigger, queue view,
   take-down, revokes, comment restamps.
2. `119_report_a_postcard_comment.sql` — the same for comments, composing its
   `enforce_participation_gate` enumeration from the comment `118` left.
3. Apply both to DEV, run the RLS suite, read `get_advisors(security)` and expect **no new
   finding**, then re-run the `service_role` grant census and expect **5 revoked**.
4. Ship the client half only after both files are applied to the target project — migration-first,
   because the client writes tables that do not exist yet (`PGRST205` otherwise).
5. **Rollback** is per file and complete: drop the take-down, drop the view, drop the table (its
   trigger goes with it), and restamp the gate comment back. Nothing else moves.

## Open Questions

Carried in `proposal.md` §Open questions with a default each. None of them changes the specs, the
approach or the task breakdown: Q1 (does a report reach anybody in-app — default no) is the only one
that is the product owner's, and its default is the answer already given for the club surface.
