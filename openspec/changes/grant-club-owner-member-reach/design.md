# Design — a club's owner reaches their own club as a member does

## D1. Why the function, not the policies

The issue's option 2 — an owner arm on the `rides` policies only — is narrower in *blast radius*
and wider in *residual bug*. The enumeration in `proposal.md` settles it: nine of the ten calling
policies are wrong in the same way, so a rides-only fix leaves an owner unable to read or post
postcards in their own club and unable to read a private club's roster. Those are not
hypothetical future callers; they are live defects today, and fixing two of nine and calling the
issue closed is how the remaining seven get inherited as covered.

The auditability objection to option 1 is real and is answered by *enumeration*, not by
narrowness: the caller set is fixed and small (ten policies, zero in `storage`, zero in other
functions — read from `pg_policies` and `pg_proc`, not recalled), the transitive set is six more,
and both are written down in the proposal. A future policy that calls `is_club_member` inherits
the owner arm silently — which is the correct default once `club-owner-authority` states the rule
capability-wide, and is exactly what a per-policy fix cannot give.

## D2. Why the name stays `is_club_member`

A function named `is_club_member` that returns true for a rider with no membership row is a trap.
Two things answer it, and neither is a rename:

1. **A rename costs ten policy recreations** — `CREATE OR REPLACE FUNCTION` cannot change a
   function's name, so every calling policy must be dropped and recreated to reference the new
   one. That turns a one-statement migration touching zero policies into a migration touching
   ten, on the visibility layer, for a naming gain. `CLAUDE.md` is explicit that naming is never
   grounds to hold a change.
2. **The name becomes accurate again.** Once `enforce-creator-membership` lands, every club owner
   *does* hold a `club_members` row, and the owner arm is belt-and-braces for a state the
   database no longer permits. Renaming to match a transitional inaccuracy would leave the wrong
   name behind afterwards.

`COMMENT ON FUNCTION` carries the contract instead. It is one statement, it is visible from
`\df+` and from the dashboard, and it does not touch a policy.

## D3. Why an RLS predicate should not lean on a trigger-enforced invariant

`enforce-creator-membership` makes the ownerless-owner state unreachable. A reasonable reading is
that this change then becomes unnecessary. It does not, for the same reason the route guard does
not make RLS unnecessary:

- The invariant is enforced by triggers on `club_members` and `clubs`. A trigger can be dropped,
  disabled, or bypassed by a `security definer` path — `private.transfer_owned_clubs` already
  writes `club_members` rows as the table owner during account deletion, and it demotes the
  departing owner to `'member'` while promoting a successor, so ownership and membership are
  moved by privileged code that RLS does not bind.
- If that invariant is ever breached, option 3 alone means the breach presents as **silent
  invisibility** — the club renders, the rides are gone, nothing errors. With the owner arm in
  place the same breach presents as a roster gap and a missing notification: cosmetic, visible,
  and not a lockout.

Defence in depth, in the direction that fails safe.

## D4. The block interaction, verified conjunct by conjunct

The rule being protected is decision #2: **widening a membership test must not step past a
block.** It holds structurally, not by luck — in every block-carrying policy in the caller and
transitive sets, `private.is_blocked` is a conjunct at the *top level* of the predicate, while
`is_club_member` sits inside a disjunction beneath it. Read from `pg_policies` on DEV
2026-08-12:

| Policy | Shape | Consequence |
|---|---|---|
| `rides` SELECT | `organizer_id = auth.uid() OR (NOT is_blocked(…, organizer_id) AND (… OR is_club_member(club_id)))` | The owner arm sits inside the second disjunct's inner `OR`. The block conjunct dominates it |
| `postcards` SELECT | `author_id = auth.uid() OR (NOT is_blocked(…, author_id) AND (club_id IS NULL OR is_club_member(club_id)) AND NOT hidden)` | Same |
| `club_members` SELECT | `(is_club_member(club_id) OR public) AND (user_id = auth.uid() OR NOT is_blocked(auth.uid(), user_id))` | Block conjunct is the outer `AND`. Blocked members stay off the roster the owner can now read |
| `postcard_comments` / `postcard_likes` SELECT | `EXISTS(postcards …) AND (author_id = auth.uid() OR NOT is_blocked(…))` | Inherits postcard visibility, keeps its own block conjunct |

So `NOT is_blocked(...) AND (X OR owner)` is what the change produces everywhere, never
`(NOT is_blocked(...) AND X) OR owner`. **A reviewer's fastest check is that the owner arm went
inside `is_club_member`'s body and nowhere else** — because any arm added at *policy* level is
the shape that could escape the block conjunct, and this change adds none.

## D5. Rollback

The current body, captured verbatim from `pg_get_functiondef` on DEV 2026-08-12 so the rollback
is a copy rather than a reconstruction:

```sql
CREATE OR REPLACE FUNCTION private.is_club_member(target_club_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid()
  );
$function$
```

Note the `search_path TO 'public'` and the unqualified `club_members`: both are restored by the
rollback and both are deliberately *not* preserved by the forward migration (`proposal.md`
§What Changes). A rollback is a revert, so it takes the hardening back out with the arm.

## D6. Sequencing

**No deployment deadlock, and no ordering constraint against the code deploy.** The change is
purely additive to a predicate: every read and write that succeeds today still succeeds
afterwards, and no application code reads or depends on the function. It can be applied to DEV
and PROD at any time, in either order, before or after any pending code deploy.

It is independent of `enforce-creator-membership` in both directions. If that change lands first,
this one is belt-and-braces on day one. If this lands first, it removes the lockout that change's
backfill would otherwise be racing.

Both projects are level on this file's prerequisites — the function is identical on DEV and PROD
because it predates the `051`–`053` divergence. Task 1.1 re-verifies rather than trusting that.

## D7. Why `feed_reads` is in the widened set and why that is fine

`feed_reads` INSERT and UPDATE both carry `(club_id IS NULL OR is_club_member(club_id))` inside a
`WITH CHECK` that already pins `user_id = auth.uid()`. The owner arm lets an ownerless owner set
a read watermark for their own club. It is an own-row write about their own reading position, it
leaks nothing, and refusing it would leave the club feed permanently unread-marked for the one
rider who owns it. No separate treatment is warranted; it is listed so it is not discovered later
as an unstated consequence.
