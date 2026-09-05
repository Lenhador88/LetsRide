# Design — preserve postcards when a club outlives its members

## Context

Everything measured below was read from the live DEV catalogue (`fpmrimzxadewsaiwpsel`) on
2026-09-05, not from migration files and not from memory. Where a claim is a *reading* of
three-valued logic rather than a catalogue fact, it was executed and the result is quoted.

The change adds one lifecycle state — a club with no owner — to a schema where `clubs.owner_id`
appears in **4 policies, 24 functions and 2 CHECK constraints**. Re-derive rather than trust:

```sql
select n.nspname||'.'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prokind='f'
   and pg_get_functiondef(p.oid) ilike '%owner_id%' order by 1;
```

## Goals / Non-Goals

**Goals.** Stop the erasure cascade destroying third-party postcards. Give the resulting state a
defined, testable meaning for every role. Move no audience wider than it is today.

**Non-Goals.** Adoption of an ownerless club. Any change to deliberate club deletion. Any change to
`029`/`032`'s successor selection when a successor exists. Any new client screen. Rendering the
club name on a preserved postcard (Q1, deferred and stated).

## Decisions

### D1 — The new arm is conditional, and the condition is *third-party content*, not *emptiness*

The owner's sentence is conditional: *"a club whose last member leaves **while third-party postcards
survive**."* Read narrowly, and deliberately so.

An abandoned club with nothing in it has nothing to protect. `009`'s original reasoning — delete it —
is correct there and is not reopened. Reading the decision broadly, so that every memberless club
becomes a permanent ownerless row, would turn a fix for a rare case into a garbage generator for the
common one: **10 of 15 clubs on DEV today have no member other than their owner**, so the broad
reading would strand ten rows on the next ten account deletions and protect nothing.

So the no-successor arm becomes:

```
if a postcard exists in this club whose author_id <> departing:
    keep the club, ownerless
else:
    delete the club            -- 009 and 032, unchanged
```

**The test is on `postcards.author_id`, not on membership**, because the whole defect is that the
two disagree. A postcard by a rider who left still counts as third-party content — that is the case
`029` §2 got wrong.

### D2 — Three-valued logic behaves in THREE directions here, and only one of them is safe

This is the single generalisation an auditor of this change is most likely to miss, so it is named
once and then applied per site rather than rediscovered at each one. Every predicate that
interpolates `owner_id` goes three-valued the moment the column is nullable, and **where it lands
depends on what kind of expression it is**:

| Site | Expression with NULL `owner_id` | Verdict |
|---|---|---|
| RLS `using` / `with check` | `auth.uid() = owner_id` → **NULL** | **Fails CLOSED** — a policy admits only TRUE |
| A `WHERE` clause inside a helper | `c.owner_id <> candidate` → **NULL** → row not returned | **Fails CLOSED** |
| A CHECK constraint | `avatar_path LIKE 'club-avatars/'||owner_id||'/%'` → **NULL** | **Fails OPEN** — a CHECK rejects only on FALSE |
| `NOT private.is_blocked(x, owner_id)` | `is_blocked` is `EXISTS(...)`, never NULL → `NOT false` → **TRUE** | **Fails OPEN** |

Executed, rather than reasoned:

```sql
select private.is_blocked('…0001'::uuid, null),                    -- false
       not private.is_blocked('…0001'::uuid, null),                -- TRUE  ← fails open
       ('…0001'::uuid <> null),                                    -- null  ← fails closed
       (null::text like 'club-avatars/' || null::text || '/%');    -- null  ← CHECK passes
```

**The fourth row is the trap.** A `security definer` helper that filters on
`not private.is_blocked(candidate, c.owner_id)` does **not** inherit the safety the other sites get
for free, because `is_blocked` is total: it swallows the NULL and returns `false`. Every such site
has to be closed by hand. §D3 and §D10 do exactly that.

### D3 — Narrow the `clubs` SELECT policy's public arm. This is the load-bearing line

The four live `clubs` policies:

```
SELECT  using (is_public OR (owner_id = auth.uid()) OR private.is_club_member(id))
UPDATE  using/check (auth.uid() = owner_id)
DELETE  using (auth.uid() = owner_id)
INSERT  with check (auth.uid() = owner_id)
```

