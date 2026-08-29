import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PostcardStamp } from '@/components/postcards/PostcardStamp'
import { PostcardViewerProvider } from '@/components/postcards/PostcardViewer'
import type { Postcard } from '@/types'

/**
 * The Journal tile, and the three things about it that are contracts rather
 * than styling.
 *
 * **The byline is the reason this component exists.** The product owner asked
 * for "images as stamps + add user avatar and name", and the name is the half
 * that is content: a strip that silently dropped it would look finished and be
 * the old anonymous grid. `PostcardStamp` reads `postcard.author`, which
 * `getRideJournal` supplies through `POSTCARD_SELECT` — an author withheld by
 * the profiles policy arrives `undefined`, so the fallback has to be asserted
 * too or a Journal of blocked riders renders four blank labels.
 *
 * **A stamp is never a dead tile.** It is a `<button>` under a viewer and an
 * `<a href>` without one, and neither branch may be nothing — that is
 * `PostcardViewer`'s stated fallback contract, and it is invisible in the app
 * because the provider is always mounted, which is exactly why it needs a test.
 *
 * **The byline is printed INSIDE the frame** since PD-350, and that is a
 * nesting rather than a class — which is why one of these tests walks tag
 * depth instead of matching a substring. Every other assertion in this file
 * passes with the byline back outside the frame, because the same elements are
 * rendered either way and only their parent differs; a change that undid the
 * one thing the product owner asked for would go green.
 *
 * **These assert markup, never pixels.** `vitest.config.ts` is
 * `environment: 'node'`, so `renderToStaticMarkup` gives what the browser would
 * have parsed and no layout at all — the same limit `PostcardAction.test.tsx`
 * records. The perforated edge itself is CSS in `globals.css` and is verified
 * by screenshot rather than by anything here; all this can say is that the
 * class survives to the element that carries the mask.
 */

/**
 * The markup between the `stamp-edge` element's own tags — the stamp's paper.
 *
 * Written out rather than reached for with a DOM, because the environment is
 * `node` and pulling jsdom in for one nesting question buys a browser this file
 * does not otherwise need. It walks `<span` / `</span>` depth from the frame's
 * opening tag, which is exact for this component: the frame and everything in
 * it is spans, and `renderToStaticMarkup` emits no self-closing spans.
 */
function stampPaper(html: string) {
  const at = html.indexOf('stamp-edge')
  if (at < 0) throw new Error('no stamp-edge element in the output')
  const open = html.lastIndexOf('<', at)
  let i = html.indexOf('>', at) + 1
  const start = i
  let depth = 1
  while (depth > 0) {
    const nextOpen = html.indexOf('<span', i)
    const nextClose = html.indexOf('</span', i)
    if (nextClose < 0) throw new Error('unbalanced spans from ' + html.slice(open, open + 40))
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + 5
    } else {
      depth -= 1
      i = nextClose + 6
    }
  }
  return html.slice(start, html.lastIndexOf('</span', i))
}
const postcard = (over: Partial<Postcard> = {}): Postcard => ({
  id: '11111111-1111-4111-8111-111111111111',
  author_id: '22222222-2222-4222-8222-222222222222',
  club_id: null,
  image_path: 'rider/photo.jpg',
  caption: 'Coffee stop',
  created_at: '2026-08-01T09:00:00Z',
  updated_at: '2026-08-01T09:00:00Z',
  // Both are `string | null` rather than optional, because `073`/`074` couple
  // them at the database and the card decides what to draw off the pair — see
  // their own docstrings in `src/types`. The stamp draws neither; they are here
  // so the fixture is a real `Postcard` and not a shape that only compiles.
  taken_place_name: null,
  taken_country_code: null,
  image_url: 'https://example.test/signed.jpg',
  author: {
    id: '22222222-2222-4222-8222-222222222222',
    username: 'pedro',
    avatar_url: null,
  } as Postcard['author'],
  ...over,
})

const bare = (p: Postcard) => renderToStaticMarkup(<PostcardStamp postcard={p} />)
const withViewer = (p: Postcard, fromRide?: boolean) =>
  renderToStaticMarkup(
    <PostcardViewerProvider>
      <PostcardStamp postcard={p} fromRide={fromRide} />
    </PostcardViewerProvider>
  )

describe('PostcardStamp — the byline', () => {
  it('draws the author’s username under the photo', () => {
    expect(withViewer(postcard())).toContain('pedro')
  })

  it('falls back to “Rider” when the author is withheld', () => {
    // `author` is absent whenever the profiles policy refuses the row — a
    // blocked rider, most often. Decision #7: there is no `full_name` to fall
    // back to, so the label is a literal rather than another column.
    const out = withViewer(postcard({ author: undefined }))
    expect(out).toContain('Rider')
    expect(out).not.toContain('pedro')
  })

  it('names the author in the accessible label, not just on screen', () => {
    // The photo carries `alt=""` — it is described by the label on the control
    // wrapping it — so if the label lost the name the tile would be unreadable
    // to a screen reader even though the byline is right there visually.
    expect(withViewer(postcard())).toContain('aria-label="pedro: Coffee stop"')
  })

  it('falls back to a date in the label when there is no caption', () => {
    const out = withViewer(postcard({ caption: null }))
    expect(out).toContain('aria-label="Postcard from pedro,')
  })
})

