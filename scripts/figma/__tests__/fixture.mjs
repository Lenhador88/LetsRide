/**
 * A miniature Figma file response, shaped like the real one. It deliberately
 * includes the cases that have actually caused trouble: a SECTION wrapper, two
 * different nodes sharing a name, float32 opacity and line heights, a legacy
 * `(OLD)` style still live inside a v2 component, and vector path data that must
 * not survive extraction.
 */
const GREY_100 = { r: 0.1019607, g: 0.1019607, b: 0.1019607 }
const GREEN = { r: 0.239, g: 0.6, b: 0.42 }

const text = (id, name, characters, styleId) => ({
  id, name, type: 'TEXT', characters,
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
  styles: { text: styleId },
  style: { fontFamily: 'Poppins', fontSize: 14, fontWeight: 500, lineHeightPx: 20.00004 },
})

const rect = (id, name, styleId, color) => ({
  id, name, type: 'RECTANGLE',
  absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
  cornerRadius: 8,
  fills: [{ type: 'SOLID', color, opacity: 1 }],
  styles: { fill: styleId },
  fillGeometry: [{ path: 'M0 0L50 0L50 50Z'.repeat(200), windingRule: 'NONZERO' }],
  absoluteRenderBounds: { x: 0, y: 0, width: 50, height: 50 },
})

export const file = {
  name: 'LR - Mobile App',
  lastModified: '2026-06-04T10:00:00Z',
  version: '1234567890',
  document: {
    id: '0:0', name: 'Document', type: 'DOCUMENT',
    children: [
      {
        id: '0:1', name: 'Design', type: 'CANVAS',
        children: [
          {
            id: '10:1', name: 'Home / Feed', type: 'FRAME',
            absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
            layoutMode: 'VERTICAL', itemSpacing: 16, paddingLeft: 16, paddingTop: 24,
            fills: [{
              type: 'GRADIENT_LINEAR',
              gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
              gradientStops: [
                { position: 0, color: { r: 0.949, g: 0.925, b: 0.902, a: 1 } },
                { position: 1, color: { r: 0.8, g: 0.722, b: 0.639, a: 1 } },
              ],
            }],
            children: [
              text('10:2', 'Title', 'Postcards', 'style-text-1'),
              rect('10:3', 'Cover', 'style-fill-1', GREY_100),
              { id: '10:4', name: 'Element / Icon / Heart Filled', type: 'COMPONENT', absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 } },
              { id: '10:5', name: 'Element / Icon / Bike', type: 'COMPONENT', absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 } },
            ],
          },
          {
            id: '11:1', name: 'Section wrapper', type: 'SECTION',
            children: [{
              id: '11:2', name: 'Create Postcard', type: 'FRAME',
              absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
              children: [text('11:3', 'CTA', 'Share a postcard', 'style-text-1')],
            }],
          },
        ],
      },
      {
        id: '50:559', name: 'Components', type: 'CANVAS',
        children: [
          {
            id: '20:1', name: 'v2 / Component / Button', type: 'COMPONENT_SET',
            absoluteBoundingBox: { x: 0, y: 0, width: 342, height: 200 },
            componentPropertyDefinitions: {
              State: { type: 'VARIANT', defaultValue: 'Default', variantOptions: ['Default', 'Disabled'] },
            },
            children: [
              {
                id: '20:2', name: 'State=Default', type: 'COMPONENT',
                cornerRadius: 100, itemSpacing: 8, paddingLeft: 16,
                absoluteBoundingBox: { x: 0, y: 0, width: 342, height: 48 },
                fills: [{ type: 'SOLID', color: GREY_100, opacity: 1 }],
                styles: { fill: 'style-fill-1' },
                children: [text('20:3', 'Label', 'Continue', 'style-text-1')],
              },
              {
                id: '20:4', name: 'State=Disabled', type: 'COMPONENT', cornerRadius: 100,
                absoluteBoundingBox: { x: 0, y: 0, width: 342, height: 48 },
                fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.10000000149011612 }],
                styles: { fill: 'style-fill-3' },
              },
            ],
          },
          {
            id: '21:1', name: 'v2 / Component / Card', type: 'COMPONENT', cornerRadius: 12,
            absoluteBoundingBox: { x: 0, y: 0, width: 342, height: 120 },
            children: [rect('21:2', 'Accent', 'style-fill-2', GREEN)],
          },
          // Shares a name with the frame on the Design page — must not overwrite it.
          { id: '22:1', name: 'Home / Feed', type: 'COMPONENT', absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } },
          {
            id: '23:1', name: 'v2 / Component / Chip', type: 'COMPONENT', cornerRadius: 4,
            absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 24 },
            children: [rect('23:2', 'bg', 'style-fill-old', { r: 0.5, g: 0.5, b: 0.5 })],
          },
        ],
      },
    ],
  },
  components: {
    '20:2': { key: 'k1', name: 'State=Default', componentSetId: '20:1' },
    '20:4': { key: 'k2', name: 'State=Disabled', componentSetId: '20:1' },
  },
  componentSets: { '20:1': { key: 'ks1', name: 'v2 / Component / Button' } },
  styles: {
    'style-fill-1': { key: 'f1', name: 'Grey/100', styleType: 'FILL' },
    'style-fill-2': { key: 'f2', name: 'Accent Brand/100', styleType: 'FILL' },
    'style-fill-3': { key: 'f3', name: 'Grey/10%', styleType: 'FILL' },
    'style-fill-old': { key: 'f4', name: 'Grey (OLD)/80', styleType: 'FILL' },
    'style-text-1': { key: 't1', name: 'Poppins/14/Medium', styleType: 'TEXT' },
  },
}

export const provenance = {
  fileKey: 'gDoteM1ow1AZpSEGSNhpc7',
  route: 'files/gDoteM1ow1AZpSEGSNhpc7',
  pulledAt: '2026-08-03T12:00:00.000Z',
  latestVersionId: 'v-fixture-1',
}
