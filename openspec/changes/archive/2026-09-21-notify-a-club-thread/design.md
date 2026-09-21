# Design — notify a club thread

Fifteen decisions. Each records what was chosen, what was rejected, and the measurement or rule that
decided it. Everything is measured against DEV `fpmrimzxadewsaiwpsel` and PROD `zwprydcyryvudhurbnye`
on **2026-09-01** unless stated.

---

## D1 — `thread_id` is a real typed column with a foreign key, not `club_id` reused

**Decision.** `notifications` gains
`thread_id uuid references public.club_threads(id) on delete cascade`, nullable, NULL on every row
of the fourteen existing types.

**The alternative, and why it is a defect rather than a shortcut.** `club_id` already exists and a
thread already knows its club, so `club_id` "works" — the row stores something true and the CHECK
passes. It fails at the **collapse key**, which is the one place nothing announces a failure:

```
notifications_event_key  UNIQUE (user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id)
                         NULLS NOT DISTINCT
```

With `club_id` as the subject, the key for a reply is *(recipient, type, actor, club)*. Ana replies
in thread X — a row. Ana replies in thread Y in the **same club** — `on conflict do nothing`. No
error, no log entry, no failing assertion, no count that moves. The author is never told about
thread Y, or Z, for the life of that club. It is the same class of silent-wrong as `044`/`046`'s
absolute grant list: correct-looking SQL producing a permanently wrong result with nothing red.

It also cannot deep-link. `routes.clubThread(threadId)` takes a **thread** id — the segment names
which entity the id is, `threads` taking a club's and `thread` taking a thread's — so a row holding
only a club can open the thread **list** at best, which is not the conversation the rider was told
about.

**Why a typed column rather than a polymorphic `subject_id`.** Unchanged from `036`: a polymorphic
column can carry no foreign key, so nothing cascades and a deleted thread leaves a row pointing at
nothing with nothing to detect it. **`thread_id` is the FIFTH typed subject column, the FIFTH
partial index and the SEVENTH foreign-key column**, and the three ordinals differ because the sets
differ: the subject columns are `postcard_id`, `comment_id`, `ride_id`, `club_id`; the partial
indexes are those four (`notifications_actor_id_idx` is **not** partial); and the FK columns are
those four plus `user_id` and `actor_id`. Derive them rather than counting by eye —
`information_schema.columns`, `pg_indexes … indexdef like '%WHERE%'`, and
`pg_constraint … contype='f'` — because an earlier revision of this line gave two of the three
wrong and a different pair wrong again in `tasks.md`.

**`ON DELETE CASCADE`, like every other FK on this table.** A notification whose subject no longer
exists must not survive as a tombstone.

---

## D2 — the unique index rebuild is safe, and this change proves it rather than asserting it

**Decision.** Create the eight-column index first, then drop the seven-column one, in that order,
inside `098`'s own transaction:

```sql
create unique index notifications_event_key_v2 on public.notifications
  (user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id, thread_id)
  nulls not distinct;
drop index public.notifications_event_key;
alter index public.notifications_event_key_v2 rename to notifications_event_key;
```

**Three facts make it safe, and each is measured rather than reasoned about.**

1. **`notifications_event_key` is a plain UNIQUE INDEX, not a table constraint.** It appears in
   `pg_indexes` and **not** in `pg_constraint` — verified on both projects. So the rebuild is
   `create index` / `drop index`, needing no `alter table … drop constraint`, and nothing depends on
   a constraint name.

2. **Every existing row has `thread_id` NULL, and `NULLS NOT DISTINCT` treats two NULLs as equal.**
   Appending a column that is constant across every existing row cannot split an equivalence class:
   any two rows that collided under seven columns still collide under eight, and any two that did
   not, still do not. So no existing collapse changes and no existing row is newly duplicated. The
   `create index` therefore cannot fail on existing data — and if it does, that is a **pre-existing
   duplicate** and a finding, not a rebuild problem.

