# LetsRide

A mobile-first app for motorcycle riders to organise rides, join clubs, and connect
with other riders.

Built with Next.js 16 (App Router), Supabase, and Tailwind CSS v4. Deployed on Vercel, and
rendered entirely client-side — every page is a client page, so it can be bundled into a
native iOS/Android build.

> **Status: early development.** Clubs and postcards work and are built from the current
> design; rides are partially built (the Journal and Chat sub-pages are not). The inbox and
> the garage are not built at all. The native shell — and with it store submission — is the
> next epic, and it still has to decide how to retire the server-render pass that 7 routes
> currently use. See `docs/HANDOFF.md` for what blocks submission.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the two values below
npm run dev
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both are safe to
expose in the browser — access control is enforced by Postgres Row Level Security, not by
hiding the key.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (needs the two env vars above) |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |
| `npm test` | RLS policy suite — needs Postgres and `psql` |

## Security model

Every table has RLS enabled, and every query runs as the requesting user. There is no
anonymous access: the `anon` role holds no table privileges, and `is_public = true` means
"visible to any signed-in rider", never "visible to the internet".

Because a wrong policy is a data leak rather than a broken page, the policy layer has its
own test suite. It applies the real migration chain to a scratch database and asserts what
each role can reach, and it runs in CI on every pull request. See
[`supabase/tests/README.md`](supabase/tests/README.md) — including what it deliberately
does *not* cover.

## Contributing

Migrations are append-only; never edit one that has been applied. A migration that changes
a policy must add an assertion to the suite.

If you are an AI agent working in this repo, read [`CLAUDE.md`](CLAUDE.md) and then
[`docs/HANDOFF.md`](docs/HANDOFF.md) before doing anything else.
