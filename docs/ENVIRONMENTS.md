# Environments — DEV and PROD

**Read `CLAUDE.md` first.** This file covers only what differs between the two environments:
which database is which, how a change travels from a branch to production, and the handful of
things that are *not* in the repo and therefore drift silently.

> **Status, 2026-08-06: the DEV database exists and the Vercel half does not.** `Letsride-dev`
> (ref **`fpmrimzxadewsaiwpsel`**, `eu-west-1`) was created, the full chain applied, and its
> schema verified byte-identical to production — see §The two environments.
>
> **Vercel Preview still points at production**, so *previews are still writing to the
> production database*. Measured, not assumed: `NEXT_PUBLIC_SUPABASE_URL` is scoped
> "Production and Preview" with the PROD value. That is now the single most important line in
> this file, and it is §Owner setup items 3 and 3a.
>
> **2026-08-11: both app hosts are live on `letsride.social`, and Supabase points at them.**
> `app.letsride.social` was confirmed serving the app before its Site URL moved — the order
> §Domains insists on. `app-dev.letsride.social` answers, but **behind Vercel SSO, so what it
> serves could not be confirmed from outside**; its branch binding is set rather than observed,
> and §Domains carries the check that closes that. The apex is still unattached and belongs to
> the website's own Vercel project (`PD-34`).
> The auth URLs that §Owner setup items 8 and 9 called an outage were **repaired before the
> domain arrived**; re-measured 2026-08-07 and struck through there.

---

## The two environments

