import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The Geoapify key exists in the secret store of the two Edge Functions that
 * call the vendor — `resolve-ride-location/` and `search-places/` — and nowhere
 * this repo can reach. One key, one vendor, one place to rotate it.
 *
 * `specs/ride-map-tiles/spec.md` — *The vendor SHALL NOT be contacted from a
 * rider's device* — makes this one decision answering four problems: the key
 * cannot leak from a bundle it is not in, a rider's IP is never disclosed to the
 * vendor, the per-view cost becomes a per-ride cost, and the tile is readable
 * offline because it is an object we host. All four collapse the moment a key or
 * a vendor hostname reaches `src/`.
 *
 * **Deliberately the same shape as `no-service-role-key.test.ts`**, which the
 * spec names as the pattern to copy, rather than a second idea about how to scan
 * for a credential. Read that file's header for the reasoning that applies to
 * both; what follows is only what differs.
 *
 * ---------------------------------------------------------------------------
 * Two rules, not one, and the second is the one a key scanner would miss
 * ---------------------------------------------------------------------------
 * A service-role key has a recognisable format. **A Geoapify key is 32
 * characters of lowercase hex**, which is indistinguishable from a dashless uuid,
 * an MD5 or a git blob — so a scanner keyed on the *format alone* either misses
 * real keys or drowns in false positives. Both rules below are therefore keyed on
 * **context**:
 *
 *   1. **No key.** A 32-hex literal sitting next to something calling itself an
 *      api key, in a URL query, or in a `NEXT_PUBLIC_*` name.
 *   2. **No vendor hostname.** `geoapify.com` must not appear in the bundle at
 *      all — not in a `src`, an `href`, a `srcset` or a CSS URL. This is the
 *      spec's own wording and it is the stronger rule, because a key is only the
 *      *credential*: an unauthenticated tile URL in the bundle still discloses
 *      every rider's IP to the vendor on every scroll, still breaks offline, and
 *      still puts a third party's uptime under the rides list.
 *
 * **It is the hostname and not the word, and the difference is deliberate.**
 * `src/app/legal/privacy/page.tsx` names Geoapify in prose, and it is *required*
 * to: the spec obliges the privacy policy to name the processor before real
 * riders geocode real addresses, since `meeting_point` is frequently a home
 * address. A rule keyed on the word would forbid the one page that has to carry
 * it — which is the shape of guard that gets deleted rather than fixed.
 *
 * Rule 2 is scoped to files that ship. **Two** test files —
 * `ride-geocode-gates.test.ts` and `place-search-shape.test.ts` — assert the
 * *outbound request* an Edge Function builds and so must name the host; neither
 * is in the bundle, and excluding them is what keeps rule 2 absolute for
 * everything that is. The count assertion below is what stops that exclusion
 * quietly growing to cover the app.
 *
 * Comment lines are stripped before either rule runs, for the reason `CLAUDE.md`
 * gives four times over: a file's description of what it must not contain looks
 * exactly like the thing it must not contain. And the filter is verified **both
 * ways** — that it reads zero now, and that it still catches a real instance,
 * which is the last test in this file. Without that half, a detector that has
 * quietly stopped matching passes for ever and looks exactly like a clean repo.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

/** This file legitimately contains every pattern it hunts for. */
const SELF = path.resolve(here, 'no-geoapify-key.test.ts')

/**
 * The only files allowed to name the vendor inside `src/`, because each asserts
 * the request an Edge Function builds and cannot do that without naming the
 * host. Neither ships in any bundle.
 *
 * **Each entry buys exactly one thing: the right to assert an outbound URL.**
 * That is the whole test for whether a file belongs here — not "it is a test
 * file", which would readmit the rule's own loophole by the back door.
 */
const VENDOR_HOSTNAME_EXEMPT = new Set([
  path.resolve(here, 'ride-geocode-gates.test.ts'),
  path.resolve(here, 'place-search-shape.test.ts'),
])

const SCANNED_DIRS = ['src', 'scripts']
const SCANNED_FILES = ['.env.local.example', 'vercel.json', 'next.config.ts']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage'])

const FUNCTION_DIR = path.join(repoRoot, 'supabase/functions/resolve-ride-location')

/**
 * `search-places` (PD-273) — the typeahead proxy. Same vendor, same key, same
 * split, so the same two assertions apply to it: the wiring reads the key from
 * the environment and inlines none, and the pure half holds none at all.
 *
 * **The directory is named rather than globbed on purpose.** A glob over
 * `supabase/functions/` would silently cover a future function and silently
 * cover nothing if one were renamed — and "silently cover nothing" is the
 * failure this whole file exists to make impossible. Adding a function here is
 * two lines and a deliberate act.
 */
