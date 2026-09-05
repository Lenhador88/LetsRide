import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  IntroductionPromptBody,
  type IntroductionPromptMode,
} from '@/components/clubs/IntroductionPrompt'
import { CLUB_INTRODUCTION_COPY, CLUB_INTRODUCTION_STARTER } from '@/lib/validation/clubs'

/**
 * `097`, PD-365, Q3 and Q1 — and PD-392's second mode.
 *
 * **Renders `IntroductionPromptBody`, not `IntroductionPrompt`.** The public
 * component wraps this in `ContextMenu`, which renders nothing at all under
 * `typeof document === 'undefined'` — always true here, since
 * `vitest.config.ts` is `environment: 'node'` and this repo adds jsdom only
 * once something needs a layout or an event, which none of these checks does.
 *
 * **This file changed under PD-392, and that is the intended cost of a required
 * prop.** `mode` has no default: a caller that forgot it would otherwise draw
 * *"Welcome to the club!"* over a rider who has not joined anything, which is
 * the exact defect the change exists to remove. A green diff here would have
 * meant a default nobody can forget to pass. The four `097` **invariants** are
 * unchanged and are now asserted in **both** modes.
 *
 * **The starter is a `placeholder`, never a `defaultValue`, and the two
 * spellings screenshot identically.** A textarea carrying the starter as a
 * prefilled VALUE is never empty, so Post would be enabled the instant the
 * sheet opens and one tap would ship the canned sentence unedited — silently
 * repealing Q1's rule ("Post is inert until the field holds non-whitespace
 * text"). **Under PD-392 that tap would also JOIN A CLUB**, which is why both
 * halves are asserted together in both modes: a placeholder with Post enabled
 * on open would be just as broken as a prefilled value with Post correctly
 * disabled, and a test checking only one half cannot tell either wrong shape
 * apart from the right one.
 *
 * Verified both ways per CLAUDE.md §Working Principles: swapping the
 * `placeholder` prop to `value`/`defaultValue` fails the "opens empty"
 * assertion; swapping the two modes' `dismiss` strings fails the label
 * assertions; dropping the `disabled={dismissDisabled}` attribute fails the
 * in-flight lock assertion.
 */
const noop = () => {}

function render(mode: IntroductionPromptMode, overrides: { value?: string; pending?: boolean; dismissDisabled?: boolean } = {}) {
  return renderToStaticMarkup(
    <IntroductionPromptBody
      mode={mode}
      value={overrides.value ?? ''}
      onValueChange={noop}
      error={null}
      pending={overrides.pending ?? false}
      dismissDisabled={overrides.dismissDisabled ?? false}
      onDismiss={noop}
      onSubmit={noop}
    />
  )
}

const MODES: IntroductionPromptMode[] = ['member', 'pre-join']

describe.each(MODES)('IntroductionPromptBody in %s mode — the 097 invariants hold', (mode) => {
  it('carries the starter as the placeholder attribute', () => {
    // React HTML-escapes the apostrophes in the starter's own text.
    expect(render(mode)).toContain(
      `placeholder="${CLUB_INTRODUCTION_STARTER.replace(/'/g, '&#x27;')}"`
    )
  })

  it('renders the textarea with no content — the field is genuinely empty, not merely displaying empty', () => {
    const html = render(mode)

    // A controlled `<textarea value="">` serialises with nothing between its
    // tags. If the starter had been wired as a `value` or `defaultValue`
    // instead, this substring would be the starter text rather than nothing.
    expect(html).toContain('<textarea')
    expect(html).not.toContain(`>${CLUB_INTRODUCTION_STARTER}</textarea>`)
  })

  it('Post is inert on open — an empty field can never satisfy Q1', () => {
    const post = render(mode).match(/<button[^>]*>Post<\/button>/)
    expect(post).not.toBeNull()
    expect(post![0]).toContain('disabled=""')
  })

  it('Post is live once the field holds non-whitespace text, and stays inert on whitespace alone', () => {
    expect(render(mode, { value: 'Hello!' }).match(/<button[^>]*>Post<\/button>/)![0]).not.toContain(
      'disabled=""'
    )
    expect(render(mode, { value: '   \n ' }).match(/<button[^>]*>Post<\/button>/)![0]).toContain(
      'disabled=""'
    )
  })

  it('the second control is present and carries no disabled state of its own by default', () => {
    const label = CLUB_INTRODUCTION_COPY[mode].dismiss
    const dismiss = render(mode).match(new RegExp(`<button[^>]*>${label}</button>`))
    expect(dismiss).not.toBeNull()
    // Not the substring "disabled" — the button's own `disabled:` Tailwind
    // variants are always in its class list — but the real HTML attribute.
    expect(dismiss![0]).not.toContain('disabled=""')
  })
})

describe('IntroductionPromptBody — the two modes say different things', () => {
  it('pre-join does not welcome the rider to a club they have not joined', () => {
    const html = render('pre-join')
    expect(html).toContain(CLUB_INTRODUCTION_COPY['pre-join'].heading)
    // React HTML-escapes the apostrophe in "you'll", as it does the starter's.
    expect(html).toContain(CLUB_INTRODUCTION_COPY['pre-join'].body.replace(/'/g, '&#x27;'))
    // The defect PD-392 exists to remove: the sheet asserting a membership that
    // the rider has not agreed to yet.
    expect(html).not.toContain(CLUB_INTRODUCTION_COPY.member.heading)
  })

  it('member mode is byte-for-byte what 097 shipped', () => {
    const html = render('member')
    expect(html).toContain('Welcome to the club!')
    expect(html).toContain('Say hello — the club can read it, wave and reply.')
    expect(html).toContain('>Not now</button>')
  })

  it('the deferral control says Join later, and member mode never does', () => {
    // The label IS the promise. `Not now` on a club the rider has not joined is
    // the sentence the product owner asked to stop showing.
    expect(render('pre-join')).toContain('>Join later</button>')
    expect(render('pre-join')).not.toContain('>Not now</button>')
    expect(render('member')).not.toContain('>Join later</button>')
  })
})

describe('IntroductionPromptBody — the in-flight dismissal lock', () => {
  it('disables the second control while a membership write is out', () => {
    // PD-392: a dismissal landing between the join and the introduction would
    // close a sheet labelled `Join later` over a join that already committed.
    // The wrapper sets this only in pre-join mode and only until the membership
    // write resolves — see `IntroductionPrompt`'s header for why the flag lives
    // there rather than here.
    const dismiss = render('pre-join', { dismissDisabled: true, pending: true }).match(
      /<button[^>]*>Join later<\/button>/
    )
    expect(dismiss).not.toBeNull()
    expect(dismiss![0]).toContain('disabled=""')
  })

  it('leaves member mode dismissible while pending — 097 rule, unchanged', () => {
    // "Not now is always present and always closes the sheet, pending or not."
    // A member has nothing at stake in the write, so holding the sheet shut
    // would trap them behind a request that can fail for reasons of its own.
    const dismiss = render('member', { pending: true }).match(/<button[^>]*>Not now<\/button>/)
    expect(dismiss).not.toBeNull()
    expect(dismiss![0]).not.toContain('disabled=""')
  })
})
