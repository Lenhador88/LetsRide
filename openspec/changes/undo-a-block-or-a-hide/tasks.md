# Tasks — undo a block or a hide

**Read `design.md` before touching any of this.** Two of its findings invert the obvious
implementation:

1. **D3** — neither list can render an image. A `security definer` accessor bypasses table RLS
   but cannot make Storage sign a path, because the Storage policies delegate to the caller's own
   table RLS. Measured, not inferred. Do not spend a day debugging a signing call that is working
   correctly.
2. **D2** — copying the `profiles` SELECT qual into the blocked-riders accessor, which is what
   the standing precedent does for postcards, drops rows here and reintroduces the exact defect
   this story fixes.
3. **D4, rewritten after `105` shipped it wrong** — telling the rider whether a hidden postcard
   could be restored is a block detector, because for a non-club postcard that answer reduces to
   `not is_blocked(me, author)` and `my_blocked_riders()` supplies the other half. `106` removes
   the flag and every preview column. The hidden list has two columns and no per-row state, and
   that is the feature rather than an omission.

**Q1 and Q2 in `proposal.md` are the product owner's and are blocking on the hide half only.**
Both have stated defaults, so build against the defaults rather than waiting. The block half
depends on neither and is the half to land first if the branch runs long — but the story closes
only when both lists exist (`docs/reference/linear.md` §Sequencing).

## 1. Migration `105_a_block_and_a_hide_can_be_undone.sql` — purely additive

- [x] 1.1 `public.my_blocked_riders()` — `returns table (blocked_id uuid, username text,
      blocked_at timestamptz)`, `language sql`, `stable`, `security definer`,
      `set search_path to ''`. Selects from `public.blocks b` joined to `public.profiles p` on
      `p.id = b.blocked_id`, where `b.blocker_id = (select auth.uid())`, ordered
      `b.created_at desc, b.blocked_id desc`.
- [x] 1.2 **No `username is not null` filter** (D2), and a comment saying why — that the conjunct
      is in the `profiles` policy this function exists to bypass, and restating it would drop a
      block nobody could then lift.
- [x] 1.3 **No `avatar_path` column** (D3), and a comment saying why — the Storage policy
      delegates to `profiles` RLS, so the path provably cannot sign for this caller.
- [x] 1.4 `revoke all on function … from public`, then `grant execute … to authenticated`.
      Mirror `009`'s treatment of `private.is_blocked`.
- [x] 1.5 `public.my_hidden_postcards(before_at timestamptz default null, page_size int default
      20)` — `returns table (postcard_id uuid, hidden_at timestamptz, restorable boolean,
      caption text, author_username text, taken_place_name text, image_path text,
      created_at timestamptz)`, same modifiers. **↳ SUPERSEDED BY 106 — see §1a. The signature is
      now `(before_at timestamptz, before_id uuid, page_size int)` returning
      `(postcard_id uuid, hidden_at timestamptz)` and nothing else.**
- [x] 1.6 It restates the `postcards` SELECT qual **minus the hide conjunct** — copy the shape
      from `public.ride_journal_postcard_ids(uuid)`, which restates the whole qual verbatim.
      `restorable` is that predicate; every other returned column is
      `case when restorable then … else null end`. **↳ REVERSED BY 106: that predicate IS the
      leak (D4), and the function no longer restates the qual at all.**
- [x] 1.7 **Exclude `p.author_id = (select auth.uid())`** (Q5) — a self-hide row is inert, since
      the author branch of the postcards policy is unconditional, and listing it would show a
      postcard the rider still sees everywhere. *(Unchanged by 106 — it is the only predicate that
      survived, and the only reason the function still joins `postcards`.)*
- [x] 1.8 `restorable` is a **boolean, never an enum** (D4). Add the comment explaining that the
      three reasons are collapsed on purpose, so the next reader does not add the reason back as
      a missing feature. **↳ REVERSED BY 106: there is no `restorable`, the collapse was two-way
      rather than three-way, and collapsing was never sufficient.**
- [x] 1.9 Keyset cursor: `(before_at is null or h.created_at < before_at)`, ordered
      `h.created_at desc, h.postcard_id desc`, `limit least(page_size, 50)`. **↳ FIXED BY 106:
      that cursor is single-column against a two-column sort, so two hides sharing a `created_at`
      across a page boundary lost one. The cursor is now `(before_at, before_id)` and the client
      must pass both halves off the last row of the previous page.**

## 1a. Migration `106_the_hidden_list_cannot_detect_a_block.sql` — the leak `105` shipped

**Found by the pre-merge review, before either accessor had a caller. `design.md` D4 is rewritten
around it; read that before this list.**

- [x] 1a.1 `drop function public.my_hidden_postcards(timestamptz, int)` — a `create or replace`
      cannot change OUT parameters, and the drop is what removes the eight-column version rather
      than leaving it reachable as an overload.
- [x] 1a.2 Recreate it returning **exactly** `(postcard_id uuid, hidden_at timestamptz)`. No
      `restorable`, no caption, no author username, no place, no image path, no `created_at`.
      **Nothing in a returned row may vary with another rider's actions**, in those words, in the
      header — so the next reader does not restore the preview as a missing feature.