**UPDATE, DELETE and INSERT need no work and that is worth stating precisely.** With `owner_id`
NULL, `auth.uid() = owner_id` is NULL and a `using` clause admits only TRUE, so an ownerless club is
uneditable and undeletable by every rider — which is exactly the owner's *"nobody inherits
anything"*, obtained for free. **It rests on three-valued logic rather than on anything written
down, so it is asserted rather than assumed.** That is a requirement below, not a remark.

**The `is_public` arm is the one that does not fail closed**, and leaving it alone would be the
whole bug back again:

1. A public club that goes ownerless **stays on Explore**. `getExploreClubs` filters `is_public`,
   which is still TRUE, so the client does not filter it out either.
2. `club_members` INSERT is
   `auth.uid() = user_id AND EXISTS (… c.is_public OR c.owner_id = auth.uid()) AND role = 'member'`.
   The first disjunct is still TRUE, so **a rider can join it**. Joining makes
   `private.is_club_member` TRUE for them, which un-hides **every preserved postcard** to a rider who
   was never in the club — the precise exposure this change exists to prevent, one tap away, passing
   every gate in the repo.

So the arm becomes `(is_public AND owner_id IS NOT NULL)`. The member and owner arms are untouched.

**Why narrow the read rather than guard the join.** Guarding `club_members` INSERT closes route 2
and leaves route 1 — a club on Explore with a Join button that refuses. Narrowing the read closes
both by construction, and closes every route that reads the club through the policy at once, rather
than by enumerating them correctly. The join guard is still written, as defence in depth, because
`is_public` is data an owner could in principle flip; it is the second lock, not the first.

**A secondary consideration, recorded as scheduling rather than dressed up as engineering.** A
parallel build session holds `src/components/clubs/`; `ClubTimeline.tsx` and `ManageRidersRoster.tsx`
both read `club.owner_id`, and `src/types/index.ts` declares `owner_id: string` in three places. A
design that let an ownerless club reach the client would force `owner_id: string | null` and
type-error into files this change may not touch. Keeping the club unreadable avoids that. **This is
not why the decision was made** — consequence 2 stands entirely on its own — but it is true and
someone will notice it, so it is written down rather than discovered.

### D4 — The club context is preserved in the DATA and not yet on the SCREEN. Say so (Q1)

The owner chose this option partly because *"the postcards keep the club context they were posted
to."* Half of that is delivered and half is deferred, and pretending otherwise would be the exact
failure this repo keeps paying for.

**Delivered:** `postcards.club_id` is never touched. The tie survives, the audience stays
club-shaped rather than app-wide, and if the club is ever adopted or the policy widened, the context
returns with no data repair.

**Deferred:** `POSTCARD_SELECT` renders the club through a PostgREST embed, `club:clubs(id, name)`,
and an embed runs under the reader's own RLS on `clubs`. With §D3's narrowing the club row is
unreadable, so the embed returns `null` and the postcard renders **as though it had no club** —
visually identical to an app-wide postcard.

**The postcard's audience is unaffected**, because audience is decided by `postcards.club_id` and
`private.is_club_member` in the postcard's own policy, never by whether the embed resolved. So this
is a display gap, not a leak. It is stated as a requirement so that a future reader knows it was
chosen.

**The fix, when Q1 is answered yes**, is a fourth arm on the `clubs` SELECT policy admitting a rider
who authored a surviving postcard in that club. It is deliberately not built here: it would put
`owner_id = NULL` on the wire for that rider and force the type change §D3 avoids, and it can be
added later with no migration to undo. **The recommended default is to defer**, because a rider
seeing one of their own old postcards without a club chip is a smaller harm than the alternative
this change exists to prevent, and nothing forecloses.

### D5 — Null both image paths, or reintroduce a defect `029` closed and catch it with nothing

`016` puts two CHECKs on each image column. They do **not** behave the same way and describing them
as uniformly disarmed would be wrong:

