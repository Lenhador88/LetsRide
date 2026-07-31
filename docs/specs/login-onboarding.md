# Login & Onboarding

Figma: `1883:10157` (epic section "Login")   Status in Figma: **Done** (all five flows)
File key: `gDoteM1ow1AZpSEGSNhpc7`

> **Capture note.** The Figma MCP quota (Starter plan) was exhausted partway through this
> pass. Full structural metadata was retrieved for all five flows, and the Splash epic-cover
> note was read. What could **not** be visually confirmed is the *label text on button and
> input component instances* (they are instance overrides, invisible to `get_metadata`).
> Every such label below is marked **[inferred]** and must be verified against Figma before
> the copy ships. All layout, screen inventory, field counts, and text-layer copy are exact.

> **Settled by the product owner during this spec — do not reopen:**
> 1. Onboarding is **required and not skippable**. No skip affordance on any step. A user
>    who has not completed onboarding cannot reach any app route.
> 2. **Email confirmation is off** for now. Signup yields an active session immediately.
>    Deliberate temporary decision — see §Risks.
> 3. **Username is kept, `full_name` is dropped.** Onboarding step 1 collects a *username*.
> 4. **Q7 approved as specced** — `src/app/page.tsx` (the v1 marketing landing page) is
>    replaced by the splash resolver. No public marketing page; if one is wanted later it is
>    a separate epic.

---

## Screens

### Splash — `1856:12299`
| Node | Screen |
|---|---|
| `1857:15449` | Splash — single frame, contains only `Logo2` (`1867:19444`, 493×328, positioned at x=-51 so it bleeds off both edges, vertically centred). |

Epic note (verbatim from Figma): *"The splash screen is visible when the app is opened and still loading."*

Notably this frame does **not** instance `v2 / Component / App Background`, unlike every
other screen in the epic — the splash has its own background treatment (brand green
`#3D996B` is the likely intent, unconfirmed).

### Login — `1857:15440`
| Node | Screen |
|---|---|
| `1857:17279` | Login |
| `1857:17291` | Login — Email focus (adds iOS keyboard at y=495) |
| `1867:19255` | Login — Password focus (adds iOS keyboard at y=495) |

Structure: title text **"Login"** (310×48 → `Poppins/32/Semibold`), two `Input / Text`
instances (email, password), then a `Buttons` frame with a **Primary 310×56** ("Log in"
[inferred]) and a **Secondary 310×40** ("Forgot password?" [inferred]). A further
**Secondary 310×40** is pinned to the bottom at y=764 ("Sign up" [inferred]).

There is **no back link** on Login — it is the root of the auth stack.

### Sign up — `1857:15411`
| Node | Screen |
|---|---|
| `1857:17165` | Sign up |
| `1857:17255` | Sign up — Email focus |
| `1857:18593` | Sign up — Password focus |
| `2298:5039` | Sign up — Checkbox checked |

Structure: back link (`Button / Link / Secondary`, 136×32 — wide, so a worded label like
"Back to login" [inferred]), title **"Sign up"**, exactly **two** `Input / Text` instances
(email, password), a Terms & Conditions row (20×20 checkbox + text
*"I agree to the Lets Ride terms and conditions and privacy statement."*), then a
Primary 310×56.

**Two fields only.** No name, no username, no confirm-password. Everything else is
collected in onboarding. The existence of a dedicated *Checkbox checked* frame strongly
implies the primary button is **disabled until the box is ticked**.

**There is no "check your inbox" screen anywhere in this section** — consistent with the
settled decision that email confirmation is off.

### Forgot password — `1857:15359`
| Node | Screen |
|---|---|
| `1867:17166` | Forgot password |
| `1867:19386` | Forgot password — Email focus |
| `1867:19408` | Create new password |
| `1867:19419` | Create new password — Password focus |

*Forgot password*: back link (136×32), title **"Reset password"**, body copy
*"Enter the email associated with your account and we'll send an email with instructions to
reset you password."* (sic — typo "reset you password" is in the design), one `Input / Text`,
one Primary.

*Create new password*: title **"Create new password"** (310×96, wraps to two lines),
**one** `Input / Text`, one Primary. **No back link** (it is entered from an email deep
link, not from within the app) and **no confirm-password field**.

Two screens are missing from the flow: a confirmation after the reset email is
requested, and a success state after the new password is set. See Q13, Q14.

