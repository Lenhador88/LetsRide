# Signup — moved from the handoff 2026-09-01

> How the flow broke against confirmation-on, how `signUp` branches now, and the end-to-end
> proof. History with a verification command per claim; the rule it produced is decision #6.

## Signup — the flow was broken on the live database, and is fixed

`signUp` assumed a live session, which confirmation-on does not give it: the RPC then ran as
`anon`, which has no EXECUTE on `accept_terms()` (`021`). `signUp` now branches on `data.session`
and returns `{ sent: true }` when there is none, and
`/auth/signup` renders *"Check your email"* instead of navigating to an onboarding step the
guard would bounce. **Consent is not lost**: the guard already sends any signed-in rider with a
NULL stamp to `/onboarding/terms` ahead of the wizard, and `023` refuses their content writes
until it is stamped — the database closes the gap, not trust.

Verify in one line each:

```bash
curl -s "https://zwprydcyryvudhurbnye.supabase.co/auth/v1/settings" -H "apikey: <publishable>" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["mailer_autoconfirm"])'   # false = required
grep -n "data.session" src/lib/actions/auth.ts
```

**The flow is now proven end to end — on DEV, 2026-08-06.** Against the real `Letsride-dev`
project through the relay, no stubs anywhere:

```
/auth/signup  ->  /onboarding/username  ->  /onboarding/location  ->  /postcards
```

Zero page errors, and the database agrees: `terms_accepted_at` stamped by `accept_terms()`,
`terms_version` `0-placeholder`, `username` set, `onboarding_completed_at` set. **That consent
write is the exact one that was failing on production**, so this is the first evidence the fix
works against a live database rather than a stubbed response.

**The *confirmation-on* path was unproven when this run happened** — DEV has confirmation
**off**, so it never sent an email and never exercised `/auth/callback`, and the two are
genuinely different paths: with confirmation on, `signUp` returns no session and takes the
`sent` branch instead. **`PD-91` closed that on 2026-08-16** against PROD, emailed link and all;
that issue has the calls, and §Store readiness row 7 has what is left.

Two consequences, and the second is the one that will bite:

