#!/usr/bin/env node
/**
 * Reads the last 24h of failed Supabase requests for a project.
 *
 * WHY THIS EXISTS. The app is a client-rendered bundle talking to Supabase
 * directly, so every read and write a rider makes is an HTTP request that
 * Supabase logs — and a broken screen usually shows up here as a 4xx or 5xx
 * before anyone reports it. On 2026-08-27 the club Discussions→Threads rename
 * (PD-313) left 64 404s against `club_discussions` in this stream: `082`
 * applied to DEV at 15:26Z and merged at 16:16Z, so for those ~50 minutes the
 * schema was ahead of the Preview still calling the old relation. Nothing
 * alerted. They were found the same afternoon, by accident, while answering an
 * unrelated question — which is the part this script exists to fix. (DEV has no
 * riders, so the cost was a broken Preview rather than an outage. On PROD the
 * same window is rider-visible.)
 *
 * THE EXPIRY IS THE POINT. Free-tier log retention is about a day and the API
 * caps any single query at a 24-hour window, so a day nobody runs this is a day
 * that cannot be recovered later. `.github/workflows/log-digest.yml` (PD-352)
 * is what stops that being a habit nobody keeps; run it by hand too, at the
 * start of a session and after every promotion.
 *
 * WHAT IT CANNOT SEE, and it is the bigger half: nothing here is a client-side
 * JavaScript error. A component that throws renders `error.tsx`, logs to the
 * rider's own console, and leaves no trace on any server. Every row this prints
 * is a network call. Sentry (PD-315) is the other half; see
 * docs/reference/observability.md.
 *
 * NOT ALL 4xx ARE DEFECTS, and this is why `--ci` classifies rather than
 * counting. A 401 on `has_password_reset_grant` is the guard working; a 403 is
 * usually RLS refusing something correctly. Two shapes are ours: a 404 on
 * `/rest/v1/<table>` (schema ahead of the code, or behind it) and a 5xx of any
 * kind. Everything else is printed and reported, never alerted on — an alert
 * that fires on correct behaviour is one nobody reads by the second week.
 *
 * CREDENTIAL. Needs a Supabase *Management API* personal access token in
 * SUPABASE_ACCESS_TOKEN — not the publishable key, not the service-role key,
 * and not anything that belongs in the app. Generate one at
 * https://supabase.com/dashboard/account/tokens. It is an operator credential:
 * keep it in the shell or in the repository secret of the same name, never in
 * .env.local, and never in the bundle.
 *
 * VERIFICATION STATUS — the two halves of this file differ, so read both.
 *
 * The SQL below IS verified. Run against DEV (`fpmrimzxadewsaiwpsel`) and PROD
 * (`zwprydcyryvudhurbnye`) through the Supabase MCP `query_logs` tool on
 * 2026-08-31: it executes on both and returned no rows on either, which is a
 * real answer rather than a broken query — the same query without the status
 * filter returned DEV's ordinary 200s in the same sitting, so the shape below
 * is measured, not assumed:
 *
 *     {"result":[{"n":571,"path":"/storage/v1/object/sign/media","status":200}],"error":null}
 *
 * The HTTP transport here is still NOT verified, and NO SESSION CAN VERIFY IT,
 * which is the reason not to spend an afternoon on it. `api.supabase.com:443` is a
 * policy denial at the agent proxy: the gateway answers 403 to CONNECT, so
 * `fetch` reports the uninformative "fetch failed" and curl reports status 000.
 * Re-derive rather than trusting this line, because a network policy is exactly
 * the kind of thing that changes without telling anyone:
 *
 *     curl -sS "$HTTPS_PROXY/__agentproxy/status"   # recentRelayFailures
 *
 * A GitHub Actions runner has no such restriction, so
 * `.github/workflows/log-digest.yml` is not merely the schedule — it is the
 * only environment that can execute this file at all. Its first run is the
 * transport test, and `workflow_dispatch` exists so that run can be triggered
 * deliberately rather than waited for.
 *
 * What the envelope sighting DID settle is `result` as the key and `error` as
 * its sibling, which is why `parseRows` reads exactly those and throws on
 * anything else.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors           # DEV
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors -- --prod
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors -- --ci
 *
 * THREE EXIT CODES, because "the monitor is broken" and "something is broken"
 * are different news and a single non-zero cannot tell them apart. A missing
 * token, a dead transport and an unreadable envelope are all states where this
 * script knows NOTHING about the projects — reporting them the same way as a
 * PROD 5xx is how the alert stops being read:
 *
 *   0  ran, and nothing in the window is ours
 *   1  ran, and there is a 5xx or a /rest/v1/ 404 to look at
 *   2  could not run — no token, no transport, or an envelope it cannot read
 *
 * Under `--ci` the reason is written to $GITHUB_STEP_SUMMARY in every one of the
 * three cases, including 2. Without that a broken run is a red job with an EMPTY
 * summary, which is the least legible way to say "I did not look".
 *
 * Behind the agent proxy, prefix with NODE_USE_ENV_PROXY=1.
 */

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PROJECTS = {
  dev: { ref: 'fpmrimzxadewsaiwpsel', label: 'letsride-dev (DEV)' },
  prod: { ref: 'zwprydcyryvudhurbnye', label: 'letsride (PRODUCTION)' },
}

