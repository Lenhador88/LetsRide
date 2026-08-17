import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The three auth email bodies in `supabase/templates/`.
 *
 * **This cannot detect the drift that actually matters**, and saying so is the
 * point of the file rather than a caveat on it: a template is a dashboard
 * setting, nothing can read a deployed one back, and so no test can tell
 * whether either project is serving what is committed here.
 * `supabase/templates/README.md` and `docs/ENVIRONMENTS.md` §The email
 * templates have files now, and still no gate carry that in full.
 *
 * What it *can* hold is the file half, which is the half that goes wrong
 * silently. An email is written once and then edited by someone who never
 * renders it, and the two edits that cost a rider their account are invisible
 * in a diff: changing the button's `href` and not the copy-this-link fallback
 * beneath it, and losing a `{{ … }}` to a well-meant tidy-up. Both leave a mail
 * that looks perfectly correct.
 */
const TEMPLATES = join(__dirname, '../../supabase/templates')

/**
 * The URL each template's links must carry — every one of them, identically.
 *
 * `confirm-signup.html`'s is PD-233's form verbatim, `&` and all. It is written
 * out here rather than derived from the file so that a change to the link has
 * to be made twice, deliberately, in two places a reviewer reads.
 */
const LINKS = {
  'confirm-signup.html':
    '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/postcards',
  'reset-password.html': '{{ .ConfirmationURL }}',
  'magic-link.html': '{{ .ConfirmationURL }}',
} as const

const hrefsIn = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])

describe.each(Object.entries(LINKS))('%s', (name, link) => {
  const html = readFileSync(join(TEMPLATES, name), 'utf8')

  it('points every link at the same URL', () => {
    // Three: Outlook's <v:roundrect>, the ordinary <a> button, and the
    // copy-this-link fallback. A rider meets exactly one of the first two
    // depending on their client, so a divergence between them is a defect only
    // half the recipients ever see.
    const hrefs = hrefsIn(html)
    expect(hrefs).toHaveLength(3)
    expect([...new Set(hrefs)]).toEqual([link])
  })

  it('repeats the URL as visible text, which is the whole text alternative', () => {
    // The dashboard exposes one HTML body and no text/plain part, so a client
    // that refuses the styling has nothing but this line to offer.
    expect(html).toContain(`>${link}</a>`)
  })

  it('loads nothing from the network', () => {
    // No external images (hence no tracking pixel), no web fonts. An images-off
    // client renders these complete.
    expect(html).not.toMatch(/<img\b/)
    expect(html).not.toMatch(/\bsrc="/)
    expect(html).not.toMatch(/@import|fonts\.googleapis|fonts\.gstatic/)
  })

  it('relies on no <style> block, which Gmail is free to strip', () => {
    expect(html).not.toMatch(/<style\b/)
  })

  it('is a fluid table capped at 600px', () => {
    expect(html).toContain('max-width:600px')
  })
})

/**
 * The detector, proved against a mutation — `no-service-role-key.test.ts`'s
 * shape, for the same reason. A regex that has quietly stopped matching passes
 * for ever and is indistinguishable from a clean file.
 */
it('catches a button and a fallback that have drifted apart', () => {
  const html = readFileSync(join(TEMPLATES, 'reset-password.html'), 'utf8')
  const tampered = html.replace('href="{{ .ConfirmationURL }}"', 'href="{{ .SiteURL }}"')

  expect(tampered).not.toEqual(html)
  expect([...new Set(hrefsIn(tampered))]).toHaveLength(2)
})
