/**
 * What leaves this app inside an error report, and what does not — PD-315.
 *
 * Everything here is a pure function over a plain object, deliberately: the
 * transport cannot be exercised from this container or from CI (there is no
 * DSN on DEV and Sentry is not reachable from the walk), so the *only* part of
 * this story a gate can hold is the shape of the payload. `sentry.ts` wires
 * these into `beforeSend` and `beforeBreadcrumb` and does nothing else to the
 * event, so an assertion here is an assertion about what ships.
 *
 * ## The rule these implement
 *
 * `place_search_attempts` is the discipline this repo already chose and the one
 * to copy: it records *that* a rider searched and holds no column that could
 * store the term, because a meeting-point search is frequently a home address.
 * An error report is the same problem with a wider mouth — it carries whatever
 * happened to be in scope — so the posture is **strip by shape, not by a list
 * of fields somebody remembered**.
 *
 * Three things are stripped and each has its own reason:
 *
 * 1. **Query strings and fragments, from every URL anywhere in the payload.**
 *    Every detail route in this app carries its subject's id in `?id=`, and a
 *    Supabase REST URL carries its filters the same way (`?id=eq.<uuid>`). The
 *    path says which screen and which table, which is the whole of what a bug
 *    report needs. This is `feedback.route`'s rule (`084`) applied to a second
 *    surface, not a new one.
 *
 * 2. **Anything JWT-shaped.** The bundle holds a JS-readable refresh token —
 *    `@supabase/ssr` set the cookie `httpOnly=false` and the store that
 *    replaced it is `localStorage` until `window.__letsrideSecureStore` runs
 *    over a platform keychain. So a token can reach an error message by a
 *    dozen routes nobody enumerated: a supabase-js error that quotes its own
 *    request, a `JSON.stringify` of a session, a thrown string. Matching the
 *    *shape* catches all of them; matching a variable name catches the one
 *    somebody thought of.
 *
 * 3. **Every `user` field except `id`.** Sentry's `sendDefaultPii: false`
 *    already withholds IP and cookies; this is the second half, because an
 *    explicitly-set `user` object is not covered by that flag.
 *
 * ## Why the rider's own id survives when content ids do not
 *
 * These look inconsistent and are not. The ids stripped out of URLs identify a
 * **postcard, club or ride** — that is, other riders' content, on a screen the
 * reporting rider merely had open. Those people are not the subject of the
 * report and consented to nothing. `user.id` is the reporting rider's own, it
 * is the app's own opaque identifier rather than a name or an address, and it
 * is what turns "someone hit this" into "three riders hit this, and one of them
 * wrote to us about it" — which is the whole reason PD-315 exists. Never
 * `email` and never `username`: the first is an account credential and the
 * second is what every byline in the app renders, so both name a person where
 * a UUID names a row.
 */

/** Sentry hands `beforeSend` a large, loosely-typed object; we touch a few known corners of it. */
export type Json = string | number | boolean | null | undefined | Json[] | { [key: string]: Json }

export type JsonObject = { [key: string]: Json }

/**
 * A JSON Web Token, by shape: three base64url segments, the first of which
 * begins with the `{"` that every JWT header starts with once encoded.
 *
 * The `eyJ` anchor is what keeps this from matching ordinary dotted text —
 * a version string, a hostname, a stack frame — while still catching every
 * real token, since the header always begins `{"alg"` or `{"typ"`.
 */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g

/**
 * Supabase's newer key format, which is NOT a JWT and so is invisible to the
 * pattern above. `sb_publishable_…` ships in the bundle by design and is
 * redacted anyway — telling the two prefixes apart at this distance is one
 * typo away from letting a secret through, and nothing is lost by scrubbing a
 * value we publish.
 */
const SUPABASE_KEY_PATTERN = /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}/g

const REDACTED = '[redacted]'

