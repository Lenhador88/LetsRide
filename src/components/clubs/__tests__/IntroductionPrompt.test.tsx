import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntroductionPromptBody } from '@/components/clubs/IntroductionPrompt'
import { CLUB_INTRODUCTION_STARTER } from '@/lib/validation/clubs'

/**
 * `097`, PD-365, Q3 and Q1 — task 8.3a.
 *
 * **Renders `IntroductionPromptBody`, not `IntroductionPrompt`.** The public
 * component wraps this in `ContextMenu`, which renders nothing at all under
 * `typeof document === 'undefined'` — always true here, since
 * `vitest.config.ts` is `environment: 'node'` and this repo adds jsdom only
 * once something needs a layout or an event, which a placeholder-versus-value
 * check does not. `IntroductionPrompt.tsx`'s own header records the split.
 *
 * **The starter is a `placeholder`, never a `defaultValue`, and the two
 * spellings screenshot identically.** A textarea carrying the starter as a
 * prefilled VALUE is never empty, so Post would be enabled the instant the
 * sheet opens and one tap would ship the canned sentence unedited — silently
 * repealing Q1's own rule ("Post is inert until the field holds
 * non-whitespace text"). This file asserts both halves of that pairing
 * together, because either one alone is the shape that reverses in silence:
 * a placeholder with Post enabled on open would be just as broken as a
 * prefilled value with Post correctly disabled, and a test checking only one
 * half cannot tell either wrong shape apart from the right one.
 *
 * Verified both ways per CLAUDE.md §Working Principles: swapping the
 * `placeholder` prop to `value`/`defaultValue` fails the "opens empty"
 * assertion below.
 */
const noop = () => {}

describe('IntroductionPromptBody — the starter is a placeholder, and the field opens empty', () => {
  it('carries the starter as the placeholder attribute', () => {
    const html = renderToStaticMarkup(
      <IntroductionPromptBody clubId="club-1" onDismiss={noop} onPosted={noop} />
    )

    // React HTML-escapes the apostrophes in the starter's own text.
    expect(html).toContain(`placeholder="${CLUB_INTRODUCTION_STARTER.replace(/'/g, '&#x27;')}"`)
  })

  it('renders the textarea with no content — the field is genuinely empty, not merely displaying empty', () => {
    const html = renderToStaticMarkup(
      <IntroductionPromptBody clubId="club-1" onDismiss={noop} onPosted={noop} />
    )

    // A controlled `<textarea value="">` serialises with nothing between its
    // tags. If the starter had been wired as a `value` or `defaultValue`
    // instead, this substring would be the starter text rather than nothing.
    expect(html).toContain('<textarea')
    expect(html).not.toContain(`>${CLUB_INTRODUCTION_STARTER}</textarea>`)
  })

  it('Post is inert on open — an empty field can never satisfy Q1', () => {
    const html = renderToStaticMarkup(
      <IntroductionPromptBody clubId="club-1" onDismiss={noop} onPosted={noop} />
    )

    const post = html.match(/<button[^>]*>Post<\/button>/)
    expect(post).not.toBeNull()
    expect(post![0]).toContain('disabled=""')
  })

  it('Not now is always present and carries no disabled state of its own', () => {
    const html = renderToStaticMarkup(
      <IntroductionPromptBody clubId="club-1" onDismiss={noop} onPosted={noop} />
    )

    const notNow = html.match(/<button[^>]*>Not now<\/button>/)
    expect(notNow).not.toBeNull()
    // Not the substring "disabled" — the button's own `disabled:` Tailwind
    // variants are always in its class list — but the real HTML attribute.
    expect(notNow![0]).not.toContain('disabled=""')
  })
})
