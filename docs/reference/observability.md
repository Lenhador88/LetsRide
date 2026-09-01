# Observability — what we can see when the app breaks

Companion to [`analytics.md`](analytics.md), which is about what riders *do*.
This one is about what *fails*, and the two were tangled together under
"analytics" on `CLAUDE.md`'s deliberately-undecided list until 2026-08-27.
They are separate decisions with separate costs, and only one of them is still
undecided.

**The short version: we see server-side and network failures for about a day,
and we see nothing at all that happens inside a rider's browser.** Since the app
is a client-rendered bundle, the second half is where most rider-visible
breakage lives.

## What we can see today

Supabase logs every request the app makes, across ten sources. Count them rather
than trusting this list — `select distinct source from logs` through the MCP
`query_logs` tool:

| Source | What it holds |
|---|---|
| `edge_logs` | every HTTP request to PostgREST, Auth, Storage and Functions — **the useful one** |
| `postgrest_logs` | PostgREST's own errors |
| `postgres_logs` | statement errors, and anything a trigger raises |
| `auth_logs`, `auth_audit_logs` | sign-in, signup, token refresh, password recovery |
| `function_logs`, `function_edge_logs` | the three Edge Functions |
| `storage_logs` | uploads and signed-URL fetches |
| `realtime_logs` | subscription connects and failures |
| `pgbouncer_logs` | pooler connections |

Vercel adds build logs and server runtime logs, but the render model makes the
second nearly empty: there is no server render path left beyond the prerender
pass, so a rider's session produces one HTML fetch and then talks to Supabase
directly for everything else.

The app also has three error boundaries — `src/app/global-error.tsx`,
`src/app/error.tsx` and `src/app/(app)/error.tsx`. They are **containment, not
observability**: they render a designed fallback with a retry, and the most any
of them does with the error object is `console.error` it into the rider's own
console.

**`global-error.tsx` does not even do that** — it has no `useEffect` and no
logging at all, and only renders `error.digest`. That is the root-layout
failure, the one case no other boundary can reach, so the gap is widest exactly
where the blast radius is largest.

## What we cannot see

- **Any client-side JavaScript error.** A `TypeError` in a component renders the
  fallback screen and is seen by nobody. It reaches no log, on any server.
- **Anything thrown outside React's render.** There is no `window.onerror` and
  no `unhandledrejection` handler, so a rejected promise in an event handler or
  an effect does not even reach a boundary.
- **Who was affected, or how often.** Nothing aggregates, so "did this happen to
  one rider or forty" has no answer at any retention.
- **The digest we print.** `error.tsx` shows the rider `Reference: <digest>`,
  which resolves to a stack trace only against a server-side log. For a
  client-side throw in a client-rendered app there is no such log, so the
  reference number is not, in practice, something we can look up.

## The 24-hour expiry

Free-tier retention is roughly a day, and the Management API caps any single
query at a 24-hour window. **A day nobody reads is permanently gone** — there is
no backfill and no archive. That is the whole argument for running the reader
below on a schedule rather than when something is already suspected, and
PD-352 built the schedule: `.github/workflows/log-digest.yml` reads both
projects at 06:00 and 18:00 UTC, plus `workflow_dispatch`.

**It is not yet producing readings, and the gap is an owner action.** The
workflow needs `SUPABASE_ACCESS_TOKEN` — a Management API personal access token
— as a repository secret. Until that exists every run exits 2 and says so in its
summary. Check rather than trust this paragraph, since the fix happens outside
the repo and nothing here changes when it does:

```
# via the GitHub MCP tools
#   actions_list method=list_workflow_runs resource_id=log-digest.yml
# A run that actually read something is conclusion=success, or a failure whose
# summary names paths rather than a missing credential.
```

**Twice daily rather than once, because the runs must overlap.** Each reads the
preceding 24 hours, so runs 12 hours apart cover every minute twice and a
skipped run loses nothing — which matters because GitHub's scheduled workflows
are best-effort and get delayed or dropped under load. On a single daily run,
every miss would be a permanent hole in the exact record this exists to keep.

**Red is two different pieces of news, and the summary is what tells them
apart.** Exit 1 means the reader looked and found something ours — a 5xx, or a
404 or **300** under `/rest/v1/`. Exit 2 means it could not look at all: no token, no
transport, an envelope it could not read. Collapsing those into one non-zero is
how a missing repository secret becomes four red jobs a day that look exactly
like a production outage, so the summary always names which happened.

Everything else is reported and never alerts, for the reason below: an alert
that fires on correct behaviour is one nobody reads by the second week.

## Reading the logs

Two ways, and the first needs no credential:

```
# In a session — the Supabase MCP tool, no setup at all
mcp__Supabase__query_logs  project_id=<ref>  sql="select ... from logs where source='edge_logs' ..."
```

```bash
# As a command — needs an operator token, see the script's header
SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors            # DEV
SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors -- --prod  # PRODUCTION
```