### Onboarding — `2067:11086`
| Node | Screen |
|---|---|
| `2067:11088` | Add your name |
| `2077:5345` | Add your name — Name focus |
| `2074:5185` | Add your location |
| `2077:5320` | Add your location — City focus |
| `2074:5233` | Add a profile picture |
| `2077:5297` | Add a profile picture — Filled |

A three-step wizard with a 3-dot pagination indicator in the footer.

| Step | Title text | Input | Footer buttons | Keyboard |
|---|---|---|---|---|
| 1 | "What's your name?" | 1 × `Input / Text` | **one** Primary, full width (310×40) | yes |
| 2 | "Where are you located?" | 1 × `Input / Text` | **two** — Secondary 151 + Primary 151 | yes |
| 3 | "Add a profile picture" | Avatar 160×160 w/ `Element / Icon / Avatar` placeholder | **two** — Secondary 151 + Primary 151 | no |

Steps 1 and 2 pin the footer at y=407, directly above the keyboard. Step 3 has no keyboard,
so its footer sits at the bottom (y=748). All three steps carry a narrow
`Button / Link / Secondary` (72×32) in the title block — a back affordance.

The *Filled* variant of step 3 (`2077:5297`) drops the placeholder icon from the `Photo`
frame, leaving an image fill — i.e. the chosen photo renders in place, 144×144, inside a
160×160 ring.

**Design/decision conflict (see Q10):** steps 2 and 3 have a *second* footer button that
step 1 does not. The only coherent reading of that asymmetry is that step 1 is mandatory and
steps 2–3 offered **Skip**. The settled decision removes skipping entirely, so that
secondary button now has no function.

---

## Data

### Tables read/written
| Table | Access |
|---|---|
| `auth.users` | written by Supabase Auth (signup, password reset) |
| `profiles` | inserted by the `handle_new_user()` trigger; updated by each onboarding step |

No other table is touched by this epic.

### Columns missing from the current schema

`supabase/migrations/001_initial_schema.sql` cannot represent this flow. A `002` migration must:

| Change | Why |
|---|---|
| `alter table profiles drop column full_name` | Settled: dropped. |
| `alter table profiles alter column username drop not null` | Username is now collected **in onboarding**, after the row already exists. `NULL` is the honest representation of "not chosen yet". Postgres unique indexes permit multiple NULLs, so uniqueness still holds. |
| `add column onboarding_completed_at timestamptz` | The gate. `NULL` = incomplete. A timestamp rather than a boolean gives a free audit trail and costs nothing. |
| `add column location text` | Onboarding step 2. Free text — see Q11. |
| `add column terms_accepted_at timestamptz` | The signup checkbox is a consent record; it needs to be durable, not just a client-side gate. |
| unique index on `lower(username)` | The current `unique` is case-sensitive, so `Ripper` and `ripper` can coexist and are indistinguishable to a human. See Q4. |
| rewrite `handle_new_user()` | See below. |
| add `to authenticated` to the `profiles` select policy | See Q23 — current policy grants reads to `anon`. |

### `handle_new_user()` must be reworked

Current body writes `full_name` (column being dropped) and falls back to
`split_part(new.email, '@', 1)` for username. That fallback is now actively harmful:
`username` is `unique`, and two users signing up as `dave@gmail.com` and `dave@yahoo.com`
both resolve to `dave` — **the second signup's trigger raises a unique violation, which
Supabase surfaces as a generic "Database error saving new user" and the account is never
created.** This is a live bug the moment two users share a local-part.

Recommended new body: insert `(id)` only. No username, no full_name, no avatar. Onboarding
owns every profile field.

### Onboarding state and abandonment

**What a user sees if they close the app at step 2 and return:** they sign in (or resume an
existing session), the proxy sees `onboarding_completed_at IS NULL`, and routes them to the
**first step whose field is still null** — so a user who completed step 1 lands on step 2
with their username already saved, not back at the start.

This works because **each step commits on "Continue"** rather than batching at the end.
Resume position is derived, not stored:

```
username IS NULL              -> /onboarding/username
location IS NULL              -> /onboarding/location
onboarding_completed_at IS NULL -> final step
else                          -> /dashboard
```

Deriving the position from field-nullness is safe *during* onboarding, but it must not be
the completion gate itself — once profile editing exists, a user clearing their location
would otherwise be thrown back into the wizard. Hence the separate
`onboarding_completed_at` column: **derived position, explicit completion.**

