## 0. Before anything — resolve the two questions that change the shape

**Status 2026-08-06: asked, unanswered, built on the documented defaults.** The product owner
was asked directly and did not answer, so group 1 was built to each recommended default rather
than blocking. Every default is recorded in the migration that implements it, so a different
answer is a new migration and not a rewrite. **Q1 is the only one already cast in applied SQL**;
Q4 and Q7 are still genuinely open and neither is blocked on the other.

- [x] 0.1 **Q1 — product owner.** A club whose owner deletes their account: transfer, or delete?
  **Built as TRANSFER** (design D2's default) in `029`. It is the difference between one rider's
  erasure request and forty other riders' postcards, and the RLS suite now asserts the
  counterfactual — without the transfer, a third party's postcard provably dies. Reversing this
  is a migration that drops one function, not a redesign.
- [ ] 0.2 **Q4 — product owner, legal.** Whether a de-identified `consent_records` row is retained
  (design D10). Default: retain. **Still open and deliberately not built** — see 1.10. It is
  listed as blocking *before launch* rather than before build, and deferring it removes work
  rather than adding it.
- [ ] 0.3 **Q7 — designer.** The `Done` frame draws no re-authentication field. The default adds
  one (design D6). **Still open**, and it costs nothing yet: group 3 is unbuilt, and the Edge
  Function's JWT check is not a substitute — re-auth proves the person at the phone knows the
  password, which is a different claim from "this session is live". Ask before building 3.4.
- [x] 0.4b **Q14 — the version string is `0-placeholder`, and the owner must replace it.**
  `/legal/terms` is placeholder copy that disclaims being an agreement, so a plausible date
  would assert the opposite of what the page says. It lives in exactly one place,
  `private.current_terms_version()`; replacing it is a one-line migration and consents already
  stamped keep the version they were given.
- [x] 0.4 Re-derive the migration number rather than trusting this file. It said **026** at write
  time and was **028** by the end of the same session — which is the point. It was **028** at write
  time, and the numbering moved underneath this proposal once already: `021` was split into an
  applied `021_onboarding_state_accessors` and a pending `025_profile_column_privileges`.
  `ls supabase/migrations/` against `list_migrations`.

## 1. Migrations — additive, no application change (the only independently landable group)

Nothing in this group removes a column, table or grant the application reads, and nothing changes
a SELECT policy. That is the group's definition, taken from `migrate-to-client-rendered-shell`
group 1, and it earned that phrasing there: one Supabase project, `main` auto-deploys, so a
removal landing without its code repair is an outage.

- [x] 1.1 Pre-flight against the live project **before writing the migration**, the way `013` and
  `022` did, and record every count in the header: clubs with more than one member; clubs whose
  owner is not the only member; clubs carrying a non-NULL `avatar_path` or `cover_image_path`;
  rides with a `club_id`; rows in each of the four tables about to gain an index. A count that is
  0 today is not a count that is 0 at apply time — re-run it then.
- [x] 1.2 Four FK indexes for the cascade: `clubs.owner_id`, `rides.organizer_id`,
  `club_members.user_id`, `ride_members.user_id`. `011` added exactly this for
  `postcard_comments.author_id` and said why in its own comment; these four are the same reason,
  never written. Do **not** add duplicates for the ~~eight~~ **nine** paths already served — see
  the spec's index requirement for the list. *(Done in `029`. The four named here were exactly
  right; the surrounding counts were not. There are **13** FKs into `profiles`, not the 11
  §Impact claims, and **9** were already served, not 8. The grep §Impact recommends counts 15
  lines, two of them the `friendships` pair `013` dropped — so subtracting the dropped rows from
  an already-wrong number produced a second wrong number. Derive from `pg_constraint`.)*
- [x] 1.3 Assertions for 1.2: a query over `pg_index` finds no FK column referencing
  `public.profiles` without a leading-column index. Write it as a derivation, not as a list of
  four names, so a table added next year fails the assertion rather than slipping past it.