- **`PD-91` proved the auth SERVER. The app's own arm has now RUN — 2026-08-27/28, PD-252 — and
  "run" is deliberately not "proven": two boundaries below, and row 7 carries them too.**
  PD-91 made six raw HTTP calls to GoTrue, so `signUp` never ran.
  `scripts/probes/signup-confirmation.mjs` drives the app instead, against PROD through the
  relay, and came back **11/11 green** across its two phases (run at 22:54Z on 2026-08-27, and
  re-run in its committed form at 07:21Z on 2026-08-28 after review changed the assertions): the
  `!data.session` arm in `src/lib/actions/auth.ts` returns `sent`, `/auth/signup` swaps the form
  for *"Check your email"* **in place** — no alert, no navigation, no form left on screen — the
  emailed link is accepted, and `/auth/callback` exchanges the code and the guard lands the rider
  on `/onboarding/terms` with `terms_accepted_at` still NULL. That last part is `023`'s gap being
  closed by the database rather than by trust, read straight off `auth.users` and `profiles`.
  **0 residue**, verified by query rather than asserted — and residue is state that moves, so
  re-run this rather than trusting the sentence: a later probe run reintroduces rows.

  **One of five runs was RED at the last two assertions, and what that means is genuinely open**
  — PD-337. Four `confirm` phases run within ~1–2.5 minutes of the mail were green; one run about
  five minutes after the mail reported `4/6`, with GoTrue's `verify` clean and the failure inside
  `exchangeCodeForSession`. **The experiment that would settle it — sign up, wait, confirm —
  could not be completed**, because PROD stopped delivering mail part way through (below). So
  neither reading is available yet: the green runs do not show a delayed click is safe, and the
  red one does not show it is broken.

  **One tempting explanation is ruled out and is worth not re-deriving.** On both runs whose
  timestamps were read, something followed the single-use link about twenty seconds after
  delivery, before the mailbox was opened — `last_sign_in_at` at `confirmation_sent_at` + 23s on
  one, `email_confirmed_at` at + 18.5s on the other. That is real, and it is **not** what
  separates the green runs from the red one, because it happened on the green runs too. It does
  locate the follower: on the run whose mail never arrived, `confirmation_sent_at` was stamped and
  `email_confirmed_at` stayed NULL for nine minutes — **no mail, no follow**, so it is downstream
  of delivery rather than inside GoTrue.

  **And PROD silently stopped delivering, which nothing in the app can see.** A signup at
  09:27:03 had `confirmation_sent_at` stamped and produced no mail at all, against four delivered
  in the preceding two hours; a send limit on Supabase's built-in SMTP is the likely cause and is
  **not established**. `signUp` returns the same `{ sent: true }` either way and the probe still
  reports `5/5` — so a green signup phase means the arm ran, never that a rider got mail. That is
  `PD-108`'s (custom SMTP) to fix, and it now has a measurement.

  ```sql
  -- on zwprydcyryvudhurbnye. Must be 0.
  -- Keyed on what gate 3 PERMITS — any tag on the owned mailbox — not on the tag
  -- one run happened to use: `+pd252%` would report 0 for an account left behind
  -- by a run tagged `+retry`, which the gate allows and this query is the only
  -- thing looking for.
  select count(*) as probe_rows from auth.users
   where email like 'pedro88email+%@gmail.com';
  ```

  There is deliberately no orphan-`profiles` check beside it: `001` declares
  `profiles.id references auth.users(id) on delete cascade`, so an orphan cannot exist and a
  count of it is a second confirmation that cannot fail. One check that can fail beats two where
  one is decorative.

  ```bash
  # the header carries the relay + dev-server commands and all five fail-closed gates
  node scripts/probes/signup-confirmation.mjs signup you+pd252-1@gmail.com
  ```

  **What that run could NOT reach, and it is not the arm.** `app.letsride.social:443` is refused
  by this container's agent proxy — `403` to `CONNECT`, in `recentRelayFailures`, measured
  2026-08-27 — so **the deployed bundle cannot be driven from a session at all and remains
  unexercised**. The app under test is the local dev server on `http://localhost:3000`, an origin
  PROD's allowlist deliberately does not carry, so GoTrue **discarded the whole `redirect_to`**
  and substituted the Site URL: the mail linked to `https://app.letsride.social?code=...`, path
  and `next` gone. That is `docs/ENVIRONMENTS.md` §The redirect allowlist working as designed and
  re-measured. The probe then drives the callback URL an allowlisted origin **would** have
  produced — **an inference from the allowlist, not an observation**; what was observed is the
  substituted URL. The `code` is GoTrue's own and unmodified; only the delivery address is
  restored.

  **The two phases share one browser, and that is a product property rather than a probe
  artifact.** The flow is PKCE, so `signUp` leaves a `code_verifier` in the storage of the
  browser that signed up and `exchangeCodeForSession` needs it back — a link opened on another
  device cannot complete. `/auth/confirm` below is the fix, still inert; `PD-233` carries it and
  now carries this measurement.

  **Automating it is still a separate call — PD-334 — and the third arm is why.**
  `checkRefusedSignup` (`scripts/walk.mjs`) posts a duplicate address; with
  `mailer_autoconfirm: true` GoTrue *errors*, so `signUp` takes `alreadyRegistered`. With
  confirmation **on** the duplicate-signup mitigation returns success and an empty `identities`
  array instead — **measured directly against PROD**, one call, rather than inferred from the
  screen it produces:

  ```bash
  curl -s -X POST "https://<prod ref>.supabase.co/auth/v1/signup" -H "apikey: <publishable>" \
    -H "Content-Type: application/json" -d '{"email":"<an existing address>","password":"..."}'
  # -> 200, "identities": [], no error   (and no second mail, for an already-CONFIRMED address)
  ```

  So the same phase falls through to `!data.session` and renders "Check your email" — observed on
  a second probe run. All four of that phase's assertions assert the *refusal*, so against that
  screen there is no alert and no `input[name="email"]` at all, the field reads reject on timeout,
  and the run goes **RED**. `runRefusedSignup`'s ref gate exists to stop exactly that. So a walk
  phase needs its own assertions **and** `WRITABLE_REFS` widened onto a confirmation-on ref, where
  every run emails a real address on the production auth server.