// `log_attributes` values are strings, so the status has to be cast before it
// is compared: `>= '400'` is a lexicographic comparison that happens to be
// right for three-digit codes and is silently wrong for anything else.
const SQL = `
select toInt32OrZero(log_attributes['response.status_code']) as status,
       log_attributes['request.path'] as path,
       count(*) as n
from logs
where source = 'edge_logs'
  and toInt32OrZero(log_attributes['response.status_code']) >= 400
group by status, path
order by n desc
limit 50
`.trim()

// PostgREST serves every table read and write the app makes. A 404 here is not
// a missing row — PostgREST answers those 200 with an empty array — it is a
// missing *relation*, which means the deployed bundle and the schema disagree.
const REST_SEGMENT = '/rest/v1/'

const isServerError = (row) => Number(row.status) >= 500

// `includes` rather than `startsWith`, and the difference is a silent miss of
// the exact case this exists to catch. Whether `request.path` arrives relative
// (`/rest/v1/rides`) or absolute (`https://<ref>.supabase.co/rest/v1/rides`) is
// UNOBSERVED for a 4xx: the filtered query returned no rows on either project,
// so the one measured row is a 200 from the unfiltered query. Anchored to the
// start, an absolute path would classify PD-313's 404s as unremarkable and the
// digest would stay green through the outage it was built for. No path that is
// not PostgREST contains this substring, so the looser test costs no false
// positives.
const isSchemaMismatch = (row) =>
  Number(row.status) === 404 && String(row.path ?? '').includes(REST_SEGMENT)

/**
 * Pull the rows out of the Management API envelope, or throw.
 *
 * THROWING IS THE WHOLE POINT, and the previous `payload.result ?? payload.data
 * ?? []` is the reason this function exists. An unrecognised envelope fell
 * through that to an empty array, which this script prints as "Nothing failed"
 * — so a renamed key, an error object, or an auth failure that still answers
 * 200 would report a clean day, for ever, in the one tool whose entire job is
 * noticing that something broke. A monitor that fails closed is useless; a
 * monitor that fails OPEN and says everything is fine is worse than none,
 * because it is trusted.
 *
 * `{ result: [] }` is different and must stay different: that is the API saying
 * the window genuinely holds no failures, which on a quiet day is the correct
 * and common answer.
 */
export function parseRows(payload) {
  if (payload && payload.error != null) {
    throw new Error(`The logs API returned an error: ${JSON.stringify(payload.error)}`)
  }
  const rows = payload?.result ?? payload?.data
  if (!Array.isArray(rows)) {
    throw new Error(
      'Unrecognised response envelope — expected `result` (or `data`) to be an array. ' +
        `Got keys: ${payload && typeof payload === 'object' ? Object.keys(payload).join(', ') || '(none)' : typeof payload}. ` +
        'Fix the key here rather than letting it read as a clean day.',
    )
  }
  return rows
}

/**
 * Split the rows into the two shapes that are ours and everything else.
 *
 * The split is what keeps the alert credible: `other` holds the 401s and 403s
 * that are guards working correctly, and they are always reported and never
 * alerted on.
 */
export function classify(rows) {
  return {
    serverErrors: rows.filter(isServerError),
    schemaMismatch: rows.filter(isSchemaMismatch),
    other: rows.filter((row) => !isServerError(row) && !isSchemaMismatch(row)),
  }
}

export function isAlerting({ serverErrors, schemaMismatch }) {
  return serverErrors.length > 0 || schemaMismatch.length > 0
}

/**
 * Make a logged path safe to publish in a job summary.
 *
 * A GitHub job summary is readable by anyone with repo read access and is kept
 * for 90 days — far longer than the ~24h window it describes — so anything that
 * lands in one has effectively been published. Two things follow:
 *
 * A QUERY STRING IS NEVER PRINTED. `/auth/v1/verify?token=...` and a signed
 * Storage URL both carry a live rider credential in the query, and a 4xx on
 * either is exactly the row this digest would report. GitHub's secret masking
 * cannot help: these are not registered secrets. Whether `request.path` ever
 * includes the query is unobserved, which is the reason to strip it now rather
 * than to find out from a summary that already published one.
 *
 * The pipe and backtick escaping is only cosmetic — an unescaped pipe breaks
 * the markdown table it sits in.
 */