- `clubs_avatar_path_owned` — `avatar_path IS NULL OR avatar_path LIKE 'club-avatars/'||owner_id||'/%'`.
  With NULL `owner_id` and a non-null path: FALSE `OR` NULL = **NULL**, and a CHECK rejects only on
  FALSE. **Disarmed.**
- `clubs_avatar_path_shape` — a pure regex, `^club-avatars/<uuid>/<uuid>\.jpg$`, with no `owner_id`
  in it. **Still biting.**

So nothing in the schema would stop an ownerless club keeping `avatar_path` pointed into
`club-avatars/<the erased rider's uid>/`. That leaves an erased rider's uid embedded in a live path
indefinitely, which `029` §D2 rejected in as many words as *"the opposite of what an erasure request
asked for"* — and it is exactly why the existing transfer arm nulls both columns.

**The new arm nulls both and returns both as `object_path` first**, so the Edge Function deletes the
bytes, identically to the two arms that already exist. The loop already emits them before it
branches, so this is one `update`, not new machinery. **The ordering constraint from `032` and `095`
applies unchanged**: `owner_id` and both paths move in **one statement**, because the path CHECKs are
row CHECKs evaluated at statement end and a split raises `23514` on the happy path.

### D6 — The tombstone is reaped when its last postcard goes (Q4)

The owner asked directly what happens when the last postcard is later deleted. Without an answer, an
ownerless, memberless, postcard-less club is a row **no rider can see, join, edit or delete** — the
DELETE policy fails closed for everybody, so it is unreachable garbage forever.

**Decision: reap it.** An `AFTER DELETE ON postcards` trigger deletes the club when, and only when,
it is ownerless, has no `club_members` row, and holds no remaining postcard. Ownerless is the first
conjunct so the common case is one indexed probe that fails immediately.

**This hangs a trigger on an already-shipped write path, so `036`'s hand-exercise gate fires** and
`tasks.md` §5 is not optional. From the moment `107` applies, every rider deleting any postcard runs
new code inside their own transaction, and a raise there takes their deletion down with it. Two
consequences the implementation owes: the body does the ownerless test **first**, and it must not be
able to raise on the ordinary path.

**Why not leave the tombstone.** It costs nothing at 15 clubs, but it is a row with no owner and no
route to removal, and the next session to meet one has no way to tell it from corruption. Reaping is
what makes "ownerless" a *state* rather than a leak in the lifecycle.

> **[corrected] This section as first written contradicted §D8, and the contradiction landed on
> third-party content — the exact thing the change exists to protect.**
>
> `rides.club_id` is `ON DELETE SET NULL`. §D8 keeps a club's private rides *because the club
> survives*, so nothing is orphaned. But the reap condition above never looked at rides — so a
> club that went ownerless holding a rider's postcard **and** their private ride would be reaped
> the moment they deleted the postcard, stranding the ride with a NULL `club_id`: visible only to
> its organizer while its `ride_members` rows survive. That is precisely the zombie `032` §2
> exists to prevent, re-created by the fix for something else.
>
> **The reap therefore also requires that no ride remains.** A ride is third-party content too, and
> the tombstone's job is to protect third-party content. Deleting the rides at reap time was
> rejected as re-creating PD-98's own defect one level down; accepting the orphan was rejected
> because nothing would ever notice it.
>
> **Four further properties the implementation owes, none of which fails loudly:**
>
> - **`SECURITY DEFINER`, and this is the one that fails SILENTLY.** The `clubs` DELETE policy is
>   `auth.uid() = owner_id`, NULL for an ownerless club, so it admits *nobody* — including the
>   rider whose postcard deletion is running the trigger. A `security invoker` version deletes zero
>   rows with no error and passes any assertion that only checks the postcard delete succeeded.
> - **`old.club_id is null` is tested first**, and again in the trigger's `WHEN` clause so the
>   function is not called at all. 6 of 11 postcards on DEV are app-wide.
> - **A multi-row delete fires it once per row, after the statement.** Each firing sees zero
>   remaining postcards; the first reaps and the rest must no-op rather than raise.
> - **It re-enters itself** — `delete from clubs` cascades to `postcards`, firing the same trigger.
>   Harmless, because the delete only runs when no postcard remains, but it must be written knowing
>   that.