---

## States

Most of the checklist's data-shaped states (empty, partial, stale, pagination) do not apply
here — these screens read at most one row, the user's own. They are marked N/A rather than
padded. The states that *do* apply are largely **UNDEFINED** in the design: no error, loading,
or offline variants exist for any of the eleven screens. Only focus states were drawn.

### Splash
| State | Behaviour |
|---|---|
| Empty | N/A |
| Loading | This screen *is* the loading state. In a Next.js SSR app there is no long client boot, so the splash is a route resolver, not a timed screen. **UNDEFINED:** whether the design intends a minimum display duration (Q18). |
| Error | **UNDEFINED.** Session lookup fails (Supabase unreachable). Default: fall through to `/auth/login`; the login attempt will surface the error. |
| Offline | **UNDEFINED.** Cached session cookie exists but `getUser()` cannot validate it. Default: treat as unauthenticated and show login with an offline banner. |
| Permission denied / Partial / Stale | N/A |

### Login
| State | Behaviour |
|---|---|
| Empty | N/A |
| Loading | **UNDEFINED.** No loading variant drawn. Default: primary button enters its `loading` state; inputs disabled. |
| Error | **UNDEFINED.** No error variant drawn — despite this being the single most common state on a login screen. Wrong credentials, unconfirmed email, rate-limited, network failure all look identical. Default: one inline error message above the primary button, `Grey/100` on a subtle red; the field borders do **not** turn red (we cannot tell which field was wrong, and saying so would leak account existence). |
| Offline | **UNDEFINED.** Default: same inline error, text "You appear to be offline." No queueing — a queued login is meaningless. |
| Permission denied | N/A |
| Partial / Stale | N/A |

### Sign up
| State | Behaviour |
|---|---|
| Empty | N/A |
| Loading | **UNDEFINED.** Default: primary `loading`, form disabled. |
| Error | **UNDEFINED.** Cases: email already registered, weak password, invalid email, network failure, **and the trigger failure described above**. Default: single inline error above the button. Note that "email already registered" is an account-enumeration leak; Supabase's default is to return success and send a duplicate-signup email — with confirmation **off**, that mitigation does not function, so the error is unavoidably explicit for now. |
| Offline | Default: inline offline error. |
| Permission denied / Partial / Stale | N/A |
| **T&C unchecked** | Drawn (`1857:17165` vs `2298:5039`). Primary disabled until checked. |

### Forgot password / Create new password
| State | Behaviour |
|---|---|
| Empty | N/A |
| Loading | **UNDEFINED.** Default: primary `loading`. |
| Error | **UNDEFINED.** For *Create new password*, the important case is an **expired or already-used recovery link** — the user arrives with no session and cannot set anything. Default: replace the form with an inline message and a link back to `/auth/forgot-password`. |
| Offline | Default: inline offline error. |
| Permission denied | Effectively the expired-link case above. |
| Partial / Stale | N/A |
| **Success (request sent)** | **UNDEFINED — screen missing.** See Q13. |
| **Success (password set)** | **UNDEFINED — screen missing.** See Q14. |

### Onboarding (all steps)
| State | Behaviour |
|---|---|
| Empty | N/A — but the *resume* case is the real "empty" here, and it is specified above. |
| Loading | **UNDEFINED.** Two distinct loads: the step's own submit, and step 1's live username availability check. Default: primary `loading` on submit; a small inline status under the input for availability. |
| Error | **UNDEFINED.** Step 1 has a genuinely new failure mode the design does not show: **username already taken**. Also: username too short/long/illegal characters, and the race where the name was free when checked and taken by the time it was submitted. Default: inline error under the input, primary stays enabled so the user can retry. |
| Offline | **UNDEFINED.** Each step commits to the server, so offline blocks progress. Default: inline offline error on the primary action; do not advance the step. Do **not** buffer steps client-side — a half-written profile that never reaches the server would leave the user permanently gated. |
| Permission denied | N/A — a user only ever writes their own profile row. |
| Partial | The core abandonment case; specified above. |
| Stale | Two tabs / two devices mid-onboarding. Default: last write wins; on load, each step re-reads the profile and skips forward if the field is already populated. |

---

## Routes