3. **All THIRTEEN existing write sites end in a BARE `on conflict do nothing`** — no index name, no
   column list, no `on constraint` — measured:

   ```sql
   select n.nspname||'.'||p.proname as fn, m[1] as clause
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral regexp_matches(p.prosrc, 'on conflict[^;]{0,80}', 'gi') m
    where p.prosrc ilike '%insert into public.notifications%'
    order by 1, 2;
   ```

   A bare `on conflict do nothing` binds to *whatever* unique index the row violates, resolved at
   execution time. So **no existing write site names the index and none needs editing.** Had one used
   `on conflict (user_id, type, actor_id, …)`, the rebuild would have broken it at runtime with a
   `42P10` inside a rider's own write — which is exactly why this is measured rather than assumed.

   **The query above is deliberately not the obvious one, and the obvious one under-reports twice.**
   Filtering `n.nspname = 'private' and proname like 'notify%'` returns twelve and misses
   **`public.approve_club_join_request`**, which also inserts into `public.notifications` — a write
   site that is neither in `private` nor named `notify%`. And `position('on conflict' in …)` returns
   only the **first** occurrence, which for `private.notify_club_join_request_declined` and for
   `approve_club_join_request` is inside a **comment** — this repo's own comment trap, at a
   `position()` instead of a `grep`. Selecting on *"inserts into `public.notifications`"* and
   returning *every* match is what makes the gate able to see a fourteenth site.

**The lock and the cost, stated.** A non-concurrent `create unique index` takes a `SHARE` lock,
blocking writes to `notifications` for its duration. The table holds **18 rows on DEV and 15 on
PROD**, so the duration is sub-millisecond. `create index concurrently` is deliberately **not** used:
it cannot run inside a transaction block, which would leave the file non-atomic for no benefit at
this size.

**Column order.** `thread_id` goes **last**, after `club_id`. Two reasons: it keeps the existing
seven-column prefix intact, so every existing retraction's predicate
`(user_id, type, actor_id, <subject>)` is still served exactly as it was; and appending is the only
change that provably preserves every existing equivalence class under fact 2 above.

---

## D3 — the subject shape has SIXTEEN arms, not two

**Decision.** `notifications_subject_shape` is dropped and re-added whole, with:

- **two new arms** — `club_thread_replied` and `club_thread_waved`, each requiring `thread_id IS NOT
  NULL` and `postcard_id`, `comment_id`, `ride_id` and `club_id` all NULL;
- **`AND thread_id IS NULL` added to all fourteen existing arms**;
- the `ELSE false` fallthrough kept.

**Why the fourteen matter as much as the two.** A CHECK is only a shape if it constrains every
column. Add `thread_id` and leave the existing arms alone and a `postcard_liked` row can legally
carry a `thread_id` — which would put it in a different equivalence class under the rebuilt key,
break its own retraction's four-column scope, and make it resolvable or not depending on a thread
nothing about it renders. Nothing would refuse it. **The brief describes this as "the two subject
shape arms"; it is sixteen**, and stating it as two is how the gap gets inherited as covered.

The `ELSE false` is what makes forgetting loud: a type added to `notifications_type_check` and
forgotten here is refused by the database rather than stored shapeless.

**Ordering inside the migration is not optional.** `drop constraint` then `add constraint`, and the
`add` validates against existing rows — so this must run **before** any row of a new type can exist,
which it does by construction (the triggers are created after).

---

## D4 — the recipient is the thread's author, and nobody else

**Decision.** Both fan-outs address `club_threads.author_id` for the thread the parent row belongs
to. One row per event, maximum.

**The rule this follows.** `event-fanout-integrity`: *"only `rides.organizer_id` SHALL be
notified … widening it is a product decision recorded as an open question, not a default."* That is
Q1, and its default is `no`.

**What widening to prior repliers would cost, so the follow-up is small rather than a rewrite.** The
recipient set becomes `thread.author_id ∪ (select distinct author_id from club_messages where
thread_id = new.thread_id)`, and it needs **three** conjuncts the single-recipient version does not:

- `private.is_club_member_for(candidate, thread.club_id)` — because a prior replier may have left
  the club since, and a row written to them is one `club_threads` SELECT drops on **every** read.
  Note `is_club_member_for`, the subject-taking twin `085` added; **`private.is_club_member` reads
  `auth.uid()` internally** and answers only for the caller, so a fan-out using it computes the
  actor's membership once and applies it to everybody.
- `not private.is_blocked(candidate, thread.author_id)` — because `club_threads` SELECT withholds a
  thread from anyone blocked with its author, so such a candidate could never read the row.
- `not private.is_blocked(candidate, new.author_id)` — the ordinary actor block, which the
  single-recipient version already has.

