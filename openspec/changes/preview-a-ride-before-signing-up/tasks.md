# Tasks

**One gate before group 1.** The migration number (0.2) is re-derived rather than trusted — the
queue runs two slots, filename order equals apply order, and a collision is not discoverable later
without rework. Everything else in this change is settled: the projection, the grant, and every
negative case.

**Territory.** PD-429 merged as [#435](https://github.com/Lenhador88/LetsRide/pull/435) and released
its slot, so this change travels alone unless a firing groups it. Write your own `<!-- territory -->`
comment at `queue-pickup.md` STEP 3 rather than trusting this line; the paths are `src/lib/data/`,
`src/components/rides/`, `src/app/rides/join/` and `supabase/migrations/`.

## 0. Before a line is written

- [ ] 0.1 Read `CLAUDE.md`, `openspec/config.yaml`, and the base capability at
      `openspec/specs/ride-invite-links/spec.md`. PD-359 archived `share-a-ride-invite-link` on
      2026-09-08 (#439), so that base is standing and the ordering this change once waited on is
      already satisfied.
- [ ] 0.2 **Settle the migration number.** Re-derive from `ls supabase/migrations/*.sql | tail -3`
      against `list_migrations` on DEV (`fpmrimzxadewsaiwpsel`) **and** PROD
      (`zwprydcyryvudhurbnye`). Expected: **`115`** — 114 files, last is
      `114_a_completion_carries_a_country.sql`. If a concurrent slot has taken it, take the next and
      say so in the file header.
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
- [ ] 0.6 **Read `public.ride_invite_link_preview`'s return signature off the live database and pin
      it beside the new one.** The anonymous projection must be a **strict subset** of it; that is
      the change's whole safety argument, and it is checkable only against the eight columns as they
      actually are today, not as `091`'s file describes them.
- [ ] 0.7 Confirm `public.ride_invite_link_public_preview` does not exist on either project.

## 1. The migration — one function, one grant

- [ ] 1.1 Create `public.ride_invite_link_public_preview(t text)` returning
      `table (ride_id uuid, title text, departure_at timestamptz, timezone text,
      meeting_point text, organizer_username text)` — **exactly this list**, and every column of it
      present in the signature 0.6 pinned. **No `crew_count` and no `organizer_avatar_path`**, which
      is what makes the projection a strict subset rather than a re-grant of `091`'s.
- [ ] 1.2 `language sql`, `security definer`, `set search_path = ''`, and **`volatile`** — declared
      explicitly, never left to the default, with the reason in a comment beside it: a `stable`
      function is served over GET by PostgREST, which would put a live capability token in the
      request log's query string. **This is the one label a later session will try to "fix".**
- [ ] 1.3 Body: `from private.live_ride_invite_link(t) k join public.rides r on r.id = k.ride_id
      join public.profiles p on p.id = r.organizer_id`, selecting the closed list by name. **Never
      `rides.*`.** No `is_public` test, no `club_id` reference, no `auth.uid()`, no `is_blocked`
      call, no `profiles` stamp test, and no `revoked_at`/`expires_at`/`departure_at` test — liveness
      has one definition and it is the function being called. **`p.username` is the only column
      taken from `profiles`.**
- [ ] 1.4 `revoke all on function public.ride_invite_link_public_preview(text) from public,
      authenticated;` then `grant execute … to anon;` — **in that order**, and `authenticated` named
      explicitly rather than relied on as absent.
- [ ] 1.5 `comment on function` covering: the closed column list; **that it is a strict subset of
      `public.ride_invite_link_preview`'s eight columns, which is the whole safety argument, so a
      column added here that is not in those eight is a new decision**; that coordinates, map paths,
      crew count, avatar, club and description are absent **and why each**; that it is the app's only
      `anon` grant and a second one is a new decision; that liveness lives in
      `private.live_ride_invite_link` and must be changed there; that blocking is unavailable rather
      than skipped — **the anonymous reach is one conjunct, "the link is live"** — with the projection
      as the safety argument; that `is_public` is never read, so the grant follows the token alone;
      and the `volatile` reason.
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
- [ ] 2.7 **The meeting point is returned, and it is the ride's own** — assert the returned value
      equals the `meeting_point` read back from the `rides` row, **not a literal**, so a projection
      that silently drops the column, returns NULL, returns another ride's string or mangles it
      fails red. Verify it both ways: green now, and red against a function whose select list omits
      the column. **`latitude`, `longitude`, `geocode_confidence`, `map_card_path` and
      `map_detail_path` stay absent**, asserted the same way — against the row's actual values.
- [ ] 2.8 **No crew count, no avatar and no roster**: create a ride with three crew and assert no
      count, no avatar path and no second username appears. **This is the subset assertion in its
      most breakable form** — both columns exist in `091`'s projection, so the temptation is to
      forward them.
- [ ] 2.8b **The projection is a strict subset of `091`'s**, asserted from the catalogue rather than
      from a row: every column name in `ride_invite_link_public_preview`'s return signature appears
      in `ride_invite_link_preview`'s. Verify both ways — green now, and red when a name not in the
      eight is added.
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
- [ ] 2.16 **Blocked rider, both states**: signed out, **all five fields are returned including the
      meeting point** (the accepted residual, asserted so it is a recorded decision rather than an
      accident — a later session reading a green suite must find this stated); signed in, the
      authenticated preview returns zero rows and the claim reaches its single raise site.
- [ ] 2.17 **`anon` reaching further is refused**: selecting the ride from `public.rides` by the id
      the preview returned gives zero rows.
- [ ] 2.17b **The grant follows the token and never `is_public`**: with a **public** ride
      (`is_public = true`) and **no live link**, `anon` reaches nothing — selecting the ride returns
      zero rows, and no function takes a ride id. Then assert `prosrc` contains no `is_public`
      reference. A public ride without a token is invisible to a signed-out visitor, exactly as
      before this change.
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
- [ ] 4.5 A doc block stating what the function does **not** return and why, naming the subset
      relation — the next reader's first instinct will be to forward `crew_count` because `091`
      returns it.

## 5. Types, keys and the screen

- [ ] 5.1 New type in `src/types/index.ts`. **Not `Partial<RideInviteLinkPreview>` and not a widened
      `RideInviteLinkPreview`** — the two must be structurally impossible to confuse, so a component
      reaching for `crew_count` or `organizer_avatar_path` on the thin object is a compile error.
- [ ] 5.2 New key in `src/lib/query/keys.ts`, **distinct** from the authenticated preview's. No inline
      key.
- [ ] 5.3 `RideInviteJoin` renders the signed-out state: title, start time, meeting point, organiser,
      and `Sign up to RSVP`. **Read in an effect through `useQuery`, never during render.** No crew,
      no count, no avatar, no map — the map is a Storage tile and `anon` cannot sign its URL.
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
- [ ] 5.10 **`noindex, nofollow` on `/rides/join`.** The authenticated wall used to block crawlers by
      accident and no longer covers this screen. Whatever mechanism the route tree supports under a
      client-rendered bundle — a `robots` meta tag rendered on the route, `app/rides/join`'s metadata
      export, or both — it SHALL be present and SHALL be asserted, not assumed. **`design-system` and
      `native` are not owners here; this is the feature's own line.**
- [ ] 5.11 **Do not build from the archived Figma frame.** `npm run figma -- ls "Join ride"` returns
      `Join ride without account` under `Archive`, and `text … --all` shows it drawing coordinates
      (`52.3702157, 4.895167899999933`), the description, a photos rail and a `4/7` roster with four
      rider names. **Every one of those is outside this projection.** The frame is evidence that the
      screen was once designed, not a specification of what ships.

## 6. Tests and the walk

- [ ] 6.1 Unit test the new read: zero rows → `null`; a thrown error propagates; a malformed token is
      refused before the round trip.
- [ ] 6.2 A component test pinning that the signed-out card renders the title **and the meeting
      point**, and **does not** render a crew count or an avatar when both are supplied in the
      surrounding fixture. Verify it both ways — green now, and red against a component that renders
      the count.
- [ ] 6.3 `guard.test.ts` — the four existing `/rides/join` cases still pass unchanged. Behaviour did
      not move; assert that it did not.
- [ ] 6.4 **One new walk phase**: open `/rides/join?token=…` **signed out** with `WALK_FIXTURES=1`,
      assert the title **and the ride's stored `meeting_point` string** are both present in the
      document, and that the crew count is not. Compare against the fixture ride's actual stored
      values, never against literals. This is the only gate in the repo that renders anything, and
      the only place the projection is checked against a real DOM.
- [ ] 6.4b **The walk asserts the robots directive** on the same signed-out load: the document
      carries `noindex, nofollow`. It is one line and it is the only automated place 5.10 can be
      caught going missing.
- [ ] 6.5 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 6.6 `npm run docs:check` — the full sweep locally, not CI's `--cheap` step.

## 7. Documentation — the main thread writes all of these

- [ ] 7.1 **`CLAUDE.md` decision #1**, replaced with the exact wording in `proposal.md` §*This breaks
      architectural decision #1*. **This is the most important line in the change**: an exception that
      is not written down is just a broken rule, and the next session will read the absolute.
- [ ] 7.1b **`CLAUDE.md` decision #2**, replaced with the wording in the same proposal section.
      Three artifacts here narrow it and none of them is `CLAUDE.md`; a narrowing recorded only in a
      change directory is the same defect 7.1 exists to prevent, one decision along.
- [ ] 7.1c **`openspec/config.yaml` `rules.proposal`** — the third rule reads *"A signed-out visitor
      is never **granted** anything — decision #1 is no anonymous access anywhere and `anon` holds
      zero grants, so a spec that writes a visibility rule admitting one has invented a role the
      system does not have."* This change makes that false, and it is the rule every future
      proposal is validated against, so a proposal correctly granting `anon` would be marked wrong.
      Narrow it to name this one exception; keep the sentence that asserting the negative is welcome.
- [ ] 7.2 `CLAUDE.md` advisor accounting — the delta measured in 3.1.
- [ ] 7.3 `docs/reference/schema.md` — a `ride_invite_link_public_preview` entry beside the other
      three RPCs, naming the `anon` grant **and its column list as a subset of
      `ride_invite_link_preview`'s**, so the two entries read against each other.
- [ ] 7.4 `docs/reference/migrations.md` §Applied state — the new file's ordering and its
      migration-first reasoning.
- [ ] 7.5 **The PR body carries the reversal and the accepted cost**, because neither belongs in the
      artifacts: that the signed-out preview shows the ride's actual `meeting_point`, whose decision
      that was and when, and that an anonymous read leaves no attributed record (`design.md` D11).
      The Linear issue carries the same. **The main thread writes both.**

## 8. Wrap-up

- [ ] 8.1 `reviewer` on the final diff. Its findings go on the PR **verbatim**, under `## Review`.
- [ ] 8.2 `/opsx:archive` this change before the PR, or say in the PR body why it stays open.
- [ ] 8.3 PR against `development`, never `main`.