| Route | Purpose | Auth |
|---|---|---|
| `/` | Splash — resolves session and onboarding state, then redirects | public |
| `/auth/login` | Login | public (replace v1 page) |
| `/auth/signup` | Sign up | public (replace v1 page) |
| `/auth/forgot-password` | Reset password request | public |
| `/auth/reset-password` | Create new password | public, **entered with a recovery session** |
| `/auth/callback` | Code-exchange route handler | public — **does not exist, must be created** |
| `/onboarding/username` | Step 1 | session required, onboarding incomplete |
| `/onboarding/location` | Step 2 | session required, onboarding incomplete |
| `/legal/terms`, `/legal/privacy` | T&C targets | public — **do not exist** (Q6) |

Separate routes per onboarding step (rather than one route with client state) so that the
proxy can redirect straight to the resume point and the browser back button behaves.

### `proxy.ts` rules

Replace the current `protectedPaths` allowlist with a **denylist of public paths**, matching
the no-anonymous-access decision:

```
PUBLIC = ['/', '/auth/login', '/auth/signup', '/auth/forgot-password',
          '/auth/reset-password', '/auth/callback', '/legal/*']

no session      + path not in PUBLIC        -> redirect /auth/login
session         + onboarding incomplete
                + path not under /onboarding
                + path not in PUBLIC        -> redirect to the resume step
session         + onboarding complete
                + path under /onboarding    -> redirect /dashboard
session         + path in {/auth/login, /auth/signup}  -> redirect /dashboard
```

Note what is **absent** from that last rule. The current code bounces *every* `/auth/*` path
when a session exists — which breaks password reset, because Supabase's recovery link
establishes a session *before* landing on the reset page. See Q1.

The onboarding check requires reading `profiles.onboarding_completed_at`, i.e. one extra
query per request on top of the existing `auth.getUser()`. Do **not** move this into
`user_metadata` to avoid the query: `user_metadata` is writable by the client via
`supabase.auth.updateUser()`, so a user could mark themselves onboarded. The consequence is
cosmetic rather than a data breach — but it also produces exactly the NULL-username rows
described in Q5, so it is not harmless.

---

## Open questions

Ten blocking, thirteen non-blocking. Every one has a recommended default; the build can
proceed on defaults alone.

### Blocking

**Q1. The signed-in `/auth/*` bounce breaks password reset.**
A Supabase recovery link creates a session, then redirects to the reset page. `proxy.ts`
currently redirects any signed-in user away from `/auth/*` to `/dashboard`, so the user can
never reach *Create new password* — they silently land on the dashboard instead, still with
the old password.
→ **Default:** narrow the bounce to `/auth/login` and `/auth/signup` only; exempt
`/auth/reset-password` and `/auth/callback`.

**Q2. `username` nullability and the trigger rework.**
Covered under §Data. Needs an explicit yes before `002` is written.
→ **Default:** `username` becomes nullable; `handle_new_user()` inserts `(id)` only.

**Q3. How is "onboarding incomplete" stored, and what does the proxy pay for it?**
→ **Default:** `profiles.onboarding_completed_at timestamptz null`; proxy reads it with one
`select` per request; resume position derived from field-nullness. Not `user_metadata` (Q-note above).

**Q4. Username rules — charset, length, case, reserved words.**
The design shows a plain text input with no hint of constraints, because it was drawn as a
display name. A unique key needs rules.
→ **Default:** 3–20 characters, `[a-z0-9_]` only, input lowercased as the user types (as the
existing v1 signup page already does), uniqueness enforced case-insensitively via a
`unique index on lower(username)`, and a small reserved denylist (`admin`, `support`,
`letsride`, `me`, `new`, `settings`, and the existing route segments).

**Q5. Dropping `full_name` while `username` can be NULL will crash nine existing screens.**
Every display-name call site in the app is `profile?.full_name || profile?.username` — with
`full_name` gone and `username` nullable, that expression resolves to `undefined`, and
`getInitials(undefined)` throws on `.split`. Affected:
`src/app/(app)/dashboard/page.tsx`, `src/app/(app)/profile/page.tsx`,
`src/app/(app)/friends/page.tsx`, `src/app/(app)/rides/page.tsx`,
`src/app/(app)/rides/[id]/page.tsx`, `src/app/(app)/clubs/[id]/page.tsx`,
`src/components/friends/SearchRiders.tsx`, `src/components/profile/EditProfileForm.tsx`,
`src/components/ui/Avatar.tsx`.
Also `SearchRiders.tsx:26` queries `full_name.ilike.%...%`, which becomes a Postgres error
against a dropped column, and `EditProfileForm.tsx` writes `full_name` on save.
→ **Default:** in the same PR as the migration, change `getInitials` to accept
`string | null | undefined` and return `'R'` for empty input; replace every
`full_name || username` with `username ?? 'Rider'`; drop `full_name` from `Profile` in
`src/types/index.ts`; fix the search `.or()` to query `username` only.

