# Undo a block or a hide

## Why

**Both actions are one-way from the UI, and a misplaced tap is permanent.** `unblockRider`
(`src/lib/actions/blocks.ts`) and `unhidePostcard` (`src/lib/actions/moderation.ts`) are
written, tested and have **zero callers** — verified on this branch. PD-298 is the story that
gives them one.

Blocking is symmetric in RLS (decision #2), so a rider who blocks someone by accident silently
disappears from that person's feeds, chats, member lists and ride crews for ever, with no route
back. That is the safety case, and it is also App Store Review Guideline 1.2 territory: a
block affordance a rider cannot reverse is a worse answer than no affordance.

### The issue's central premise is false, and this change exists because of that

PD-298's body says *"The schema is already on our side … This is a screen, not a migration."*
**Measured on DEV (`fpmrimzxadewsaiwpsel`) on 2026-09-05, running as `authenticated` with the
one real blocker's `sub`, that is false for both halves.**

| Read, as the blocker | Rows |
|---|---|
| own `blocks` rows | 1 |
| the blocked rider's `profiles` row | **0** |
| `profiles` readable in total | 22 of 24 |

- **Blocked riders.** The live `profiles` SELECT qual is
  `(auth.uid() = id) OR ((username IS NOT NULL) AND (NOT private.is_blocked(auth.uid(), id)))`,
  and `private.is_blocked(a, b)` matches **either** direction — symmetric by construction, read
  from `pg_get_functiondef` rather than from the migration. So the blocker cannot read the
  blocked rider's row. A list built on existing schema renders **a list of UUIDs**.
- **Hidden postcards.** The live `postcards` SELECT qual carries the hide conjunct *inside* it
  (`AND NOT (EXISTS (SELECT 1 FROM postcard_hides h WHERE h.postcard_id = postcards.id AND
  h.user_id = auth.uid()))`), so a hidden postcard is unreadable to the very rider who hid it.
  `011` anticipated this at the index it created — *"This serves the profiles cascade and a
  'hidden posts' screen if one is ever designed."*

**So each list needs a `security definer` accessor, and each accessor carries a visibility
rule.** That is the whole reason this is a proposal rather than a screen. Migration `105`.

### And one consequence nobody has stated yet: neither list can show an image

This is the finding that should change what gets built, and it was measured rather than
reasoned about — see `design.md` D3.

Storage policies are **not** `security definer`. Both relevant ones delegate to the table RLS
of the caller:

- *"Riders read avatars their profile visibility allows"* resolves an `EXISTS … FROM profiles`
  under the caller's own `profiles` RLS. For the blocker→blocked pair that subquery returns
  **false** (measured).
- *"Riders read postcard images their audience predicate allows"* resolves an
  `EXISTS … FROM postcards` under the caller's own `postcards` RLS — which contains the hide
  conjunct. Measured in a rolled-back transaction on DEV: insert a hide row, and the same
  subquery flips from true to **false** in the same statement.

A `security definer` accessor bypasses *table* RLS and can therefore return `avatar_path` and
`image_path`. It cannot make either **sign**, because signing is a second authorization pass
through Storage that the accessor has no influence over. So:

> **A blocked rider renders as initials. A hidden postcard renders with no photo.** Not as a
> styling choice — as the only outcome the current Storage policies permit.

Both lists are still worth building; the block half loses nothing (a username identifies a
rider) and the hide half loses its thumbnail. Whether to widen the Storage policy for the hide
half is **Q1**, and it is the product owner's, because it is a visibility decision rather than
an implementation one.

## What Changes

- **Migration `105_a_block_and_a_hide_can_be_undone.sql` — purely additive.** Two
  `security definer` functions in `public`, one index, no change to any existing policy, CHECK,
  grant or column.
- **`public.my_blocked_riders()`** — the rows *this rider created*, with the identity the
  `profiles` policy withholds. No arguments at all: the subject is `auth.uid()` and nothing
  else, which is narrower than the `takes a row id, never a rider id` bar CLAUDE.md sets for a
  `public` `security definer` function.
- **`public.my_hidden_postcards(before_at, page_size)`** — this rider's own `postcard_hides`
  rows, each carrying **exactly what Unhide would restore, and nothing more**. The postcards
  audience predicate is restated with the hide conjunct removed and every other conjunct
  intact; when the row would still be unreadable for some *other* reason, the preview columns
  come back NULL and a `restorable` flag is false. The nulling happens **in the function**, not
  in the component — the client owns the render path, so a rule that only reaches a component
  is advisory (CLAUDE.md §Technology Decisions).
- **An index on `blocks (blocker_id, created_at desc)`** so the list has a sort that is not a
  filesort. `postcard_hides` already has the matching one from `011`.
- **Assertions in `supabase/tests/rls_test.sql`** — the suite is at **3382** and every negative
  case in the delta spec below maps onto one.
- **Client: reads only.** A new `src/lib/data/moderation.ts`, two keys in
  `src/lib/query/keys.ts`, two types in `src/types/index.ts`, and two list sections inside the
  **existing** `PrivacySheet`. Both writes already exist and neither is modified.

## What Does NOT Change

- **No new route and no new nav entry.** Owner's decision, recorded on the issue 2026-09-05:
  the lists live inside `src/components/profile/PrivacySheet.tsx`, reached by Profile tab → ⋯
  `Account options` → **Privacy**, joining the analytics opt-out already there. The nav stays
  at four tabs.
- **No policy is modified.** Not `profiles`, not `postcards`, not `blocks`, not
  `postcard_hides`, and not `storage.objects` — see Q1 for the one place that could change and
  why it is being asked rather than assumed.
- **Blocking stays symmetric and stays in RLS.** Nothing here filters in application code.
- **`private.is_blocked` is not touched.** Widening it, or adding a direction argument, would
  change every policy that calls it.
- **No new `profiles` SELECT policy.** The tempting alternative — "let a rider read the row of
  someone they blocked" — is permissive-OR'd with the existing policy and would therefore make
  the blocked rider visible on **every** `profiles` read in the app, undoing the block. See
  `design.md` D1.
- **No admin or moderator surface.** `postcard_reports` is out of scope; that is
  `act-on-postcard-reports`.
- **`hidePostcard` and `unhidePostcard` gain no new invalidation call**, because the new key
  sits under the `postcards` prefix they already invalidate. See `design.md` D5.

## Impact

- **Security advisors: +2 per project, 37 → 39.** Each `security definer` function in `public`
  that `authenticated` may execute produces one
  `authenticated_security_definer_function_executable` WARN. Derived from the catalog rather
  than trusted: DEV currently has **34** such functions, plus the two `rls_enabled_no_policy`
  INFOs and the one outstanding `auth_leaked_password_protection`, which is exactly the
  documented **37**. Putting the functions in `private` would add **none** — and would also make
  them unreachable, because PostgREST routes only to `public` and the client has no other path.
  `029` is the precedent for getting that wrong.
- **Apply order: additive-first, and there is no unsafe side.** The migration adds objects no
  shipped bundle observes and changes no read path an older bundle uses, so an old bundle
  against the new database is unaffected and a new bundle against the old database gets a clean
  `PGRST202` on a function the two list sections are the only callers of. It may therefore apply
  before or after the deploy. **This stops being true if Q1 is answered "widen Storage"** — that
  answer modifies an existing SELECT policy and needs its own ordering call.
- **Migration number `105`.** The chain is at `104` files; DEV is at `104` and PROD at `100`,
  so `105` promotes to PROD behind the existing `101`–`104` gap, in filename order.

## Open Questions

Each has a recommended default so the build is never blocked on an answer.

**Q1 — Should a rider see the photo of a postcard they hid? (BLOCKING, product owner only.)**
Today they provably cannot: the Storage policy delegates to `postcards` RLS and the hide
conjunct lives there. Showing it needs a widened `storage.objects` SELECT policy admitting the
hider, which is a visibility decision about someone else's photo and is not mine to take.
*Default if unanswered:* **build without the photo** — caption, author username, place and date,
with a neutral placeholder. It is honest, it is additive, and the widening stays available as a
follow-up. This is the one question whose answer changes the migration's apply-order class.

**Q2 — Does the "no longer available" row say why? (BLOCKING, product owner only.)**
A hidden postcard can become unrestorable because the hider left the club, because the author
blocked the hider, or because the author deleted their account. Naming the reason turns this
list into a **block detector**: the RLS suite asserts *"the blocked rider is not told they were
blocked"*, and a row that flips to "the author blocked you" tells them. *Default:* one neutral
state, identical copy for all reasons, never a reason. See `design.md` D4.

**Q3 — Does a rider get to clear an unrestorable hide row? (Non-blocking, mine unless
overruled.)** It is their own row and `011`'s DELETE policy already permits it. *Default:*
**yes**, labelled `Remove from this list` rather than `Unhide`, because unhiding restores
nothing. A row a rider can neither restore nor remove is the same complaint this story exists
to answer, one level down.

**Q4 — Do the lists paginate in a bottom sheet? (Non-blocking, mine.)** `PrivacySheet` is a
`ContextMenu`, not a page. *Default:* `my_hidden_postcards` takes a keyset cursor from the
start (the `011` index serves it exactly); `my_blocked_riders` returns everything, because the
count is bounded by human behaviour, and the accessor gains a cursor the day that stops being
true.

**Q5 — Should `hidePostcard` refuse a self-hide? (Non-blocking, mine.)** It currently accepts
one and the row is inert, which its own comment documents. *Default:* leave the action alone and
have the **accessor** exclude `author_id = auth.uid()`, so no inert row can ever reach the list.
Changing the action is a behaviour change to a shipped write path for no rider benefit.