const SEARCH_FUNCTION_DIR = path.join(repoRoot, 'supabase/functions/search-places')

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/**
 * Strip whole-line comments in every syntax this repo commits. Conservative on
 * purpose — only lines that are ENTIRELY a comment go, so hiding a key behind a
 * trailing `// note` does not work.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (t === '') return false
      return !(
        t.startsWith('//') ||
        t.startsWith('#') ||
        t.startsWith('--') ||
        t.startsWith('*') ||
        t.startsWith('/*') ||
        t.startsWith('{/*')
      )
    })
    .join('\n')
}

/** 32 lowercase hex characters — the vendor's key format. */
const KEY = '[0-9a-f]{32}'

function findViolations(
  source: string,
  { allowVendorHostname = false }: { allowVendorHostname?: boolean } = {},
): string[] {
  const found: string[] = []
  const code = stripCommentLines(source)

  // A key literal beside something naming itself a key: `apiKey: '…'`,
  // `api_key = "…"`, `GEOAPIFY_API_KEY='…'`.
  if (new RegExp(`api_?key['"]?\\s*[=:]\\s*['"\`]?${KEY}`, 'i').test(code)) {
    found.push('an api key literal')
  }

  // The same key in a URL query string, which is how this vendor takes it.
  if (new RegExp(`[?&]api_?key=${KEY}`, 'i').test(code)) {
    found.push('an api key in a URL')
  }

  if (/NEXT_PUBLIC_[A-Z_]*GEOAPIFY/.test(code)) {
    found.push('a NEXT_PUBLIC_ Geoapify variable')
  }

  // The env var name itself. It may exist in the Edge Function and nowhere else;
  // in `src/` it means app code is reaching for the secret.
  if (/GEOAPIFY_API_KEY/.test(code)) found.push('the GEOAPIFY_API_KEY variable')

  if (!allowVendorHostname && /geoapify\.com/i.test(code)) {
    found.push('a vendor hostname')
  }

  return found
}

