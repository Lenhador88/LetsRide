# CI, read the jobs not the run

> The hand-gate to run when CI is unavailable, the runner-outage signature, and the two build
> shapes. `CLAUDE.md` §Branching & CI has the rules; this is the procedure.

## A green tick is not a check — read the jobs, not the run

**A run's `conclusion: success` says nothing about whether anything was tested.** Most of the CI
denylist reports `success` with both real jobs `skipped`, so a `design/`- or `openspec/`-only PR
goes green having tested nothing. Check the *jobs*:

```bash
# via the GitHub MCP tools — the REST API 403s from this container's shell
#   actions_list method=list_workflow_runs  resource_id=ci.yml
#   actions_list method=list_workflow_jobs  resource_id=<run id>
# A healthy code run has "Type Check, Lint & Build" with conclusion=success,
# NOT skipped, and NOT a 15-minute cancelled "Detect what changed" above it.
```

**A 15-minute `Detect what changed` cancelled with `runner_id: 0` and an empty `runner_name` is
the signature of a runner-assignment outage**, not a repo problem, and it skips both real jobs
behind it. That happened over 2026-08-06/07 and recurred *after* an apparent recovery, which is
why the runs alone are not evidence. If it returns it is an **owner action**:
<https://www.githubstatus.com>, then repo Settings → Actions and the account's Actions usage.

**The hand-gate, which is what to run when CI is unavailable:**

```bash
npm ci
npx tsc --noEmit                      # exit 0
npm run lint                          # exit 0 — 9 pre-existing <img> warnings, 0 errors
npm run test:unit                     # 3184/3184 across 119 files
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build   # exit 0, 44 static routes
node scripts/native/assert-web-build.mjs   # that build was the web app, not the bundle
PGPASSWORD=postgres npm test          # 3310 assertions, 0 failures
```

**And the second build shape, which nothing above covers** — PD-142 left the repo with two, and
exactly one of them may deploy:

```bash
# CAPACITOR_BUILD=1 next build, then the bundle check. The origin is REQUIRED here
# and the build fails without it (PD-188); the web build above needs it unset.
NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native
ls out/index.html                     # exists; .next-capacitor/ does not
npm run release:check                 # only before a store submission — see §The shell
```

**Two traps in running that, both of which produce a confident wrong answer first:**

- **`node_modules` is not in a fresh container.** `npm ci` first, or `vitest: not found` reads
  as a broken suite rather than a missing install.
- **`cmd 2>&1 | tail -5 && echo PASS` always prints PASS** — `tail` exits 0 no matter what the
  command did. Capture the exit code from the command itself, never from the end of a pipe.
- **`npm ci` can install the WRONG SWC binary for this container, and the build then fails
  somewhere that looks nothing like the cause.** Measured 2026-08-26: `npm ci` left
  `@next/swc-linux-x64-musl` and no `@next/swc-linux-x64-gnu` in a glibc container, so Next fell
  back to the wasm compiler, which compiles `next.config.ts` without resolving its extensionless
  `.ts` imports — and `npm run build` died on `Cannot find module '.../src/lib/origin-normalise'`,
  which reads exactly like somebody deleted a file. The two `⚠ Attempted to load @next/swc-...`
  lines above it are the real message.

  ```bash
  ls -d node_modules/@next/swc*        # must include swc-linux-x64-gnu on this image
  ```

  **Fix it by unpacking the tarball, NOT with `npm install --no-save`** — that re-resolves the
  whole tree and walks straight into the trap below, which is how this was found:

  ```bash
  npm pack @next/swc-linux-x64-gnu@$(node -p "require('./package.json').dependencies.next")
  mkdir -p node_modules/@next/swc-linux-x64-gnu
  tar -xzf next-swc-linux-x64-gnu-*.tgz -C node_modules/@next/swc-linux-x64-gnu --strip-components=1
  ```

- **`npm install` is not `npm ci`, and the difference fails as two red tests that are not
  yours.** `@fission-ai/openspec` is `^1.7.0` and the lock pins `1.7.0`; an `install` resolves
  `1.10.0`, whose templates differ, and `openspec-artifacts.test.ts` — the byte-compare against
  the CLI that generated `.claude/skills/` and `.claude/commands/opsx/` — fails on two files a
  session touching neither has never opened. It reads exactly like drift someone introduced.
  Measured 2026-08-24 in a container that arrived that way. `npm ci` is the fix, and CI never
  sees it because CI runs `npm ci`:

  ```bash
  node -p "require('./node_modules/@fission-ai/openspec/package.json').version"   # 1.7.0
  ```

## Edge Function currency

**Version numbers differ per project and always will** (they count deploys), so the
`ezbr_sha256` is what says the two projects agree, and equality is not currency: compare the deploy
against the file, and count the undeployed commits rather than reading a list anywhere:

```bash
ls supabase/functions/ | wc -l                                                     # what the repo has
TZ=UTC git log -1 --format=%cd --date=iso-strict-local -- supabase/functions/<name>/   # newer than the deploy = stale
TZ=UTC git log --oneline --since=<deploy timestamp> -- supabase/functions/<name>/      # by how many commits
```
```
mcp__Supabase__list_edge_functions zwprydcyryvudhurbnye   # PROD
mcp__Supabase__list_edge_functions fpmrimzxadewsaiwpsel   # DEV
# updated_at vs the commit date; status ACTIVE, verify_jwt true, ezbr_sha256 equal across the two
```
