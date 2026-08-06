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

---

## The two environments

| | DEV | PROD |
|---|---|---|
| Git branch | `development` | `main` |
| Vercel target | Preview | Production |
| URL | `letsrideapp-git-development-pedro-projects1.vercel.app` | `letsrideapp.vercel.app` |
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
never a literal, per `CLAUDE.md` §Test accounts.

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

| Setting | DEV | PROD (intended) | **PROD, measured 2026-08-06** |
|---|---|---|---|
| Email confirmation | off | **on** before launch (decision #6) | **ON** — `mailer_autoconfirm: false` |
| Site URL | the DEV preview alias | `https://letsrideapp.vercel.app` | ❌ **`http://localhost:3000`** |
| Redirect allowlist | `http://localhost:3000/**` + `https://letsrideapp-*-pedro-projects1.vercel.app/**` | the production origin **only** | ❌ **`http://localhost:3000` only** — neither the production origin nor the preview alias is on it |
| Leaked-password protection | on | on | **off** — the one outstanding security advisor |
| `UpdatePasswordRequireCurrentPassword` | on | on | **not measured** — no read-only probe found for it |

**Fill every cell in that last column or write "not measured".** A blank reads as "fine", and
the first revision of this table left four blank while stating one measured row — which is how
the two rows below went another day unnoticed.

### The redirect allowlist is broken on production right now

Not a hazard to design against — measured, and it breaks every emailed link the app sends.
`GET /auth/v1/verify` with a bogus token reports where GoTrue *would* have sent the rider:

```bash
B="https://zwprydcyryvudhurbnye.supabase.co/auth/v1/verify?token=bogus&type=signup&redirect_to="
for t in https://letsrideapp.vercel.app/auth/callback http://localhost:3000/auth/callback; do
  curl -s -o /dev/null -D - "$B$t" -H "apikey: <publishable>" | grep -i '^location:'
done
# production origin -> http://localhost:3000#error=...   (discarded, fell back to Site URL)
# localhost         -> http://localhost:3000/auth/callback#error=...   (honoured)
```

An unlisted `redirect_to` is **discarded silently** and replaced by the Site URL — which is
itself `http://localhost:3000`. So a rider who signs up or requests a password reset on
`letsrideapp.vercel.app` gets an email whose link confirms their address and then sends their
phone to a dead local address. The account works; the rider cannot tell, and has no way back.

**The live database already records this.** The one account created through the real signup flow
has `email_confirmed_at` set 13 seconds after `created_at` and `last_sign_in_at` NULL. That row
was read as proof of the consent bug (§Auth configuration above); it is equally proof of this
one, and only the consent half has been fixed in code. The other half is two dashboard clicks —
§Owner setup, items 8 and 9.

`requestPasswordReset` builds its link from `window.location.origin`
(`src/lib/actions/auth.ts`, the `origin` const — line number deliberately omitted, it has moved
once already), and Vercel preview URLs are per deployment, so the wildcard is what makes
recovery work from a preview at all. This section used to say only that, and never checked
whether *production itself* was on the list. It is not.

Adopting `config.toml` is what fixes this properly, and the first Edge Function deploy forces
that decision anyway — see below.

### Edge Functions

**They are not in the migration chain.** They deploy separately, per project, and can drift out
of sync with the schema in a way `npm run db:drift` cannot see. A function calling a column
that only exists on DEV is a failure class the chain does not cover.

`supabase/functions/delete-account/` is **written, not deployed, and has never run** — its own
header says so, and `list_edge_functions` against PROD returns zero. Three things follow:

- **Deploying needs the Supabase CLI.** The MCP server exposes `list_edge_functions` and
  `get_edge_function` but no deploy tool, so this is an owner action and the CLI has to arrive
  before the first deploy. That is the same CLI that brings `config.toml`, which is why the
  first Edge Function — not branching — is what forces the tooling decision.
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
7a. **Make `development` the repo's default branch** — the ordered checklist is in §The last
   piece above, and step 1 (verify Vercel's Production Branch reads `main`) gates the rest.
   Until this is done, every agent session reads `CLAUDE.md` and `.claude/` from `main`, so any
   instruction merged to `development` is written but not in force.

**8 and 9 are new, measured, and the most urgent things on this list** — they are the only two
items here that are breaking production *today* rather than preparing for DEV. Both are on
`letsride` → Authentication → URL Configuration:

8. **Set Site URL to `https://letsrideapp.vercel.app`.** It is `http://localhost:3000`.
9. **Add `https://letsrideapp.vercel.app/**` and
   `https://letsrideapp-*-pedro-projects1.vercel.app/**` to the redirect allowlist.** Only
   `http://localhost:3000` is on it, so both the production origin and every preview URL are
   discarded and replaced by the Site URL.

Until both are done, **every emailed link the app sends — signup confirmation and password
recovery alike — lands a rider's phone on `http://localhost:3000`.** No error is shown to
anyone; the deploy is green and the account is real. This is not the DEV split, it predates it,
and item 4's "narrow PROD's redirect allowlist" was written on the assumption that the list was
too *wide*. It is empty of anything usable.

Then, in a session: apply the chain to DEV, run `npm run db:drift` to prove the three agree,
seed it, and move the two `@letsride.test` fixtures off production.