**Q6. Where do "terms and conditions" and "privacy statement" link, and are those pages public?**
The checkbox text names two documents that do not exist, and the no-anonymous-access rule
would otherwise put them behind a login the user has not completed yet.
→ **Default:** static `/legal/terms` and `/legal/privacy` pages with placeholder copy, added
to the proxy's public allowlist. Real copy is a legal deliverable, not an engineering one —
flag to the product owner.

**Q7. The splash conflicts with the existing public marketing page at `/`.**
`src/app/page.tsx` is a v1 marketing landing page with hero copy and feature cards. The
Figma epic has no marketing page — `/` is a splash whose job is to resolve where to send you.
→ **Default:** replace `src/app/page.tsx` with the splash resolver. Preserve the old file in
git history only. If marketing wants a public landing page it is a separate epic.

**Q8. `/auth/callback` does not exist.**
Password recovery (and any future OAuth or email confirmation) needs a route handler that
exchanges the code for a session. Without it the reset email link cannot work at all.
→ **Default:** create `src/app/auth/callback/route.ts` doing `exchangeCodeForSession`, then
redirecting to `next` (validated as a relative path — an unvalidated `next` is an open-redirect).

**Q9. Does the signup primary button require the T&C checkbox?**
The dedicated *Checkbox checked* frame implies yes but does not prove it.
→ **Default:** yes — primary disabled until checked; write `terms_accepted_at = now()` on
successful signup.

**Q10. Steps 2 and 3 of onboarding have a secondary footer button with no remaining function.**
Given onboarding is now non-skippable, the 151px Secondary next to the 151px Primary has
nothing to do. It cannot be "Back" — every step already has a back link in its title block.
→ **Default:** remove the secondary button and make the primary full-width on every step,
matching step 1. This is a visible deviation from a Done design and needs a designer
heads-up, but it is the only reading consistent with the settled decision.

**Q23. `profiles` is currently readable by anonymous users.**
`create policy "Profiles are viewable by everyone" on profiles for select using (true)`
has no `to` clause, so it defaults to `public` — which includes the `anon` role. Anyone with
the (publishable) anon key can read every profile row without signing in. This directly
violates architectural decision #1, and `profiles` is the table this epic owns.
→ **Default:** `to authenticated` on the select policy in `002`. The same defect exists on
`club_members` and `ride_members` (`using (true)`) — out of scope here, but hand it to the
`data` agent.

### Non-blocking

**Q11. What shape is `location`?** Free text ("Where are you located?" with a plain input) or
structured city/country? Structured enables "rides near me" later; free text ships now.
→ **Default:** `location text`, free text, no geocoding, no autocomplete. Revisit when
`rider-ux` needs proximity.

**Q12. Where does the back link on onboarding step 1 go?** There is no previous step, and
going "back" to signup is meaningless — the account already exists.
→ **Default:** hide the back link on step 1.

**Q13. No confirmation screen after requesting a password reset.**
→ **Default:** inline success state on the same screen — replace the form with "If an account
exists for that address, we've sent reset instructions." Keeps the flow to one screen and
avoids account enumeration (Q16).

**Q14. No success state after setting a new password.**
→ **Default:** the recovery session is already active, so redirect straight to `/dashboard`
(or the onboarding resume step, if incomplete).

**Q15. Password rules.** The design shows no strength meter, no requirements text, no
confirm field.
→ **Default:** minimum 8 characters, Supabase's default policy, error surfaced inline. No
meter.

**Q16. Email enumeration on forgot-password.**
→ **Default:** always show the same success message regardless of whether the address exists.

**Q17. Rate limiting on login, signup, and reset.**
→ **Default:** rely on Supabase Auth's built-in limits for the first slice. No app-level
throttle, no CAPTCHA.

**Q18. Does the splash have a minimum display duration?**
→ **Default:** no artificial delay. It renders only for as long as the session lookup takes.

