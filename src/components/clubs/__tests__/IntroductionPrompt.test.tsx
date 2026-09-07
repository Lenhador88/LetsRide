import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  IntroductionPromptBody,
  type IntroductionPromptMode,
} from '@/components/clubs/IntroductionPrompt'
import { CLUB_INTRODUCTION_COPY, CLUB_INTRODUCTION_STARTER } from '@/lib/validation/clubs'

/**
 * `097`, PD-365, Q3 and Q1 — PD-392's second mode, and PD-418's asymmetry.
 *
 * **Renders `IntroductionPromptBody`, not `IntroductionPrompt`.** The public
 * component wraps this in `ContextMenu`, which renders nothing at all under
 * `typeof document === 'undefined'` — always true here, since
 * `vitest.config.ts` is `environment: 'node'` and this repo adds jsdom only
 * once something needs a layout or an event. **The prefill itself is the
 * wrapper's and is asserted in `IntroductionPrompt.dom.test.tsx`**; this file
 * owns what the body does with whatever value it is handed.
 *
 * ## The `097` invariants are now MEMBER-mode invariants, and that is the point
 *
 * Until PD-418 both modes held *Post is inert until the field holds
 * non-whitespace text* and *the starter is a `placeholder`, never a
 * `defaultValue`*, and this file asserted them with `describe.each` over both.
 * They are now asserted **per mode and in opposite directions**, because the
 * asymmetry is load-bearing rather than an oversight:
 *
 * - **Member mode keeps both.** The text is the only thing the sheet produces
 *   there, so a live control over an empty field promises a post that cannot
 *   happen.
 * - **Pre-join mode holds neither, deliberately.** The control joins whether or
 *   not there is text, so disabling it on an empty field is exactly the
 *   mandatory-introduction wall PD-418 removes — and the field arrives carrying
 *   the starter, so a placeholder there would only ever show on a field the
 *   rider has deliberately cleared.
 *
 * **A `describe.each` over both modes is the refactor to refuse.** It is the
 * natural-looking tidy-up and it can only pass by making one mode wrong.
 *
 * Verified both ways per CLAUDE.md §Working Principles: making the pre-join
 * primary `disabled` on an empty value fails *the primary is live on an empty
 * field*; restoring the placeholder in pre-join fails *no placeholder*; dropping
 * the member-mode `disabled` fails *Post is inert on open*; swapping the two
 * modes' `dismiss` or `submit` strings fails the label assertions; dropping
 * `disabled={dismissDisabled}` fails the in-flight lock assertion.
 */
const noop = () => {}