Plus the exclusion `candidate <> new.author_id`, applied **after** the union rather than inside one
arm, because a rider can qualify through both arms.

And the bound changes shape: from one row per message to *(distinct prior authors)* rows per
message, inside the replier's own transaction — which is PD-368's exception, taken a second time,
on a surface that is chat rather than an event.

**The owner-who-is-not-a-member trap belongs to that widening and is recorded here so it is not
re-derived wrongly — and an earlier revision of this section DID re-derive it wrongly**, which is
why the measurement is written out rather than the conclusion. `club_members` DELETE is a bare
`auth.uid() = user_id` with no owner carve-out, so an owner can leave their own club in one request
and keep ownership. What that costs them is the question, and the tempting answer is false:

```sql
-- measured on DEV 2026-09-01, off pg_get_functiondef
private.is_club_member(target_club_id)
  -> private.is_club_member_for(auth.uid(), target_club_id)
private.is_club_member_for(candidate, target_club_id)
  -> exists (select 1 from public.club_members
              where club_id = target_club_id and user_id = candidate)
     or exists (select 1 from public.clubs
                 where id = target_club_id and owner_id = candidate)
```

**`private.is_club_member` HAS an owner arm** — `054`/PD-128 gave it one — so an ownerless owner
resolves `club_threads` perfectly well, and a notification addressed to them is **readable**. The
`ride_created_in_club` asymmetry is therefore NOT what is going on here: that asymmetry is what
`036` §7.5 measured *before* `054`, and `CLAUDE.md` already records that `054` turned that narrowing
into a gap rather than a consequence. Citing it here would import a permanently-unreadable-row
argument that does not apply.

Two live consequences, and they run in opposite directions:

- **For a Q1 widening**, the helper would silently ADMIT the ownerless owner into the candidate set.
  Whether they belong there is a product decision to make out loud; it is not forced either way by
  readability, which is what the old wording implied.
- **For Q8**, the eviction is observable ONLY for an author who is not the club's owner. An owner
  who leaves keeps reading notifications about their own thread, through the owner arm. `098.14`'s
  fixture makes the author a non-owner deliberately, so that assertion cannot pass for the wrong
  reason.

---

## D5 — one live row per (recipient, actor, thread); no `message_id` column

**Decision.** The reply notification's subject is the **thread**, not the message. There is no
`notifications.message_id`.

**What the rider sees.** Five people reply → five rows. One person replies ten times → **one** row,
stamped at their first reply, which does not resurface or reorder.

**Why not per-message, which is `postcard_commented`'s shape.** `postcard_commented` sets
`comment_id`, so two comments are two notifications — and `event-fanout-integrity` requires exactly
that, *"because the recipient has two things to read."* A thread reply is **chat**, not a comment on
a photo: `club_messages` has a 1000-character body, a realtime subscription, an unread watermark
table (`club_thread_reads`) and a composer that expects a conversation. Per-message would make an
active thread a notification firehose, and the app's other chat surface — `ride_messages` —
deliberately notifies nobody at all for that reason. A `message_id` column would also be an
**eighth** subject column, an eighth FK, an eighth index and a nine-column collapse key, all for a
notification nobody wants one of per line.

**Why not `on conflict do update` bumping `created_at` and clearing `read_at`.** It reads as the
obvious fix for "it does not resurface" and it is refused twice over: `created_at` is server-owned
and records **an event at an instant**, so moving it makes the row lie about when the thing
happened and reorders a list whose ordering is specified to be deterministic; and it hands every
rider a re-ping button — reply, reply, reply — with no rate limit anywhere in this app. That is
`090`'s harassment shape reached from the other side. Q5 offers it and recommends against it.

---

## D6 — the un-wave retraction, and the `090` bound it is accepted against

**Decision.** `private.retract_club_thread_waved()` on `after delete on public.club_thread_waves`,
scoped by **all four** of `user_id`, `type`, `actor_id`, `thread_id`.

**The precedent is `092`'s `retract_club_waved`, one table over** — the same act, the same shape,
shipped 2026-08-31. Not `087`, which retracts on an UPDATE of a status column and has no analogue
here, and not `090`, which **removes** a retraction. All three were read.