- **The cross-device confirm route is BUILT and INERT, and turning it on is an owner action.**
  `/auth/confirm` (`src/app/auth/confirm/page.tsx`) verifies an emailed `token_hash` through
  `verifyOtp`, which needs no PKCE verifier and therefore works on any device. **Nothing links to
  it yet**: GoTrue builds the link from the *Confirm signup* email template, a dashboard setting.
  Switching that template is the whole remaining step, and **it must happen after this route is
  deployed** — a template pointing at a route that does not exist breaks every confirmation in
  flight, and a spent link cannot be retried. The template, verbatim, on **both** projects:

  ```html
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/postcards">
    Confirm your email
  </a>
  ```

  `{{ .SiteURL }}` rather than `{{ .RedirectTo }}` because each project's Site URL already points
  at its own host (PD-106). `/auth/callback` stays regardless: recovery is still PKCE, and any
  confirmation link already in an inbox still points there.

  **That bare anchor is no longer what to paste — `supabase/templates/confirm-signup.html` is**,
  and it carries exactly that href (PD-235). Two more sit beside it, `reset-password.html` and
  `magic-link.html`, one per dashboard field. **The paste is still the whole remaining step and it
  is still the owner's**; committing the files changed nothing about what either project serves.
  `supabase/templates/README.md` carries the field mapping and the subject lines, and
  `docs/ENVIRONMENTS.md` §The email templates have files now, and still no gate says why nothing
  in CI, `docs:check` or a session can tell whether the paste ever happened — the templates are
  the one setting that is not merely ungated but **unreadable from here**, so a hand-diff against
  the file is the only check there is.

  **DEV cannot exercise this route as configured, and finding that out costs a session.** Two
  documented facts stack: DEV runs `mailer_autoconfirm: true` (`docs/ENVIRONMENTS.md` §Auth
  configuration), so no confirmation mail is sent and there is no `{{ .TokenHash }}` to click;
  and `app-dev.letsride.social` sits behind Vercel SSO and answers `302` to `vercel.com/sso-api`
  (§Domains), which is where DEV's `{{ .SiteURL }}` points — so even a hand-built link dies at a
  Vercel login page on a phone. Testing on DEV means turning autoconfirm off temporarily **and**
  using a Vercel-authenticated browser. **Template-first is still refused** — see the route's own
  header for why the failure is recoverable but not free.

  **Deploying template-first is recoverable, which is not the same as safe.** Only `verifyOtp`
  spends a `token_hash`, and a 404 or a guard bounce never calls it, so the link survives for the
  rest of GoTrue's OTP lifetime. Deploy-first still wins; the cost of getting it wrong is a window
  of confusing failures rather than a cohort of dead accounts. **`recovery` is deliberately refused
  by `confirmableOtpType`** — a `token_hash` would fix cross-device password reset too, but the
  reset screen gates on `026`'s grant, read off the session's `amr` claim, and whether a
  `verifyOtp`-minted session carries `{ method: 'recovery' }` is unmeasured. Measure it against a
  real emailed link before widening.

- **`/auth/callback` has a signup arm since PD-225, and the cross-device case is still broken.**
  The routing half landed: `callbackFailureDestination()` (`src/lib/auth/recovery.ts`) reads
  `next` — the only discriminator GoTrue's refusal preserves — and sends a failed confirmation to
  `/auth/login?error=invalid_confirmation` rather than into password recovery, where both auth
  screens now render the code. **What that does NOT fix is the confirm itself.** A rider
  confirming on a *different device* than they signed up on has no PKCE `code_verifier`, so
  `exchangeCodeForSession` **cannot** succeed — and GoTrue's `/verify` has already spent the
  token by then, so the account is confirmed and the link is dead. They get a clear message and
  a working way in (sign in); they do not get the link working. The fix that would is a
  `token_hash`/`verifyOtp` route, and it is ordered: deploy the route, *then* change the
  *Confirm signup* email template, which is an owner action.

Reproduce the DEV run rather than trusting this: point the relay at
`https://fpmrimzxadewsaiwpsel.supabase.co`, run the dev server against it, and sign up with any
`@letsride.dev` address. That suffix matters — `supabase/seeds/development.sql` refuses to run
if any account exists that does *not* match it, so test riders on any other domain block
seeding.

---