describe('PostcardStamp — the frame', () => {
  it('carries the stamp edge on the element holding the photo', () => {
    expect(withViewer(postcard())).toContain('stamp-edge')
  })

  it('draws a placeholder rather than a broken image when signing failed', () => {
    // `image_url: null` is a signed URL that could not be minted, not a
    // postcard without a photo — 010 makes the bucket private, so there is no
    // second way to render it.
    const out = withViewer(postcard({ image_url: null }))
    expect(out).not.toContain('<img src="https://example.test/signed.jpg"')
    expect(out).toContain('svg')
  })
})

describe('PostcardStamp — what a tap does', () => {
  it('is a button under a viewer, so the tap opens the popup rather than navigating', () => {
    const out = withViewer(postcard())
    expect(out).toContain('<button')
    expect(out).not.toContain('href=')
  })

  it('degrades to a link to the thread when no viewer is mounted', () => {
    // Not decoration: a control that silently did nothing is the alternative,
    // and the route it points at is the same one shared links already open.
    const out = bare(postcard())
    expect(out).toContain('href="/postcards/detail?id=11111111-1111-4111-8111-111111111111"')
  })
})

describe('PostcardStamp — the ride marker', () => {
  /**
   * `086`, PD-328. Two assertions and the SECOND is the one that matters: the
   * marker has to be absent when the prop is not passed, because `RideJournal`
   * draws every one of its tiles that way and a default that leaked would put a
   * ride glyph on every stamp in the app.
   *
   * Asserted on the glyph's own class list rather than on a name, for
   * `PostcardAction.test.tsx`'s recorded reason: the environment is `node`, so
   * there is no layout to measure and the class list is what actually survives
   * to the browser.
   */
  it('draws the ride glyph when the postcard reached the strip through a ride', () => {
    const out = withViewer(postcard(), true)
    expect(out).toContain('h-3 w-3 shrink-0 text-muted')
  })

  it('draws NOTHING when the prop is not passed — the Journal branch', () => {
    // `RideJournal` passes no flag at all, deliberately: every stamp there is
    // from that ride, so a marker on all of them would say nothing. If this
    // ever goes red, the default has leaked and every strip in the app has
    // grown a glyph.
    const out = withViewer(postcard())
    expect(out).not.toContain('h-3 w-3 shrink-0 text-muted')
  })

  it('folds the provenance into the existing label rather than adding a second one', () => {
    // One labelled element, not two: the glyph is decoration inside a control
    // that already has a name, and a second would make a screen reader announce
    // the tile twice.
    expect(withViewer(postcard(), true)).toContain('aria-label="pedro: Coffee stop — from a ride"')
    expect(withViewer(postcard())).toContain('aria-label="pedro: Coffee stop"')
  })
})

describe('PostcardStamp — the byline is printed on the stamp', () => {
  /**
   * PD-350, product owner: *"add the poster avatar and name into them"*. The
   * byline existed before this change as a row BELOW the perforation, so the
   * word doing the work is *into*.
   *
   * This is the one assertion in the file that a refactor cannot satisfy by
   * accident, and it is here because the defect it guards is invisible in a
   * screenshot of a single tile: outside the frame the row sits on cream and
   * inside it on white paper, six pixels apart, at the same overall height.
   */
  it('renders the avatar and username inside the perforated frame, not under it', () => {
    const paper = stampPaper(withViewer(postcard()))
    expect(paper).toContain('pedro')
  })

  it('keeps the photo inside the frame too — the byline did not replace it', () => {
    // Guards the other direction of the same edit: a byline moved in while the
    // photo moved out would still put the name on the paper.
    expect(stampPaper(withViewer(postcard()))).toContain('https://example.test/signed.jpg')
  })
})

describe('PostcardStamp — the postmark', () => {
  /**
   * The wheel-shaped cancellation (PD-350) — the mark that makes the tile read
   * as a franked stamp rather than as a photo with a notched border.
   *
   * Asserted on the rotation rather than on the circles, for two reasons: the
   * placeholder branch draws an `ImageIcon` that is also an `svg`, so `svg`
   * alone cannot tell the two apart, and the rotation is the property whose
   * loss actually matters — axis-aligned the mark reads as a badge offering to
   * be tapped instead of as ink pressed onto paper.
   */
  it('franks a stamp that has a photo', () => {
    expect(withViewer(postcard())).toContain('rotate-[-14deg]')
  })

  it('draws NO postmark over the failed-to-sign placeholder', () => {
    // A cancellation over an empty slot reads as a broken glyph rather than as
    // ink, and there is nothing there to frank.
    expect(withViewer(postcard({ image_url: null }))).not.toContain('rotate-[-14deg]')
  })

  it('is decoration — it adds no second accessible name to the tile', () => {
    const out = withViewer(postcard())
    expect(out.match(/aria-label=/g)).toHaveLength(1)
  })
})