**Q19. Offline behaviour across the auth screens.**
→ **Default:** inline "You appear to be offline" error on the submitting action. No queueing,
no service-worker caching of auth routes. Revisit with `rider-ux` when PWA lands.

**Q20. Can a username be changed later, and what happens on collision?**
→ **Default:** yes, editable from profile, same validation and availability check as
onboarding step 1. No cooldown, no history of past usernames.

**Q21. What happens if a user deletes their account mid-onboarding?**
Account deletion is not built, and there is no exit from a required onboarding other than
signing out — which leaves an `auth.users` row with a profile that has a NULL username
forever.
→ **Default:** out of scope for this epic, but the wizard must offer a **sign out** action so
the user is not trapped. Hand orphan cleanup to the `data` agent.

**Q22. Does `full_name` need a backfill before it is dropped?**
→ **Default:** no. Pre-launch, no real users. Drop it outright in `002`.

**Q24. What is the splash background colour?**
The frame does not instance `App Background`, so it differs from every other screen, but the
value was not captured.
→ **Default:** brand green `#3D996B` full-bleed with the logo centred. Verify in Figma before
shipping — this is a one-token fix if wrong.

**Q25. Are the eleven inferred button and input labels correct?**
Listed inline above with **[inferred]** markers.
→ **Default:** build with the inferred labels, then verify against Figma in a single pass
when quota allows. None of them affect structure or data.

---

## Recommendation: defer the profile-picture step

**Assessment: the flow holds together without it. Defer it.**

Step 3 is the only step in the epic that requires Supabase Storage, a bucket with RLS,
client-side image compression, and EXIF stripping — an entire second vertical slice
(`media` agent) attached to what is otherwise a two-field form. Deferring it:

- **Does not break the flow.** Steps 1 and 2 are self-contained; the wizard simply ends after
  location. `onboarding_completed_at` is written at the end of step 2 instead of step 3.
- **Does not break the UI.** `avatar_url` already exists, is already nullable, and `<Avatar>`
  already falls back to initials — which will now derive from the username (Q5). Every screen
  that renders an avatar continues to work.
- **Is trivially reversible.** Re-adding the step means inserting one route and moving where
  `onboarding_completed_at` is written.

Two consequences to handle:

1. **The pagination indicator drops from 3 dots to 2.** A visible design deviation. It is
   correct — showing three dots for a two-step wizard would be a lie — but the designer should
   be told.
2. **Users who onboard during the deferral never get prompted for a photo.** Adding the step
   later must not re-gate them (their `onboarding_completed_at` is already set). Surface the
   photo prompt as a dismissible nudge on the profile screen instead, not a retroactive wizard.

Recommended slice boundary: **`/onboarding/username` + `/onboarding/location` in this epic;
`/onboarding/photo` in a `media` follow-up.**

---

## Risks

**Email confirmation is off.** This is settled and deliberate, but it means anyone can sign
up with an email address they do not control — including someone else's. Consequences while
it stays off: password reset is the only proof-of-ownership check in the system; a squatter
can take a username under a victim's email; and Supabase's duplicate-signup mitigation
(returning success and emailing the real owner) does not function, so the signup screen must
explicitly say "email already registered", which is an enumeration leak.

Also note this is a **Supabase Auth dashboard setting** (`Authentication → Providers → Email
→ Confirm email`, off), not something in the repo. It is invisible to code review and will
not travel with a migration — it must be recorded somewhere durable, and re-checked before
public launch.

**Revisit before public launch.**

---

## Out of scope

- Social / OAuth sign-in. Not in the design.
- Email confirmation and the "check your inbox" screen. Settled as off.
- Profile picture upload, Supabase Storage, image compression, EXIF stripping — deferred to a
  `media` follow-up (see above).
- Account deletion and orphan cleanup (Q21).
- The public marketing landing page currently at `/` — replaced, not respecced (Q7).
- Real legal copy for terms and privacy (Q6) — placeholder pages only.
- Migrating `zinc-*`/`orange-500`/Geist/`lucide-react` anywhere outside the screens this epic
  touches. The v2 primitives (`Button`, `Input`, `Avatar`, the Poppins scale, the cream
  background) are the `design-system` agent's deliverable and **block this epic**.
- `club_members` / `ride_members` anon-readable RLS (noted in Q23) — hand to `data`.
- Blocking, notifications, pagination, and counts — no surface in this flow.