- [x] 1a.3 Keep `security definer`, `set search_path = ''`, `language sql`, `stable`, the
      `h.user_id = (select auth.uid())` scope, the self-hide exclusion, and the
      `least(greatest(coalesce(page_size, 20), 0), 50)` bound. A DROP discards all of them, so
      each is re-stated rather than inherited.
- [x] 1a.4 Composite keyset cursor `(before_at, before_id)`; 1.9 above.
- [x] 1a.5 `revoke all … from public, anon` then `grant execute … to authenticated`, **by name at
      the new signature** — the drop took `105`'s grants with it and a bare `create` inherits
      Supabase's project default, which grants EXECUTE to `anon` explicitly.
- [x] 1a.6 The join to `profiles` is gone with the username it fed; the join to `postcards`
      survives for the self-hide exclusion alone.
- [x] 1a.7 Apply to DEV. Free in both directions — the dropped object has no observer, since
      `105` is DEV-only and no deployed bundle has ever called it (`090`'s class).
- [x] 1a.8 Verify against the live database: one function of that name, the two-column result,
      the three-argument signature, `prosecdef`, `proconfig`, and the grants.
- [x] 1a.9 Advisors: **net zero, DEV stays at 39** — one `security definer` function in `public`
      leaves and the same name comes back. Run `get_advisors(security)` rather than deriving it.
- [x] 1.10 `create index blocks_blocker_id_created_at_idx on public.blocks (blocker_id,
      created_at desc)`.
- [x] 1.11 `comment on function` for both, naming the policy each bypasses and the conjunct each
      removes.
- [x] 1.12 Apply to DEV with `apply_migration`. Order is free — the change is additive and
      neither side fails (`proposal.md` §Impact). **Unless Q1 comes back "widen Storage"**, which
      modifies an existing SELECT policy and needs its own ordering call before it applies.
- [x] 1.13 Verify against the live database afterwards: both functions present, `prosecdef` true,
      `proconfig` carrying `search_path=`, and the grants as written.

## 2. Security advisors

- [x] 2.1 Re-run `get_advisors(security)` on DEV and confirm **exactly two new**
      `authenticated_security_definer_function_executable` WARNs, one per function: 37 → 39.
- [x] 2.2 Record the per-migration accounting in `docs/reference/migrations.md` §Security
      advisors. An advisor that is not in that table is an unexpected one.
- [x] 2.3 Confirm no new `rls_enabled_no_policy` INFO — this migration creates no table.

## 3. RLS assertions — `supabase/tests/rls_test.sql`

**A migration that changes a policy must add an assertion; this one adds two functions that
*stand in for* a policy, so the same rule applies with more force.** Suite is at **3440** after
`106` (3382 before `105`, 3431 after it) — re-derive with
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"` and compare **label sets**, not
counts, since a count cannot tell a rename from a loss. `106` is exactly that case: it removed
fifteen `105` labels and added twenty-four, for a net +9 that says almost nothing on its own.

- [x] 3.1 A rider sees exactly the blocks they created; the blocked party sees none of them.
- [x] 3.2 A rider with zero blocks gets zero rows and no error.
- [x] 3.3 A block against a NULL-username rider is returned, not dropped (D2).
- [x] 3.4 Deleting the blocked rider's profile removes the row via cascade.
- [x] 3.5 A rider sees exactly their own hides; another rider's hide of the same postcard is
      absent from theirs and the postcard stays in that rider's feed.
- [x] 3.6 A restorable row carries its caption and author username. **↳ REPLACED BY 106: every
      returned row IS `(postcard_id, hidden_at)` and carries nothing else, asserted as a whole-row
      shape rather than column by column, so a re-added column goes red without anyone having to
      remember to name it.**
- [x] 3.7 A hide on a postcard in a club the rider has left: `restorable` false, **every preview
      column NULL**. **↳ REPLACED BY 106: the ENTIRE result set is byte-identical before and after
      the rider leaves the club.**
- [x] 3.8 A hide on a postcard whose author has since blocked the hider: `restorable` false,
      every preview column NULL — and assert the author username is NULL specifically, since
      that is the field that would name the blocker. **↳ REPLACED BY 106: the entire result set is
      byte-identical before and after the author's block is lifted, and 106.3 asserts the same
      while a real block is PLACED through the real INSERT policy. `my_blocked_riders()` being
      empty for that rider is asserted beside it, because the two accessors ship together and the
      leak was the subtraction of one from the other.**
- [x] 3.6a–3.8a (`106.1`–`106.5`) One function of that name and no overload; the two-column
      result and the three-argument signature pinned in the catalog; the three classes of row
      indistinguishable on 106's own fixtures; both halves of the composite cursor, including the
      documented loss when `before_id` is omitted; the self-hide exclusion restated. **Mutation-
      tested three ways, each caught: re-add `restorable` → `105.6`; drop the self-hide exclusion
      → `105.5`; drop the `before_id` arm → `106.4`.**
- [x] 3.9 A self-hide row is excluded (1.7).
- [x] 3.10 Deleting the postcard removes the hide row via cascade, so it leaves the list rather
      than becoming unrestorable.
- [x] 3.11 `has_function_privilege('authenticated', …, 'execute')` true for both; the same false
      for `anon`. **Privilege assertions, not calls** — the suite runs as the table owner, which
      is what let `029` ship broken (D7).
- [x] 3.12 `unblockRider`'s and `unhidePostcard`'s policies still refuse another rider's row —
      re-assert, since these lists are the first thing that makes those DELETE paths reachable.

## 4. Client — reads and types

- [ ] 4.1 `src/lib/data/moderation.ts` (new): `getBlockedRiders()` and
      `getHiddenPostcards(before?)`, both through `resolveSupabase()` and `.rpc(...)`.
      **106: the cursor is a PAIR** — pass `before_at` *and* `before_id` from the last row of the
      previous page, or the page boundary silently drops rows sharing a `created_at`.
- [ ] 4.2 Types in `src/types/index.ts` — `BlockedRider`, `HiddenPostcard`. Not inline.
      **106: `HiddenPostcard` is `{ postcard_id: string; hidden_at: string }` and nothing else.**
      No `restorable`, no caption, no author, no image path.
- [ ] 4.3 Keys in `src/lib/query/keys.ts`: `postcards.hidden()` → `['postcards', 'hidden']` and
      `profile.blockedRiders()` → `['profile', 'blockedRiders']`. **Both get the header comment
      the file's convention requires**, naming the writer that sweeps them (D5).
- [ ] 4.4 **Do not add an `invalidate` call to any of the four actions.** Both keys are already
      covered — `postcards.all()` and `EVERYTHING`. An added call is dead code.
- [ ] 4.5 Do not sign `avatar_path` for blocked riders — it is not returned (1.3). `Avatar`
      falls back to initials from the username.

## 5. Client — the two lists inside `PrivacySheet`

- [ ] 5.1 Extend `src/components/profile/PrivacySheet.tsx`. **No new route, no new nav entry** —
      the owner's decision, recorded on PD-298 2026-09-05.
- [ ] 5.2 Follow the `/clubs/detail/edit` precedent for composition. **There is no v2 Figma frame
      for any of this and there will not be one** — do not wait for a drawing. Raise it only if
      the composition needs a primitive that does not exist.
- [ ] 5.3 Use existing primitives only — `Button`, `Card`, `Avatar`, `ErrorState`,
      `useOnlineStatus`. Primary buttons are near-black `Grey/100`, never green.
- [ ] 5.4 Gate each list on its **data**, never on `isLoading`, matching the skeleton the sheet
      already renders for the analytics toggle.
- [ ] 5.5 Empty states for both, worded so "you have not blocked anyone" cannot be confused with
      a failed read.
- [ ] 5.6 Offline: show the cached list, disable both undo affordances, reuse the sheet's
      existing offline notice.
- [ ] 5.7 **106: there is no restorable/unrestorable distinction to render.** Every row is a
      neutral placeholder with identical copy and a `Remove from this list` action rather than
      `Unhide` (Q3) — the list has no preview and no per-row state, because any per-row difference
      is a channel the author of the postcard can drive (D4).
- [ ] 5.8 A failure in one list must not blank the other or the analytics toggle (partial state).
- [ ] 5.9 Confirm before unblocking. It is the reversal of a safety action and a second misplaced
      tap here is as bad as the first one.
- [ ] 5.10 The sheet scrolls; do not let two unbounded lists push the Close button off-screen.

## 6. Gates

- [ ] 6.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`.
- [ ] 6.2 `PGPASSWORD=postgres npm test` — the RLS suite, green, with the new labels present.
- [ ] 6.3 `npm run walk` — the lists sit behind a menu the walk does not open, so add no phase.
      Confirm the walk still passes rather than extending its remit; a phase needs a defect no
      other gate can see.
- [ ] 6.4 `npm run docs:check` if any numeric claim moved — the advisor count does (37 → 39), so
      it will.
- [ ] 6.5 `npx openspec validate undo-a-block-or-a-hide --strict`.

## 7. Not in this change

- [ ] 7.1 **No widening of any Storage policy** unless Q1 says so. That is a visibility decision
      about another rider's photo and it is the owner's.
- [ ] 7.2 **No change to `hidePostcard`** to refuse a self-hide (Q5). The accessor excludes them;
      changing a shipped write path for no rider benefit is not this story.
- [ ] 7.3 **No `restorable` flag, no reason enum, and no preview column of any kind** (D4, as
      rewritten; `106`). If a future change wants a preview it takes the snapshot-at-hide-time
      route D4 records, and it revisits the requirement in the `database-enforced-integrity`
      delta first. **The spec deltas under `specs/` still describe `105`'s eight-column shape and
      have NOT been rewritten** — they are the next thing to fix and are the reason
      `openspec validate --strict` (6.5) is not yet meaningful for this change.
- [ ] 7.4 **No moderator or admin surface.** `postcard_reports` belongs to
      `act-on-postcard-reports`.
- [ ] 7.5 **No undo toast.** PD-298's proposal 2 was considered and rejected in the issue: five
      seconds is not when a rider realises they blocked the wrong person.
