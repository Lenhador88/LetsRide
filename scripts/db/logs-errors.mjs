#!/usr/bin/env node
/**
 * Reads the last 24h of failed Supabase requests for a project.
 *
 * WHY THIS EXISTS. The app is a client-rendered bundle talking to Supabase
 * directly, so every read and write a rider makes is an HTTP request that
 * Supabase logs — and a broken screen usually shows up here as a 4xx or 5xx
 * before anyone reports it. On 2026-08-27 the club Discussions→Threads rename
 * (PD-313) left 64 404s against `club_discussions` in this stream while the
 * migration was ahead of the deploy, and nobody looked; it was found days later
 * by accident. That is the failure this script exists to make cheap.
 *
 * THE EXPIRY IS THE POINT. Free-tier log retention is about a day and the API
 * caps any single query at a 24-hour window, so a day nobody runs this is a day
 * that cannot be recovered later. Run it at the start of a session and after
 * every promotion.
 *
 * WHAT IT CANNOT SEE, and it is the bigger half: nothing here is a client-side
 * JavaScript error. A component that throws renders `error.tsx`, logs to the
 * rider's own console, and leaves no trace on any server. Every row this prints
 * is a network call. See docs/reference/observability.md.
 *
 * NOT ALL 4xx ARE DEFECTS. A 401 on `has_password_reset_grant` is the guard
 * working; a 403 is usually RLS refusing something correctly. What matters is a
 * 404 on a relation (schema ahead of code, or behind it), a 5xx of any kind,
 * and any status whose count jumps. The output groups by path so a jump is
 * visible without a baseline.
 *
 * CREDENTIAL. Needs a Supabase *Management API* personal access token in
 * SUPABASE_ACCESS_TOKEN — not the publishable key, not the service-role key,
 * and not anything that belongs in the app. Generate one at
 * https://supabase.com/dashboard/account/tokens. It is an operator credential:
 * keep it in the shell, never in .env.local, never in the bundle.
 *
 * VERIFICATION STATUS. The SQL below is verified — it was run against DEV
 * through the Supabase MCP `query_logs` tool and produced the table in this
 * script's header. The HTTP transport here is NOT verified: no management token
 * exists in the build container, so this file has never completed a live call.
 * Treat the first run as a test of the transport, not of the query.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors           # DEV
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors -- --prod
 *
 * Behind the agent proxy, prefix with NODE_USE_ENV_PROXY=1.
 */

const PROJECTS = {
  dev: { ref: 'fpmrimzxadewsaiwpsel', label: 'letsride-dev (DEV)' },
  prod: { ref: 'zwprydcyryvudhurbnye', label: 'letsride (PRODUCTION)' },
}

const SQL = `
select log_attributes['response.status_code'] as status,
       log_attributes['request.path'] as path,
       count(*) as n
from logs
where source = 'edge_logs'
  and log_attributes['response.status_code'] >= '400'
group by status, path
order by n desc
limit 50
`.trim()

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  fail(
    'SUPABASE_ACCESS_TOKEN is not set.\n\n' +
      '  This needs a Supabase Management API personal access token — the operator\n' +
      '  credential, not the publishable key and not the service-role key.\n' +
      '  Create one at https://supabase.com/dashboard/account/tokens and pass it in:\n\n' +
      '      SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors\n\n' +
      '  Without a token the same query can still be run through the Supabase MCP\n' +
      '  `query_logs` tool — see docs/reference/observability.md.',
  )
}

const wantsProd = process.argv.includes('--prod')
const project = wantsProd ? PROJECTS.prod : PROJECTS.dev

const end = new Date()
const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)

const url = new URL(
  `https://api.supabase.com/v1/projects/${project.ref}/analytics/endpoints/logs.all`,
)
url.searchParams.set('sql', SQL)
url.searchParams.set('iso_timestamp_start', start.toISOString())
url.searchParams.set('iso_timestamp_end', end.toISOString())

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
}).catch((error) => fail(`Could not reach the Management API: ${error.message}`))

if (!response.ok) {
  const body = await response.text().catch(() => '')
  fail(`Management API returned ${response.status}. ${body.slice(0, 400)}`)
}

const payload = await response.json()
const rows = payload.result ?? payload.data ?? []

console.log(`\n  Failed requests, last 24h — ${project.label}`)
console.log(`  ${start.toISOString()} → ${end.toISOString()}\n`)

if (rows.length === 0) {
  console.log('  Nothing failed. That is a real answer, not an empty result:')
  console.log('  this window genuinely holds no 4xx or 5xx.\n')
  process.exit(0)
}

const width = Math.max(...rows.map((r) => String(r.path ?? '').length), 4)
console.log(`  ${'n'.padStart(6)}  ${'status'.padEnd(6)}  path`)
console.log(`  ${'-'.repeat(6)}  ${'-'.repeat(6)}  ${'-'.repeat(Math.min(width, 60))}`)
for (const row of rows) {
  console.log(
    `  ${String(row.n).padStart(6)}  ${String(row.status).padEnd(6)}  ${row.path}`,
  )
}

const serverErrors = rows.filter((r) => Number(r.status) >= 500)
const notFound = rows.filter((r) => Number(r.status) === 404)

console.log('')
if (serverErrors.length > 0) {
  console.log(`  ${serverErrors.length} path(s) returned 5xx — these are ours, always.`)
}
if (notFound.length > 0) {
  console.log(
    `  ${notFound.length} path(s) returned 404 — on /rest/v1/<table> that means the\n` +
      '  schema and the deployed code disagree. Check the migration/deploy order.',
  )
}
console.log('')
