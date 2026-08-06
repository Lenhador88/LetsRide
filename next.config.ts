import type { NextConfig } from "next";

/**
 * Fail the build when a `NEXT_PUBLIC_SUPABASE_*` variable is missing.
 *
 * **This has to live here, because nothing else in the app can catch it.** The
 * obvious place is `lib/supabase/client.ts`, and it does guard there — but that
 * guard can only ever fire in the browser: `createClient()` is called from an
 * effect or an event handler and never during render (CLAUDE.md §Read in an
 * effect), so the prerender pass never reaches it. Measured 2026-08-06 by
 * building with the key unset: `next build` compiles, prerenders all 22 static
 * pages and exits **0**. The deployment then goes green and every screen fails
 * in the browser with supabase-js's `supabaseKey is required`, from inside a
 * dependency, naming neither the variable nor the environment.
 *
 * A green deploy of a completely broken app is the worst of the available
 * failures, and it is reachable by one wrong checkbox: splitting the Vercel
 * variables between the PROD and DEV projects briefly left Preview holding the
 * URL and not the key, which is exactly this.
 *
 * Both are `NEXT_PUBLIC_*` and therefore inlined at build time, so build time
 * is also the only honest place to assert them — a build carries whichever
 * values it was built with, permanently (docs/ENVIRONMENTS.md §Never use
 * Vercel's promote or instant-rollback to cross the boundary).
 */
const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const

const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name])

if (missingEnv.length > 0) {
  throw new Error(
    `Missing required environment ${missingEnv.length === 1 ? 'variable' : 'variables'}: ` +
      `${missingEnv.join(', ')}.\n\n` +
      'Both must be set for every environment the app builds in. On Vercel that ' +
      'is Production, Preview and Development — and a Preview variable scoped to ' +
      'a single git branch leaves every other branch without it. Locally, copy ' +
      '.env.local.example to .env.local.\n\n' +
      'See docs/ENVIRONMENTS.md.'
  )
}

/**
 * `CAPACITOR_BUILD=1` switches this build to a fully static bundle for the
 * native shell. **Anything else — including the Vercel build — must come out
 * byte-for-byte the same as it did before this flag existed**, which is why the
 * flag gates an entire config object rather than tweaking fields on a shared
 * one. `main` and `development` both auto-deploy from this repo and neither
 * sets it (docs/ENVIRONMENTS.md).
 *
 * ## Why the native build needs it at all
 *
 * Capacitor copies a directory of files into the app bundle and serves them
 * from a local scheme handler. There is no Node process in an app bundle, so
 * `ƒ (Dynamic) server-rendered on demand` has nothing to render it — those
 * seven routes are the whole reason this flag exists.
 *
 * ## Each option, and what breaks without it
 *
 * - **`output: 'export'`** — emits HTML/JS/CSS only. Measured 2026-08-06: with
 *   nothing else changed it fails at `/clubs/[id]` with *"Page is missing
 *   generateStaticParams() so it cannot be rendered"*. See
 *   `src/app/(app)/**\/[id]/layout.tsx` for how that is answered and why the
 *   answer is a placeholder rather than a real id list.
 * - **`trailingSlash: true`** — makes `/clubs` an `out/clubs/index.html`
 *   directory instead of an `out/clubs.html` sibling file. Capacitor's asset
 *   handler resolves a URL path against the filesystem, so `/clubs` finds a
 *   directory's `index.html` and never finds `clubs.html`. Without this the
 *   shell shows a blank screen on every route but `/`.
 * - **`images: { unoptimized: true }`** — `next/image` is used on six screens
 *   and its default loader is a server route. Export refuses to build without
 *   this, and there is no server in a bundle to run the optimiser.
 * - **`distDir`** — keeps the export's build cache out of `.next`, so a local
 *   `npm run build` and a local `CAPACITOR_BUILD=1` build cannot hand each other
 *   a half-static cache.
 *
 * ## `webDir` is `.next-capacitor`, not `out/` — measured, and it is a trap
 *
 * A first draft of this comment said *"`out/` is fixed by Next and is the
 * `webDir`"*. It is not. With a custom `distDir`, Next 16 writes the export into
 * **`distDir`** and never creates `out/` at all: after a clean
 * `CAPACITOR_BUILD=1` build, `ls out` is *No such file or directory* and the
 * HTML is at `.next-capacitor/postcards/placeholder/index.html`. Measured
 * 2026-08-06.
 *
 * So whoever writes `capacitor.config.ts` must set `webDir: '.next-capacitor'`.
 * Pointing it at `out/` yields an empty bundle — and an empty `webDir` fails at
 * *launch*, on a device, as a white screen, which is the most expensive place in
 * this whole epic to discover a one-word mistake. `/.next-capacitor/` is
 * gitignored alongside `/out/` for the same reason either would be.
 */
const isCapacitorBuild = process.env.CAPACITOR_BUILD === '1'

const nextConfig: NextConfig = isCapacitorBuild
  ? {
      output: 'export',
      distDir: '.next-capacitor',
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
      /* config options here */
    };

export default nextConfig;
