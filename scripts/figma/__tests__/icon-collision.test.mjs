/**
 * PD-261 end-to-end cover: a full `extract.mjs` run over a raw file shaped
 * like the real collision — a real `Element / Icon / Chevron Down` COMPONENT
 * on the icons page, and a same-named INSTANCE dropped into an unrelated
 * scratch frame that walks after it. Before the fix, `figma:extract` would
 * silently re-point `design/icons/index.json` at the instance's id.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const EXTRACT = fileURLToPath(new URL('../extract.mjs', import.meta.url))

const file = {
  name: 'LR - Mobile App',
  lastModified: '2026-08-17T00:00:00Z',
  version: '999',
  document: {
    id: '0:0', name: 'Document', type: 'DOCUMENT',
    children: [
      {
        id: '0:1', name: 'Icons', type: 'CANVAS',
        children: [
          // The real component — must survive the collision.
          { id: '1:1', name: 'Element / Icon / Chevron Down', type: 'COMPONENT' },
          { id: '1:2', name: 'Element / Icon / Bike', type: 'COMPONENT' },
        ],
      },
      {
        id: '0:2', name: 'AI / Clubs one screen / 2026-08-17', type: 'CANVAS',
        children: [
          {
            id: '9:1', name: 'Scratch frame', type: 'FRAME',
            children: [
              // A scratch instance sharing the real icon's name, walked after
              // the canvas above — this is what used to win.
              { id: '9:2', name: 'Element / Icon / Chevron Down', type: 'INSTANCE' },
            ],
          },
        ],
      },
    ],
  },
  components: {}, componentSets: {}, styles: {},
}

let raw
let design
let stdout

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'figma-icon-collision-'))
  raw = path.join(root, 'raw')
  design = path.join(root, 'design')
  await mkdir(raw, { recursive: true })
  await writeFile(path.join(raw, 'file.json'), JSON.stringify(file))

  ;({ stdout } = await run('node', [EXTRACT], {
    env: { ...process.env, FIGMA_RAW_DIR: raw, FIGMA_DESIGN_DIR: design },
  }))
}, 30_000)

afterAll(async () => {
  if (raw) await rm(path.dirname(raw), { recursive: true, force: true })
})

describe('extract — icon name collisions (PD-261)', () => {
  it('resolves Chevron Down to the real COMPONENT, not the scratch INSTANCE', async () => {
    const icons = JSON.parse(await readFile(path.join(design, 'icons/index.json'), 'utf8'))
    const chevron = icons.icons.find((i) => i.name === 'Chevron Down')
    expect(chevron.id).toBe('1:1')
  })

  it('leaves the uncontested icon untouched', async () => {
    const icons = JSON.parse(await readFile(path.join(design, 'icons/index.json'), 'utf8'))
    expect(icons.icons.find((i) => i.name === 'Bike').id).toBe('1:2')
    expect(icons.count).toBe(2)
  })

  it('prints which collisions it resolved, and what it chose over what', () => {
    expect(stdout).toContain('1 icon name collision(s) resolved')
    expect(stdout).toContain('Chevron Down: kept COMPONENT 1:1')
    expect(stdout).toContain('INSTANCE 9:2')
  })
})
