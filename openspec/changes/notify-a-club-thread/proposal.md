# Notify a club thread — a reply and a wave reach the rider who started it

> Linear **PD-367** — *"A comment or a wave on a club thread notifies — and notifications need a
> `thread_id` first"*. Product owner, 2026-09-01: ***"yes a comment or a wave should notify."***
>
> Story 3 of the three PD-365's feedback split into. **PD-367 has no comments**; `get_issue` and
> `list_comments` were both called and the body is the whole of it.
>
> Migration number is **`098`** and it is fixed. `097` belongs to
> `openspec/changes/introduce-yourself-on-joining-a-club/` and `099` to PD-368. This change
> touches **nothing** in that directory, and **no column of `club_threads`**.

## ⚠ Read this first

### 1. The APPLY ORDER is the opposite of the one PD-367 specifies. RAISED, AND NOW SETTLED.

**PD-367's body, and the brief that commissioned this file, both said `098` applies only AFTER its
bundle is confirmed serving — `089`'s rule. Measured against the tree and both databases, that is
the unsafe side. The main thread decided it on 2026-09-01: order A, migration-first**, on the three
measurements below rather than on the recommendation alone. `tasks.md` §7 records the decision and
keeps order B struck rather than deleted.

The stated reason had expired and the change has a second property that inverts the answer:

- **The reason expired on 2026-08-28.** `089`'s rule exists because `notificationCopy` and
  `NotificationsListItem`'s `describe` were exhaustive switches with **no runtime fallback**, so an
  unknown `type` returned `undefined` from a destructured result and took the notifications screen
  down. `089`'s own follow-up added both fallbacks *for this reason*, in its own words: *"this is so
  the type after next has no such window."* They are on `origin/main` and on `origin/development`
  today. An unknown type now renders `Rider · did something on LetsRide.` with `href: null` —
  an unlinked, generic row that **self-heals** the moment the bundle lands.

  ```bash
  git show origin/main:src/components/notifications/copy.ts | grep -c "did something on LetsRide"                # 1
  git show origin/main:src/components/notifications/NotificationsListItem.tsx | grep -c "return { href: null }"   # 1
  git log --oneline -S"did something on LetsRide" -- src/components/notifications/copy.ts                        # 4c90be6 (#343, PD-335 / 089)
  ```

- **`098` adds a COLUMN THE SHIPPED CLIENT READS, and `089` did not.** `NOTIFICATION_SELECT` in
  `src/lib/data/notifications.ts` is an explicit column list, and this change adds
  `thread:club_threads!thread_id(id, title)` to it. Against a pre-`098` database PostgREST answers
  **`PGRST200` / 400** for that embed — *could not find a relationship* — `unwrapList` throws, and
  **every rider's notifications list
  fails entirely** for the length of the window — not a degraded row, the whole screen. That is
  `096`'s reasoning read on the read side: *"For a column a shipped client WRITES, migration-first
  is the only safe side."*

So the two sides are not symmetric. Migration-first costs a handful of generic rows that fix
themselves; deploy-first costs an existing screen for every rider. And on PROD the first cost is
measurably **zero**: `select count(*) from club_threads` is **0** and `club_messages` is **0** on
`zwprydcyryvudhurbnye` (2026-09-01), so no reply and no thread wave can exist during that window at
all.

**So the order is `096`'s: `098` applies BEFORE the bundle serves, on each project independently.**
This is not a disagreement with `089`; it is `089`'s own rule, which asks *which side fails safe*,
run against two facts `089` did not have. `tasks.md` §7 is the operative instruction and order B
there is struck — kept visible because *"a new notification type deploys last"* is the rule this
repo carries and the next reader will reach for it.

### 2. Scope is EVERY club thread, and that is an interpretation rather than a quotation.

