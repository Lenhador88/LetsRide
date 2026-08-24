<!--
COORDINATION — DELIBERATELY NONE NEEDED, AND THAT IS A CHOICE.

`The route guard SHALL be a UX affordance and SHALL NOT be relied on for access control` is
already modified by TWO active changes — `add-account-deletion` and `add-static-export-bundle`.
This change would have been the third claimant on one requirement, and archiving replaces a
MODIFIED requirement wholesale, so a three-way race would decide the body by archive order.

It is avoided rather than managed: none of the standing requirement's three scenarios names the
location step or the resume target, so nothing in it goes stale when the step is deleted. What
this change needs is a rule that does not exist yet — what happens to a path under `/onboarding`
that no longer resolves — so both requirements below are ADDED and have no other claimant.

Re-derive before archiving:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive
-->

## ADDED Requirements

### Requirement: The wizard SHALL have exactly one resume target, and every path under `/onboarding` SHALL resolve to it

For a rider with a session, a consent stamp and no completion stamp, `resolveDestination` SHALL
resolve a single resume path, SHALL return `null` only for that path, and SHALL redirect **every
other** path under `/onboarding` to it — including paths the app no longer serves.

This is the case that strands a rider, and it is invisible to every gate in the repo. The guard's
onboarding branch today returns `null` — *stay here* — for `/onboarding/location` whenever
`has_username` is true. Delete that route and leave the branch as it is, and a rider who reaches
that URL after the deploy (a bookmark, a tab left open across the deploy, a native shell restoring
its last path, a browser back button) gets a 404 body **with the guard actively deciding they
belong there**. `tsc`, ESLint, Vitest, `next build` and the RLS suite all stay green through it,
which is the class of defect `CLAUDE.md` records the walk existing for.

Stating it as *"every other path redirects"* rather than *"`/onboarding/location` redirects"* is
the whole point: `isOnboarding` is `pathname.startsWith('/onboarding')`, so the rule covers the
next step this wizard gains or loses without anyone remembering to come back here.

The one-way stamp is what makes a single resume target safe. Completion is stored rather than
derived (`003` §3), so a rider who later clears their location in the profile editor is not thrown
back into a wizard — which was the original reason for storing it, and is why removing a step from
the wizard cannot re-gate anybody.

#### Scenario: A stale path under `/onboarding` redirects instead of rendering nothing
- **WHEN** a rider with a username and no completion stamp loads `/onboarding/location` after the
  route is deleted
- **THEN** the guard SHALL redirect them to the resume step
- **AND** this SHALL hold for any unknown path under `/onboarding`, not only the deleted one

#### Scenario: The resume target is the same for every incomplete rider
- **WHEN** the guard resolves a resume step for a rider with a consent stamp and no completion
  stamp
- **THEN** it SHALL be `/onboarding/username` whether or not they already have a username
- **AND** `/onboarding/terms` SHALL still redirect onward for a rider whose consent is already
  recorded, unchanged

#### Scenario: Consent is still gated ahead of the wizard
- **WHEN** a rider has no `terms_accepted_at`
- **THEN** they SHALL be sent to `/onboarding/terms` before any wizard step, unchanged, because
  `023` refuses to stamp completion while the consent stamp is NULL

#### Scenario: A completed rider is never sent back into the wizard
- **WHEN** a rider whose `onboarding_completed_at` is set loads any `/onboarding` path
- **THEN** they SHALL be redirected to `/postcards`, unchanged
- **AND** clearing `profiles.location` from the profile editor SHALL NOT change that answer

#### Scenario: The unavailable and gone states are untouched
- **WHEN** `my_onboarding_state()` errors, or answers zero rows for a rider with no `profiles` row
- **THEN** the guard SHALL behave exactly as before — `/auth/login?error=profile_unavailable`,
  falling through on the two auth entry paths so it cannot redirect to itself for ever
- **AND** zero rows SHALL still NOT be read as "not onboarded"

### Requirement: A wizard step that commits a stamp SHALL be retry-safe from its own screen

Where a screen performs more than one write and the last one commits an onboarding stamp, a failure
of any write SHALL leave the rider on a screen from which resubmitting the same input completes the
job, with no state they must undo and no screen they must reach some other way.

The username step becomes the step that commits `onboarding_completed_at`, and it does so with two
round trips: a `profiles` UPDATE, then `complete_onboarding`. There is a window between them. The
window is acceptable **only because the recovery is the screen the rider is already on** — the
guard's resume target for a rider with a username and no stamp is `/onboarding/username`, and
resubmitting the same name updates their own row (no unique violation against itself; `038` permits
a rename and refuses only a removal) before re-running the RPC.

The alternative — one RPC that takes the username too — is rejected in `design.md` §D2: it moves
charset, reserved-name and `23505`-to-field-message handling into SQL, making a second copy of
rules that already live in `checkUsername` and `003` §4.

#### Scenario: The completion call fails after the username lands
- **WHEN** the `profiles` UPDATE succeeds and `complete_onboarding` then fails
- **THEN** the rider SHALL see an error on the username screen and SHALL remain un-onboarded
- **AND** resubmitting the same username SHALL succeed and complete onboarding
- **AND** the guard SHALL send them back to that same screen on any navigation in between

#### Scenario: Offline at the completing step
- **WHEN** the rider submits with no connectivity
- **THEN** the screen SHALL show a retryable error and SHALL NOT report success
- **AND** nothing SHALL be queued for later, because the participation gate makes a rider with no
  stamp unable to write anything the queue could hold

#### Scenario: The first-paint state of the wizard is unchanged
- **WHEN** the username screen loads
- **THEN** it SHALL render its form immediately with no data read of its own, unchanged — the
  screen has no query, so it has no empty, loading, partial or stale state
- **AND** the live availability check SHALL remain advisory, with its own unanswered state
  (`usernameCheckUnanswered`), unchanged

#### Scenario: Permission-denied is not reachable here and is not invented
- **WHEN** any read on this screen returns zero rows
- **THEN** it SHALL be treated as it is today; this change adds no read whose empty result could
  mean "not allowed", so no new empty-versus-denied distinction is introduced
