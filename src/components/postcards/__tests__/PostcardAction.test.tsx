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
      it('is symmetric px-2 with no count — the 12px is the count-to-edge gap, not a control gap', () => {
        const classes = controlClasses(render(undefined))
        expect(classes).toContain('pl-2')
        expect(classes).toContain('pr-2')
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

      it('restores the measured pr-3 as soon as there is a number beside the icon', () => {
        const html = render(7)
        expect(controlClasses(html)).toContain('pl-2')
        expect(controlClasses(html)).toContain('pr-3')
        expect(controlClasses(html)).not.toContain('pr-2')
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

  // Share never has a count — there is nothing recorded to count — so it is the
  // one control that is uncounted on every postcard, including a popular one.
  it('leaves share symmetric even on a card whose other counts are set', () => {
    const html = card({ likes_count: 12, comments_count: 3 })
    const controls = classLists(html).filter((c) => c.includes('rounded-lg') && c.includes('pl-2'))
    expect(controls.filter((c) => c.includes('pr-3'))).toHaveLength(2)
    expect(controls.filter((c) => c.includes('pr-2'))).toHaveLength(1)
  })

  it('leaves all three symmetric on a card with no likes and no comments', () => {
    const html = card({})
    const controls = classLists(html).filter((c) => c.includes('rounded-lg') && c.includes('pl-2'))
    expect(controls).toHaveLength(3)
    expect(controls.every((c) => c.includes('pr-2') && !c.includes('pr-3'))).toBe(true)
  })
})
