import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  PostcardActionButton,
  PostcardActionLink,
  PostcardActionStatic,
} from '@/components/postcards/PostcardAction'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { BannerProvider } from '@/components/ui/Banner'
import type { Postcard } from '@/types'

/**
 * The action row's geometry had nothing measuring it, which is how it went
 * wrong: the shared shape carried Figma's `padding 8/12/8/8` unconditionally,
 * every variant in the frame draws a count, and the app hides the count at zero
 * — so a bare glyph sat with 12px of dead space beside it and, against the
 * frame's own `itemSpacing 0`, two icons ended up 20px apart. Nothing failed.
 * `docs/FIGMA-FIDELITY-TODO.md` §Home / Postcards feed carries the deviation and
 * the tap-target cost that came with fixing it.
 *
 * **These assert the rule, not the pixels**, and the distinction is the reason
 * to write it down rather than let a later reader assume more coverage than
 * exists. Vitest runs `environment: 'node'`, so there is no layout engine here:
 * `renderToStaticMarkup` gives the class list the browser would have used, and
 * whether 8+24+8 comes out as 40px is the browser's arithmetic, taken on trust.
 * What that catches is every way this has actually broken — the trailing padding
 * going unconditional again, `Count` and `hasCount` disagreeing about zero, a
 * gap appearing on the row to "fix" spacing, or `ShareButton` drifting out of
 * the set because it is the one control with no count at all.
 *
 * No jsdom, deliberately: static markup needs none, and `vitest.config.ts` is
 * `environment: 'node'` for the whole suite. A DOM would be a dependency bought
 * to assert strings that arrive without one.
 */

// `PostcardMenu` reaches for the app router, which only exists inside Next.
// Nothing here exercises navigation; the row's layout is the subject.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/postcards',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {},
}))

const ICON = <svg data-testid="icon" />

/** Every `class="…"` in the markup, in document order. */
function classLists(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1])
}

/** The one control in the markup — these render exactly one. */
function controlClasses(html: string): string {
  return classLists(html)[0]
}

describe('PostcardAction — trailing padding follows the count', () => {
  const variants = {
    button: (count?: number) =>
      renderToStaticMarkup(<PostcardActionButton icon={ICON} count={count} label="Act" />),
    link: (count?: number) =>
      renderToStaticMarkup(<PostcardActionLink href="/x" icon={ICON} count={count} label="Act" />),
    static: (count?: number) =>
      renderToStaticMarkup(<PostcardActionStatic icon={ICON} count={count} label="Act" />),
  }

  for (const [name, render] of Object.entries(variants)) {
    describe(name, () => {
      // 6px either side — the product owner's number, chosen from rendered
      // options, not derived from the frame, which draws no zero-count state.
      it('is symmetric px-1.5 with no count — the 12px is the count-to-edge gap, not a control gap', () => {
        const classes = controlClasses(render(undefined))
        expect(classes).toContain('px-1.5')
        expect(classes).not.toContain('pl-2')
        expect(classes).not.toContain('pr-3')
      })

      // The state the app is actually in on a fresh postcard, and the one the
      // frame never drew. `count={0}` must read as "nothing to draw", not as a
      // number whose padding should be reserved.
      // Asserts on the count *element*, not on the `>0<` adjacency: a `Count`
      // that regressed to rendering a zero with any surrounding whitespace
      // would slip straight past the substring form, leaving this case named
      // for a behaviour that the positive `>7<` case below was really carrying.
      it('treats a zero count as no count', () => {
        expect(controlClasses(render(0))).toBe(controlClasses(render(undefined)))
        expect(render(0)).not.toContain('tabular-nums')
        expect(render(undefined)).not.toContain('tabular-nums')
      })

      // A counted control is the frame's own 8/12 box, untouched — the whole
      // point of keying on the count is that the measured state stays measured.
      it('restores the measured 8/12 as soon as there is a number beside the icon', () => {
        const html = render(7)
        expect(controlClasses(html)).toContain('pl-2')
        expect(controlClasses(html)).toContain('pr-3')
        expect(controlClasses(html)).not.toContain('px-1.5')
        expect(html).toContain('>7<')
      })
    })
  }

  // `cn` is twMerge, and the conditional padding sits *before* `className` in
  // every call — so a caller can still override it, exactly as when the padding
  // was hardcoded into the shared shape.
  it('lets a caller override the padding, unchanged by the conditional', () => {
    const html = renderToStaticMarkup(
      <PostcardActionButton icon={ICON} count={3} label="Act" className="pr-8" />
    )
    expect(controlClasses(html)).toContain('pr-8')
    expect(controlClasses(html)).not.toContain('pr-3')
  })
})