**The scope is the whole of the safety argument.** A delete scoped by `type + thread_id` alone is a
write **one rider can aim at another rider's row**, in the one table in this schema whose entire
premise is that no rider can write to it: rider A un-waving would delete rider B's notification for
the same thread. A holds no grant on `notifications` — but the trigger does, and it is running on A's
delete. `actor_id` is what makes it A's own row; `user_id` is what stops a future multi-recipient
type being cleared wholesale. The scope is free: `(user_id, type, actor_id, …)` is a prefix of the
rebuilt index.

The three subject columns not named — `postcard_id`, `comment_id`, `ride_id`, `club_id` — are NULL on
every `club_thread_waved` row by D3's arm, so naming `type` is what fixes them. That is
`retract_postcard_liked`'s own reasoning.

### The recipient is NOT on the deleted row, and `092`'s function cannot be copied

**`club_thread_waves` holds `(thread_id, user_id, created_at)` and nothing else**, so the
notification's recipient — `club_threads.author_id` — has to be **joined**. That is the one
structural difference from `092`, and it is invisible until it bites: `retract_club_waved` reads all
four scope columns straight off `OLD`, because `club_join_waves` carries `subject_user_id`,
`user_id` **and** `club_id`. Copying its shape here does not compile into anything correct.

**It fires on cascaded deletes, and — unlike `092`'s — it does NOTHING there.** When a thread is
deleted, the FK cascade issues `delete from club_thread_waves where thread_id = …`, and by the time
that statement's `AFTER DELETE` triggers run the `club_threads` row is **already gone**. So the join
finds nothing, no recipient resolves, and zero rows are deleted. The notifications are removed by
`notifications.thread_id`'s own cascade, which does all the work.

An earlier revision of this section said the retraction fires there "redundantly … at worst
duplicated work and never wrong". **That is false** — there is no duplicate removal, because the
retraction cannot reach the row at all. It is kept as a correction because the wrong version is what
a reader re-derives from `092`'s comment, which says the opposite *and is right about its own table*.

**The failure mode of getting this wrong is not a missing notification, it is a thread that cannot be
deleted.** `select … into strict`, or any `if not found then raise`, raises `NO_DATA_FOUND` inside
the thread's own delete and aborts it — taking `moderate_club_thread`, `remove_reported_thread`, club
deletion and account deletion with it, because all four reach `club_thread_waves` through this
cascade. Fan-out failures are deliberately not swallowed, so it surfaces as a rider who cannot delete
their own thread. Write it as `delete … using public.club_threads`, or as a scalar subquery compared
with `=` so a missing thread yields NULL and matches nothing.

**Still no `pg_trigger_depth()` or `TG_OP` guard.** The temptation now runs the other way — "skip the
cascade case, it does nothing" — and it is refused for the original reason: a guard that skips the
cascade case is one refactor away from skipping the rider case, and the rider case is the feature.

### The `090` counter-argument, stated rather than buried

`090` dropped `083`'s retraction for the opposite reason, and the argument applies here word for
word: **with** a retraction, wave → un-wave → wave writes a *fresh* row each cycle, because the key
never collides — so a rider with one toggle can re-notify a thread's author without limit. **Without**
one, the uniqueness index absorbs every repeat and the author is notified exactly once, ever.

`092` shipped `club_waved` with the retraction anyway, one day before this file, and its **first**
stated reason — *"without a retraction it is an unbounded notification generator"* — is the argument
`090` had already inverted. Both cannot be right about the same index.

**`092` has a SECOND reason, it is sound, and it does not transfer to this type.** Stated at
`supabase/migrations/092_club_timeline_engagement.sql:710-717`: the retraction is what removes a
`club_waved` row when the waved rider leaves the club, and *"the notifications read policy would have
withheld it anyway once `clubs` SELECT stopped resolving for them on a private club; **on a PUBLIC
club it would not have**, and this is what closes that."* That is a real gap the retraction closes —
`club_waved`'s resolvability conjunct is `clubs`, whose SELECT carries an `is_public` arm, so a
public club's row stays readable for ever after the subject leaves.

**`club_thread_waved`'s conjunct is `club_threads`, which is membership-only and has no `is_public`
arm at all.** So the eviction this change already specifies happens on public and private clubs
alike, and there is no gap left for a retraction to close. The one sound half of `092`'s case is
absent here.