- [x] ~~1.4 Relax `016`'s `clubs_avatar_path_owned` and `clubs_cover_image_path_owned`.~~
  **DROPPED — the premise is wrong, and D2 already said so.** The CHECK is
  `avatar_path is null OR avatar_path like 'club-avatars/' || owner_id || '/%'`, so it pins only
  a **non-NULL** path to the current owner. "Any ownership transfer raises `23514`" is true only
  of a transfer that *keeps* the path — and D2 chose the other option in the same breath ("null
  both paths on transfer… **no new constraint semantics**"). This task contradicts the design it
  implements. Measured on the real constraint before dropping it: transfer keeping the path is
  refused `23514`; transfer nulling it is allowed. All four CHECKs survive `029` untouched.
- [x] 1.5 Assertions for 1.4 — kept, retargeted at what actually happens: an ownership transfer
  on a club with both images set succeeds *and surrenders both*; the four path CHECKs `016`
  verified still exist by name. Both are in the `029` §B block.
- [x] 1.6 `security definer` transfer function: reassign `clubs.owner_id` to the longest-tenured
  remaining `admin` by `club_members.joined_at`, else the longest-tenured remaining `member`,
  else delete the club. Null both image paths on transfer and return their object paths so the
  caller can delete the objects. Delete the club's rides when the club is deleted, rather than
  letting `rides.club_id`'s `ON DELETE SET NULL` orphan them into the zombie state design D3
  describes. It lives in `private` so PostgREST does not publish it, matching `is_blocked` and
  `is_club_member`; `authenticated` gets no EXECUTE. *(Done in `029` — and this instruction is
  **incomplete in a way that shipped a broken function**. "In `private`, no EXECUTE for
  `authenticated`" describes who must be kept out and never says who must be let in, so `029`
  landed a function no caller could reach: `service_role` holds no USAGE on `private`, and
  PostgREST routes only to `public`. `031` adds a `service_role`-only `public` wrapper. The
  general form of the miss: **a task that names only the negative case produces a function that
  refuses everyone**, which is the exact inverse of the failure `openspec/config.yaml` was
  written to prevent, and just as silent.)*
- [x] 1.6b `031` — `public.transfer_owned_clubs_for_deletion(uuid)`, `security invoker` and
  privilege-free, EXECUTE to `service_role` alone; plus USAGE on `private` and EXECUTE on the
  worker for that role. Asserted to grant nothing to riders and none of the other six helpers.
- [x] 1.7 Assertions for 1.6, one per branch: transfer to an admin; transfer to a member when no
  admin exists; deletion when no member remains; **another rider's postcards in the club survive
  the owner's deletion**, asserted from that rider's own session; a private club's transferred
  rides keep `is_public = false` and `022`'s invariant still holds; no ride is left with `club_id`
  NULL and `is_public` false and a roster its own crew cannot read.
- [x] 1.8 `profiles.terms_version` (Q14), server-owned and immutable in the same
  `enforce_onboarding_completion` shape `012` uses for the timestamp. **No backfill** — the same
  ruling `023` records, for the same reason.
- [x] 1.9 Assertions for 1.8, and the first one is asserted **stronger than asked**: a
  client-supplied version is not "replaced by the server's" but **refused with `42501`**,
  because `030` gives `authenticated` no column grant at all and column privileges are checked
  against the columns named in SET *before* any BEFORE trigger runs (`025` §DEFECT 2c). Refusal
  beats correction, and it leaves `enforce_onboarding_completion` — which `003`, `012` and `023`
  have each layered — untouched. Idempotency is asserted by moving the stored version out from
  under a second `accept_terms()` call, since "did not re-stamp" and "re-stamped with the same
  constant" are otherwise indistinguishable while there is one version string.
- [ ] 1.10 If Q4 is "retain": the `consent_records` table — salted hash of the subject uuid, terms
  version, server timestamp, nothing else. RLS enabled, **no policy at all**, no grant to
  `authenticated`, so the refusal does not rest on a policy being written correctly.
  **DEFERRED, and deliberately, not overlooked.** Q4 is marked PO *(legal)* and "blocking before
  launch, not before build"; retaining a hash of a deleted person's identifier is a legal
  posture nobody in a session should adopt on the owner's behalf. Deferring costs nothing —
  "retain nothing" removes work rather than adding it, and the Edge Function that would write
  the row is not deployed either. `030`'s `terms_version` is the half that had to land first,
  because it cannot be reconstructed later.
- [ ] 1.11 Assertions for 1.10 — deferred with it.
- [x] 1.12 Apply, then check the Supabase security advisors. Expect the two known findings
  (`moderate_comment` by design, the leaked-password toggle) plus the new transfer function, which
  is narrower than `moderate_comment` and expected. `PGPASSWORD=postgres npm test` green before
  any of this is called done.

## 2. The Edge Function (nothing in group 3 may point at this until it is deployed and exercised)

- [x] 2.1 Create `supabase/functions/` — there is none today, so this is also the repo's first
  Edge Function and brings a deploy path CI does not have. Record how it is deployed, and that a
  function deployed by hand and never redeployed is the same class of drift as an unapplied
  migration.
- [x] 2.2 The function itself: verify the JWT in the function rather than trusting the gateway;
  resolve the subject from the token; **take no id parameter of any kind**; require the
  re-authentication proof from 3.4; run the club transfer, then the Storage sweep, then
  `deleteUser(sub)` with **hard delete**, never Supabase's soft-delete mode.
- [x] 2.3 Storage sweep across all five prefixes in the `media` bucket — `postcards/<uid>/`,
  `avatars/<uid>/`, `covers/<uid>/`, `club-avatars/<uid>/`, `club-covers/<uid>/` — through the
  Storage API. `delete from storage.objects` is refused by Supabase's own guard, which
  `scripts/storage/sweep-orphans.mjs` documents; paging matters, because `list()` truncates
  silently and a truncated sweep reports success.
- [ ] 2.4 Idempotency and failure handling per design D7: already-deleted returns success; a
  failure before the auth delete leaves everything intact; the transfer and the cascade are one
  transaction; concurrent invocations do not double-transfer a club and never select a candidate
  who is themselves mid-deletion.
- [x] 2.5 The credential: service-role key in the function's secret store only. **Not** in the
  repo, `.env.local.example`, Vercel, any test fixture or any `NEXT_PUBLIC_*` variable. Add a
  grep-based unit test that fails if a service-role key pattern appears anywhere under `src/` or
  in a committed env example — the same shape as the existing `use-server-exports` and
  `isomorphic` guards, and for the same reason: this is a rule no reviewer will catch twice.
- [ ] 2.6 Exercise it against the real project with a disposable account before any UI points at
  it: delete succeeds; a second call succeeds; a request with another rider's id in the body still
  deletes only the caller; a request bearing the publishable key is refused; a request with no
  token is refused. **A live run, not a claim** — `docs/HANDOFF.md` records three PRs that merged
  unverified.

## 3. The flow

- [ ] 3.1 Add the `Delete account` row to `ProfileMenu`'s sheet: last position, own list group,
  `Warning/100`, `TrashIcon` from `@/components/icons/generated` (`Element / Icon / Trash` — the
  generated set has it). No dead row: it ships working or it does not ship.
- [ ] 3.2 **Also add the `Preferences` row, or explicitly decide not to.** The frame has
  **three** rows and the built menu has one. `ProfileMenu.tsx`'s doc comment and
  `docs/FIGMA-FIDELITY-TODO.md` §Profile both say "exactly two rows in the design, and that is
  read from the frame rather than assumed" — verified wrong with
  `npm run figma -- tree "Profile / Delete account / Account options" --all`, where none of the
  three list items is hidden. Fix both claims in the same change; a wrong claim that names its own
  method is worse than a stale one.
- [ ] 3.3 The confirmation screen from `2303:9370`: "Delete account?" (`Poppins/24/Semibold`),
  "This action cannot be undone." (`Poppins/14/Regular`), `Button variant="danger"` labelled
  `Delete account`, `secondary` labelled `Cancel`. The title's fill in the frame is the legacy
  `Grey (OLD)/10` — resolve to the nearest v2 token per decision #4 rather than porting it.
- [ ] 3.4 Re-authentication before the destructive call (design D6, Q7). Server-verified, not a
  client-side gate.
- [ ] 3.5 The impact summary: clubs that will change hands, upcoming rides that will be cancelled,
  riders currently RSVP'd to them. Read through `src/lib/data/`, under the rider's own session,
  never through the privileged function. Render nothing rather than zeroes when there is nothing.
- [ ] 3.6 The action in `src/lib/actions/` that calls the function, with pending, error and
  offline states. **Offline refuses** and never queues — an irreversible destructive action is the
  one mutation that must never be optimistic.
- [ ] 3.7 On success: clear the session, the query cache, cached images and device secure storage,
  then land on `/auth/login`. The local clear happens even when the sign-out call fails.
- [ ] 3.8 Every state from the flow spec has a treatment: in flight, offline, failed, already
  deleted, cancelled at every point. Reuse the shared loading/error/offline treatments the render
  migration builds rather than inventing screen-local ones.

## 4. What everyone else sees — the four screens where empty and forbidden look identical

- [ ] 4.1 `/rides/[id]`, `/postcards/[id]`, the profile reached from a byline, and a club roster:
  say the content is **unavailable**. Not "deleted" — that discloses a person to someone who may
  have blocked them. Not "you do not have permission" — that is a different and wrong explanation
  of the same zero rows.
- [ ] 4.2 The postcard deck skips a card whose postcard has disappeared since the fetch, without
  leaving a blank position. The deck only moves forward, so a blank cannot be returned to.
- [ ] 4.3 Comment threads close the gap rather than rendering a placeholder byline. There is no
  tombstone author and `postcard_comments.author_id` is `not null`.
- [ ] 4.4 Counts agree with rows after a deletion, everywhere. Nothing is denormalised — `009` and
  `011` both declined a counter deliberately — so this should be free, and the assertion is what
  proves it.

## 5. The web-accessible route (Play), and it depends on nothing

- [x] 5.1 `src/app/legal/account-deletion/page.tsx` — public, under the existing `/legal/*` prefix
  the route guard already allows. Explains what deletion removes, what happens to clubs and rides,
  and links into the in-app flow. **Reads no table, holds no personal data, adds no `anon`
  grant.**
- [x] 5.2 It must never accept a deletion request from an unauthenticated form. A page that
  deletes an account on an emailed identifier is an account-deletion service for strangers.
- [x] 5.3 Link it from `/legal/terms` and `/legal/privacy` so a store reviewer finds it without
  being given the URL.

## 6. Verification and handoff

- [ ] 6.1 A cascade test in the RLS suite: delete a fixture's `auth.users` row inside a savepoint
  and assert, table by table, what survived and what did not — including, from the *other*
  rider's session, that their postcards in the departed owner's club are still there. This is the
  part most likely to be silently wrong and it is fully testable on plain Postgres.
- [x] 6.2 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`,
  `PGPASSWORD=postgres npm test` all green.
- [ ] 6.3 Walk it against the real database with a real disposable account, on a device, offline
  and online. `npm test` proves the cascade; only a live run proves the JWT verification, the
  Storage delete and the sign-out.
- [x] 6.4 Run `reviewer` before the PR, including its RLS and data-exposure audit. Never on its
  own work. The service-role credential and the transfer function are what it is for.
- [x] 6.5 Correct the documentation this change found wrong, in the same PR: the two-row claim in
  `ProfileMenu.tsx` and `docs/FIGMA-FIDELITY-TODO.md` §Profile (3.2); `docs/HANDOFF.md`'s "account
  deletion is not built" line; and a note in `scripts/storage/sweep-orphans.mjs` that it sweeps
  `postcards/` for one rider and is not a remedy for a departed rider's objects.
- [x] 6.6 Update `CLAUDE.md`: the Trust & Safety row in §Product Scope, the `clubs` and `rides`
  rows in §Schema where the cascade behaviour is now different, and — the first entry of its kind
  — the existence of an Edge Function and where its secret lives.
- [ ] 6.7 ~~Tick `migrate-to-client-rendered-shell` task 7.5 and its Q9~~ — **done, and the
  target has moved.** 7.5 was ticked when that change was archived on 2026-08-06 (this proposal
  *is* what it asked for), and the change now lives under
  `openspec/changes/archive/2026-08-06-migrate-to-client-rendered-shell/`. **Do not edit an
  archived change** — it is the record of what shipped. What survives of this task: record in
  **this** change's design that `023`'s 1.14 INSERT arm is defence in depth rather than the
  primary control, per D8.