### D7 — `public.delete_owned_club` (`043`) is NOT touched, and the reason is who is standing there

Both paths end in `delete from public.clubs`, and both cascade third-party postcards away. It is
tempting to fix them together. **They are different, and the difference is the whole justification
for `009`'s cascade.**

`delete_owned_club` is a **deliberate act by a rider who is present**, behind a confirmation that
already counts what it destroys — `getClubDeletionImpact` reports postcards, rides and members, and
`an-owner-leaves-their-club` requires that those counts *"still report"* postcards by riders who
have left. The rider is told what goes and chooses it. `009` chose cascade there knowing that:
*"cascade loses the rows; set null leaks them."*

`transfer_owned_clubs` is the opposite: a **side effect of a third party's erasure**, with nobody to
ask, no confirmation, and a rider whose content is destroyed who is not even party to the
transaction. `029` §2's error was importing `009`'s conclusion into a context that had lost `009`'s
premise.

**Silently changing deliberate deletion would be scope creep**, and it would also be a product
change nobody asked for: an owner who deletes a club and finds it still exists, ownerless, would
reasonably call that a bug. If the owner later wants deletion to preserve third-party content too,
that is its own story with its own confirmation copy.

### D8 — The new arm deletes no rides, and this is a narrowing of the delete arm's premise (Q3)

The existing no-successor arm runs `delete from public.rides where club_id = club.id and
is_public = false` before deleting the club. `032` §2 narrowed it there deliberately: a **public**
ride survives the club perfectly well, and only a private one becomes a zombie when
`rides.club_id`'s `ON DELETE SET NULL` (`confdeltype = 'n'`, verified) detaches it.

**That premise is gone in the new arm.** The club row survives, so `club_id` is never set null and no
ride is orphaned. Deleting a private ride there would destroy a third party's ride, its crew and its
chat during someone else's account erasure — **the same defect class this change exists to close**,
left standing in the same function.

> **[corrected] "No ride is orphaned" is only true for as long as the club survives, and §D6 reaps
> it.** The decision here is unchanged and right; the *reasoning* above was incomplete, and taken
> literally it justified a reap condition that stranded the very rides this section preserves. The
> guarantee is completed in §D6: the club is not reaped while any ride remains.

So: the new arm deletes nothing. The **delete** arm keeps `032`'s statement verbatim.

**No audience widens.** A private ride in an ownerless club is readable by its organizer and by a
live-invite holder; the club arm of the ride SELECT policy runs through `private.is_club_member`,
which is FALSE for everyone once the roster is empty. The ride's reach is identical before and
after — it simply is not destroyed.

### D9 — An ownerless club cannot be adopted, and that is a decision (Q2)

**Recommended and taken: no adoption.** An ownerless club is a tombstone protecting other people's
content, not a resource to claim. Adoption hands a rider a club full of postcards by people who
never met them, and the new owner could then flip `is_public` and re-open the exposure §D3 closes.
"Nobody inherits anything" is the owner's phrase and adoption is inheritance with an extra step.

It forecloses nothing: `owner_id` stays nullable, so an adoption RPC can be added later with its own
rules about who may claim and what they may then do.

### D10 — Every other route to a club, audited from the catalogue rather than from a list

§D3 narrows the SELECT **policy**. A `security definer` function has no policy beneath it, so
narrowing the policy narrows **none** of these. Each was read and each is stated.

> **This table was WRONG when first written, in three ways, and the corrections are the most
> valuable thing in this file.** The pre-build review and the build found them; they are marked
> **[corrected]** below rather than silently fixed, because each is a mistake the next reader is
> likely to repeat.
>
> 1. **`can_read_club` was recorded as "Closed … gated by §D3". It is not gated by §D3 at all** —
>    it is a `security definer` function carrying *its own* `c.is_public` test, which is exactly
>    what this section's own opening sentence says a policy change cannot reach. The table
>    contradicted its own premise at its single most load-bearing row.
> 2. **The policy count was given as 4, then 5, and is 7.** Both wrong numbers came from scoping
>    the catalogue query to `schemaname = 'public'`, which cannot see the two `storage.objects`
>    policies. A schema-scoped catalogue query is a list with a filter on it.
> 3. **Four further sites were absent**, three of them carrying §D2's fourth-row hazard.