`scripts/db/logs-errors.mjs` carries the query and the credential rules. **Its
SQL is verified against both projects; its HTTP transport is not, and no session
can verify it** — `api.supabase.com:443` is a policy denial at the agent proxy,
which answers 403 to CONNECT, so `fetch` reports only "fetch failed" and curl
reports status 000 — which is the reason not to spend a session on it.
Re-derive rather than trusting it, since a network policy changes without
announcement:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status"   # look at recentRelayFailures
```

A GitHub Actions runner has no such restriction, so the scheduled workflow above
is not merely the clock — it is the only environment that can execute the script
at all, and its `workflow_dispatch` trigger exists so the first transport test
can be triggered deliberately rather than waited for.

**Not every 4xx is a defect.** A 401 on `has_password_reset_grant` is the guard
working and a 403 is usually RLS refusing correctly. What matters is:

- **a 404 on `/rest/v1/<table>`** — the schema and the deployed code disagree,
  which is a migration/deploy ordering problem;
- **a 300 on `/rest/v1/`** — PostgREST declining to *choose*. The measured case
  is `PGRST201`: the schema now offers an embed more than one relationship, so
  it resolves none of them and the screen behind it renders nothing. On an
  `/rest/v1/rpc/` path the same status also covers an overloaded function it
  cannot pick between — unobserved here, and unobservable today, since no
  `public` function in this schema has an overload;
- **any 5xx** — always ours;
- **a count that jumps** against yesterday.

**The 300 is why the window is not simply `>= 400`, and it was added after this
digest sat through the outage it exists for.** PD-363: `092` added an ordinary
join table, `club_members`↔`profiles` gained a second candidate relationship,
and both club lists, the club roster and the club timeline started returning
nothing — **65 rows** on `/rest/v1/clubs` and **6 more** on
`/rest/v1/club_members`, every one *below* the threshold the script was reading,
so the digest would have reported a clean day. Each number goes with its path:
a bare total loses the roster query, which is one of the four screens that
sentence says went down. The band is
named rather than widened to `>= 300`: a 304 is a cache working and a redirect
is a redirect, and an alert stays credible only while every row in it is a
question.

The worked example is real, and worth stating with its measured timeline rather
than a rounder one. The Discussions→Threads rename (PD-313) left **64 404s** on
`club_discussions` in this stream: `082` applied to DEV at 15:26Z and merged at
16:16Z, so for those **~50 minutes** the schema was ahead of the Preview still
calling the old relation. Nothing alerted. They were found the same afternoon,
by accident, while answering an unrelated question.

**DEV has no riders, so the cost there was a broken Preview rather than an
outage** — the reason to carry the example is that the same ordering mistake on
PROD is rider-visible for the length of a build, and nothing would have told us
there either.

## Client-side error reporting — DECIDED and shipped, PD-315

**Sentry**, on the Monitoring & Analytics Notion page, built 2026-09-01. This
section used to be an open decision and is kept as the record of what the
decision cost, because two of the three costs it named are now permanent
properties of the repo rather than hypotheticals:

1. **Two runtime dependencies**, not one. `@sentry/capacitor` peers an exact
   `@sentry/react` and hands it the options as its sibling `init`; the pair
   covers both build shapes, so `@sentry/nextjs` was NOT taken alongside them.
   `@sentry/capacitor` is additionally a native plugin.
2. **A store privacy label.** Still `native`'s, and PD-353's unmasked session
   replay moves it further than this does.
3. **The consent question turned out to be narrower here than it looked.** It
   lands mostly on analytics, where PD-353 built a separate opt-out stamp
   (`096`). Error reporting sends no rider content by design — see the scrub
   below — and is not behind that toggle.

The first-party alternative this section used to describe (an Edge Function plus
an insert-only table in the shape of the two spend ledgers) was not taken. It
avoided the three costs and reached neither native crashes nor the global
handlers, which is most of what the SDK is for.

### What is sent, what is never sent

`src/lib/observability/scrub.ts` is the whole answer and it strips **by shape,
not by a list of fields somebody remembered** — the fields are Sentry's to
change, and an SDK upgrade routes around a field list silently.

| | |
|---|---|
| Query strings and fragments | **Stripped, from every URL anywhere in the payload.** Every detail route carries its subject's id in `?id=`, and a Supabase REST URL carries its filters the same way. `feedback.route`'s rule (`084`) at a second surface |
| Anything JWT-shaped, and both Supabase key formats | **Redacted.** The bundle holds a JS-readable refresh token, so one can reach a message by routes nobody enumerated |
| `user.email`, `user.username`, `user.ip_address` | **Dropped.** `sendDefaultPii: false` covers what the SDK collects; the scrub covers what we set |
| `user.id` | **Sent.** The asymmetry is deliberate: ids in a URL are other riders' content on a screen the reporter merely had open, and this is the reporter's own. It is what turns "someone hit this" into "three riders did" |
| Cookies, request headers, `query_string` | **Deleted, not redacted.** A redacted key still tells a reader the request carried one |
| A failed request's body | **Never captured.** `enableCaptureFailedRequests: false`, written out rather than left to the default, because a place-search term is frequently a home address and travels in a POST body nothing else in a report can reach |
| Performance traces | **Off.** `tracesSampleRate: 0` — a different product with its own quota |
| Session replay | **Off here.** It is PostHog's (PD-353); a second recorder is a second privacy disclosure for no question the first cannot answer |

### What still cannot be seen

- **A failure to load the app's own chunks.** The reporter is in the bundle, so
  nothing in a client bundle can report it. Vercel's logs are the only witness
  on the web, and in the shell there is none.
- **Anything, on any environment without a DSN.** Unset is a clean no-op, which
  is DEV, every preview and local development. The transport is therefore
  exercised by nothing this repo gates — the assertions are about the payload's
  shape and the options asked for.

```bash
npx vitest run src/lib/observability     # the scrub, the options, the one doorway
```

### Not in PD-315

The alert → ticket automation — the Sentry webhook, `repository_dispatch` and
the headless triage run. This story ends when a throw in a rider's browser is
visible to us.

### The owner action still outstanding

The Sentry org and project, and the DSN in Vercel (Production and
Preview/Development are separate scopes) and in the native build's environment.
Until that lands the code ships and stays silent.