function render(
  mode: IntroductionPromptMode,
  overrides: { value?: string; pending?: boolean; dismissDisabled?: boolean } = {}
) {
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

/** The primary control, matched by the label that mode actually renders. */
function primary(mode: IntroductionPromptMode, html: string) {
  const match = html.match(
    new RegExp(`<button[^>]*>${CLUB_INTRODUCTION_COPY[mode].submit}</button>`)
  )
  expect(match).not.toBeNull()
  return match![0]
}

describe('IntroductionPromptBody in member mode — the 097 invariants are unchanged', () => {
  it('carries the starter as the placeholder attribute', () => {
    // React HTML-escapes the apostrophes in the starter's own text.
    expect(render('member')).toContain(
      `placeholder="${CLUB_INTRODUCTION_STARTER.replace(/'/g, '&#x27;')}"`
    )
  })

  it('renders the textarea with no content — the field is genuinely empty, not merely displaying empty', () => {
    const html = render('member')

    // A controlled `<textarea value="">` serialises with nothing between its
    // tags. If the starter had been wired as a `value` or `defaultValue`
    // instead, this substring would be the starter text rather than nothing.
    expect(html).toContain('<textarea')
    expect(html).not.toContain(`>${CLUB_INTRODUCTION_STARTER}</textarea>`)
  })

  it('Post is inert on open — an empty field can never satisfy Q1', () => {
    expect(primary('member', render('member'))).toContain('disabled=""')
  })

  it('Post is live once the field holds non-whitespace text, and stays inert on whitespace alone', () => {
    expect(primary('member', render('member', { value: 'Hello!' }))).not.toContain('disabled=""')
    expect(primary('member', render('member', { value: '   \n ' }))).toContain('disabled=""')
  })
})

describe('IntroductionPromptBody in pre-join mode — PD-418 repeals both, and only here', () => {
  it('the primary is live on an empty field — the mandatory-introduction wall is gone', () => {
    // THE assertion of this story. A `disabled=""` here means a rider who
    // cleared the prefilled starter cannot join at all, which is the exact
    // behaviour PD-418 removes — and it is invisible in a screenshot.
    expect(primary('pre-join', render('pre-join'))).not.toContain('disabled=""')
  })

  it('the primary stays live on whitespace alone, where member mode does not', () => {
    // Whitespace is the empty case as far as `club_threads_introduction_length`
    // is concerned, so this is the same rule as above and not a second one — it
    // is asserted separately because a naive `value.length === 0` guard passes
    // the test above and fails this one.
    expect(primary('pre-join', render('pre-join', { value: '   \n ' }))).not.toContain(
      'disabled=""'
    )
  })

  it('carries NO placeholder — the wrapper hands the starter down as the value instead', () => {
    // A placeholder here would be dead markup that surfaces only on a field the
    // rider has deliberately emptied, urging them to write the thing they just
    // declined to write.
    expect(render('pre-join')).not.toContain('placeholder=')
  })

  it('renders whatever value it is handed, including the starter, between the tags', () => {
    // The body is presentational: it must never grow a default of its own, and
    // this pins that the prefill arrives from outside rather than from here.
    expect(render('pre-join', { value: CLUB_INTRODUCTION_STARTER })).toContain(
      `>${CLUB_INTRODUCTION_STARTER.replace(/'/g, '&#x27;')}</textarea>`
    )
  })
})

describe.each<IntroductionPromptMode>(['member', 'pre-join'])(
  'IntroductionPromptBody in %s mode — what both modes still share',
  (mode) => {
    it('the second control is present and carries no disabled state of its own by default', () => {
      const label = CLUB_INTRODUCTION_COPY[mode].dismiss
      const dismiss = render(mode).match(new RegExp(`<button[^>]*>${label}</button>`))
      expect(dismiss).not.toBeNull()
      // Not the substring "disabled" — the button's own `disabled:` Tailwind
      // variants are always in its class list — but the real HTML attribute.
      expect(dismiss![0]).not.toContain('disabled=""')
    })
  }
)

describe('IntroductionPromptBody — the two modes say different things', () => {
  it('pre-join does not welcome the rider to a club they have not joined', () => {
    const html = render('pre-join')
    expect(html).toContain(CLUB_INTRODUCTION_COPY['pre-join'].heading)
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
    expect(html).toContain('>Post</button>')
  })

  it('the primary says Join club in pre-join and Post in member — the label IS the promise', () => {
    // PD-418: a control that joins whether or not there is text cannot be called
    // `Post`, and one whose only product is text cannot be called `Join club`.
    expect(render('pre-join')).toContain('>Join club</button>')
    expect(render('pre-join')).not.toContain('>Post</button>')
    expect(render('member')).not.toContain('>Join club</button>')
  })

  it('the deferral control says Cancel in pre-join, and never Join later again', () => {
    // `Join later` was PD-418's named defect: it reads as *join now, introduce
    // later* and joined nothing at all, so a rider who took it believed they
    // were a member and was not. A control by that name must join.
    expect(render('pre-join')).toContain('>Cancel</button>')
    expect(render('pre-join')).not.toContain('>Join later</button>')
    expect(render('member')).not.toContain('>Join later</button>')
    expect(render('pre-join')).not.toContain('>Not now</button>')
  })
})

describe('IntroductionPromptBody — the in-flight dismissal lock', () => {
  it('disables the second control while a membership write is out', () => {
    // PD-392: a dismissal landing between the join and the introduction would
    // close the sheet over a join that already committed. The wrapper sets this
    // only in pre-join mode and only until the membership write resolves — see
    // `IntroductionPrompt`'s header for why the flag lives there rather than
    // here.
    const dismiss = render('pre-join', { dismissDisabled: true, pending: true }).match(
      /<button[^>]*>Cancel<\/button>/
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
