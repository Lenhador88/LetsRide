import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WaveIcon } from '@/components/icons/generated'
import { WaveFilledIcon } from '@/components/icons/derived'

/**
 * `derived.tsx` holds transformations of generated artwork, and the whole
 * safety of that arrangement is that the transformation is re-derivable. The
 * generated file is rewritten wholesale by `npm run figma:components`, so a
 * redrawn `wave` would otherwise leave the filled variant drawing last month's
 * hand — silently, because both still render something hand-shaped.
 *
 * So this does the extraction rather than asserting a literal: it reads the
 * path back out of `WaveIcon` and rebuilds what `WaveFilledIcon` should be.
 */
function pathOf(markup: string): string {
  const match = /\bd="([^"]+)"/.exec(markup)
  if (!match) throw new Error('no path in the rendered icon')
  return match[1]
}

describe('WaveFilledIcon', () => {
  it('is the outer contour of the generated wave, and nothing else', () => {
    const outline = pathOf(renderToStaticMarkup(<WaveIcon />))
    const subpaths = outline.split(/(?=M)/).filter(Boolean)
    // Two subpaths — the silhouette and the interior detail — is the property
    // the fill relies on. A regenerated icon with three would need a decision,
    // not a re-run, which is why this is asserted rather than assumed.
    expect(subpaths).toHaveLength(2)
    expect(pathOf(renderToStaticMarkup(<WaveFilledIcon />))).toBe(subpaths[0].trim())
  })

  it('carries no fill-rule, so the silhouette is solid', () => {
    // The outline needs `evenodd` to punch its interior out. The filled variant
    // has no interior to punch, and inheriting the rule would be a latent hole
    // the day a third subpath appears.
    expect(renderToStaticMarkup(<WaveFilledIcon />)).not.toContain('fill-rule')
  })

  it('takes the colour of the text around it, like every generated icon', () => {
    expect(renderToStaticMarkup(<WaveFilledIcon />)).toContain('fill="currentColor"')
  })
})
