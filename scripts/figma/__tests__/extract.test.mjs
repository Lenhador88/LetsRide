/**
 * End-to-end cover for the offline stage: runs the real extract.mjs against a
 * fixture in a scratch directory. This is the stage that runs unattended once a
 * month, so its orchestration — not just its pure helpers — is worth pinning.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { file, provenance } from './fixture.mjs'

const run = promisify(execFile)
const EXTRACT = fileURLToPath(new URL('../extract.mjs', import.meta.url))

let raw
let design
let stdout

const read = async (relative) => JSON.parse(await readFile(path.join(design, relative), 'utf8'))

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'figma-extract-'))
  raw = path.join(root, 'raw')
  design = path.join(root, 'design')
  await mkdir(raw, { recursive: true })
  await writeFile(path.join(raw, 'file.json'), JSON.stringify(file))
  await writeFile(path.join(raw, 'provenance.json'), JSON.stringify(provenance))

  // A stale artifact from a previous run — extraction must clear it.
  await mkdir(path.join(design, 'frames'), { recursive: true })
  await writeFile(path.join(design, 'frames', 'renamed-last-month.json'), '{}')

  ;({ stdout } = await run('node', [EXTRACT], {
    env: { ...process.env, FIGMA_RAW_DIR: raw, FIGMA_DESIGN_DIR: design },
  }))
}, 30_000)

afterAll(async () => {
  if (raw) await rm(path.dirname(raw), { recursive: true, force: true })
})

describe('extract', () => {
  it('writes one file per top-level frame and component', async () => {
    const index = await read('index.json')
    expect(index.frames.map((f) => f.name)).toEqual([
      'Home / Feed',
      'Create Postcard',
      'Nested Screen',
    ])
    expect(index.components.map((c) => c.name)).toContain('v2 / Component / Button')
  })

  it('descends into SECTION wrappers rather than treating them as screens', async () => {
    const index = await read('index.json')
    expect(index.frames.map((f) => f.name)).not.toContain('Section wrapper')
    expect(index.frames.find((f) => f.name === 'Create Postcard').id).toBe('11:2')
  })

  it('records the section path, which is what tells same-named screens apart', async () => {
    // Recursing into nested sections made every screen addressable but made the
    // *names* ambiguous — six real frames are called `Home - Postcards - All new`,
    // one per flow. The flow is the disambiguator, so it has to be in the index.
    const index = await read('index.json')
    expect(index.frames.find((f) => f.name === 'Nested Screen').section)
      .toBe('Section wrapper / Inner section')
    expect(index.frames.find((f) => f.name === 'Create Postcard').section).toBe('Section wrapper')
    expect(index.frames.find((f) => f.name === 'Home / Feed').section).toBeNull()
  })

  it('descends through *nested* sections, so every screen is addressable by name', async () => {
    // The real file groups flows in an outer section whose children are sections.
    // Stopping at one level indexed the flow and hid the screens inside it, so
    // `figma -- tree "Home - Postcards - All new"` could not resolve.
    const index = await read('index.json')
    expect(index.frames.map((f) => f.name)).not.toContain('Inner section')
    expect(index.frames.find((f) => f.name === 'Nested Screen').id).toBe('11:5')
  })

  it('disambiguates two nodes sharing a name instead of overwriting one', async () => {
    const index = await read('index.json')
    const files = [...index.frames, ...index.components]
      .filter((e) => e.name === 'Home / Feed')
      .map((e) => e.file)

    expect(files).toEqual(['frames/home-feed.json', 'components/home-feed-2.json'])
    expect((await read(files[0])).id).toBe('10:1')
    expect((await read(files[1])).id).toBe('22:1')
  })

  it('deletes artifacts orphaned by a rename', async () => {
    const frames = await readdir(path.join(design, 'frames'))
    expect(frames).not.toContain('renamed-last-month.json')
  })

  it('records the page a node came from', async () => {
    expect((await read('frames/home-feed.json')).page).toBe('Design')
    expect((await read('components/v2-component-button.json')).page).toBe('Components')
  })

  it('resolves the app background gradient to a CSS angle and hex stops', async () => {
    const [fill] = (await read('frames/home-feed.json')).fills
    expect(fill.angle).toBe(135)
    expect(fill.stops.map((s) => s.color)).toEqual(['#F2ECE6', '#CCB8A3'])
  })

  it('separates legacy (OLD) styles from the live token set', async () => {
    const tokens = await read('tokens.json')
    expect(tokens.colors.map((c) => c.name)).not.toContain('Grey (OLD)/80')
    expect(tokens.legacy.map((c) => c.name)).toEqual(['Grey (OLD)/80'])
  })

  it('snaps float32 opacity so Grey/10% is #0000001A, not #00000019', async () => {
    const tokens = await read('tokens.json')
    expect(tokens.colors.find((c) => c.name === 'Grey/10%').value).toBe('#0000001A')
  })

  it('rounds float32 line height out of the type table', async () => {
    const tokens = await read('tokens.json')
    expect(tokens.type.find((t) => t.name === 'Poppins/14/Medium')).toMatchObject({
      fontSize: 14, lineHeight: 20, fontWeight: 500,
    })
    expect(await readFile(path.join(design, 'TOKENS.md'), 'utf8')).toContain('| 14 / 20 |')
  })

  it('indexes icons by name without exporting them', async () => {
    const icons = await read('icons/index.json')
    expect(icons.icons.map((i) => i.slug)).toEqual(['bike', 'heart-filled'])
    expect(icons.count).toBe(2)
    expect(stdout).toContain('npm run figma:icons')
  })

  it('carries text content and its resolved type token', async () => {
    const title = (await read('frames/home-feed.json')).children[0]
    expect(title.characters).toBe('Postcards')
    expect(title.styles.text).toBe('Poppins/14/Medium')
  })

  it('drops vector path data — the reason the snapshot fits in git', async () => {
    const body = await readFile(path.join(design, 'frames/home-feed.json'), 'utf8')
    expect(body).not.toContain('fillGeometry')
    expect(body).not.toContain('absoluteRenderBounds')
    expect(body.length).toBeLessThan(4000)
  })

  it('records provenance so staleness can be judged without a re-pull', async () => {
    const manifest = await read('manifest.json')
    expect(manifest).toMatchObject({
      fileName: 'LR - Mobile App',
      lastModified: '2026-06-04T10:00:00Z',
      latestVersionId: 'v-fixture-1',
      pulledAt: provenance.pulledAt,
    })
    expect(manifest.counts).toMatchObject({ pages: 2, frames: 3, components: 4, componentSets: 1 })
  })

  it('is deterministic — a second run reproduces the same bytes', async () => {
    const before = await readFile(path.join(design, 'index.json'), 'utf8')
    await run('node', [EXTRACT], {
      env: { ...process.env, FIGMA_RAW_DIR: raw, FIGMA_DESIGN_DIR: design },
    })
    expect(await readFile(path.join(design, 'index.json'), 'utf8')).toBe(before)
  })
})
