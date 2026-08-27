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
observability**: they render a designed fallback with a retry, and the only
thing they do with the error object is `console.error`.

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
below on a schedule rather than when something is already suspected.

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
SQL is verified against DEV; its HTTP transport is not** — no management token
exists in the build container, so the file has never completed a live call.

**Not every 4xx is a defect.** A 401 on `has_password_reset_grant` is the guard
working and a 403 is usually RLS refusing correctly. What matters is:

- **a 404 on `/rest/v1/<table>`** — the schema and the deployed code disagree,
  which is a migration/deploy ordering problem;
- **any 5xx** — always ours;
- **a count that jumps** against yesterday.

The worked example is real: the Discussions→Threads rename (PD-313) left 64
404s on `club_discussions` in this stream while `082` was ahead of its deploy.
Nothing alerted, and it was found days later by accident while answering an
unrelated question.

## The open decision: client-side error reporting

This is the part that is still undecided, and it is deliberately **not** being
decided by whoever next needs it. It carries three costs the log reading above
does not:

1. **A runtime dependency.** There are nine, deliberately, and a hosted SDK
   would be the tenth — in a bundle that also holds a JS-readable refresh token
   and ships into an app store.
2. **A consent question.** Error payloads carry URLs, user ids and sometimes
   input. Under GDPR that is not automatically "strictly necessary", and consent
   has to be separate from the T&C stamp `accept_terms()` writes.
3. **A store privacy label.** `native` owns anything gated on a review
   guideline, and an SDK collecting device identifiers changes what must be
   declared.

A first-party alternative exists and avoids all three: an Edge Function endpoint
plus a small insert-only table, in the shape of the two spend ledgers
(`place_search_attempts`, `ride_map_render_attempts`) — same RLS posture, same
retention sweep, no new dependency. It costs more to build and gives less than a
real SDK.

**Do not pick one of these in passing.** It wants a proposal that states what is
sent, what is never sent, and how long it is kept.
