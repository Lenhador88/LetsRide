# Tasks

**Two gates before group 1.** The migration number is not `114` (0.2), and the town has no column
behind it (0.6). Neither is discoverable later without rework.

**Territory.** PD-430 holds slot 1 with PD-429 and both touch `src/lib/data/`, `src/components/rides/`
and `supabase/migrations/`. Confirm the slot is still yours before starting group 1.

## 0. Before a line is written

- [ ] 0.1 Read `CLAUDE.md`, `openspec/config.yaml`, and the base capability at
      `openspec/changes/share-a-ride-invite-link/specs/ride-invite-links/spec.md`. **Archive
      `share-a-ride-invite-link` before this change**, or the `ride-invite-links` delta has nothing
      to attach to.
- [ ] 0.2 **Settle the migration number, and it is not `114`.** `docs/reference/migrations.md`
      §Applied state holds `114` for `113_home_country`'s unwritten partner. Re-derive from
      `ls supabase/migrations/*.sql | tail -3` against `list_migrations` on DEV
      (`fpmrimzxadewsaiwpsel`) **and** PROD (`zwprydcyryvudhurbnye`). Expected: **`115`**. If a
      concurrent slot has taken it, take the next and say so in the file header.
- [ ] 0.3 Record the **before** numbers — every claim in group 6 is a delta against them:
      `get_advisors(security)` on DEV, and
      `select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal;`
- [ ] 0.4 Record the **before** pins the migration must not disturb:
      `select md5(prosrc) from pg_proc where proname='can_read_ride' and pronamespace='private'::regnamespace;`
      and `select qual from pg_policies where schemaname='public' and tablename='rides' and cmd='SELECT';`
- [ ] 0.5 Re-read `private.live_ride_invite_link`, `private.ride_invite_link_reachable_by` and
      `public.ride_invite_link_preview` **off the live database**, not from `091`'s file. Confirm
      none has been replaced since. This migration replaces none of them, but a builder who assumes
      the file is current will mis-describe what they call.
- [ ] 0.6 **Get the answer to Open question #1 (the town) before writing the function signature.**
      Default if no answer arrives: **four columns, no town**. Everything else in this change is
      identical either way; only the column list and one rendered line move.
- [ ] 0.7 Confirm `public.ride_invite_link_public_preview` does not exist on either project.

## 1. The migration — one function, one grant

- [ ] 1.1 Create `public.ride_invite_link_public_preview(t text)` returning
      `table (ride_id uuid, title text, departure_at timestamptz, timezone text,
      organizer_username text)` — **plus a town column only if 0.6 said yes**.
- [ ] 1.2 `language sql`, `security definer`, `set search_path = ''`, and **`volatile`** — declared
      explicitly, never left to the default, with the reason in a comment beside it: a `stable`
      function is served over GET by PostgREST, which would put a live capability token in the
      request log's query string. **This is the one label a later session will try to "fix".**
- [ ] 1.3 Body: `from private.live_ride_invite_link(t) k join public.rides r on r.id = k.ride_id
      join public.profiles p on p.id = r.organizer_id`, selecting the closed list. **Never
      `rides.*`.** No `is_public` test, no `club_id` reference, no `auth.uid()`, no `is_blocked`
      call, no `profiles` stamp test, and no `revoked_at`/`expires_at`/`departure_at` test — liveness
      has one definition and it is the function being called.
- [ ] 1.4 `revoke all on function public.ride_invite_link_public_preview(text) from public,
      authenticated;` then `grant execute … to anon;` — **in that order**, and `authenticated` named
      explicitly rather than relied on as absent.
- [ ] 1.5 `comment on function` covering: the closed column list; that `meeting_point`, coordinates,
      map paths, crew count, avatar and club are absent **and why each**; that it is the app's only
      `anon` grant and a second one is a new decision; that liveness lives in
      `private.live_ride_invite_link` and must be changed there; that blocking is unavailable rather
      than skipped, with the projection as the safety argument; and the `volatile` reason.
- [ ] 1.6 File header: additive in every statement, **migration-first with the reasoning** (D9's
      table, both sides), rollback in one step (`drop function`), and the note that the hand-exercise
      gate does **not** fire because no trigger and no live write path is touched.
- [ ] 1.7 Apply to DEV with `apply_migration`. Record the ordering in
      `docs/reference/migrations.md` §Applied state — **the main thread writes that file.**

## 2. RLS assertions — and every one of them runs as `anon`