The owner said *"yes a comment or a wave should notify"* in a conversation about the club
introduction (PD-365). Building it for introductions alone gives a **two-tier rule** — replying to
an introduction notifies, replying to any other thread in the same club does not — with nothing on
either screen saying why, and with the difference living in a column
(`club_threads.introduces_user_id`) that belongs to a story building in parallel. This change
therefore reads it as *every* `club_threads` row. **Correct this if the owner meant introductions
only**; it is Q6 and its cost is one `WHEN` clause on each trigger.

### 3. Everything below is measured against BOTH projects on 2026-09-01.

DEV `fpmrimzxadewsaiwpsel`, PROD `zwprydcyryvudhurbnye`. Each claim carries the command that
re-derives it. The Linear half is first-hand: `get_issue` and `list_comments` on PD-367 and
`get_issue` on PD-368.

### 4. These files were hand-scaffolded, and `openspec validate` is green.

`node_modules` was absent when they were written, so `openspec new change` could not run and the
artifacts were written to the exact shape the scaffold produces (`.openspec.yaml` with `schema` and
`created`, plus `proposal.md`, `design.md`, `specs/<capability>/spec.md`, `tasks.md`), copied from
`openspec/changes/club-timeline-engagement/`. The CLI is installed now and has been run:

```bash
node_modules/.bin/openspec validate notify-a-club-thread --type change            # valid
node_modules/.bin/openspec validate notify-a-club-thread --type change --strict   # valid
```

**Note the flag.** There is no `--change` option; it is a positional item name with `--type change`,
or `--changes` for all of them. And this is the **only** automated gate these artifacts have —
`openspec/` sits in `ci.yml`'s denylist, so nothing else in CI reads them.

## Why

A rider opens a thread in their club. Three people answer it. **They are told nothing, ever.**

- **No notification in this schema fires on a `club_messages` insert at all.** Fourteen types
  today, none of them a reply — re-derive off `notifications_type_check`, not off this sentence.
- **A thread wave notifies nobody either.** `092` shipped `club_thread_waves` deliberately silent;
  its own `comment on function private.notify_club_waved()` says so in as many words: *"A THREAD
  wave notifies nobody at all; there is deliberately no notify_club_thread_waved."*

So this is **two** fan-outs, not one. And it is the gap that makes PD-365's introduction worth
writing and then pointless: the rider who introduces themselves is exactly the rider waiting for an
answer.

## The trap the cheap build walks into

`notifications` has **no `thread_id`**, and its collapse key is exactly:

```
notifications_event_key  UNIQUE (user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id)
                         NULLS NOT DISTINCT
```

Reuse `club_id` as the subject and a reply notification collapses per *(recipient, type, actor,
club)*:

> Ana replies in thread X → the author is notified. Ana replies in thread Y **in the same club** →
> `on conflict do nothing` absorbs it, and the author is **never told, for ever**, with nothing
> raised anywhere. No error, no log line, no failing assertion. It also cannot deep-link to the
> conversation, because `routes.clubThread` takes a **thread** id and the row would hold a club's.

So `thread_id` is mandatory, which means **rebuilding the unique index every existing fan-out's
collapse depends on**. That rebuild is safe, and this change proves it rather than asserting it —
see `design.md` §D2.

## What changes

**One migration, `098`.** No new table. No new RPC. No change to `club_threads`.

| # | Change | Why it is here |
|---|---|---|
| 1 | `notifications.thread_id uuid references club_threads(id) on delete cascade` | The subject a reply and a thread wave are about |
| 2 | Rebuild `notifications_event_key` over eight columns, still `NULLS NOT DISTINCT` | Or every reply after the first in a club is swallowed |
| 3 | `notifications_thread_id_idx`, **partial** on `thread_id is not null` | The seventh FK on the table, and every cascade path into it must be indexed |
| 4 | `notifications_type_check` gains `club_thread_replied`, `club_thread_waved` | Fifteen and sixteen |
| 5 | `notifications_subject_shape` rewritten — **sixteen arms, not two** | Every existing arm must also say `thread_id IS NULL`, or a `postcard_liked` row can carry a thread |
| 6 | The SELECT and UPDATE policies gain a `thread_id` resolvability conjunct, identically | A row whose thread the reader cannot open must not be returned |
| 7 | `private.notify_club_thread_replied()` + trigger on `club_messages` | Fan-out 1 |
| 8 | `private.notify_club_thread_waved()` + trigger on `club_thread_waves` | Fan-out 2 |
| 9 | `private.retract_club_thread_waved()` + `AFTER DELETE` trigger | Un-waving must not leave a notification standing |
| 10 | Two `comment on function` restatements — `092`'s and `094`'s | Both currently state, in the database, that this thing does not exist |

