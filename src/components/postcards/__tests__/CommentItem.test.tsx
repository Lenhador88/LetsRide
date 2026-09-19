import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BannerProvider } from '@/components/ui/Banner'
import { CommentItem } from '@/components/postcards/CommentItem'
import type { PostcardComment } from '@/types'

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111'

const COMMENT: PostcardComment = {
  id: '22222222-2222-4222-8222-222222222222',
  postcard_id: '33333333-3333-4333-8333-333333333333',
  author_id: AUTHOR_ID,
  body: 'Nice ride!',
  created_at: '2026-09-18T12:00:00.000Z',
  updated_at: '2026-09-18T12:00:00.000Z',
  author: {
    id: AUTHOR_ID,
    username: 'rider_one',
    avatar_url: null,
    avatar_path: null,
    bike_model: null,
  },
}

/**
 * `123`, PD-454 — the inline `Report` control beside `Delete`, `design.md`
 * D10. `CommentItem` calls `useBanner()` unconditionally, so `BannerProvider`
 * is real rather than stubbed, matching `ThreadOptionsRows.test.tsx`'s own
 * reason for the same wrapper.
 *
 * **Both flags are asserted independently of one another, because they come
 * from different rights.** `canDelete` is 011's DELETE policy (your own
 * comment, or any comment on a postcard you authored); `canReport` is
 * `viewerId !== undefined && comment.author_id !== viewerId` — the two
 * combine on the postcard author's own view of somebody else's comment, where
 * both controls render together, and neither is a substitute for the other.
 */
function render(props: { canDelete: boolean; canReport: boolean }) {
  return renderToStaticMarkup(
    <BannerProvider>
      <CommentItem comment={COMMENT} {...props} />
    </BannerProvider>
  )
}

describe('CommentItem — the Report control', () => {
  it('is ABSENT on the viewer’s own comment, even though they can delete it', () => {
    // The comment's author, reading their own comment: canDelete is true
    // (011's own-comment arm), canReport is false — the policy would accept a
    // self-report (design.md D9) but the row is never drawn for the author.
    const html = render({ canDelete: true, canReport: false })
    expect(html).not.toContain('>Report<')
    expect(html).toContain('>Delete<')
  })

  it('is PRESENT on a comment the viewer did not write and cannot delete', () => {
    // An ordinary viewer of somebody else's comment on somebody else's
    // postcard: neither delete right applies, but they may still report it.
    const html = render({ canDelete: false, canReport: true })
    expect(html).toContain('>Report<')
    expect(html).not.toContain('>Delete<')
  })

  it('draws BOTH controls for the postcard’s own author reading someone else’s comment', () => {
    // canDelete via the postcard-author arm of 011's policy, canReport because
    // this viewer did not write the comment — the two rights are independent
    // and neither one hides the other.
    const html = render({ canDelete: true, canReport: true })
    expect(html).toContain('>Report<')
    expect(html).toContain('>Delete<')
  })

  it('draws NEITHER control when the viewer may neither delete nor report', () => {
    // `viewerId === undefined` — the session went away mid-render — collapses
    // both flags to false through their own defensive `!== undefined` guard in
    // CommentList, never through a prop this component invents itself.
    const html = render({ canDelete: false, canReport: false })
    expect(html).not.toContain('>Report<')
    expect(html).not.toContain('>Delete<')
  })

  it('gives Report the negative-margin floor class when it renders first', () => {
    // `design.md` D10: the same 44px floor and `-ml-1` trick `Delete` already
    // used, and only the row's FIRST control gets the negative margin —
    // reversed, both controls would carry it and the row would sit too far
    // left, or neither would and the touch target would clip the row above it.
    const bothControls = render({ canDelete: true, canReport: true })
    expect(bothControls).toContain('-ml-1 inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-medium text-muted')

    const deleteOnly = render({ canDelete: true, canReport: false })
    expect(deleteOnly).toContain('-ml-1 inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-medium text-muted')
  })
})