| Route | With NULL `owner_id` | Why |
|---|---|---|
| `clubs` UPDATE / DELETE / INSERT policies | **Closed** | `auth.uid() = owner_id` → NULL; a policy admits only TRUE |
| `private.is_club_member_for` | **FALSE for everyone** | Roster arm empty; owner arm `owner_id = candidate` → NULL |
| `private.is_club_admin_for` | **FALSE for everyone** | Both arms as above |
| `private.can_read_club` | **[corrected] OPEN via its OWN `is_public`** | **Not** reached by §D3 — a definer body has no policy beneath it. Narrowed identically, in the same migration. `rls_test.sql` 060 pins the two against each other and is what caught this |
| `private.club_takes_join_requests_for` | **[corrected] Closed by a NEIGHBOUR** | `c.owner_id <> candidate` → NULL saves it, while its own `not is_blocked(candidate, c.owner_id)` fails OPEN. Made explicit. Also gates `discoverable_private_clubs` and `club_avatar_is_discoverable` |
| `private.club_takes_invites_for` | **Closed** | Same conjunct |
| `private.club_invite_link_reachable_by` | **[corrected] Closed by a NEIGHBOUR** | `uid <> k.owner_id` → NULL saves it; its own `not is_blocked(uid, k.owner_id)` fails OPEN. Made explicit |
| `private.join_club_from_invite` | **Closed already** | `085` wrote `if v_owner is null … return false` |
| `private.join_club_from_request` | **[added] Closed already** | Same guard, verbatim. Deserves the same credit `join_club_from_invite` gets |
| `private.establish_club_owner_membership` | **[added] Unreachable** | `AFTER INSERT ON clubs`, and the INSERT policy demands `auth.uid() = owner_id` |
| **`public.complete_onboarding`** | **[added] OPEN — and the only real one** | `security definer`, force-joins every rider to `clubs.is_default` with **no `owner_id` predicate**. See §D12 |
| `club_members` INSERT policy | **OPEN via `is_public`** | Closed by §D3, plus an explicit `owner_id is not null` conjunct |
| `private.club_invite_is_answerable_for` | **OPEN — §D2's fourth row** | `not private.is_blocked(candidate, c.owner_id)` returns TRUE |
| `private.notify_club_joined` / `notify_ride_created_in_club` | **Closed, by accident** | A NULL recipient is dropped by `recipient <> new.user_id` → NULL |
| `private.notify_club_join_requested` | **[added] Closed, by the same accident** | Identical `select c.owner_id as recipient` union; missed by the first pass over the other two |
| `private.notify_club_invited` | **[added] OPEN — §D2's fourth row** | `not exists (… and is_blocked(x, c.owner_id))` is TRUE. Closed only by `club_takes_invites_for` upstream. Needs a POSITIVE existence test; adding the condition to the negative one would read as a guard and do nothing |
| `storage.objects` club avatar / cover reads | **[added] Closed** | `foldername(name)[2] = c.owner_id::text` inside an `EXISTS` → NULL. §D5 nulls the paths anyway |
| Storage: postcard images | **Follows the postcard** | See §D11 |

**Every one of the four `club_members` inserters was enumerated**, since membership is what un-hides
a preserved postcard: `establish_club_owner_membership`, `join_club_from_invite`,
`join_club_from_request`, `complete_onboarding`. Only the last was unguarded.

**Two of those need writing about.**

`club_invite_is_answerable_for` is the one site §D2's fourth row predicts, and it is the SELECT gate
on `club_invites`. Its other conjunct, `private.may_invite_to_club_for(i.inviter_id, i.club_id)`,
is FALSE for an ownerless club because nobody is an admin of one — so the invite is **not**
answerable in practice, and the write path is closed twice over by `085`'s guard anyway. **But it is
closed by a conjunct that is about something else**, which is precisely the shape that breaks when
someone later "tidies" it. The fix is an explicit `c.owner_id is not null` conjunct plus an
assertion naming this reason. **Without it a rider keeps a live invite showing an ownerless club's
name and an Accept button that silently does nothing** — a stale affordance and a small disclosure,
not a membership leak.