**The suite runs as the table owner, for whom no grant or policy exists.** An assertion here that
forgets `set role anon` proves nothing. The suite already does this at eight sites; follow the
`set role anon; … ; reset role;` shape in `rls_test.sql`.

- [ ] 2.1 **Grant, per grantee.** `has_function_privilege('anon', …, 'EXECUTE')` is `true`;
      `authenticated` and `public` are `false`. Three separate assertions.
- [ ] 2.2 **The other three RPCs are unchanged**: `anon` holds no EXECUTE on
      `ride_invite_link_preview`, `claim_ride_invite_link` or `revoke_ride_invite_link`.
- [ ] 2.3 **No table became readable**: `has_table_privilege('anon', t, 'SELECT')` is `false` for
      `rides`, `ride_invite_links`, `ride_members`, `ride_invites`, `profiles`, `clubs`.
- [ ] 2.4 **The pins from 0.4 still hold** — `can_read_ride`'s `prosrc` md5 and the `rides` SELECT
      qual, byte-identical. A failure here means the migration is wrong, not that the pin is stale.
- [ ] 2.5 **No policy names `anon`**: count rows in `pg_policies` for schema `public` whose `roles`
      includes `anon` — zero, before and after.
- [ ] 2.6 **The happy path, as `anon`**: a live token returns exactly one row with exactly the closed
      column list.
- [ ] 2.7 **The meeting point is absent** — assert against the ride's **actual stored**
      `meeting_point` value, not a literal, so a projection that gains the column later fails red.
      Same for `latitude`, `longitude`, `map_card_path`, `map_detail_path`.
- [ ] 2.8 **No crew count and no roster**: create a ride with three crew and assert no count and no
      second username appears.
- [ ] 2.9 **The six dead states, as `anon`, all six**: revoked, expired, ride deleted, ride departed,
      malformed string, and a random 32-hex token that never existed. Each returns **zero rows** and
      raises **nothing**. A subset passes green with an oracle present in the state it omits.
- [ ] 2.10 **Both previews agree** about each of the six — the anonymous one as `anon`, the
      authenticated one as `authenticated`.
- [ ] 2.11 **Club-private is served and unobservable**: a private club's ride and a clubless public
      ride return the identical column shape as `anon`, and neither response carries a club id, club
      name or `is_public`.
- [ ] 2.12 **A past ride needs no special case**: a link whose ride departed returns zero rows through
      the ordinary dead path.
- [ ] 2.13 **Catalogue reads, never inferred from a call that worked**: `prosecdef` is `true`,
      `proconfig` is `{"search_path="}`, `provolatile` is `v`, and the return signature matches the
      closed list exactly.
- [ ] 2.14 **`prosrc` carries no caller predicate**: `is_blocked`, `auth.uid`, `terms_accepted_at`,
      `onboarding_completed_at` all absent. **And no liveness restatement**: `revoked_at`,
      `expires_at`, `departure_at` all absent.
- [ ] 2.15 **The anonymous path writes nothing**: preview a live and a dead token as `anon` inside a
      transaction and assert no row was added to any table in `public`.
- [ ] 2.16 **Blocked rider, both states**: signed out, the four fields are returned (the accepted
      residual, asserted so it is a recorded decision rather than an accident); signed in, the
      authenticated preview returns zero rows and the claim reaches its single raise site.
- [ ] 2.17 **`anon` reaching further is refused**: selecting the ride from `public.rides` by the id
      the preview returned gives zero rows.
- [ ] 2.18 Run `PGPASSWORD=postgres npm test`. Reconcile against the previous run by **label set**,
      never by count.

## 3. Security advisors

- [ ] 3.1 `get_advisors(security)` on DEV, delta against 0.3. **Expected +1 WARN**, but the label is
      unmeasured: no `anon`-executable `security definer` function exists on either project today, so
      whether Supabase reports it as `authenticated_security_definer_function_executable`, as a
      variant, or not at all is a fact to read.
- [ ] 3.2 **If no advisor fires, write that down as a finding**, not as a saving — it means the
      advisor set cannot see the app's only anonymous surface.
- [ ] 3.3 **+0 INFO expected**: no table is created, so no `rls_enabled_no_policy`.
- [ ] 3.4 Participation gate count unchanged from 0.3. No table, no `authenticated` writer, no gate
      trigger.
- [ ] 3.5 The `service_role` census (`CLAUDE.md` §Supabase Rules) is unchanged — 30 kept, 3 revoked.
      Re-run rather than assume.

## 4. The read

- [ ] 4.1 New exported function in `src/lib/data/ride-invite-links.ts`, beside
      `getRideInviteLinkPreview`. Resolves through `resolveSupabase`. Validates the token with
      `rideInviteTokenSchema` before the round trip, as the existing one does.