describe('the Geoapify key and the vendor never reach the app', () => {
  const targets = [
    ...SCANNED_DIRS.flatMap((d) => walk(path.join(repoRoot, d))),
    ...SCANNED_FILES.map((f) => path.join(repoRoot, f)),
  ].filter((f) => existsSync(f) && f !== SELF)

  it('scans a non-trivial number of files, so a broken walk fails loudly', () => {
    // Without this, a bad path makes every assertion below pass over an empty
    // list — a guard reporting success having checked nothing at all.
    expect(targets.length).toBeGreaterThan(50)
  })

  it('exempts exactly the two URL-asserting test files, and nothing else', () => {
    // The exemption is what lets rule 2 stay absolute everywhere else, so its
    // SIZE is the thing worth pinning — an exemption list that grows quietly
    // ends up covering the app, and every entry still passes its own assertion.
    //
    // **One -> two on 2026-08-19 (PD-273).** `place-search-shape.test.ts`
    // asserts the typeahead proxy's outbound URL, which is the same claim on
    // the same host for the same reason as `ride-geocode-gates.test.ts`. A
    // third entry needs a reason written here, not just a path added above.
    expect(VENDOR_HOSTNAME_EXEMPT.size).toBe(2)
    for (const file of VENDOR_HOSTNAME_EXEMPT) expect(existsSync(file)).toBe(true)
  })

  it.each(targets.map((f) => [path.relative(repoRoot, f), f]))(
    '%s names no Geoapify credential and no vendor host',
    (_label, file) => {
      let source: string
      try {
        source = readFileSync(file, 'utf8')
      } catch {
        return // binary or unreadable; nothing to scan
      }
      expect(
        findViolations(source, { allowVendorHostname: VENDOR_HOSTNAME_EXEMPT.has(file) }),
      ).toEqual([])
    },
  )

  it('the Edge Function reads the key from its environment and inlines none', () => {
    const index = path.join(FUNCTION_DIR, 'index.ts')
    expect(existsSync(index)).toBe(true)
    const source = readFileSync(index, 'utf8')

    expect(source).toMatch(/Deno\.env\.get\('GEOAPIFY_API_KEY'\)/)

    const code = stripCommentLines(source)
    expect(new RegExp(`['"\`]${KEY}['"\`]`).test(code)).toBe(false)
    expect(new RegExp(`[?&]api_?key=${KEY}`, 'i').test(code)).toBe(false)
  })

  it('the search proxy reads the key from its environment and inlines none', () => {
    const index = path.join(SEARCH_FUNCTION_DIR, 'index.ts')
    expect(existsSync(index)).toBe(true)
    const source = readFileSync(index, 'utf8')

    expect(source).toMatch(/Deno\.env\.get\('GEOAPIFY_API_KEY'\)/)

    const code = stripCommentLines(source)
    expect(new RegExp(`['"\`]${KEY}['"\`]`).test(code)).toBe(false)
    expect(new RegExp(`[?&]api_?key=${KEY}`, 'i').test(code)).toBe(false)
  })

  it("the search proxy's pure half builds both URLs but carries no key of its own", () => {
    const shape = path.join(SEARCH_FUNCTION_DIR, 'shape.ts')
    expect(existsSync(shape)).toBe(true)
    const code = stripCommentLines(readFileSync(shape, 'utf8'))

    expect(new RegExp(`['"\`]${KEY}['"\`]`).test(code)).toBe(false)
    expect(code).not.toMatch(/Deno\.env/)
  })

  it('the search proxy takes no user id from the request body', () => {
    // Rule 2, and the reason it is asserted rather than trusted: the subject
    // comes from the verified JWT, and "we check the id matches the caller" is
    // one refactor away from not doing that. `parseRequest` has no field for a
    // user id at all, and the insert reads `user.id` off the verified session.
    const shape = stripCommentLines(readFileSync(path.join(SEARCH_FUNCTION_DIR, 'shape.ts'), 'utf8'))
    const index = stripCommentLines(readFileSync(path.join(SEARCH_FUNCTION_DIR, 'index.ts'), 'utf8'))

    for (const forbidden of ['user_id', 'userId', 'uid', 'subject']) {
      expect(shape).not.toMatch(new RegExp(`raw[?.\\[]+['"]?${forbidden}`))
    }
    expect(index).toMatch(/user_id: user\.id/)
  })

  it('the pure half builds the URL but carries no key of its own', () => {
    const gates = path.join(FUNCTION_DIR, 'gates.ts')
    expect(existsSync(gates)).toBe(true)
    const code = stripCommentLines(readFileSync(gates, 'utf8'))

    // The key arrives as an argument. Nothing in this file may hold one.
    expect(new RegExp(`['"\`]${KEY}['"\`]`).test(code)).toBe(false)
    expect(code).not.toMatch(/Deno\.env/)
  })

  it('takes only a ride id from the request body', () => {
    // The spec: no organizer id, club id or uid from the request body. The
    // subject comes from the verified JWT and entitlement is then decided by
    // reading the ride under the caller's own RLS. Asserted rather than trusted,
    // because "we check the id matches the caller" is one refactor away from not
    // doing that.
    const code = stripCommentLines(readFileSync(path.join(FUNCTION_DIR, 'index.ts'), 'utf8'))

    for (const forbidden of ['organizer_id', 'club_id', 'user_id', 'uid']) {
      expect(code).not.toMatch(new RegExp(`body[?.\\[]+['"]?${forbidden}`))
    }
    expect(code).toMatch(/body\?\.rideId/)
    expect(code).not.toMatch(/searchParams/)
  })

  /**
   * The other half of the filter check. A detector that has quietly stopped
   * matching anything passes every assertion above, for ever, and looks exactly
   * like a clean repo. These are the real formats, not approximations.
   */
  it('the detector catches a real key and a real vendor reference', () => {
    const realShapedKey = '0123456789abcdef0123456789abcdef'

    expect(findViolations(`const apiKey = '${realShapedKey}'`)).toContain(
      'an api key literal',
    )
    expect(findViolations(`fetch('https://example.test/x?apiKey=${realShapedKey}')`)).toContain(
      'an api key in a URL',
    )
    expect(findViolations('NEXT_PUBLIC_GEOAPIFY_KEY=x')).toContain(
      'a NEXT_PUBLIC_ Geoapify variable',
    )
    expect(findViolations("Deno.env.get('GEOAPIFY_API_KEY')")).toContain(
      'the GEOAPIFY_API_KEY variable',
    )
    expect(findViolations("const host = 'https://maps.geoapify.com/v1/staticmap'")).toContain(
      'a vendor hostname',
    )

    // Naming the processor in prose is not a finding, and must not become one:
    // the privacy policy is obliged to do exactly that.
    expect(findViolations('We send the meeting point to Geoapify, a processor.')).toEqual([])

    // The hostname exemption really does only lift the hostname rule.
    expect(
      findViolations(`const u = 'https://maps.geoapify.com/v1/staticmap?apiKey=${realShapedKey}'`, {
        allowVendorHostname: true,
      }),
    ).toEqual(['an api key literal', 'an api key in a URL'])

    // And the comment strip works: the same key in a comment is not a finding.
    expect(findViolations(`// never put apiKey = '${realShapedKey}' here`)).toEqual([])
    expect(findViolations('const ok = "a static map tile"')).toEqual([])
  })
})