**So Q2 rests on a genuinely thinner footing than "follow `092`", and the owner should see that
rather than a consistency argument doing work it cannot do.** What is actually left for the
retraction, once the inverted argument and the non-transferring one are removed:

- **For it:** a notification standing for an act that has been undone. But this repo has already
  ruled that truthfulness is *not* the reason for a retraction — `036` §7.2 says in terms that *"the
  reason is harassment, not truthfulness"*, and `club_joined` deliberately survives the joiner
  leaving. So this argument is available but is not one the repo has ever accepted before.
- **Against it:** `090` applies cleanly — the retraction is precisely what turns a one-tap toggle
  into a repeatable notification generator, and without it the collapse key bounds the author to one
  notification ever. Dropping it also deletes a `security definer` function, a trigger, and the
  entire cascade hazard the section above exists to describe.

**Q2 — ANSWERED 2026-09-01: keep the retraction.** Product owner, asked directly with the case
against it put first: *"Q2 yes leave it."* So the retraction ships and this section is the record of
what was weighed rather than an open question.

**The argument against is NOT withdrawn, and it is written down here because it is the thing a later
change would act on.** `postcard_liked` and `club_waved` both retract; `090` says all three are
wrong to; reversing it belongs in one file covering all three with its own assertions rather than as
a silent divergence in a change about threads — which is the same call `092` made when it declined
to fix `postcard_likes`' policy in its own file. The sharpest form of the objection, which is
easier to see now that the eight-column key exists: **a second reply from the same actor in the same
thread COLLAPSES and re-notifies nobody, while a wave toggled off and on again does not** — the
retraction deletes the row, so the next wave has nothing to collide with. That makes a wave button
the only control in this schema that can be used as a doorbell. Its implementation cost, whenever it
is taken, is one trigger and one function per surface.

The exposure while it stands is bounded by `club_thread_waves`' primary key `(thread_id, user_id)` —
one wave per rider per thread at a time — and by the recipient being one rider who can block the
waver.

---

## D7 — a deleted reply retracts NOTHING, and that is the standing rule rather than an omission

**Decision.** There is **no** `AFTER DELETE` trigger on `club_messages`.

Three reasons, in force order:

1. **The standing requirement already rules on it.** `notifications`: *"no `AFTER DELETE` trigger
   SHALL be added on `club_members` or `ride_members`, because a retraction hanging off a DELETE the
   **actor** controls is a rider-aimed delete of another rider's row in a table no rider may write —
   the hazard `event-fanout-integrity`'s retraction-scoping requirement exists to bound, accepted
   once for likes and not a second time."* `public.delete_own_club_message` is exactly such a DELETE.
2. **It would be wrong even where it is safe.** A rider who replied three times holds **one**
   notification, keyed on the thread. Deleting one of the three messages would clear a row that the
   other two still justify. A retraction would have to count the actor's remaining messages in the
   thread — a read inside a trigger inside another rider's transaction, to undo something that is
   still true.
3. **It is `090`'s generator, with an extra step.** Post → delete → post re-notifies once per cycle.

**The cost, stated.** A recipient can hold "Bo replied to *Sunday run*" pointing at a thread with no
message from Bo. That is correct: the row records **an event at an instant** — `created_at` is that
instant — and not a standing claim about the present. It is the identical ruling to a `club_joined`
row surviving the joiner leaving.

---

## D8 — the SELECT and UPDATE policies gain the conjunct, identically

**Decision.** Both policies are dropped and re-created with one added conjunct, in the same place in
both:

```sql
and (thread_id is null or exists (select 1 from public.club_threads t where t.id = notifications.thread_id))
```