describe('PostcardCard — the action row', () => {
  // A complete `Postcard`, checked by `tsc` rather than cast past it. The
  // earlier version omitted `image_path` and `updated_at` and invented a
  // `ride_id`, all hidden behind `as unknown as Postcard` — so the day the card
  // renders from `image_path` instead of the signed `image_url`, the fixture
  // would have supplied nothing, the card would have quietly taken its
  // could-not-load branch, and every assertion below would still have passed.
  function card(overrides: Partial<Postcard>): string {
    const postcard: Postcard = {
      id: 'p1',
      author_id: 'a1',
      club_id: null,
      image_path: 'a1/p1.jpg',
      caption: 'Caption',
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-01-01T10:00:00Z',
      image_url: null,
      is_own: false,
      likes_count: 0,
      comments_count: 0,
      is_liked: false,
      taken_place_name: null,
      taken_country_code: null,
      ...overrides,
    }

    return renderToStaticMarkup(
      <BannerProvider>
        <PostcardCard postcard={postcard} />
      </BannerProvider>
    )
  }

  /** The row is the only element carrying both the bottom padding and a gap. */
  function actionRowClasses(html: string): string {
    const rows = classLists(html).filter((c) => c.includes('pb-2') && /(^|\s)gap-/.test(c))
    expect(rows).toHaveLength(1)
    return rows[0]
  }

  // The frame's `itemSpacing` is 0 and the controls carry their own padding, so
  // a gap here is spacing counted twice — which is the shape of the bug this
  // whole file exists for, arriving from the other direction.
  it('separates the controls with no gap of its own, as the frame draws it', () => {
    expect(actionRowClasses(card({}))).toContain('gap-0')
  })

  /**
   * The three actions, found by the marker attribute they carry for exactly
   * this. Selecting them by a *padding* class would be circular — padding is
   * what is under test, so a changed value would silently drop controls rather
   * than fail — and `before:-inset-y-0.5`, the obvious alternative, is shared
   * with `Button`'s `md` size, so it would quietly widen the day a `<Button>`
   * lands inside a card.
   */
  function actionControls(html: string): string[] {
    const controls = [...html.matchAll(/<[^>]*\sdata-postcard-action=""[^>]*>/g)]
      .map((m) => /class="([^"]*)"/.exec(m[0])?.[1])
      .filter((c): c is string => c !== undefined)
    expect(controls).toHaveLength(3)
    return controls
  }

  // Share never has a count — there is nothing recorded to count — so it is the
  // one control that is uncounted on every postcard, including a popular one.
  it('leaves share symmetric even on a card whose other counts are set', () => {
    const controls = actionControls(card({ likes_count: 12, comments_count: 3 }))
    expect(controls.filter((c) => c.includes('pl-2') && c.includes('pr-3'))).toHaveLength(2)
    expect(controls.filter((c) => c.includes('px-1.5'))).toHaveLength(1)
  })

  /**
   * The location caption (PD-279). Two cases, because the interesting half is
   * the ABSENCE: the columns are readable by exactly the postcard's audience,
   * so a caption drawn on a NULL name would be the card inventing a location,
   * and `Hide` is indistinguishable from "this photo carried none" on purpose.
   *
   * Asserted on the rendered text rather than on a class, so a restyle does not
   * fail it and a dropped `postcard.taken_place_name &&` does.
   */
  it('draws the place a postcard names', () => {
    const html = card({ taken_place_name: 'Berkhout' })
    expect(html).toContain('Berkhout')
    // The screen-reader context, without which this is a bare noun between the
    // photo's alt text and the date.
    expect(html).toContain('Taken in')
  })

  it('draws no caption when the postcard names no place', () => {
    const html = card({ taken_place_name: null })
    expect(html).not.toContain('Taken in')
  })

  /**
   * The flag half (`074`, PD-279). Same absence rule as the name above, plus
   * the one this card owns on its own: a country with no name never reaches
   * it at all — `postcards_taken_country_code_needs_a_place` refuses that row
   * at the database — so the fallback case here is a NAMED place with no
   * country, which is the typed-and-never-picked shape.
   */
  it('draws the flag before the town when the postcard names a country', () => {
    const html = card({ taken_place_name: 'Berkhout', taken_country_code: 'NL' })
    expect(html).toContain('🇳🇱')
    expect(html).toContain('Berkhout')
  })

  it('falls back to the location pin, not a flag, for a place with no country', () => {
    const html = card({ taken_place_name: 'Berkhout', taken_country_code: null })
    expect(html).not.toContain('🇳🇱')
    expect(html).toContain('Berkhout')
  })

  // `Grey/70%` bounds the composite at `#4C4C4C` whatever the photo is —
  // 8.59:1 for white text. The 40px gradient underneath reaches ~0.37 alpha at
  // this text's height, which is 2.58:1 at the glyph top, so the pill is the
  // contrast fix rather than decoration and both captions owe it.
  it('backs both captions with a bounded scrim rather than the gradient alone', () => {
    const html = card({ taken_place_name: 'Berkhout' })
    expect(classLists(html).filter((c) => c.includes('bg-scrim'))).toHaveLength(2)
  })

  it('leaves all three symmetric on a card with no likes and no comments', () => {
    const controls = actionControls(card({}))
    expect(controls.every((c) => c.includes('px-1.5') && !c.includes('pr-3'))).toBe(true)
  })
})