export function sanitisePath(path) {
  return String(path ?? '')
    .split('?')[0]
    .split('#')[0]
    .replaceAll('|', '\\|')
    .replaceAll('`', "'")
}

/** One markdown table for the GitHub job summary. */
export function formatSummary(label, rows, classified) {
  const lines = [`## ${label}`, '']
  if (rows.length === 0) {
    lines.push('No 4xx or 5xx in the last 24 hours.', '')
    return lines.join('\n')
  }
  if (isAlerting(classified)) {
    lines.push(
      `**${classified.serverErrors.length} path(s) returned 5xx** and ` +
        `**${classified.schemaMismatch.length} returned 404 under \`${REST_SEGMENT}\`**.`,
      '',
    )
  } else {
    lines.push('Failures present, none of them alerting (see the script header).', '')
  }
  lines.push('| n | status | path |', '| --: | --- | --- |')
  for (const row of rows) {
    lines.push(`| ${row.n} | ${row.status} | \`${sanitisePath(row.path)}\` |`)
  }
  lines.push('')
  return lines.join('\n')
}

// Set once `--ci` is known, so `fail` can write the summary a red run owes.
let ciMode = false

/**
 * The monitor could not run. Exit 2, never 1.
 *
 * Exit 1 means "I looked and found something". Everything routed here means "I
 * did not look" — no token, no transport, an envelope I cannot read. Collapsing
 * the two is what turns a missing repository secret into four red jobs a day
 * that look exactly like a production 5xx, and an alert that cries wolf on
 * day one is the failure this whole design argues against.
 */
function fail(message) {
  console.error(`\n  ${message}\n`)
  writeSummary(`## Digest did not run\n\n${message}\n\nThis is exit 2 — the monitor could not read the window, which is NOT the same as a clean day and NOT the same as an alert.\n`)
  process.exit(2)
}

function writeSummary(markdown) {
  if (ciMode && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  }
}

async function main() {
  // Before the token check, so a missing token still writes its reason out.
  ciMode = process.argv.includes('--ci')

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

  const project = process.argv.includes('--prod') ? PROJECTS.prod : PROJECTS.dev

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

  let rows
  try {
    rows = parseRows(await response.json())
  } catch (error) {
    fail(error.message)
  }

  console.log(`\n  Failed requests, last 24h — ${project.label}`)
  console.log(`  ${start.toISOString()} → ${end.toISOString()}\n`)

  const classified = classify(rows)

  if (rows.length === 0) {
    console.log('  Nothing failed. That is a real answer, not an empty result:')
    console.log('  this window genuinely holds no 4xx or 5xx.\n')
  } else {
    const width = Math.max(...rows.map((r) => String(r.path ?? '').length), 4)
    console.log(`  ${'n'.padStart(6)}  ${'status'.padEnd(6)}  path`)
    console.log(`  ${'-'.repeat(6)}  ${'-'.repeat(6)}  ${'-'.repeat(Math.min(width, 60))}`)
    for (const row of rows) {
      console.log(
        `  ${String(row.n).padStart(6)}  ${String(row.status).padEnd(6)}  ${row.path}`,
      )
    }

    console.log('')
    if (classified.serverErrors.length > 0) {
      console.log(
        `  ${classified.serverErrors.length} path(s) returned 5xx — these are ours, always.`,
      )
    }
    if (classified.schemaMismatch.length > 0) {
      console.log(
        `  ${classified.schemaMismatch.length} path(s) returned 404 under ${REST_SEGMENT} — the\n` +
          '  schema and the deployed code disagree. Check the migration/deploy order.',
      )
    }
    console.log('')
  }

  writeSummary(formatSummary(project.label, rows, classified))

  // `exitCode` rather than `exit()`: on a runner stdout is a pipe, and
  // `process.exit()` does not flush pending async writes to one — so the table
  // printed above can be truncated, partially, silently, and only in CI. Letting
  // the module end flushes it.
  //
  // Silence when there is nothing is the requirement, so a non-alerting run is 0
  // and the scheduled job stays green with its detail in the summary.
  process.exitCode = ciMode && isAlerting(classified) ? 1 : 0
}

// Only when invoked directly, so the pure helpers above can be imported and
// pinned by a test without this file reading the environment, making a network
// call, or calling process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