**Both, and identically, is the requirement rather than tidiness.** `notifications` requires *"the
UPDATE policy's predicate SHALL be identical to the SELECT policy's"* in both `using` and `with
check`. An UPDATE policy wider than SELECT makes `update notifications set read_at = now() where
read_at is null` touch rows the rider cannot see, and PostgREST reports the affected-row count — a
number the rider can compare against the list they were shown. The difference is the count of hidden
rows, and the commonest reason a row is hidden is a block, which this spec elsewhere requires never
be disclosed by *"any gap, count or marker"*.

**It discloses nothing new, and that is a derivation rather than a hope.** `club_threads` SELECT is
`EXISTS(clubs c where c.id = club_id) AND private.is_club_member(club_id) AND (author_id = auth.uid()
OR NOT private.is_blocked(auth.uid(), author_id))`, and `clubs` SELECT is `is_public OR owner_id =
auth.uid() OR private.is_club_member(id)`. So **thread-resolves implies club-resolves** — the
membership arm satisfies the club policy on its own — and the new conjunct can only ever *narrow*.
The thread's **title** is never on the row; it is read live through the embed under the reader's own
RLS, per the standing rule that a notification carries no denormalised text.

**No type-scoped disjunct.** `089` and `093` each added one — `type = 'club_join_request_declined'
AND private.club_takes_join_requests(club_id)`, `type = 'club_invited' AND
private.has_live_club_invite(club_id)` — because their recipients are, by construction, riders who
**never could** read the subject: a declined requester and an invitee are non-members at the moment
the row is written, so without a disjunct the row would be unreadable from birth. That is the
condition a type-scoped disjunct exists for, and **neither new type meets it**: the recipient
authored the thread, which `club_threads` INSERT required membership for, so the ordinary conjunct
resolves **at the moment the row is written**.

**It does not resolve for ever, and that is deliberate rather than an oversight.** A thread's author
who later leaves the club stops reading it — `club_threads` SELECT is membership-only — which is the
eviction Q8 puts to the owner and `specs/event-fanout-integrity` states as *"a subset of the
resolving set only while they remain a member."* A disjunct is **not** the repair for that: it would
keep the notification readable while the thread screen it links to still refuses the rider, which is
precisely the row-renders-but-its-destination-will-not-open state the standing spec forbids. Adding a
disjunct nothing needs would also widen the one policy that must stay the narrowest in the schema.

**The two existing disjuncts are preserved verbatim** in the re-created policies. They are on the
`club_id` conjunct and this change does not touch it; dropping them would take `089`'s and `093`'s
notifications down silently.

---

## D9 — the subject columns are `thread_id` ALONE; `club_id` stays NULL

**Decision.** Both new types set `thread_id` and leave `postcard_id`, `comment_id`, `ride_id` and
**`club_id`** NULL.

**Why not both, which `ride_created_in_club` does.** That type sets both *because it renders both* —
the club's name in the copy and the ride as the destination — and
`event-fanout-integrity`'s conjunct table is keyed on **what a type renders**. These two types render
the **thread's title** and open the **thread**. The club is named nowhere and is not the destination:
`routes.clubThread` takes a thread id, so the row needs no club id to build its link.

Carrying `club_id` anyway would add a conjunct with no rendered resource behind it, add a column to
the collapse key that `thread_id` already determines, and put a second, weaker resolvability test
beside a stronger one — inviting a later reader to "simplify" the strong one away, which the standing
requirement *"the resolvability conjunct is not simplified away"* exists to stop.

**Nothing is lost on the cascade side.** Deleting the club cascades `club_threads` (`club_id → clubs
ON DELETE CASCADE`), which cascades these notifications. The `club_id` route would be redundant, not
additional.

---

## D10 — the client renders the title live, degrades to `your post`, and never links a dead thread

**Decision.**

- `NOTIFICATION_SELECT` gains **`thread:club_threads!thread_id(id, title)`** — hinted.
- `notificationCopy` gains two cases reading `row.thread?.title ?? 'your post'`.
- `describe` gains two cases returning `{ href: row.thread ? routes.clubThread(row.thread.id) : null }`
  with no trailing thumbnail.
- `NotificationRow` (the type) gains `thread: { id: string; title: string } | null`.

**The embed is hinted even though it is unambiguous today**, and that is PD-363's rule rather than
caution. A hinted embed cannot go ambiguous whatever a later migration adds; an unhinted one answers
`PGRST201` / **HTTP 300** the day someone adds a junction, and **no gate in this repo can see it** —
`tsc` type-checks a template string, ESLint reads no SQL, Vitest mocks the client, `next build`
issues no query, and the RLS suite runs on plain Postgres where PostgREST's relationship cache does
not exist.

**`club_thread_waves` is a live example of the shape**, which is why this is not hypothetical: its
primary key is `(thread_id, user_id)` over exactly its two foreign keys, so it is a **junction**
between `club_threads` and `profiles` — meaning an unhinted `profiles(...)` embed off `club_threads`
is ambiguous **today**. This change needs no such embed (the actor already arrives through
`profiles!actor_id`), but any thread read that grows one must write **`profiles!author_id`**.
`profiles!user_id` is correct off `club_members` and off nothing else here.

**No raw `thread_id` column on the select.** `089`'s three types need their raw `club_id` because
their embed **cannot** resolve — that is the whole of `089`. Here the embed resolves exactly when the
row is returned, because the policy conjunct and the embed run the same predicate under the same
reader. So `row.thread` is non-null for every returned row and `href: null` is the unreachable floor,
present for the same reason every other arm has one.

---

## D11 — the apply order, which is the opposite of what the brief specifies

**This is the change's one objection and it is recorded at length because the reasoning, not the
conclusion, is what makes it checkable.**

`089`'s rule — *a new notification type applies only after its bundle is confirmed serving* — is not
a fixed order. It is the additive-first rule's real question: **which side fails safe.** Run against
this change's facts, it answers the other way.

| | Older bundle, `098` applied | New bundle, `098` NOT applied |
|---|---|---|
| The notifications **list** | Renders. New rows show `Rider · did something on LetsRide.`, unlinked | **`PGRST200` / 400 on `thread:club_threads!thread_id` — no such relationship in the schema cache → `unwrapList` throws → the screen's failed-read state, for every rider** |
| The unread **count** | Correct — `unread_notification_count()` reads through the policy | Correct, so the badge is nonzero over a broken list |
| Self-healing | **Yes.** The copy is resolved live, so the rows render correctly the moment the bundle lands | Yes, once the migration lands |
| Blast radius | The new rows only | **Every notification row of every type, for every rider** |

**The fallback that changes the answer is on `main` today**, added by `089`'s own follow-up (#343)
for exactly this purpose:

```bash
git show origin/main:src/components/notifications/copy.ts | grep -c "did something on LetsRide"                 # 1
git show origin/main:src/components/notifications/NotificationsListItem.tsx | grep -c "return { href: null }"    # 1
```

`copy.ts`'s own comment prices it: *"A BUNDLE already serving meets rows written by a migration it
predates, and without this it returns `undefined` where a string is expected. `089`'s header prices
what that costs and orders its own apply after the deploy because of it; **this is so the type after
next has no such window**."* This change is the type after next.

**And the second fact is the one `089` did not have at all: a column the shipped client READS.**
That is `096`'s case on the read side — *"For a column a shipped client WRITES, migration-first is
the only safe side"* — and `096` went **first**, before the build served, for it.

**The measured cost of migration-first on PROD is zero.** `select count(*) from club_threads` is
**0** and `club_messages` is **0** on `zwprydcyryvudhurbnye`. No reply and no thread wave can be
written during the window, so no generic row can appear.

**DECIDED 2026-09-01, by the main thread: `098` applies BEFORE the bundle serves, on each project
independently.** It was raised here as a recommendation against PD-367's own instruction; the
decision was taken on the three measurements above rather than on the recommendation, and
`tasks.md` §7 is the operative instruction, with order B struck rather than deleted.

The reason the decision went that way and not the other is that **the two orders are not equally
recoverable**: migration-first is undone by waiting a few minutes for the build, deploy-first is a
live outage of an existing screen for every rider until someone applies a migration. Where two
orders both look defensible, that asymmetry is the tie-break.

---

## D12 — no push, and saying so is cheaper than being asked

Adding a `notifications` type does not enrol it for push. `078` created `push_devices` and delivery
lives in `openspec/changes/deliver-push-notifications/`. `092` drew the same line for `club_waved`
and this change draws it in the same place: **a thread reply and a thread wave produce an in-app row
and nothing else.** A rider who wants to know has the badge.

---

## D13 — two comments in the database currently state that this feature does not exist

Both go false the moment `098` applies, and both are corrected in the same file.

1. **`comment on function private.notify_club_waved()`** ends: *"A THREAD wave notifies nobody at
   all; there is deliberately no notify_club_thread_waved."* Re-issued with the sentence replaced.
   The comment is external, so this costs nothing and does not touch `prosrc`.

2. **`private.remove_reported_thread`'s cascade list**, in its **body**, says: *"`036`'s
   `notifications` has no `thread_id` column and is not in the chain."* That claim becomes false and
   it is the one an operator reads before removing a reported thread.

   **The body is deliberately NOT rewritten, and the reason is `prosrc` alone.** Correcting an
   in-body comment needs `create or replace function`, which changes `prosrc` — the value every
   cross-project reconciliation in this repo is keyed on (`md5(prosrc)`, `pg_get_functiondef`,
   because a reduced apply makes the *recorded statement* useless for comparison). A DEV/PROD
   divergence in that hash, produced by a notifications migration, is a signal that costs a session
   to run down and says nothing true. It also puts `094`'s function behind this change's ordering
   constraint for a comment. `092` declined the identical trade for `postcard_likes`' policy.

   **It is NOT because the function is `security definer` — it is not one.** `private.remove_reported_thread`
   has `prosecdef = false` (measured on DEV 2026-09-01; its DDL carries `set search_path = ''` and no
   `security definer`, deliberately). The definer one is `public.moderate_club_thread`, a different
   function, and conflating them is easy because they sit in the same migration and do the same
   delete. Recorded because an earlier revision of this section rested the argument on that false
   premise, and the argument survives without it.

   Instead: `comment on function private.remove_reported_thread(uuid)` is re-issued carrying the
   correction, `098`'s header names the stale line and its file and line, and **task 8.4 files the
   in-body edit as its own follow-up**. A wrong comment about a cascade that now happens correctly is
   a documentation defect, not a behavioural one — the cascade fires either way.

---

## D14 — no new gate trigger, no new advisor, and both are asserted rather than claimed

**The participation gate does not move.** `club_messages` and `club_thread_waves` each already carry
`enforce_participation_gate BEFORE INSERT … WHEN (CURRENT_USER = 'authenticated')` — measured on both
projects — and this change creates no table. So the count stays at **22**, on both, and `098` asserts
that rather than leaving it to be inferred. `096.10` is the precedent for asserting a count that
does **not** move.

**Note the shape difference between the gate trigger and the fan-out triggers, because copying the
wrong one is a bug this repo has already priced.** The gate carries `WHEN (CURRENT_USER =
'authenticated')` so it correctly *skips* privileged writes. **The three fan-out triggers must carry
no `WHEN` clause at all** — a notification that silently does not happen for a seed, an RPC or a
`psql` write is a gap with nothing to detect it, and it is the RLS suite's own writes that would
stop firing. Equally, **no fan-out function body may branch on `current_user`**: inside a `security
definer` function `current_user` is the **owner**, so such a guard never runs.

**No new security advisor.** All three functions live in `private`, which PostgREST does not publish,
so `authenticated_security_definer_function_executable` cannot fire for them and **this change moves
the count by zero on each project**. `085`'s eight `private` functions adding zero advisors is the
measured precedent, and the rule is that the count moves by the number of **public** functions only.
A new advisor after apply means a function landed in `public` or a `revoke` did not, and is a failed
apply.

**The gate is the DELTA and never an absolute number, and this is the session that proves why.** DEV
reads 37 and PROD 36 today (2026-09-01) — a legitimate difference, because `097`'s public
`introduce_to_club` is applied on DEV and awaiting promotion, which is the ordinary DEV-ahead state.
An earlier revision of this section pinned **36 on both**; against a correct DEV that reads as a
failed apply, which is the failure mode a stale absolute number always has here. Take the count and
the name set **before** the apply on that project and compare them **after**.

---

## D15 — nothing invalidates a cache belonging to somebody else

**Decision.** `postClubMessage` and the thread-wave action are **unchanged**. Neither gains
`invalidate(keys.notifications.list())` or `invalidate(keys.notifications.unread())`.

The actor is excluded from the recipient set by construction, so the rider whose client would run
the invalidation is exactly the rider the notification is not for. Invalidating their own
notifications cache would clear something the write did not change; there is no mechanism in this
hand-rolled cache to reach the recipient's client and none is being invented.

The recipient sees the row on their next navigation. That is the bounded staleness
`client-cache-invalidation` already requires be **stated rather than fixed** — *"the badge is stale
until the next navigation"* — and this change states it for two more types rather than pretending
otherwise. A key added here would be a claim the app cannot honour, which is worse than the
staleness.

**What does change for the recipient is nothing new**: `MarkNotificationsRead` and the existing
`notifications.list` / `notifications.unread` pair already invalidate together, and both new types
ride that unchanged.
