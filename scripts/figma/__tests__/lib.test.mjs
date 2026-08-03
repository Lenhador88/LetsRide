import { describe, expect, it } from 'vitest'
import {
  collectGeometry, collectTokens, dominant, formatDuration, isLegacy, pruneNode, readRateLimit,
  resolvePaint, slug, toHex, total, walk,
} from '../lib.mjs'

describe('formatDuration', () => {
  it.each([
    [45, '45s'],
    [90, '1m 30s'],
    [3600, '1h 0m'],
    [14_400, '4h 0m'],
    [248_933, '2d 21h'],
  ])('%is -> %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })

  it('does not invent a duration from a missing or negative value', () => {
    expect(formatDuration(null)).toBe('unknown')
    expect(formatDuration(NaN)).toBe('unknown')
    expect(formatDuration(-1)).toBe('unknown')
  })
})

describe('readRateLimit', () => {
  const headers = (entries) => new Headers(entries)

  it('reads Retry-After as seconds, which is what Figma sends', () => {
    // Verified live 2026-08-03: sampled 61s apart, the value fell by 64 — a
    // real countdown in seconds, not milliseconds and not reset per request.
    const limit = readRateLimit(headers({
      'retry-after': '248933',
      'x-figma-plan-tier': 'starter',
      'x-figma-rate-limit-type': 'high',
    }))

    expect(limit.seconds).toBe(248_933)
    expect(limit.readableWait).toBe('2d 21h')
    expect(limit.planTier).toBe('starter')
    expect(limit.limitType).toBe('high')
  })

  it('projects a reset instant rather than leaving the caller to add it up', () => {
    const before = Date.now()
    const limit = readRateLimit(headers({ 'retry-after': '3600' }))
    expect(limit.resetsAt.getTime()).toBeGreaterThanOrEqual(before + 3_600_000 - 1000)
    expect(limit.resetsAt.getTime()).toBeLessThanOrEqual(Date.now() + 3_600_000 + 1000)
  })

  it('accepts the HTTP-date form the RFC also allows', () => {
    const at = new Date(Date.now() + 120_000).toUTCString()
    const limit = readRateLimit(headers({ 'retry-after': at }))
    expect(limit.seconds).toBeGreaterThan(100)
    expect(limit.seconds).toBeLessThanOrEqual(120)
  })

  it('reports unknown rather than guessing when the header is absent', () => {
    const limit = readRateLimit(headers({}))
    expect(limit.seconds).toBeNull()
    expect(limit.readableWait).toBe('unknown')
    expect(limit.resetsAt).toBeNull()
  })
})

const solid = (r, g, b, opacity) => ({ type: 'SOLID', color: { r, g, b }, opacity })

describe('toHex', () => {
  it('renders an opaque colour without an alpha channel', () => {
    expect(toHex({ r: 1, g: 1, b: 1 }, 1)).toBe('#FFFFFF')
    expect(toHex({ r: 0.1019607, g: 0.1019607, b: 0.1019607 }, 1)).toBe('#1A1A1A')
  })

  it('snaps float32 opacity to the authored percentage', () => {
    // Figma stores 70% as 0.69999998807907104. Rounding the raw float gives B2,
    // which is one step off the value the designer actually typed.
    expect(toHex({ r: 0, g: 0, b: 0 }, 0.69999998807907104)).toBe('#000000B3')
    expect(toHex({ r: 0, g: 0, b: 0 }, 0.10000000149011612)).toBe('#0000001A')
    expect(toHex({ r: 1, g: 1, b: 1 }, 0.05000000074505806)).toBe('#FFFFFF0D')
  })

  it('treats all-but-imperceptible opacity as fully opaque', () => {
    expect(toHex({ r: 0, g: 0, b: 0 }, 0.9995)).toBe('#000000')
  })
})

describe('resolvePaint', () => {
  it('drops hidden paints', () => {
    expect(resolvePaint({ ...solid(1, 0, 0, 1), visible: false })).toBeNull()
  })

  it('computes the CSS angle of a linear gradient from its handles', () => {
    // The app background: 135deg, #F2ECE6 -> #CCB8A3.
    const paint = resolvePaint({
      type: 'GRADIENT_LINEAR',
      gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      gradientStops: [
        { position: 0, color: { r: 0.949, g: 0.925, b: 0.902, a: 1 } },
        { position: 1, color: { r: 0.8, g: 0.722, b: 0.639, a: 1 } },
      ],
    })

    expect(paint.angle).toBe(135)
    expect(paint.stops.map((s) => s.color)).toEqual(['#F2ECE6', '#CCB8A3'])
    // Handles are kept because the angle is only literal on a square node.
    expect(paint.handles).toHaveLength(3)
  })

  it.each([
    [[{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], 180],
    [[{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], 90],
    [[{ x: 0.5, y: 1 }, { x: 0.5, y: 0 }], 0],
  ])('maps handles %j to %i degrees', (handles, expected) => {
    const paint = resolvePaint({
      type: 'GRADIENT_LINEAR', gradientHandlePositions: handles, gradientStops: [],
    })
    expect(paint.angle).toBe(expected)
  })

  it('references image fills without reaching for their bytes', () => {
    const paint = resolvePaint({ type: 'IMAGE', imageRef: 'abc123', scaleMode: 'FILL' })
    expect(paint).toEqual({ type: 'IMAGE', imageRef: 'abc123', scaleMode: 'FILL' })
  })
})

const STYLES = {
  's1': { name: 'Grey/100', styleType: 'FILL' },
  's2': { name: 'Poppins/14/Medium', styleType: 'TEXT' },
  's3': { name: 'Grey (OLD)/80', styleType: 'FILL' },
}

describe('pruneNode', () => {
  const node = {
    id: '1:2',
    name: 'Button',
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y: 0, width: 342.0001, height: 48 },
    layoutMode: 'HORIZONTAL',
    itemSpacing: 8,
    paddingLeft: 16,
    cornerRadius: 100,
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    visible: true,
    fills: [solid(0.1019607, 0.1019607, 0.1019607, 1)],
    styles: { fill: 's1' },
    // The bulk of a real file, and worthless once rendered.
    fillGeometry: [{ path: 'M0 0L342 0L342 48Z', windingRule: 'NONZERO' }],
    strokeGeometry: [{ path: 'M0 0L342 0' }],
    absoluteRenderBounds: { x: 0, y: 0, width: 342, height: 48 },
    children: [
      {
        id: '1:3',
        name: 'Label',
        type: 'TEXT',
        characters: 'Continue',
        styles: { text: 's2' },
        style: { fontFamily: 'Poppins', fontSize: 14, fontWeight: 500, lineHeightPx: 20.0004 },
      },
    ],
  }

  const pruned = pruneNode(node, { styles: STYLES })

  it('keeps identity, geometry and layout', () => {
    expect(pruned.id).toBe('1:2')
    expect(pruned.box).toEqual({ x: 0, y: 0, w: 342, h: 48 })
    expect(pruned.layoutMode).toBe('HORIZONTAL')
    expect(pruned.cornerRadius).toBe(100)
    expect(pruned.paddingLeft).toBe(16)
  })

  it('drops vector path data — this is what makes the snapshot committable', () => {
    expect(pruned.fillGeometry).toBeUndefined()
    expect(pruned.strokeGeometry).toBeUndefined()
    expect(pruned.absoluteRenderBounds).toBeUndefined()
  })

  it('omits properties sitting at their default', () => {
    expect(pruned).not.toHaveProperty('opacity')
    expect(pruned).not.toHaveProperty('blendMode')
    expect(pruned).not.toHaveProperty('visible')
  })

  it('resolves style ids to names, so the snapshot reads without a lookup table', () => {
    expect(pruned.styles).toEqual({ fill: 'Grey/100' })
    expect(pruned.fills).toEqual([{ type: 'SOLID', color: '#1A1A1A' }])
  })

  it('carries text content and its resolved type', () => {
    const label = pruned.children[0]
    expect(label.characters).toBe('Continue')
    expect(label.styles.text).toBe('Poppins/14/Medium')
    expect(label.text).toMatchObject({ fontSize: 14, fontWeight: 500, lineHeightPx: 20 })
  })

  it('leaves an unknown style id out rather than inventing a name', () => {
    const orphan = pruneNode({ id: '9:9', name: 'x', type: 'RECTANGLE', styles: { fill: 'gone' } }, { styles: STYLES })
    expect(orphan.styles).toBeUndefined()
  })

  it('resolves component instances to their set name', () => {
    const instance = pruneNode(
      { id: '4:4', name: 'Button', type: 'INSTANCE', componentId: 'c1' },
      {
        styles: STYLES,
        components: { c1: { name: 'State=Default', componentSetId: 'cs1' } },
        componentSets: { cs1: { name: 'v2 / Component / Button' } },
      },
    )
    expect(instance.component).toBe('State=Default')
    expect(instance.componentSet).toBe('v2 / Component / Button')
  })
})

describe('collectTokens', () => {
  const root = {
    id: '0', name: 'root', type: 'FRAME',
    children: [
      { id: '1', name: 'a', type: 'RECTANGLE', styles: { fill: 's1' }, fills: [solid(0.1019607, 0.1019607, 0.1019607, 1)] },
      { id: '2', name: 'b', type: 'RECTANGLE', styles: { fill: 's1' }, fills: [solid(0.1019607, 0.1019607, 0.1019607, 1)] },
      // Same style name, different resolved value — the file has drifted.
      { id: '3', name: 'c', type: 'RECTANGLE', styles: { fill: 's1' }, fills: [solid(1, 0, 0, 1)] },
      { id: '4', name: 'd', type: 'TEXT', styles: { text: 's2' }, style: { fontSize: 14, lineHeightPx: 20, fontWeight: 500 } },
      { id: '5', name: 'e', type: 'RECTANGLE', styles: { fill: 's3' }, fills: [solid(0.5, 0.5, 0.5, 1)] },
    ],
  }

  const { fills, text } = collectTokens(root, STYLES)

  it('counts uses per style name and picks the dominant value', () => {
    expect(total(fills.get('Grey/100'))).toBe(3)
    expect(dominant(fills.get('Grey/100'))).toBe('#1A1A1A')
  })

  it('retains every value a style resolved to, so drift is visible', () => {
    expect([...fills.get('Grey/100').keys()]).toEqual(['#1A1A1A', '#FF0000'])
  })

  it('records text styles as size/lineheight/weight', () => {
    expect(dominant(text.get('Poppins/14/Medium'))).toBe('14/20/500')
  })

  it('collects legacy styles too — they are reported, not silently dropped', () => {
    expect(fills.has('Grey (OLD)/80')).toBe(true)
    expect(isLegacy('Grey (OLD)/80')).toBe(true)
    expect(isLegacy('Grey/80')).toBe(false)
  })

  it('ignores fills with no style reference', () => {
    const bare = { id: '0', name: 'r', type: 'FRAME', fills: [solid(0, 1, 0, 1)] }
    expect(collectTokens(bare, STYLES).fills.size).toBe(0)
  })
})

describe('collectGeometry', () => {
  it('ranks each value by how often it is used', () => {
    const root = {
      id: '0', name: 'r', type: 'FRAME', cornerRadius: 8,
      children: [
        { id: '1', name: 'a', type: 'FRAME', cornerRadius: 4, itemSpacing: 8 },
        { id: '2', name: 'b', type: 'FRAME', cornerRadius: 4, itemSpacing: 8 },
        { id: '3', name: 'c', type: 'FRAME', cornerRadius: 4, itemSpacing: 16 },
      ],
    }
    expect(collectGeometry(root).cornerRadius).toEqual([{ value: 4, n: 3 }, { value: 8, n: 1 }])
    expect(collectGeometry(root).itemSpacing).toEqual([{ value: 8, n: 2 }, { value: 16, n: 1 }])
  })
})

describe('walk', () => {
  it('visits every node depth-first', () => {
    const root = { id: '0', children: [{ id: '1', children: [{ id: '2' }] }, { id: '3' }] }
    expect([...walk(root)].map((n) => n.id)).toEqual(['0', '1', '2', '3'])
  })
})

describe('slug', () => {
  it.each([
    ['v2 / Component / Button', 'v2-component-button'],
    ['Element / Icon / Heart Filled', 'element-icon-heart-filled'],
    ['  Spaces  ', 'spaces'],
    ['!!!', 'unnamed'],
  ])('%s -> %s', (input, expected) => {
    expect(slug(input)).toBe(expected)
  })
})