The **fan-outs are closed by accident and that is not good enough to leave alone.**
`notifications.user_id` is `NOT NULL`, and both functions union in `select c.owner_id as recipient`.
A NULL recipient would violate that constraint and **take the triggering write down with it** — a
rider's join, or a ride's creation, failing with a 500. It does not, because the post-union filter
`candidates.recipient <> new.user_id` evaluates to NULL for a NULL recipient and the row is dropped.
That is real and it was measured, but it is a side effect of a filter written for a different
purpose. An `owner_id is not null` conjunct on that arm makes it intentional, and the assertion says
why.

### D11 — Storage follows the postcard, with no policy change, and this was checked rather than asserted

The Storage read policy for postcard images is:

```
bucket_id = 'media' AND foldername(name)[1] = 'postcards'
AND EXISTS (SELECT 1 FROM postcards p
             WHERE p.image_path = objects.name
               AND foldername(objects.name)[2] = p.author_id::text)
```

That `EXISTS` runs under the **reader's** RLS on `postcards`, so the bytes are reachable exactly when
the row is. A preserved postcard's author still matches its own `author_id = auth.uid()` arm, so
**their own bytes stay readable** — and they are alive, so `postcards/<their uid>/` is untouched by
the erasure. A rider who cannot read the row cannot read the bytes. **No Storage policy changes**,
and the club's own avatar and cover are deleted with their bytes by §D5.

### D12 — [added during the build] The welcome club is EXCLUDED from the new arm

**This is a security condition, and it was found by reading a test fixture rather than by §D10's
catalogue audit — which is worth knowing about the audit.**

`public.complete_onboarding` is `SECURITY DEFINER` and joins every completing rider to the club
carrying `clubs.is_default`:

```sql
insert into public.club_members (club_id, user_id, role)
select c.id, v_uid, 'member' from public.clubs c where c.is_default
on conflict do nothing;
```

with no `owner_id` predicate — and its own comment says why that matters: *"The insert runs as the
function owner, so `club_members`' INSERT policy does not apply and no policy needs widening for a
rider to be placed in a club they did not ask for."*

**So §D3's narrowing cannot reach it.** If the welcome club were allowed to go ownerless, every
subsequent signup would still be force-joined to it, each new membership row would make
`private.is_club_member` TRUE, and every preserved postcard in that club would become readable by
every new rider in the app — **widening over time rather than being a one-off**. It also breaks §D6:
a club that keeps gaining members can never satisfy the reap condition, so the tombstone becomes
permanent *and* populated.

**Decision: the new arm excludes `clubs.is_default`.** The welcome club keeps `032`'s delete.

**Rejected: guard `complete_onboarding` alone and let the club go ownerless.** That keeps the club
and makes every future rider join **nothing, silently** — `059`'s own documented worst failure. Its
warning fires only when *no* club carries `is_default`, and an ownerless one still does.

**Both locks are taken anyway.** The exclusion is the primary fix; `complete_onboarding` also gets
`and c.owner_id is not null`, and `059`'s warning condition is widened to match so the join-nothing
case is loud rather than silent. The reason for the second lock is this change's own new requirement
in `database-enforced-integrity`: the exclusion is a *neighbouring guarantee about something else*,
holding only while `is_default` marks exactly one club.

**The stated cost, which is larger than it first looks and must not be filed as a footnote.**
Third-party postcards in the welcome club are still destroyed by an erasure. Measured on DEV:
**all 5 club-attached postcards in the database are in the welcome club**, so on today's data this
leaves PD-98's defect open for 100% of club-attached postcards by row count. It is still the right
trade — the defect is latent (0 third-party postcards on DEV *and* PROD) and shipping a leak to fix
a latent bug is clearly worse — and `rls_test.sql` 081.16b already records that this arm destroys
the welcome club and everything in it, so the change leaves that path exactly as it found it rather
than half-fixing it. **Filed as its own Linear issue rather than left in this paragraph.**