- [ ] 4.2 **It SHALL NOT call `supabase.auth.getUser()` and SHALL NOT require a session** — that is
      the whole point. `getRideInviteLinkPreview`'s `if (!user) return null` stays where it is.
- [ ] 4.3 **No second read.** No `is_crew` probe (there is no caller), no avatar signing (`anon` has
      no reach into `storage.objects`), no crew count.
- [ ] 4.4 Zero rows → `null`, meaning *decided: this link is no longer valid*. A thrown error stays a
      thrown error, so the screen can tell a dead link from a tunnel.
- [ ] 4.5 A doc block stating what the function does **not** return and why — the next reader's first
      instinct will be to add the meeting point back.

## 5. Types, keys and the screen

- [ ] 5.1 New type in `src/types/index.ts`. **Not `Partial<RideInviteLinkPreview>` and not a widened
      `RideInviteLinkPreview`** — the two must be structurally impossible to confuse, so a component
      reaching for `meeting_point` on the thin object is a compile error.
- [ ] 5.2 New key in `src/lib/query/keys.ts`, **distinct** from the authenticated preview's. No inline
      key.
- [ ] 5.3 `RideInviteJoin` renders the signed-out state: title, start time, organiser, and
      `Sign up to RSVP`. **Read in an effect through `useQuery`, never during render.**
- [ ] 5.4 The time renders through a named `formatRide*` helper with `rides.timezone` passed as the
      **required** zone argument. `null` means "we do not know" and falls back through `rideZone()`.
      The viewer's own zone is never the answer.
- [ ] 5.5 Gate on the **data**, never on `isLoading`. `undefined` is the skeleton; `null` is the dead
      message.
- [ ] 5.6 All eight states from the spec's table render, including offline (cached preview, control
      disabled, nothing queued) and error (retry, distinct from dead).
- [ ] 5.7 The CTA routes to signup with the token still stashed — the existing `pending-token` round
      trip, **unchanged**.
- [ ] 5.8 **Correct the `RIDE_JOIN_PATH` comment in `src/lib/auth/guard.ts`.** *"public so it can HOLD
      a credential, never so it can SHOW anything"* is false the day this ships. **No behaviour in
      `guard.ts` changes** — both sets keep `/rides/join`.
- [ ] 5.9 Buttons are near-black `Grey/100` `#1A1A1A`, never green. Icons from
      `@/components/icons/generated`.

## 6. Tests and the walk

- [ ] 6.1 Unit test the new read: zero rows → `null`; a thrown error propagates; a malformed token is
      refused before the round trip.
- [ ] 6.2 A component test pinning that the signed-out card renders the title and **does not** render
      a meeting point when one is supplied in the surrounding fixture. Verify it both ways — that it
      is green now and red against a component that renders the field.
- [ ] 6.3 `guard.test.ts` — the four existing `/rides/join` cases still pass unchanged. Behaviour did
      not move; assert that it did not.
- [ ] 6.4 **One new walk phase**: open `/rides/join?token=…` **signed out** with `WALK_FIXTURES=1`,
      assert the title renders and the ride's stored `meeting_point` string is absent from the
      document. This is the only gate in the repo that renders anything, and the only place the
      absence is checked against a real DOM.
- [ ] 6.5 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 6.6 `npm run docs:check` — the full sweep locally, not CI's `--cheap` step.

## 7. Documentation — the main thread writes all of these

- [ ] 7.1 **`CLAUDE.md` decision #1**, replaced with the exact wording in `proposal.md` §*This breaks
      architectural decision #1*. **This is the most important line in the change**: an exception that
      is not written down is just a broken rule, and the next session will read the absolute.
- [ ] 7.2 `CLAUDE.md` advisor accounting — the delta measured in 3.1.
- [ ] 7.3 `docs/reference/schema.md` — a `ride_invite_link_public_preview` entry beside the other
      three RPCs, naming the `anon` grant.
- [ ] 7.4 `docs/reference/migrations.md` §Applied state — the new file's ordering and its
      migration-first reasoning.
- [ ] 7.5 Note in the PR body that Open question #1 (the town) was answered which way, and by whom.

## 8. Wrap-up

- [ ] 8.1 `reviewer` on the final diff. Its findings go on the PR **verbatim**, under `## Review`.
- [ ] 8.2 `/opsx:archive` this change before the PR, or say in the PR body why it stays open.
- [ ] 8.3 PR against `development`, never `main`.
