/**
 * A plain-HTTP relay to the Supabase project, so a browser in this container
 * can reach it.
 *
 * ## Why this exists
 *
 * The render migration moved every read and write into the browser. Before it,
 * `npm run walk` proved a screen rendered because *Node* talked to Supabase —
 * the dev server held the session and issued the queries, and Node reaches the
 * outside world fine with `NODE_USE_ENV_PROXY=1`. After it, the browser is the
 * client, and **Chromium in this container cannot reach Supabase at all.**
 *
 * Measured 2026-08-06, not inherited from the docs:
 *
 * - `curl -x http://127.0.0.1:38171 https://<ref>.supabase.co/auth/v1/health`
 *   returns **401** — the agent proxy accepts the CONNECT, the tunnel opens and
 *   TLS completes. The host is allowed by policy.
 * - The same URL fetched from a Chromium page launched with
 *   `--proxy-server=$HTTPS_PROXY` **hangs until aborted**. No response, no
 *   `requestfailed`, and — the telling part — *no entry in the proxy's
 *   `recentRelayFailures`*, where a blocked host does appear (`example.com:443`
 *   → `connect_rejected`, 403). So the CONNECT is accepted and the stall is
 *   downstream of it, inside Chromium.
 * - It is not the flags: bare, `--ignore-certificate-errors`, `--disable-quic`,
 *   `--disable-http2` and the combinations all hang identically.
 *
 * This is the same environment limitation `docs/HANDOFF.md` already records for
 * `<img>` of a signed URL and for `XMLHttpRequest` to Storage ("hangs without
 * ever firing `onload` or `onerror`"). What changed is its blast radius: it used
 * to cost photos, and now it costs sign-in, so **it takes the whole walk with
 * it** — the only gate in this repo that renders anything.
 *
 * ## What this is, and what it is not
 *
 * It is a byte-for-byte forward of one origin, over a hop that works. The
 * browser talks plain HTTP to `localhost`, which it reaches directly (the dev
 * server proves it), and this process re-issues the request with Node's fetch,
 * which reaches Supabase. Method, path, query, body, status and headers all
 * survive. The **real project, real RLS, real JWTs, real Storage** — nothing is
 * stubbed, and no application code changes: the walk overrides
 * `NEXT_PUBLIC_SUPABASE_URL` for its own run and nothing else.
 *
 * It is **not** a development convenience and must never be one. It terminates
 * TLS, so it is a plaintext hop carrying access tokens; it exists to make one
 * automated check possible in one sandbox. It binds loopback only. Do not point
 * a browser you sign into personally at it, and do not deploy it anywhere.
 *
 * ## Running it
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/supabase-relay.mjs &     # :3001 by default
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NODE_USE_ENV_PROXY=1 npm run dev
 *   WALK_EMAIL=... WALK_PASSWORD=... npm run walk
 *
 * The dev server needs the same override because the URL is inlined into the
 * client bundle at build time — that is what makes the browser use it.
 */
const PORT = Number(process.env.RELAY_PORT ?? 3001)
const UPSTREAM = process.env.RELAY_UPSTREAM ?? process.env.NEXT_PUBLIC_SUPABASE_URL

if (!UPSTREAM || !UPSTREAM.startsWith('https://')) {
  console.error('Set RELAY_UPSTREAM (or NEXT_PUBLIC_SUPABASE_URL) to the https:// project URL.')
  process.exit(2)
}

const { createServer } = await import('node:http')

/**
 * Hop-by-hop headers, plus the two that would name the wrong origin.
 *
 * `host` has to go or Node sends `localhost:3001` upstream and Supabase's
 * router answers for the wrong project. `content-length` has to go because the
 * body is re-encoded and a stale length truncates it — the failure looks like a
 * malformed JWT rather than a truncated body, which is a bad half hour.
 */
const DROP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
])

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(([k]) => !DROP.has(k.toLowerCase()))
    )

    try {
      const upstream = await fetch(new URL(req.url, UPSTREAM), {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
        redirect: 'manual',
      })

      const out = Object.fromEntries(upstream.headers)
      // The browser's origin is the dev server, not this relay, so every
      // response has to be readable cross-origin. Supabase already sends `*`;
      // restating it means a preflight that never reached upstream still gets
      // an answer.
      out['access-control-allow-origin'] = '*'
      out['access-control-allow-headers'] = '*'
      out['access-control-expose-headers'] = '*'
      delete out['content-encoding']
      delete out['content-length']

      res.writeHead(upstream.status, out)
      res.end(Buffer.from(await upstream.arrayBuffer()))
    } catch (error) {
      // 502 rather than a hang. The whole reason this file exists is that a
      // silent stall is indistinguishable from a slow screen, and debugging one
      // cost this session an hour.
      console.error(`relay ${req.method} ${req.url} —`, String(error))
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'relay_failed', detail: String(error) }))
    }
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`supabase relay: http://localhost:${PORT} -> ${UPSTREAM} (loopback only)`)
})