### D13 — [added during the build] Nulling `owner_id` is the MECHANISM, not bookkeeping

`clubs_owner_id_fkey` is `references public.profiles(id) ON DELETE CASCADE`. **Detaching the club
from that cascade is the entire reason it survives the erasure** — the `profiles` row is deleted
moments later, and any club still pointing at it goes with it.

No file in the change said so, and §D1's pseudocode reads "keep the club, ownerless", which a
builder can reasonably implement as *skip the `delete from public.clubs`*. That version looks
correct, passes every assertion written against `transfer_owned_clubs` in isolation, and then loses
the club and every postcard in it to the cascade a few statements later. `rls_test.sql` 107.1
performs the `profiles` cascade for exactly this reason instead of asserting on the function's
return value.

`public.leave_owned_club` already records the constraint from the other side: *"clubs.owner_id is
NOT NULL with a CASCADE FK and 'do not transfer' is unavailable when the owner's account is being
erased."* This change removes the first half of that sentence.

## Risks / Trade-offs

- **A new nullable column in a schema that interpolates it in 30 places.** Mitigated by §D2's table
  and §D10's per-site audit, and by asserting the fails-closed behaviour rather than trusting it.
  The residual risk is a *future* site written without §D2 in mind; the requirement added to
  `database-enforced-integrity` is what carries that forward.
- **A trigger on `postcards` DELETE (§D6).** Real, and gated by the hand-exercise procedure in
  `tasks.md` §5. Declining Q4 removes this risk and leaves permanent tombstones.
- **Q1's display gap (§D4).** A rider may see an old postcard of their own with no club chip. Chosen
  over the alternative, stated rather than hidden, reversible with no migration.
- **The state is unreachable on DEV today**, so every assertion is fixture-driven. That is a reason
  to write the fixtures carefully, not a reason to defer: 0 at-risk clubs today is 0 by luck.

## Open Questions

Each has a recommended default so the build proceeds and can be corrected later.

**Q1 — Do preserved postcards show their club's name? Default: no, deferred.** §D4. **Product
owner's**, non-blocking. Answering yes costs a fourth policy arm and a `string | null` type change.

**Q2 — Adoptable? Default: no, out of scope.** §D9. **Product owner's**, non-blocking.

**Q3 — Do private rides die in the new arm? Default: no.** §D8. Technical; a reviewer can settle it.

**Q4 — Reap the tombstone? Default: yes.** §D6. Technical; a reviewer can settle it. Declining
leaves rows nobody can delete.

## Questions Closed

- **Who inherits?** Nobody. Owner, 2026-09-05.
- **Is ownerless already representable?** No — `owner_id` is `NOT NULL`. Two functions already guard
  for it defensively; neither makes it legal.
- **Is there data to repair?** No. 0 postcards by ex-members, 0 memberless clubs, measured.
- **Does this touch deliberate deletion?** No. §D7.
- **What does this do to the advisor count?** Nothing — 39 DEV / 37 PROD. No new `public` function;
  any helper added lives in `private`, which adds none.

## Sequencing

**Migration-first, and the reason is that the migration has no unsafe side rather than that
migration-first is the default.**

- **No shipped client writes `owner_id`.** It is insertable but not updatable (`045`'s per-column
  grants), and the INSERT policy demands `auth.uid() = owner_id`, so no client can write NULL. There
  is no `PGRST204` case.
- **No new PostgREST relationship**, so no `PGRST201`/HTTP 300 case for an older bundle.
- **The policy delta is provably a no-op against every row that exists at apply time.** Adding
  `AND owner_id IS NOT NULL` changes the result for exactly the rows where `owner_id` is NULL, and
  there are none — the column is `NOT NULL` until this file runs. Only this migration can create the
  first such row.
- **No client type changes**, by §D3.

So the shape is `090`'s — a migration whose observable effect no bundle can see — and it may apply
before or after the deploy. It goes **migration-first** so the guarantee exists from the moment the
code that depends on it can run.

**Within the file, statement order matters** and is fixed in `tasks.md` §2: drop `NOT NULL`, then
the policies, then the helpers, then the function body. The function body is last because it is the
only thing that can create the state the policies must already be ready for.