/** Absolute URLs inside free text — an error message quoting the request that failed. */
const URL_IN_TEXT_PATTERN = /\bhttps?:\/\/[^\s"'<>)\]}]+/g

/**
 * Strip the query string and fragment, keeping origin and path.
 *
 * Deliberately tolerant of things that are not URLs: this runs over values
 * Sentry collected rather than values we constructed, so a breadcrumb whose
 * `url` is `'(unknown)'` or a relative path must come back unchanged rather
 * than throwing inside `beforeSend` — where a throw drops the whole event and
 * the failure is a silently missing error report.
 */
export function scrubUrl(value: string): string {
  const cut = value.search(/[?#]/)
  const withoutQuery = cut === -1 ? value : value.slice(0, cut)
  return redactSecrets(withoutQuery)
}

/**
 * Redact credentials wherever they appear in a string, and strip the query
 * string off any absolute URL embedded in it.
 *
 * Both halves matter for one common payload: supabase-js errors quote the URL
 * they called, so a message can carry a filter *and* — on an auth failure — a
 * token, in one sentence neither `scrubUrl` nor a token match alone would
 * fully clean.
 */
export function scrubText(value: string): string {
  return redactSecrets(value.replace(URL_IN_TEXT_PATTERN, (url) => url.split(/[?#]/)[0] ?? url))
}

function redactSecrets(value: string): string {
  return value.replace(JWT_PATTERN, REDACTED).replace(SUPABASE_KEY_PATTERN, REDACTED)
}

/**
 * Keys whose values are URLs. Sentry puts a URL under each of these:
 * `url` on a fetch/xhr breadcrumb and on `event.request`, `from`/`to` on a
 * history breadcrumb (which in this SPA is every navigation), and `referrer`
 * in the HTTP context.
 *
 * A key list is the wrong tool for finding secrets and the right one for URLs:
 * every string in the payload gets `scrubText` regardless, so this only decides
 * where the *stricter* whole-value strip applies. A URL the list misses is
 * still caught by `scrubText` as long as it is absolute; the list exists for
 * the relative ones, which have no `https://` to anchor on.
 */
const URL_KEYS = new Set(['url', 'from', 'to', 'referrer', 'href', 'route', 'pathname'])

/**
 * Walk anything and scrub every string in it.
 *
 * A whole-payload walk rather than a fixed set of fields, because the fields
 * are Sentry's to change: an SDK upgrade that adds a new context object would
 * silently route around a field list, and the failure mode of that is a home
 * address in a third-party dashboard. Error payloads are small, so the cost of
 * being exhaustive is nothing measurable.
 *
 * `depth` bounds it against a cyclic or pathological object — `beforeSend`
 * runs on the rider's main thread, and an error report is never worth freezing
 * a screen over.
 */
export function scrubValue(value: Json, key?: string, depth = 0): Json {
  if (depth > 12) return REDACTED

  if (typeof value === 'string') {
    return key !== undefined && URL_KEYS.has(key) ? scrubUrl(value) : scrubText(value)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, key, depth + 1))
  }

  if (value !== null && typeof value === 'object') {
    const out: JsonObject = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = scrubValue(childValue, childKey, depth + 1)
    }
    return out
  }

  return value
}

/**
 * The `beforeSend` body — everything above, plus the three whole fields that
 * are dropped rather than cleaned.
 *
 * `cookies`, `headers` and `query_string` have no scrubbed form worth keeping:
 * the first two are the session itself and the third is what `scrubUrl` already
 * refuses to send. Deleting them is stronger than redacting them, because a
 * redacted key still tells a reader the request carried one.
 */
export function scrubEvent<T extends JsonObject>(event: T): T {
  const scrubbed = scrubValue(event) as T

  const request = scrubbed.request
  if (request !== null && typeof request === 'object' && !Array.isArray(request)) {
    delete request.cookies
    delete request.headers
    delete request.query_string
  }

  const user = scrubbed.user
  if (user !== null && typeof user === 'object' && !Array.isArray(user)) {
    for (const key of Object.keys(user)) {
      if (key !== 'id') delete user[key]
    }
  }

  return scrubbed
}
