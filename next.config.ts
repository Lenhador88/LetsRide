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

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