**Client, four files.** `src/types/index.ts` (the union and the row's `thread`),
`src/lib/data/notifications.ts` (the hinted embed), `src/components/notifications/copy.ts` (two
cases), `src/components/notifications/NotificationsListItem.tsx` (two cases in `describe`).

> **Correction to the brief's file paths, so the next reader does not hunt for them.** The two
> exhaustive switches are `src/components/notifications/copy.ts` and
> `src/components/notifications/NotificationsListItem.tsx`. There is **no** `src/lib/notifications/`
> directory. `src/lib/actions/notifications.ts` and `src/lib/data/notifications.ts` exist and are
> different files.

**No new cache key.** `src/lib/query/keys.ts` already carries `notifications.list()` and
`notifications.unread()`, and neither fan-out is written by the rider who reads it — see
§*What the cache does NOT do*.

## Who is notified — the recipient set, and its bound

**Both types: `club_threads.author_id`, and nobody else.**

- A reply notifies the rider who **started** the thread.
- A thread wave notifies the rider who **started** the thread.

This is `ride_joined`'s original shape and `event-fanout-integrity` records the reasoning as
standing: *"only `rides.organizer_id` SHALL be notified … widening it is a product decision recorded
as an open question, not a default."* Q1 is that open question, with `no` as the recommended
default.

**The bound, stated rather than discovered** — PD-368's shape, one domain over:

- **One message writes at most ONE notification row**, inside the replier's own transaction. Not
  N−1, not one per member. A 500-member club and a 3-member club cost the same.
- **At most one LIVE row per `(thread author, replier, thread)`**, because `actor_id` and
  `thread_id` are both in the collapse key. A thread with 40 distinct repliers accumulates at most
  40 rows over its life, all addressed to one rider.
- **A thread wave is the same shape**, bounded additionally by `club_thread_waves`' primary key —
  `(thread_id, user_id)` — which lets one rider hold one wave per thread at a time.

This is the tightest bound of any fan-out in this schema, and it is deliberate: a club thread is
chat, and `ride_messages` — the app's other chat surface — notifies **nobody** precisely because a
per-message fan-out is a firehose.

## The negative cases — who must NOT see or do this

Every line is a statement about a role and a resource, so each maps onto an assertion in
`supabase/tests/rls_test.sql`. `openspec/config.yaml` is explicit that an unstated one *"silently
becomes whatever the migration author assumed"*.

### Who never receives a row

| Role | Reply | Thread wave | Mechanism |
|---|---|---|---|
| **The actor** | never | never | `new.author_id <> t.author_id` / `new.user_id <> t.author_id` in the fan-out, read from the row and never from `auth.uid()` |
| **A club member who is not the thread's author** | never | never | The recipient set is one rider (Q1) |
| **A club admin, qua admin** | never | never | No role arm anywhere in either fan-out |
| **The club's owner, qua owner** | never | never | And this is load-bearing rather than incidental — see below |
| **A non-member of the club** | never | never | They cannot write the parent row: both INSERT policies carry an `EXISTS` against `club_threads` under the caller's own RLS, and `club_threads` SELECT requires `private.is_club_member(club_id)` |
| **A blocked party, either direction** | never | never | `not private.is_blocked(actor, recipient)` in both fan-outs |
| **A signed-out visitor** | never | never | Decision #1: `anon` holds zero grants and every route but `/auth/*` and `/legal/*` needs a session. Asserted as a negative, never granted |

**The owner-who-is-not-a-member case is the `ride_created_in_club` asymmetry again, and it must not
be re-derived wrongly if Q1 is ever answered `yes`.** `clubs` SELECT admits `owner_id = auth.uid()`;
`club_threads` SELECT does **not** — it requires `private.is_club_member(club_id)`, which queries
`club_members` with no owner arm. `club_members` DELETE is a bare `auth.uid() = user_id`, so an
owner can leave their own club in one request and keep ownership. A row written to an ownerless
owner would be dropped by the SELECT policy on **every** read, for ever — which
`event-fanout-integrity` calls a defect in the fan-out rather than a row awaiting a policy change.
Today the recipient is the thread's author, who held a membership when they wrote the thread, so the
case cannot arise; **a widening must exclude it explicitly.**

### Who never READS a row that exists

- **Anyone but the recipient.** `notifications` SELECT is `user_id = auth.uid()` and nothing else
  admits a second party — not the actor, not the club's owner, not an admin.
- **The recipient, once the thread stops resolving for them.** The new conjunct is
  `thread_id IS NULL OR EXISTS (select 1 from public.club_threads t where t.id = notifications.thread_id)`,
  evaluated under the reader's own row security. So:
  - **A rider who LEFT the club keeps the row and stops reading it — this is Q8**, the only
    rider-visible behaviour here that nobody has explicitly decided. `club_threads` SELECT needs
    `is_club_member`, and the thread author's own-row arm sits *inside* the block conjunct rather
    than ahead of the membership one — so authoring it is not enough. **Nothing deletes the row**,
    the unread count falls with the list in the same instant, and rejoining returns it with its
    original `created_at` and read state. Eviction, not deletion — the `client-cache-invalidation`
    ruling. It follows from the policy rather than being chosen, which is exactly why it is put as a
    question rather than left to be inherited.
  - **A rider blocked with the thread's author** loses it the same way, by the same conjunct.
  - **A rider blocked with the ACTOR** loses it by `notifications`' own
    `not private.is_blocked(auth.uid(), actor_id)` — a different mechanism, and the two are asserted
    separately because one assertion cannot say which fired.
  - **A rider whose actor's `username` goes NULL** loses it by the standing `profiles` conjunct.
- **A private club discloses nothing new.** The thread conjunct **dominates** the club conjunct —
  thread-resolves implies club-resolves, because `club_threads` SELECT already requires
  `is_club_member` and `clubs` SELECT admits every member — so no reader gains a club they could not
  already see. The thread's **title** is read live through the embed under the reader's own RLS and
  is never stamped on the row.

### Who can never write, forge, aim or dismiss one

Unchanged and re-asserted for the two new types: `authenticated` holds **no INSERT and no DELETE
grant** on `notifications` and there is no policy for either; UPDATE is confined to `read_at` under a
predicate **identical** to SELECT's, so a rider cannot learn the count of rows hidden from them.
Neither fan-out reads `auth.uid()`; the actor comes from `new.author_id` / `new.user_id`, each pinned
to `auth.uid()` by its own table's INSERT policy, so a rider cannot cause a notification naming
somebody else as actor. The retraction is scoped by **all four** of `user_id`, `type`, `actor_id`
and `thread_id`, so one rider's un-wave cannot reach another rider's row.

## What happens when the thread goes away

| Event | The notifications' fate | Mechanism |
|---|---|---|
| The author deletes their own thread (`081`) | **Deleted** | `notifications.thread_id → club_threads ON DELETE CASCADE` |
| An admin moderates it (`094`, `moderate_club_thread`) | **Deleted** | Same cascade — that RPC's whole body is `delete from public.club_threads` |
| An operator removes a reported thread (`094`, `private.remove_reported_thread`) | **Deleted** | Same cascade. **That function's own body says the opposite today** and this change makes the claim false — see §D13 |
| The club is deleted | **Deleted** | `club_threads.club_id → clubs ON DELETE CASCADE`, then the thread cascade |
| A replier deletes their message (`delete_own_club_message`) | **Survives** | Deliberate — no retraction on replies, see §D7 |
| The recipient deletes their account | **Deleted** | `user_id` cascade |
| The actor deletes their account | **Deleted**, from the recipient's list | `actor_id` cascade |
| An un-wave | **Deleted** | `private.retract_club_thread_waved()`, this change's own trigger — which joins `club_threads` for the recipient and deletes nothing when that thread is already gone (§D6) |

## What the rider actually sees

**Five people reply to your thread → five rows**, one per person, each opening the thread. **One
person replies ten times → one row**, stamped at their *first* reply. That is `on conflict do
nothing` working as designed, and the cost is stated rather than hidden: **a reply notification does
not resurface.** A rider who has read "Bo replied to *Sunday run*" is not told again when Bo replies
again in the same thread. Q5 offers the alternative and recommends against it — `on conflict do
update` bumping `created_at` and clearing `read_at` would reorder an event row away from the instant
it records, and hand any rider a re-ping button with no rate limit behind it.

**The copy and the destination** (Q3 — the design draws no such row; `npm run figma -- text "Inbox -
Notifications"` returns rows for rides only, so these strings are a product decision, not a design
read):

| Type | Second line | Destination | Trailing |
|---|---|---|---|
| `club_thread_replied` | `replied to ‹thread title›.` | `routes.clubThread(thread.id)` | none |
| `club_thread_waved` | `waved at ‹thread title›.` | `routes.clubThread(thread.id)` | none |

Both resolve the title from the live embed and fall back to `your post` when it does not resolve —
`036` §2's rule, the same way `ride_invited` degrades to `a ride`. **The deep link is `null` rather
than dead when the thread is unreadable**, and that branch is unreachable by construction, because
the SELECT policy withholds the whole row in exactly that case. It exists as the floor, matching
every other arm.

No trailing thumbnail: a thread has no image, and the club's avatar in that slot would read as a
club notification.

## The state checklist — the notifications list, with two new row types

The list already defines every state (`036`); what follows is what the new rows do inside them.

| State | Behaviour |
|---|---|
| **Empty** | No change. Three kinds of zero — none, all blocked, all unresolvable — collapse to one empty state, deliberately, because distinguishing them discloses a block |
| **Loading** | No change. The screen gates on its **data**, never on `isLoading` |
| **Error** | The failed-read state with a retry. **A pre-`098` database is exactly this**, which is the whole of §1's objection |
| **Offline** | Reported as offline; marking read is refused rather than queued |
| **Permission denied** | Indistinguishable from empty **by design** and must stay so: the rows a policy withholds are withheld silently, because a gap, count or marker would disclose the block |
| **Partial** | A thread whose title does not resolve costs the **title** and never the row: the copy degrades to `your post`. A thread that does not resolve at all costs the row, in the database |
| **Stale** | The badge is stale until the next navigation, and that is stated rather than fixed. **A fan-out addressed to somebody else can never invalidate the recipient's cache** — see below |

## What the cache does NOT do

**Neither `postClubMessage` nor the thread-wave action invalidates `keys.notifications.*`, and that
is correct rather than an omission.** The rider who writes the parent row is never the rider who
receives the notification — the fan-out excludes the actor — so an invalidation in the actor's
client would clear a cache belonging to nobody the write concerns. There is no cross-rider
invalidation in this cache and none is being invented: the recipient sees the row on their next
navigation, which is precisely the bounded staleness `client-cache-invalidation` already requires be
**stated**. A new key here would be a claim the app cannot honour.

## What this change does NOT do

- **No push notification.** `078`'s `push_devices` exists and delivery is
  `openspec/changes/deliver-push-notifications/`. Adding a type does not enrol it. `092` drew the
  same line for `club_waved`.
- **No `message_id` column** and no per-message notification. §D5.
- **No retraction on a deleted reply.** §D7.
- **No change to `club_threads`, `club_messages` or `club_thread_waves`** — not a column, not a
  policy, not a grant. The only triggers added to them are the two fan-outs.
- **No new participation-gate trigger.** `club_messages` and `club_thread_waves` already carry one
  (measured), and this change adds no table — so the count stays at **22** on both projects.
- **No new security advisor.** All three functions live in `private`, which PostgREST does not
  publish, so **this change moves the count by zero on each project**. `085`'s eight `private`
  functions adding zero advisors is the precedent, and the rule is that the count moves by the number
  of **public** functions only. **The check is relative, never an absolute number**: DEV and PROD
  legitimately differ right now — 37 and 36, measured 2026-09-01, because `097`'s `introduce_to_club`
  is applied on DEV and awaiting promotion — so an absolute target would read a correct DEV as a
  failed apply.
- **No `introduces_user_id`, no `introduction`, no `097`.** That is the parallel story's.

## Open questions

Every one carries a recommended default so the build can proceed and be corrected.

| # | Question | Blocking | Who answers | Default |
|---|---|---|---|---|
| **Q1** | Does a reply notify **prior repliers** as well as the thread's author? | No | Product owner | **No.** Author only. §D4 records what widening would cost and require |
| **Q2** | Wave → un-wave → wave re-notifies once per cycle. Keep the retraction or drop it (`090`)? | No | Product owner | **Keep it — weakly.** `092`'s only *sound* argument does not transfer to this type, so `090` applies cleanly and the merits now favour dropping. Held only because reversing it belongs in one file covering all three wave fan-outs. §D6 |
| **Q3** | The two copy strings and the destination | No | Product owner | The table above. The design draws no such row |
| ~~**Q4**~~ | ~~**The apply order.**~~ **ANSWERED 2026-09-01 — order A, migration-first**, on three measurements rather than on the recommendation alone. `tasks.md` §7 records them and strikes order B. §1 and §D11 | — | Settled | **Migration-first.** Not open |
| **Q5** | Should a reply notification **resurface** when the same rider replies again? | No | Product owner | **No** — `on conflict do nothing`. §D5 |
| **Q6** | Is the scope every thread, or introductions only? | No | Product owner | **Every thread.** §2 |
| **Q7** | Does a thread wave deserve the same weight as a reply, or is it noise? | No | Product owner | **Same weight**, its own type. `club_waved` is the precedent |
| **Q8** | A thread's author who **leaves the club** stops reading their own thread's notifications. Evict, or keep them readable? | No | Product owner | **Evict.** It falls out of `club_threads`' membership-only SELECT rather than being chosen, and it is an eviction rather than a deletion — rejoining returns every row with its `created_at` and read state intact. §D8. Raised as a question because it is rider-visible and nobody has decided it |

## Verification

Every claim in this file re-derives:

```bash
# fourteen types today, none a reply; and no thread_id column
# (against DEV fpmrimzxadewsaiwpsel and PROD zwprydcyryvudhurbnye)
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
select count(*) from information_schema.columns
 where table_schema='public' and table_name='notifications' and column_name='thread_id';   -- 0, both

# every fan-out's conflict clause is BARE — no index name, no column list
select proname, substring(prosrc from position('on conflict' in lower(prosrc)) for 30)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'private' and proname like 'notify%';                                   -- 12 rows

# the gate already covers both parent tables, so the count does not move
select count(*) from pg_trigger where tgname='enforce_participation_gate' and not tgisinternal;  -- 22, both

# the rebuild's cost
select count(*) from public.notifications;                          -- DEV 18, PROD 15 (it moves)
select count(*) from public.club_threads;                           -- DEV 4,  PROD 0
```