| | DEV | PROD |
|---|---|---|
| Git branch | `development` | `main` |
| Vercel target | Preview | Production |
| URL (canonical, live since 2026-08-11) | `app-dev.letsride.social` | `app.letsride.social` |
| URL (Vercel-assigned, always works) | `letsrideapp-git-development-pedro-projects1.vercel.app` | `letsrideapp.vercel.app` |
| Supabase project | `Letsride-dev` / `fpmrimzxadewsaiwpsel` — **created 2026-08-06, chain applied, schema verified identical to PROD** | `letsride` / `zwprydcyryvudhurbnye` |
| Who can reach it | Owner only (Vercel SSO on Preview) | Anyone with the link |
| Test accounts | `@letsride.dev`, seeded | None. Real riders only |
| Email confirmation | Off, so fixtures can be made | **On** once riders are live (decision #6) |

Feature branches also deploy to Preview and therefore also point at DEV. That is deliberate:
the isolation is *"nothing but `main` touches production"*, not *"only `development` is safe"*.

## How a change reaches production

```
feature-x ──PR──▶ development ──PR──▶ main
   │                   │                │
 Preview            Preview         Production
   ▼                   ▼                ▼
  DEV                 DEV             PROD
```

1. Branch `feature-x` **off `development`**, never off `main`.
2. PR into `development`. CI runs — `ci.yml` triggers on both branches, and a base branch
   missing from those lists runs *no checks at all* while showing no red mark.
3. Merge. Vercel rebuilds the DEV deployment. Check it there.
4. PR `development` → `main`. Merge. Vercel builds fresh against Production variables.
5. **Back-merge**: fast-forward `development` to `main` so the two are identical again.

### Promote with a merge commit, never a squash

Steps 1–3 squash-merge, which is right: a feature branch's intermediate commits are noise.

**Step 4 must not.** A squash creates a *new* commit on `main` whose parent is not
`development`, so the branches diverge permanently even though their trees are identical.
Every later promotion PR then re-shows commits that already shipped, the diff stops meaning
"what is unreleased", and step 5 can no longer fast-forward.

Verified on the first promotion (#64): merged with a merge commit, after which
`git merge origin/main --ff-only` on `development` succeeded and both branches sat at the same
SHA. A squash would have made that fast-forward impossible from the very first release.

### Never use Vercel's promote or instant-rollback to cross the boundary

Vercel's own REST documentation for `POST /v10/projects/{projectId}/promote/{deploymentId}`
says it plainly: **"This does not rebuild the deployment."**

Both Supabase variables are `NEXT_PUBLIC_*`, so Next inlines them into the bundle **at build
time**. A build permanently carries whichever database it was built against. Promoting a
DEV-built preview to production therefore ships the DEV Supabase URL and publishable key to
real riders — with a green deployment, no error, and no way to tell from the outside.

Rolling back *within* production is fine: that artifact was built with production values.
Crossing the boundary is not. **Promotion is a git merge that triggers a fresh build, always.**

### The native build flag — `CAPACITOR_BUILD` belongs in no Vercel target

Since PD-142 (2026-08-10) this repo produces **two** build shapes from one `next.config.ts`, and
exactly one of them may deploy:

| | `npm run build` | `npm run build:native` |
|---|---|---|
| Selected by | nothing | `CAPACITOR_BUILD=1` |
| Output | a server build in `.next/` | a static export in `out/` |
| Legacy `/postcards/<uuid>` links | redirected (307) | **do not resolve at all** |
| `next/image` | optimised | `unoptimized: true` |
| Who loads it | Vercel | `npx cap sync`, then a device |

**Set it in Production, Preview or Development and the deployment becomes a static export with
no server behind it.** Every legacy detail link 404s — the `redirects()` live in the web config,
and an export has no server to run one — and images stop being optimised. The deploy goes
**green**, which is the same failure shape as promoting a preview: nothing red anywhere, and the
app is broken for riders.

It is the same rule as the two Supabase variables one section up, for the same reason — a build
carries what it was built with, permanently. Verify rather than trust the sentence:

```bash
npm run build && node scripts/native/assert-web-build.mjs
```

That reads the output the build just wrote rather than the config that was meant to produce it,
and it runs in CI immediately after the Build step. **The Vercel side is an owner action** — a
session can assert on output, never on a dashboard.

**A bundle is this rule with the escape hatch removed.** A `.ipa` or `.aab` built from a feature
branch or from `development` points **every install** at `letsride-dev` for ever: no promote, no
redeploy, no dashboard toggle, only a new binary through a store review. DEV also runs
`mailer_autoconfirm: true`, so such a build would let anyone sign up with an address they do not
control.

**A release bundle is built from `main`, against `letsride`, with the canonical origin set — and
all three are asserted against the built output before submission** rather than inferred from
which branch somebody was on:

```bash
NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native
npm run release:check
```

`release:check` (`scripts/native/assert-release-bundle.mjs`, PD-188) walks every emitted file and
refuses the bundle unless it carries `zwprydcyryvudhurbnye` (`letsride`) and **no other** project
ref, and the canonical origin above and no `localhost` one. **It fails when it finds no ref at
all**, because a stale or empty `out/` otherwise reads exactly like a clean bundle — the same
skip-is-not-a-pass rule `docs:check --cheap` follows. Detectors tested against planted failures
in `scripts/native/__tests__/release-guards.test.mjs`; run against real builds 2026-08-12, a
PROD-ref bundle passes and a DEV-ref one is refused by name.

**It is deliberately not part of `npm run build:native`.** That runs `check-export.mjs` on every
native build, including the local, CI and on-device ones which may point wherever they like as long
as they never reach a store (`openspec/changes/add-static-export-bundle/design.md` §D7) — CI's own
bundle step builds against DEV. Wiring the release gate in there would either block every test
build or get switched off.

**`NEXT_PUBLIC_CANONICAL_ORIGIN` is the third variable a bundle bakes in permanently**, and it is
required for a native build — `next.config.ts` fails a `CAPACITOR_BUILD=1` build without it, and
the web build must keep building with it unset. Inside the shell `window.location.origin` is
`https://localhost`, which is on no redirect allowlist, and an unlisted `redirect_to` is discarded
silently — see §The redirect allowlist for the measurement. A confirmation email from a bundle
therefore opens `app.letsride.social`, the **web** app, rather than deep-linking back into the
shell; that is acceptable, and universal/app links are separate work.

**Do not set it in any Vercel target — a web build now REFUSES it rather than tolerating it.**
This is the one hazard the variable introduces, through the same door as the split that once left
Preview holding the Supabase URL and not the key: somebody sets it in Vercel, having read that a
release needs it, and unless it is scoped to a single target it lands on **Preview** too. Every
DEV and feature-branch build then emails confirmation and recovery links pointing at
`app.letsride.social`, where the token was minted by the wrong project and is invalid — green
deploy, right-looking link, and the rider clicking it is the first thing that fails. It cannot
even help when right: `window.location.origin` is already the host that served the app.

`next.config.ts` throws rather than asserting over the built output — no artifact is produced, so
nothing can ship wrong. Both directions are checked:

```bash
# expect exit 1 and "NEXT_PUBLIC_CANONICAL_ORIGIN is set, but this is a web build"
NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build
# expect exit 0 — the web build must keep building with it unset
npm run build && node scripts/native/assert-web-build.mjs
```

### The hotfix rule

If anything is ever committed to `main` that did not come through `development` — a
production hotfix at 2am — **merge `main` back into `development` immediately**. Otherwise
`development` still holds the old version of that file, and the next promotion silently
reverts the fix. This is the classic failure of this branch model and it is not hypothetical.

### The last piece: make `development` the repo's default branch

**The branch model is adopted everywhere except the one setting that decides what a fresh
checkout sees, and that gap has a cost nobody was paying attention to.** Measured 2026-08-06:

```
GitHub default_branch = "main"
  -> CLAUDE_CODE_BASE_REF = main          (environment type: cloud_default)
    -> the session container clones main  (.git/config carries [branch "main"])
      -> CLAUDE.md and .claude/ load from main
```

Two consequences, and the second is the one that compounds:

- **Agent sessions read instructions from `main`.** So a standing instruction merged into
  `development` is *written but not in force* — the next session follows the superseded rule and
  cannot tell. On the day this was found, `main` was five commits behind and a session starting
  fresh would have read a `CLAUDE.md` still claiming `letsride-dev` did not exist.
- **Every feature branch is cut from the wrong base.** Sessions branch from `main` and open PRs
  against `development`, so each one starts behind and has to rebase. This file already tells
  people to branch with `git checkout -B <branch> origin/development`; the environment hands
  them `main` regardless.

Setting the default to `development` is not a new commitment to GitFlow — it is finishing the
one already made when the environments were split. `main` stays exactly what it is: the
production branch, receiving only the promotion.

**Do these in order. Step 1 gates step 3, and skipping it is the one way to cause real harm.**

1. **Verify Vercel's Production Branch reads `main`.** Vercel → Project → Settings → Git →
   Production Branch. It defaults to the repo's default branch *at import time* and is normally
   stored explicitly afterwards — but if it tracks the default rather than storing it, flipping
   GitHub would point Production at `development` and ship DEV-built code, with DEV credentials
   inlined, to real riders on a green deploy. That is §Never use Vercel's promote, reached by a
   different door. **Unverified at the time of writing** — no MCP tool reads Vercel project
   settings, so this needs a human eye once.
2. **Check GitHub → Settings → General → "Automatically delete head branches".** In a promotion
   PR, `development` is the *head* branch, so with this on, merging `development` → `main` would
   delete `development`. It has not happened (#64 was that promotion and the branch survived), so
   it is presently off or was declined. Note that step 3 makes this moot in the safest possible
   way: **GitHub refuses to delete the default branch**, so once `development` is the default it
   cannot be removed by a merge, a setting, or a mis-click.
3. **GitHub → Settings → General → Default branch → switch to `development`.**
4. **Re-point branch protection.** Covered by Owner setup item 6, which is still outstanding for
   both branches — but note the default branch is the one most tooling protects by convention,
   so do not assume a rule written for `main` moved with it.
5. **Confirm it took.** Start a fresh session and check that it opens on `development`:

   ```bash
   echo "$CLAUDE_CODE_BASE_REF"                       # expect: development
   git rev-parse --abbrev-ref HEAD                    # the work branch, cut from development
   git rev-list --count origin/development..HEAD      # expect 0 at session start
   ```

**What does not need changing, verified 2026-08-06.** `ci.yml` already lists both branches on
both triggers, so no workflow is affected. The only `main` references in code are the two
fallbacks in `.claude/hooks/*.sh`, which are deliberate — they prefer `development` and fall
back only in a clone that never fetched it.

**The one habit that changes:** after the flip, a new PR defaults to base `development`, which
is right for every PR except the promotion. **The `development` → `main` promotion must set its
base explicitly** — and it is still a merge commit, never a squash (§Promote with a merge commit).

---

## Domains

`letsride.social` was bought by the product owner on 2026-08-07. **Both app hosts were attached
on 2026-08-11 and serve today**; the apex is still free for the website. The Vercel-assigned
`*.vercel.app` URLs keep working alongside them and are still the fallback — nothing here was a
cutover with a window.

| Host | Serves | Vercel project | Target / branch | State |
|---|---|---|---|---|
| `app.letsride.social` | **The app, production** | `letsrideapp` | Production (`main`) | ✅ serving, verified |
| `app-dev.letsride.social` | The app, DEV | `letsrideapp` | Preview, **git branch `development`** | ✅ attached; **branch binding set, not verified** |
| `letsride.social` + `www` | The marketing website | **a second project — not this repo** | its own Production | not attached (`PD-34`) |

Check rather than trust the ticks — a domain can be detached, and the fallback is silent:

```bash
for h in app.letsride.social app-dev.letsride.social; do
  printf '%-26s %s\n' "$h" "$(curl -s -o /dev/null -w '%{http_code}' "https://$h/auth/login")"
done
# 200 for app · 302 to vercel.com/sso-api for app-dev (Preview SSO — see below)
```

**That second row's branch binding cannot be read from outside, and the distinction is not
pedantry.** A `302` to the SSO wall proves the host is attached and protected; it says nothing
about *which build* sits behind it. If the Git Branch field were unset or wrong, Vercel would
serve the **production** build there — and `NEXT_PUBLIC_SUPABASE_URL` is inlined at build time
(§Never use Vercel's promote), so DEV's Site URL would be sending testers to a build wired to the
**production** database, with the SSO wall guaranteeing nobody notices. Confirm it in Vercel →
Settings → Domains, or from a browser already authenticated to Vercel, by reading the build id out
of the page:

```bash
# in the browser console on https://app-dev.letsride.social
__next_f.flat().join('').match(/"b":"([^"]+)"/)[1]
# RaYyGVUpuNcjXRMPL2sXX = development (right) · oU6Zgzt7JSBwDS6DyoYa2 = production (wrong)
```

Those two ids were measured 2026-08-11 and move with every deploy, so re-read them from
`letsrideapp-git-development-…` and `letsrideapp.vercel.app` rather than trusting the literals.

**The apex belongs to a different Vercel project, and that is the load-bearing part of the
split.** Putting the website in this repo would drag it through this repo's CI, this repo's
`output: 'export'` constraint (`capacitor.config.ts` — seven routes cannot satisfy it today) and
this repo's release train, so a copy tweak on the marketing page would wait behind a migration.
A separate project also means the apex can never accidentally serve the app: there is no route
in `letsrideapp` that answers for a domain it does not hold.

### Order of operations, and the one step that must not run early

**Run on 2026-08-11 for the two app hosts. It is kept as procedure, not as a plan** — the apex
still has to go through it when `PD-34` lands, and so does any host added later.

1. **Attach `app.letsride.social`** to `letsrideapp` (Settings → Domains) and let it serve
   Production. **Attach `app-dev.letsride.social` and set its Git Branch to `development`** —
   the field exists on the domain row, and the REST equivalent is `gitBranch` on
   `POST /v10/projects/{idOrName}/domains`.
2. **Add the DNS records Vercel prints for *these* domains.** It shows the exact values on the
   domain row and `vercel domains inspect` prints them. Do not copy a CNAME target or an apex A
   record out of a document — Vercel's own docs label the familiar `cname.vercel-dns-0.com` and
   `76.76.21.21` as *general* values and tell you to inspect the domain for the specific ones.
   (Pointing the registrar's nameservers at Vercel instead is the other route, and it is the
   simpler one if nothing else uses this domain's DNS yet. It is not the simpler one once email
   records live there — see §Email below.)
3. **Wait for the certificate and confirm both hosts actually serve the app in a browser.**
4. **Only then** change Supabase's Site URL. Step 4 before step 3 replaces one dead address with
   a different dead address, and the failure is silent in exactly the way §The redirect
   allowlist documents.

**Step 2 has a trap at name.com, and the obvious move is the one that fails.** Vercel's
per-domain target is a hex label — `61d5e29577db7c13.vercel-dns-017.com` for `app-dev` — and
name.com's DNS panel **rejects it as an invalid entry**. Nothing about the value is wrong, so the
natural reading — *Vercel printed the wrong thing* — is the wrong one, and that is the whole
reason this paragraph exists.

**Likely cause, untested:** the label starts with a digit, which
[RFC 1123](https://www.rfc-editor.org/rfc/rfc1123) permits and the older RFC 952 does not, and
some registrar validators still enforce the older rule. Nobody probed name.com's validator, so
treat this as the working hypothesis rather than the diagnosis. Three ways past it:

1. Use the generic **`cname.vercel-dns.com`** instead. It starts with a letter, so it satisfies
   the hypothesis, and Vercel still verifies a subdomain pointed at it.
2. `POST /v4/domains/letsride.social/records` on name.com's API, which does not run the panel's
   client-side validation at all. Needs an API token from the account. This is the one that works
   whatever the cause is.
3. Re-enter it with a trailing dot: `61d5e29577db7c13.vercel-dns-017.com.` — cheap to try, but
   **note it is inconsistent with the hypothesis above**, since a trailing dot does not move the
   leading digit. If this is what clears it, the hypothesis is wrong and should be struck.

**Which of the three actually resolved it on 2026-08-11 was not recorded.** Establish it the next
time — `PD-34`'s apex has to run this same step.

Two more name.com specifics: the **Host** field takes the bare label (`app`, not
`app.letsride.social` — paste the FQDN and you get `app.letsride.social.letsride.social`), and
**TTL 300 while configuring** turns a wrong record into a five-minute mistake.

**DNS stays at name.com and the nameservers do not move to Vercel.** Every record needed today
is a subdomain CNAME, which behaves identically at any registrar, and name.com supports ANAME at
the apex — so `PD-34` needs no migration either. Keeping DNS at the registrar is also what keeps
§Email's SPF/DKIM/DMARC independent of whoever hosts.

### What changes in Supabase, and what does not

**The redirect allowlist is additive; the Site URL is not.** Add the new origins to the
allowlist *first* and leave the `*.vercel.app` entries on it — an allowlist holding both costs
nothing and keeps every existing preview link working. The Site URL is a single value **and it
is the silent fallback**: an unlisted `redirect_to` is discarded and replaced by it, with no
error to anyone, which is the whole mechanism behind the outage in §The redirect allowlist. So it
is the one field where being early is worse than being late.

**Applied 2026-08-11**, and re-read off the live servers with the probe in that section:

| Project | Site URL | Redirect allowlist |
|---|---|---|
| `letsride` (PROD) | `https://app.letsride.social` | `https://app.letsride.social/**`, `https://letsrideapp.vercel.app/**`, `https://letsrideapp-*-pedro-projects1.vercel.app/**` |
| `Letsride-dev` | `https://app-dev.letsride.social` | `https://app-dev.letsride.social/**`, `http://localhost:3000/**`, `https://letsrideapp-*-pedro-projects1.vercel.app/**` |

`http://localhost:3000/**` stays on DEV and is now **off** PROD, where it had been a permanently
open redirect target on a production auth server.

**The preview wildcard stays on PROD, and the reason is not what the name suggests.** It also
matches a *production* alias: `letsrideapp-git-main-pedro-projects1.vercel.app`, measured serving
the identical production build — same etag as `app.letsride.social`. Drop the wildcard and auth
links opened on that host fall back to the Site URL instead.

**Note it does *not* match `letsrideapp-pedro-projects1.vercel.app`**, the other alias on the
project — `letsrideapp-` + `*` + `-pedro-projects1.vercel.app` cannot match a string that is
shorter than the two literals combined, even with `*` empty. Worth stating because the pattern
reads as though it covers every `letsrideapp-…` host and it does not; whether auth links opened
on that alias work has never been probed.

The wildcard is also a far weaker exposure than the localhost entry that *was* removed: a matching
host cannot be created without deploy rights on the Vercel project, whereas any process on a
rider's own machine can listen on `localhost:3000`. Replacing it with the one exact alias is the
tidier end state, once `app.letsride.social` is canonical and the `*.vercel.app` entries can all
go together.

**Nothing in `src/` needs to change for any of this, on the web.** `ShareButton`, `signUp` and
`requestPasswordReset` build their URLs from `canonicalOrigin()` (`src/lib/origin.ts`), which is
`window.location.origin` unless `NEXT_PUBLIC_CANONICAL_ORIGIN` is set — so the app still follows
whichever host served it, on every one of these hostnames. Verify rather than trust — a hardcoded
origin added later is exactly the kind of thing that only breaks in email:

```bash
grep -rn "letsrideapp\|vercel\.app\|localhost:3000" src/    # expect: nothing
```

**That grep is the whole check on the web and half of it in the shell**, which is why the helper
exists: a computed origin has no hostname to find, so the command above reads clean while a native
bundle emails every rider a link to `https://localhost`. The countable half is the reader —
exactly one, `canonicalOrigin()` itself:

```bash
grep -rn "window.location.origin" src/ --include=*.ts --include=*.tsx \
  | grep -vE ':[0-9]+:\s*(\*|//|/\*)'    # expect: src/lib/origin.ts, and nothing else
```

### `app-dev` inherits Vercel SSO, which is intended but has one sharp edge

Deployment protection on `letsrideapp` is `ssoProtection: { enabled: true, deploymentType:
"preview" }` — measured 2026-08-07 via `get_project_deployment_protection`. DEV is owner-only by
design and that should stay.

**The edge: a DEV signup-confirmation link opens `app-dev.letsride.social` in whatever browser
the mail app hands it to, and that browser hits the SSO wall before it ever reaches
`/auth/callback`.** On a phone, signed out of Vercel, the rider sees a Vercel login page instead
of the app. That does not break PROD and it does not break the walk, but it means *DEV signup
cannot be exercised on a device* until either the branch domain is exempted from protection or
the test is run in a browser already authenticated to Vercel.

**Confirmed 2026-08-11, once the domain was attached: it does inherit.**
`https://app-dev.letsride.social/auth/login` answers `302` to `vercel.com/sso-api`, against `200`
and real app HTML on `app.letsride.social`. So the sharp edge above is live, not hypothetical.
Whether such a domain can be *exempted* on this plan is still **not measured** — that is a
separate question from whether it inherits, and only the second one has been answered.

### The apex before the website exists

A bought domain that serves nothing is worse than one that forwards, so a redirect from
`letsride.social` to `app.letsride.social` is reasonable as an interim. **Make it a 307, never a
301.** A permanent redirect is cached by the browser itself, so every visitor who loads the apex
once keeps being sent to the app for as long as that cache lives — including after the marketing
site ships. There is no way to reach into those caches, and the people affected are exactly the
early visitors you most want to land on the website.

### Email

Auth mail currently leaves Supabase's shared SMTP, from a Supabase-owned sender. That is
rate-limited and documented as unsuitable for production volume, and it is unrelated to owning a
domain — buying `letsride.social` did not change what sends the mail, only what could.

Sending from `noreply@letsride.social` needs a real SMTP provider plus SPF, DKIM and DMARC
records on the apex. **That is what makes the nameserver decision in step 2 matter**: if DNS
moves to Vercel, the mail records move with it.

Worth doing even while nothing sends mail: publish an SPF record with `-all` and a DMARC record
with `p=reject`. A domain with no mail policy can be spoofed by anyone, and a young brand's
first experience of that is usually a phishing run at its own signups.

---

## Migrations

The chain is the source of truth and it reproduces a database from zero — including Storage,
because `010` writes `storage.buckets` rather than assuming a dashboard click. `run.sh` proves
this on every PR touching `supabase/**`.

### Order of operations, which is not one step

An additive migration and a destructive one need **opposite** orders relative to the code
deploy. This is the lesson `021` was split for (into `021` + `025`), and with two environments
it gets run twice:

| Migration is… | Order |
|---|---|
| **Additive** — new table, column, policy, function | apply → **then** deploy the code |
| **Destructive** — drop, revoke, tighten a CHECK | deploy the code → **then** apply |

Getting a destructive one backwards is an instant outage: `024` dropped `avatar_url`, and the
code before that commit still selected it. Getting an additive one backwards is a screen that
throws on load.

So a schema change travels like this:

1. Migration file lands in the `feature-x` → `development` PR.
2. Apply it to **DEV**, in the correct order for its type.
3. Verify on the DEV URL.
4. PR `development` → `main`, merge.
5. Apply it to **PROD**, in the correct order for its type.

### Checking drift

```bash
PROD_DATABASE_URL=postgresql://... DEV_DATABASE_URL=postgresql://... npm run db:drift
```

Three-way: files, DEV, PROD. Exits non-zero on any disagreement. Either URL may be omitted.

Two things it encodes that a hand-rolled check gets wrong, both measured:

- **It compares names, never versions or ordering.** The recorded `version` is a timestamp of
  *when* a migration was applied. PROD's rows run `initial_schema` (001) → `fix_visibility_policies`
  (004) → … because `004`–`007` reached the database before `002` did. A fresh DEV replayed in
  filename order records filename-order versions. The two databases will hold identical
  migrations under permanently different versions, forever.
- **It normalises the name.** 29 of PROD's 32 rows carry the bare name; three carry the numeric
  prefix (`003_onboarding`, `009_postcards_and_blocks`, `010_postcard_storage`). A check that
  skips this reports three phantom drifts against a correct database.

**There is no rollback.** The chain is append-only and there are no down scripts. A wrong
migration is fixed by writing the next one; if it destroyed data, by restoring from backup —
which is why the free tier is not viable once real riders exist.

### Seeding DEV

```bash
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v seed_password="$(openssl rand -base64 18)" \
  -f supabase/seeds/development.sql
```

Idempotent — it resets rather than appends. It **refuses to run** against any database holding
an account it did not create, which is what stops it ever reaching production; the guard runs
before the delete, so a refused run changes nothing. The password is a required argument and
never a literal, per `docs/HANDOFF.md` §Test accounts.

Postcard images are absent — SQL cannot upload a JPEG — so the deck shows broken thumbnails
until someone posts one through the app. Doing that early is worthwhile anyway: it is the only
thing that exercises compression, EXIF stripping and the Storage policies.

**The seed is gated in CI** (`npm run db:seed:check`, and a step in the RLS job). It builds a
scratch database from the full chain, applies the seed, re-applies it to prove it resets rather
than appends, and then proves the guard still refuses once a non-seed account exists — and that
a refused run changes nothing.

That gate exists because the seed is the only SQL here that runs *by hand, occasionally*.
Everything else is exercised continuously, so the seed is the one file that rots without anyone
noticing: a later migration adds a NOT NULL column, nothing goes red, and it is discovered by
whoever is standing up DEV under time pressure. The guard half is checked for the same reason
`no-service-role-key.test.ts` proves its own detector still fires — a guard that has quietly
stopped matching passes for ever and looks exactly like a correct one.

---

## What is NOT in the repo, and therefore drifts silently

This is the real maintenance cost of two projects. Everything above is version-controlled;
none of the below is.

### Vercel's system environment variables

`src/app/layout.tsx` resolves the `og:image` origin from **`VERCEL_PROJECT_PRODUCTION_URL`**,
falling back to a written-down `https://app.letsride.social`. Vercel exposes that variable only
while the project's **Automatically expose System Environment Variables** toggle is on — Settings
→ Environment Variables, default on, dashboard-only, no file behind it.

**Nothing observes which branch ran, and that is the trap.** Vercel sets the variable to the
production domain on Preview deployments too, so it resolves to exactly the fallback string: a
build where the read returned `undefined` is byte-identical to one where it worked. The difference
first appears *after* a domain move, as an `og:image` that 404s on every shared link while the page
itself is fine.

So the fallback is a floor rather than a belt-and-braces flourish — with the toggle off, the
literal is the only thing keeping share cards rendering, and it is the thing a domain move has to
remember to edit. Check the toggle before assuming a move needs no code change:

```bash
# On any deployment's build log, the resolved value is visible in the built output:
grep -o 'https://[^"]*/brand/og-card.png' .next/server/app/index.html
```

### The observability keys, and their scoping is the whole design (PD-315, PD-353)

Four `NEXT_PUBLIC_*` variables arrived on 2026-09-01. All four are **public by design** — they
ship in the client bundle, like the Supabase publishable key — and all four are a **clean no-op
when unset**, so nothing throws and nothing prints on an environment that has none. That last
property is what a session should verify before reporting either SDK as broken.

**They scope in OPPOSITE directions, and that is deliberate rather than an oversight:**

| Variable | Scope | Why |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Production **and** Preview/Development | One Sentry project, split by the environment tag. Filtering an environment out of an issue list is one click, and an error on DEV is worth seeing |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Per target — `production` / `development` | Unset resolves to `unknown` rather than `production`. A build whose variable did not arrive is one we want to SEE mislabelled; defaulting to the real answer for the most important environment is how a Preview's errors get read as riders' |
| `NEXT_PUBLIC_POSTHOG_KEY` | **Production ONLY** | The free tier allows **one project**, and a PostHog project is the analytics boundary: a funnel aggregates everything in it by default, so a DEV event corrupts a PROD number silently unless every insight remembers to filter it out. There is no environment tag that fixes this the way Sentry's does |
| `NEXT_PUBLIC_POSTHOG_HOST` | Production only, with PostHog's EU host | EU Cloud, chosen at account creation. Defaults to `https://eu.i.posthog.com` in code, so this row is a belt-and-braces override rather than a requirement |

**The cost of the PostHog row is named rather than hidden**, because it is the trap §Technology
Decisions records against a flag defaulting off: *a thing nothing can reach is a thing nothing can
test*. `npm run walk` runs against DEV, so it cannot exercise one line of the analytics path, and
neither can any preview. Two things cover it and both are required —
`src/lib/analytics/__tests__/` asserts the seam and every call site, and the **transport is
hand-verified once on PROD after a promotion**, before PD-353 reaches `Done (in production)`.

**Four PostHog settings live in a dashboard as well as in the code, and nothing checks that the
two agree.** Autocapture off, heatmaps off, web vitals on, session replay on. A mismatch fails
silently in the expensive direction — autocapture switched on in the dashboard collects element
text from every screen while `src/lib/analytics/client.ts` says it does not. Same class of
drift as the auth settings below, and the same remedy: read the dashboard, do not trust a
sentence.

### Auth configuration

There is no `supabase/config.toml` — this repo has never used the Supabase CLI — so every
GoTrue setting is a dashboard click with no file behind it. **A new project starts on Supabase
defaults, and the default is email confirmation ON**, which is the opposite of decision #6. A
fresh DEV will therefore refuse to let you create a fixture rider, and it will look like a
broken signup rather than a config difference.

**That is not a hazard waiting for DEV — it already happened on PROD.** Measured 2026-08-06,
`letsride` reports `mailer_autoconfirm: false`: the default was never changed, decision #6 said
otherwise for the project's whole life, and `signUp` was written against the sentence rather
than the setting. The result is one account on the live database created through the real
signup flow with no consent stamp, no username and no sign-in — the exact shape this predicts.
`signUp` now branches on `data.session`, so the app is correct either way, but the lesson is
the one this section is for: **an unversioned setting drifts silently, and code that trusts a
document instead of reading it drifts with it.** Verify with one call that needs no
credentials:

```bash
curl -s "https://<ref>.supabase.co/auth/v1/settings" -H "apikey: <publishable key>" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["mailer_autoconfirm"])'
# false = confirmation REQUIRED. true = autoconfirm, i.e. "off".
```

Note the polarity — `mailer_autoconfirm: false` reads like "confirmation off" and means the
opposite.

Check these on both projects whenever either changes:

| Setting | DEV | PROD (intended) | **PROD, measured — date per cell** |
|---|---|---|---|
| Email confirmation | off | **on** before launch (decision #6) | **ON** — `mailer_autoconfirm: false`, re-measured 2026-08-07 |
| Site URL | `https://app-dev.letsride.social` | `https://app.letsride.social` | ✅ **`https://app.letsride.social`** — moved and re-measured 2026-08-11 |
| Redirect allowlist | `https://app-dev.letsride.social/**` + `http://localhost:3000/**` + `https://letsrideapp-*-pedro-projects1.vercel.app/**` | `https://app.letsride.social/**`, the `*.vercel.app` entries, and **no** localhost | ✅ all three honoured; `http://localhost:3000/**` **removed** — re-measured 2026-08-11 |
| Leaked-password protection | on | on | **off** — the one outstanding security advisor |
| `UpdatePasswordRequireCurrentPassword` | on | on | **not measured** — no read-only probe found for it |

**Fill every cell in that last column or write "not measured".** A blank reads as "fine", and
the first revision of this table left four blank while stating one measured row — which is how
the two rows below went another day unnoticed.

### The email templates have files now, and still no gate

`supabase/templates/` holds the three branded auth mails — `confirm-signup.html`,
`reset-password.html`, `magic-link.html` — one file per dashboard field, pasted by hand into both
projects. **That directory is the source of truth by convention only**, and it belongs in this
section rather than above it for exactly that reason: a template is a dashboard setting like the
Site URL, and committing a file does not change what the setting is.

The asymmetry with everything else in this repo is worth stating plainly, because a file in git
*looks* authoritative:

- **Nothing can read a deployed template back.** The Supabase MCP server exposes no template read;
  `GET /v1/projects/{ref}/config/auth` needs a personal access token this environment does not
  hold; and `/auth/v1/settings` — the credential-free probe two paragraphs up — returns no bodies.
  So the drift is not merely ungated, it is **unobservable from a session**.
- **The CI job that does open the directory can only see the files.**
  `src/__tests__/auth-email-templates.test.ts` reads all three templates under Vitest, so it
  catches a link that no longer matches its own copy-this-link fallback — or the hardcoded
  constant it is pinned to, which is why a deliberate link change has to be made in the test
  as well. It cannot see a hosted
  project, and neither can anything else: the RLS suite applies migrations to a scratch Postgres
  with no GoTrue in it, and `docs:check` measures files in this repo.

The check is therefore a hand-diff, and it is the owner's: paste the dashboard's current body into
a scratch file and `diff -u` it against the committed one whenever either project's auth config is
touched. `supabase/templates/README.md` carries the field mapping, the subject lines and the
markup constraints.

**One ordering note that outlives the paste:** `confirm-signup.html` carries PD-233's link form,
so pasting it *is* PD-233. Prove the link works on the project you pasted into before calling
either issue done — and note this section's own rows say why DEV cannot exercise it as configured
(autoconfirm is on, so no confirmation mail is sent at all).

### The redirect allowlist — on the domain now, and here is the probe that proves it

**This section has been rewritten twice by things it asserted going out of date, which is the
argument for the probe rather than the table.** Keep the command; the verdict under it is a
dated reading, not a fact about the system.

`GET /auth/v1/verify` with a bogus token reports where GoTrue *would* have sent the rider,
needs no credentials beyond the publishable key, and changes nothing:

```bash
K="<publishable key>"   # mcp__Supabase__get_publishable_keys
B="https://zwprydcyryvudhurbnye.supabase.co/auth/v1/verify?token=bogus&type=signup&redirect_to="
for t in https://app.letsride.social/auth/callback https://letsrideapp.vercel.app/auth/callback \
         http://localhost:3000/auth/callback https://not-allowlisted.example.com/auth/callback; do
  curl -s -o /dev/null -D - "$B$t" -H "apikey: $K" | grep -i '^location:'
done
```

**Measured 2026-08-11, after §Domains step 4.** Read each row as its own fact:

| Project | `redirect_to` sent | GoTrue's `location:` | Means |
|---|---|---|---|
| PROD | `https://app.letsride.social/auth/callback` | the same URL | ✅ allowlisted and honoured |
| PROD | `https://letsrideapp.vercel.app/auth/callback` | the same URL | ✅ still honoured — the fallback host keeps working |
| PROD | `https://letsrideapp-git-main-…vercel.app/auth/callback` | the same URL | ✅ covered by the preview wildcard |
| PROD | `http://localhost:3000/auth/callback` | `https://app.letsride.social` | ✅ **removed** — and the fallback names the Site URL |
| DEV | `https://app-dev.letsride.social/auth/callback` | the same URL | ✅ allowlisted |
| DEV | `http://localhost:3000/auth/callback` | the same URL | ✅ kept, which is correct for DEV |
| DEV | `https://not-allowlisted.example.com/auth/callback` | `https://app-dev.letsride.social` | ✅ names DEV's Site URL |

The discard rows are how you read the Site URL without a dashboard: **whatever a discarded
`redirect_to` falls back to *is* the Site URL.** Send a deliberately unlisted host when every
real one is allowlisted, or the probe has nothing to fall back from and tells you nothing.

**The same probe, pointed at the two origins a native shell produces. Measured against PROD
2026-08-12** (PD-188) — this is what makes the canonical origin a build requirement rather than a
nicety:

| Project | `redirect_to` sent | GoTrue's `location:` | Means |
|---|---|---|---|
| PROD | `https://app.letsride.social/auth/callback` | the same URL | ✅ the origin a release bundle bakes in is allowlisted and honoured — no dashboard action needed, PD-106 already did it |
| PROD | `https://localhost/auth/callback` | `https://app.letsride.social` | ❌ discarded — the webview origin under `androidScheme: 'https'` |
| PROD | `capacitor://localhost/auth/callback` | `https://app.letsride.social` | ❌ discarded — the iOS scheme |

**The discard drops the path with the origin, and that is worse than a dead link.** The rider does
not land on `/auth/callback` with an error to read: they land on the app **root**, with no `next`
param and the failure only in the URL fragment, which nothing in this app reads. From the sending
side it is invisible — the email was sent, the address was confirmed, and the rider is simply
never seen again. `src/lib/origin.ts` and `next.config.ts` are what stop a bundle being built that
way at all.

An unlisted `redirect_to` is **discarded silently** and replaced by the Site URL. That mechanism
is unchanged and is what made the original outage invisible — while the Site URL was
`http://localhost:3000`, a rider who signed up got an email that confirmed their address and
then sent their phone to a dead local address, with the account working and no way to tell.
**It is also why §Domains orders the domain attach before the Site URL change**: pointing the
Site URL at a host that does not resolve yet rebuilds that exact failure with a new hostname.

**The live database still records the outage, and that row is now history rather than a
finding.** The one account created through the real signup flow has `email_confirmed_at` set 13
seconds after `created_at` and `last_sign_in_at` NULL. It was read as proof of the consent bug
(§Auth configuration above) and is equally proof of this one. Both halves are now fixed — the
consent write in `signUp`, the URLs in the dashboard — so the row proves what *was* broken, and
nothing about the present state. **`PD-91` exercised signup end to end against this
database on 2026-08-16** — signup, the emailed link, `verify`, then a password grant — so "the
dashboard is right" and "the auth server works" are both now established. What is still not: the
app's own `signUp` on the confirmation-on path, which PD-91 bypassed by calling GoTrue directly
(PD-252).

`requestPasswordReset` builds its link from `window.location.origin`
(`src/lib/actions/auth.ts`, the `origin` const — line number deliberately omitted, it has moved
once already), and Vercel preview URLs are per deployment, so the wildcard is what makes
recovery work from a preview at all. That is also why §Domains needs no code change: the origin
follows the host that served the page, on every one of these hostnames.

Adopting `config.toml` is what fixes this properly, and the first Edge Function deploy forces
that decision anyway — see below.

### Edge Functions

**They are not in the migration chain.** They deploy separately, per project, and can drift out
of sync with the schema in a way `npm run db:drift` cannot see. A function calling a column
that only exists on DEV is a failure class the chain does not cover.

`supabase/functions/delete-account/` is **deployed to both projects and `ACTIVE` as of
2026-08-11**, both `verify_jwt: true`, both on the same `ezbr_sha256` — so PROD and DEV run an
identical build. Re-derive with `list_edge_functions` against each ref rather than trusting this
line. Three things follow:

- **Redeploying needs the Supabase CLI.** The MCP server exposes `list_edge_functions` and
  `get_edge_function` but no deploy tool, so every deploy after this one is an owner action too.
  **That makes an edit to `index.ts` silent drift**: the repo changes, the running function does
  not, and nothing — not CI, not `db:drift`, which only reads migrations — compares them. That is
  the same CLI that brings `config.toml`, which is why the first Edge Function — not branching —
  is what forces the tooling decision.
- **Nothing type-checks them.** `tsconfig.json` excludes `supabase/functions` because it is
  Deno. ESLint still parses them, and it is the only tool that does.
- **Secrets are per project.** A DEV push key that reaches a test device and a PROD one that
  reaches every rider. Getting these backwards sends test notifications to real people.

### Scheduled jobs — the footgun to design against before writing one

Ride reminders need a schedule. **If that is written as `pg_cron`, it lives in a migration, and
the chain replicates it to DEV — where it will also fire.** A reminder job running on both
databases means DEV sending real notifications to whatever addresses its seed holds. `pg_net`
carries the same hazard for outbound HTTP.

Neither extension is installed today (`list_extensions` — both present, both
`installed_version: null`), so this has not bitten. The mitigation has to be something the
chain *cannot* replicate: gate the job on a per-project value in Vault, which is already
installed, or schedule it outside the chain entirely. **Decide which before the first
scheduled job is written, not after it has fired from the wrong database.**

---

## Owner setup — still outstanding

Nobody in a session can do these.

1. ~~**Check the current Vercel variable scoping.**~~ **Done, and it was the bad case.**
   `NEXT_PUBLIC_SUPABASE_URL` is scoped *Production and Preview* with the PROD value, so every
   preview and feature branch has been reading and writing production.
2. ~~**Create `letsride-dev`.**~~ **Done** — `fpmrimzxadewsaiwpsel`, `eu-west-1`, same org.
3. **Set the variables per target** — Production → `letsride`; Preview and Development →
   `Letsride-dev` (`https://fpmrimzxadewsaiwpsel.supabase.co`). **This is now the only thing
   standing between previews and the production database.**

   Add a *second row* per variable rather than editing the existing one: Vercel allows one
   value per name per environment, so each name ends up with a Production row and a Preview row.

3a. **Leave the Preview rows' branch filter empty.** A Preview variable scoped to a single git
   branch applies to that branch alone — and feature branches deploy to Preview too, so they
   would build with the variable missing. Which does **not** fail loudly: measured, `next build`
   exits 0 without the anon key and ships a green deployment that fails in every browser.
   `next.config.ts` now asserts both at build time so that turns red instead.
4. ~~**Replicate auth config** on DEV~~ **Done and verified** — confirmation **off**
   (`mailer_autoconfirm: true`), Site URL set to the DEV preview alias, and both
   `http://localhost:3000/**` and the preview wildcard on the redirect allowlist. PROD's
   allowlist was also repaired the same day (items 8 and 9 below).
5. **Repoint the GitHub Actions secrets at DEV.** CI only uses them for `next build`, which
   fetches nothing, so production credentials have no business being there.
6. **Branch protection on both `main` and `development`** — require `Type Check, Lint & Build`
   and `RLS Policy Tests`, require branches up to date, no bypass. Currently off entirely.
7. **Supabase Pro.** The free tier has no daily backups, and with no down migrations, backups
   are the only rollback that exists.
7b. **Create the Sentry org and project, and put the DSN in Vercel** (PD-315). Production and
   Preview/Development are separate scopes and both want it — see §The observability keys above.
   The native build's environment needs it too. **Until this lands, error reporting ships and
   stays completely silent**, which is a clean no-op rather than a failure: nothing throws and
   nothing prints, so there is no symptom to debug and no way for a session to tell it apart
   from working.
7c. **Confirm the four PostHog dashboard toggles** (PD-353) — autocapture off, heatmaps off, web
   vitals on, session replay on — and put `NEXT_PUBLIC_POSTHOG_KEY` on **Production only**. The
   code cannot see the dashboard half, and a mismatch is silent.
7c-i. **Set replay retention to the shortest the plan allows** (PD-353), and check what the free
   tier actually permits rather than assuming it is configurable. This is the highest-consequence
   of the PostHog settings and the easiest to leave at a default: unmasked video of riders'
   screens, sitting for however long the plan defaults to. Nothing in the repo can see or set it.
7c-ii. **Tell the pilot riders** (PD-353). They are people who can be told, which the issue calls
   "a stronger answer than masking", and it costs a sentence. `/legal/privacy` carries the written
   version; this is saying it to the group directly, which the written page cannot substitute for
   while the recording is unmasked.
7c-iii. **Set Sentry's alert rule to real-time** (PD-315). Not the alert→ticket automation, which
   `observability.md` §Not in PD-315 carves out as its own deliverable — this is the project's own
   notification rule. A crash spike on a fresh release has to be known in minutes, and a project
   created with defaults will not do that.
7d. **Decide what happens to PostHog's records when a rider deletes their account** (PD-353,
   open). `delete-account` does not reach PostHog, so a rider who erases their account leaves
   their events and their unmasked recordings behind — `029`'s "the row goes" contract is
   silently false for the one processor holding video of them. `identify()` uses `auth.uid()`
   so the handle exists; wiring the erasure needs a PostHog private API key in the function's
   secret store, which is a new secret and arguably its own story. Until then
   `/legal/privacy` and `/legal/account-deletion` both say plainly that deletion does not reach
   it and name the email route that does.
7a. **Make `development` the repo's default branch** — the ordered checklist is in §The last
   piece above, and step 1 (verify Vercel's Production Branch reads `main`) gates the rest.
   Until this is done, every agent session reads `CLAUDE.md` and `.claude/` from `main`, so any
   instruction merged to `development` is written but not in force.

8. ~~**Set Site URL to `https://letsrideapp.vercel.app`.**~~ **Done** — re-measured 2026-08-07,
   a discarded `redirect_to` now falls back to `https://letsrideapp.vercel.app/` rather than
   `http://localhost:3000`. This was the most urgent item in the repo for two days *after it
   had already been fixed*, in three places at once, which is the strongest argument this file
   has for §The redirect allowlist's rule: **keep the probe, not the verdict.**
9. ~~**Add the production origin to the redirect allowlist.**~~ **Done and verified** by the
   same probe. ~~One residue worth a click: `http://localhost:3000/**` is still honoured on
   **PROD**.~~ **Removed 2026-08-11**, with the domain move — it was never an outage, since
   `requestPasswordReset` builds its `redirect_to` from `window.location.origin` and nothing in
   production ever asked for it, but it was a permanently open redirect target on a production
   auth server.

**The domain work that replaced both of these is done — `PD-105` and `PD-106`, 2026-08-11 — and
the ordering rule it was kept here for outlives it:** attach the host, confirm it serves, **then**
move the Site URL. Doing it in the other order recreates items 8 and 9 exactly, with a hostname
that looks right. The apex still has to go through it when `PD-34` lands, which is why §Domains
keeps the list as procedure rather than a record.

Then, in a session: apply the chain to DEV, run `npm run db:drift` to prove the three agree,
seed it, and move the two `@letsride.test` fixtures off production.

## Where the split stands — moved from the handoff 2026-09-02

**`docs/ENVIRONMENTS.md` is the contract.** Read it before touching either project. What
belongs here is only which half is real.

**Real, and exercised end to end on 2026-08-06** — the full loop ran once, deliberately:
feature branch → `development` (#63) → `main` (#64), then a fast-forward back-merge leaving both
branches at the same SHA.

- **`development` is deployed**: `letsrideapp-git-development-pedro-projects1.vercel.app`,
  Preview target, `READY`. Owner-only, because Preview carries Vercel SSO.
- **Both custom hosts are attached since 2026-08-11**, with both Supabase Site URLs moved to
  match — `PD-105`/`PD-106`, and `docs/ENVIRONMENTS.md` §Domains carries the probes.
  `app.letsride.social` answers `200` with the app, verified. `app-dev.letsride.social` answers
  `302` to Vercel SSO, which verifies it is attached and protected and **not** which build is
  behind it — its `development` binding is set, not observed, and §Domains has the build-id check
  that settles it. The `*.vercel.app` URLs still work and are still the fallback.
- **CI triggers on a `development` base** — confirmed by run 149's own `pull_request` event.
  `ci.yml` `on:` lists both branches on both triggers; a base missing from those lists runs
  *zero* jobs and shows no red mark, which is indistinguishable from having nothing to check.
- `npm run db:drift`, `npm run db:seed:check` (also a CI step), `supabase/seeds/development.sql`.

**The DEV database is `Letsride-dev`, ref `fpmrimzxadewsaiwpsel`**, `eu-west-1`, same org.
Confirmation is **off** there (`mailer_autoconfirm: true`) and on for PROD, which is the intended
split. §Migrations below is the live comparison.

**The Vercel half is not done, and that is now the only gap.** `NEXT_PUBLIC_SUPABASE_URL` is
still scoped **Production and Preview** against PROD, so previews still read and write the live
database — measured 2026-08-06, which finally answers `ENVIRONMENTS.md` §Owner setup item 1.
`NEXT_PUBLIC_SUPABASE_ANON_KEY` was narrowed to Production only mid-session, so Preview
currently holds a URL and no key. Both need a second row scoped to **Preview with no branch
filter** — a branch-scoped Preview variable applies to that branch alone, and feature branches
deploy to Preview too.

That misconfiguration does **not** fail the build — measured, `next build` exits 0 and ships,
because `createClient()` is only called from an effect and the prerender pass never reaches it.
`next.config.ts` now asserts both variables at build time so it turns red instead of
green-and-broken.

Two rules that bite immediately, before any of the owner steps happen:

- **PRs go to `development`, not `main`.** The thing an agent gets wrong by habit. `main` takes
  exactly one kind of PR: the promotion.
- **Never promote a Vercel preview to production.** `NEXT_PUBLIC_SUPABASE_*` is inlined at
  build time and Vercel's own API docs say promote *"does not rebuild the deployment"* — so it
  would ship DEV credentials to riders with a green deploy and no error.

Verify rather than trust, one line each:

```bash
git ls-remote --heads origin development          # does the branch exist
grep -A 5 '^on:' .github/workflows/ci.yml         # both branches, both triggers
npm run db:drift                                  # needs PROD_DATABASE_URL / DEV_DATABASE_URL
```
