/**
 * Three-way migration drift check: the files in `supabase/migrations/`, against
 * what DEV has applied, against what PROD has applied.
 *
 * ## Why this exists
 *
 * With one database, "is the schema right?" was one `list_migrations` call and a
 * human comparing it to `ls`. `CLAUDE.md` records that line being wrong in both
 * directions more than once — it said `001`–`010` for a day after `011` landed,
 * and a session obeying *Unapplied migrations are drift* would have re-run `011`
 * against tables that already existed.
 *
 * With two databases there are three things to keep in agreement rather than
 * two, and the failure modes are not equally bad:
 *
 *   * **DEV behind PROD** — DEV is a false negative. You test against a schema
 *     that is not production's, and everything passes.
 *   * **PROD behind DEV** — the outage. Code ships expecting columns that do not
 *     exist.
 *   * **Applied but no file** — someone ran SQL by hand. The chain no longer
 *     reproduces either database, so `run.sh` is asserting against a fiction.
 *
 * ## The two traps this encodes, both measured rather than assumed
 *
 * **1. Never compare by `version`, or by ordering.** The recorded version is a
 * timestamp of *when it was applied*, not the filename prefix. PROD's first five
 * rows are `initial_schema` (001), then `fix_visibility_policies` (004),
 * `harden_security_definer_functions` (005), `revoke_handle_new_user_execute`
 * (006), `revoke_anon_access` (007) — because `004`–`007` reached the database
 * before `002` did, which is the whole reason `008` exists.
 *
 * A fresh DEV built by replaying files in filename order will record versions in
 * *filename* order. So the two databases will hold the same migrations under
 * permanently different version numbers, and any check that diffs versions or
 * compares ordering screams about a difference that is not one. After the third
 * false alarm nobody reads the output. **Compare the set of names.**
 *
 * **2. The recorded `name` is not consistently formatted.** Measured against
 * PROD on 2026-08-06: 29 of 32 rows carry the bare name (`initial_schema`),
 * but three carry the numeric prefix too — `003_onboarding`,
 * `009_postcards_and_blocks`, `010_postcard_storage`. Whoever applied those
 * passed the filename where the others passed the descriptive half. So both
 * sides are normalised by stripping `.sql` and a leading `\d+_`, and a check
 * that skips this reports three phantom drifts against a perfectly correct
 * database.
 *
 * ## Connecting
 *
 * `psql`, not a Postgres client library. `npm test` already requires psql, so
 * this adds no dependency — §Technology Decisions asks for a thirty-line helper
 * before a new package, and this is that.
 *
 *   PROD_DATABASE_URL=postgresql://... DEV_DATABASE_URL=postgresql://... \
 *     npm run db:drift
 *
 * Either may be omitted; that column is then reported as `--` rather than
 * failing. Running it with neither checks nothing and says so.
 *
 * Exits non-zero on any drift, so it can gate a deploy step.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations')

/**
 * Strip the extension and any leading numeric prefix, so `014_profile_media.sql`
 * from disk and `profile_media` from the database compare equal — and so do the
 * three rows that recorded the prefix. See trap 2 in the header.
 */
function normalise(name) {
  return name.replace(/\.sql$/i, '').replace(/^\d+_/, '')
}

function fileMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, key: normalise(f) }))
}

/**
 * Returns the applied set, or null when the URL was not supplied.
 *
 * A fresh project has no `supabase_migrations` schema at all, which is a
 * legitimate state — an empty DEV before its first apply — not an error. It is
 * reported as an empty set so the table renders the whole chain as missing,
 * which is exactly what it is.
 */
function appliedMigrations(url, label) {
  if (!url) return null

  const sql = `select coalesce(
    (select string_agg(name, e'\\n' order by version)
     from supabase_migrations.schema_migrations), '')
    where to_regclass('supabase_migrations.schema_migrations') is not null;`

  let out
  try {
    out = execFileSync('psql', [url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const detail = (err.stderr || err.message || '').trim().split('\n').pop()
    console.error(`\n  Could not read ${label}: ${detail}`)
    console.error('  Check the connection string, and that this host can reach the database.')
    process.exit(2)
  }

  return new Set(
    out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalise)
  )
}

const prod = appliedMigrations(process.env.PROD_DATABASE_URL, 'PROD')
const dev = appliedMigrations(process.env.DEV_DATABASE_URL, 'DEV')

if (!prod && !dev) {
  console.error('Set PROD_DATABASE_URL and/or DEV_DATABASE_URL. Nothing to compare.')
  process.exit(2)
}

const files = fileMigrations()
const fileKeys = new Set(files.map((m) => m.key))

// Applied-but-no-file is the case a files-driven loop cannot see, so the row set
// is the union rather than the file list.
const everyKey = [...new Set([...fileKeys, ...(dev ?? []), ...(prod ?? [])])].sort()

const mark = (set, key) => (set === null ? '--' : set.has(key) ? 'yes' : 'NO')
const width = Math.max(24, ...everyKey.map((k) => k.length))

console.log()
console.log(`  ${'migration'.padEnd(width)}  file   DEV    PROD`)
console.log(`  ${'-'.repeat(width)}  ----   ---    ----`)

const problems = []

for (const key of everyKey) {
  const inFile = fileKeys.has(key)
  const row = [
    inFile ? 'yes' : 'NO',
    mark(dev, key),
    mark(prod, key),
  ]
  const clean = row.every((c) => c === 'yes' || c === '--')
  console.log(`  ${key.padEnd(width)}  ${row.map((c) => c.padEnd(6)).join('').trimEnd()}${clean ? '' : '   <-'}`)

  if (!inFile) {
    problems.push(`${key}: applied to a database but has no file. The chain no longer reproduces it.`)
    continue
  }
  if (prod && !prod.has(key)) problems.push(`${key}: in the repo, not applied to PROD.`)
  if (dev && !dev.has(key)) problems.push(`${key}: in the repo, not applied to DEV.`)
}

console.log()
console.log(
  `  ${files.length} file(s)` +
    (dev ? `, ${dev.size} applied to DEV` : '') +
    (prod ? `, ${prod.size} applied to PROD` : '')
)

if (problems.length === 0) {
  console.log('\n  No drift.\n')
  process.exit(0)
}

console.log('\n  DRIFT:')
for (const p of problems) console.log(`    - ${p}`)

// Named explicitly because the two directions need opposite responses, and the
// wrong one is expensive: applying a missing migration to PROD to "catch it up"
// is correct only if its code has already deployed. See docs/ENVIRONMENTS.md.
if (prod && dev) {
  const prodBehind = [...dev].filter((k) => !prod.has(k) && fileKeys.has(k))
  const devBehind = [...prod].filter((k) => !dev.has(k) && fileKeys.has(k))
  if (prodBehind.length) {
    console.log(`\n  PROD is behind DEV by ${prodBehind.length}. Check whether the code that needs`)
    console.log('  them has deployed before applying — an additive migration goes first, a')
    console.log('  destructive one goes after.')
  }
  if (devBehind.length) {
    console.log(`\n  DEV is behind PROD by ${devBehind.length}. DEV is a false negative until this`)
    console.log('  is fixed: it is testing against a schema production does not have.')
  }
}

console.log()
process.exit(1)
