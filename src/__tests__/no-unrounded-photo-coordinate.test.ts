import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The unrounded photo coordinate must not leave `resolvePhotoLocation`.
 *
 * `openspec/changes/…/design.md` §D7 states the rule the whole postcard location
 * model rests on:
 *
 * > the unrounded coordinate leaves the device only as part of a `precise` write
 * > the rider explicitly chose. Nothing else — not a lookup, not a bias, not a
 * > log — may carry it.
 *
 * **As shipped that is prose.** It is testable for the paths it names and it
 * quantifies over paths not yet built, and nothing gated it: the rounding lives
 * inside `reverseGeocodePlace`, and the RLS suite cannot see client behaviour at
 * all. This repo's idiom for a universal negative is a tripwire that fails the
 * build — `no-service-role-key.test.ts`, `isomorphic.test.ts`,
 * `use-server-exports.test.ts` — and this is that file for §D7.
 *
 * ## The three things it holds, and why it takes all three
 *
 * 1. **The holder set is pinned.** A file that imports `ExifCapture` or one of
 *    its parsers is a file that can carry an unrounded fix. PD-278 names the
 *    trigger exactly — *"it rises the first time somebody adds a second reader of
 *    `ExifCapture`"* — so a new holder fails here and has to be declared. This is
 *    the control that catches a whole-object leak (`log(capture)`) in a file that
 *    never writes `.latitude` at all.
 * 2. **Inside a holder, every coordinate read is classified individually.** Not
 *    per line — see the box below, which is the correction that made this test
 *    real rather than decorative.
 * 3. **`reverseGeocodePlace` rounds both parameters.** It is on the sanctioned
 *    sink list *because* it rounds at its own entry, so without this assertion
 *    the list is a claim about a function nothing checks — delete the rounding
 *    and every call site is unchanged, so (2) still passes. That is the same
 *    defect one level up that PD-278 warns about for the detector itself.
 *
 * ---------------------------------------------------------------------------
 * A sanction clears ONE READ, never a line — and the first draft got this wrong
 * ---------------------------------------------------------------------------
 * The pre-merge review found five separate holes with one shape: each sanction
 * tested the whole line, so a partial match waved through everything else on it.
 * The ordinary form of this leak shipped green —
 *
 *     const exactLat = upload.status === 'done' ? upload.capture.latitude : null
 *     console.info('[dbg]', exactLat)
 *
 * — because line one *declares something* and the declaration sanction matched
 * `(?:const|let|var)\s.*capture`. `if (c.latitude !== null) logRaw(c.latitude)`
 * went the same way on the presence-test sanction, and
 * `return { lat: c.latitude }` on the `return` sanction.
 *
 * So the unit of classification is **the individual read, at its offset**, and a
 * read is sanctioned only by a fact about *itself*: it is compared to
 * null/undefined, or it sits inside the still-open parentheses of a sanctioned
 * call. Line-level sanctions survive only for mentions of the binding that read
 * **no coordinate at all** (`return { path, capture }`, a type annotation), where
 * there is no coordinate to leak and the holder assertion bounds the flow.
 *
 * ## What it cannot see, stated rather than implied
 *
 * It is a source scan, like `no-service-role-key.test.ts` and with the same
 * honesty about its reach:
 *
 * - **It does not follow aliases across lines.** It flags the read that creates
 *   one (`const lat = capture.latitude`), which is the line an author writes; it
 *   does not then track `lat`. A coordinate laundered through an `any`, a
 *   module-level variable read three files away, or computed member access
 *   (`c['lat' + 'itude']`) is outside it.
 * - **`src/lib/media/location.ts` is exempt wholesale**, so a *new* function
 *   added beside `resolvePhotoLocation` could emit the unrounded value with no
 *   coverage here — and that is the likeliest place for one. `location.test.ts`
 *   pins `resolvePhotoLocation`'s own five shapes, not its future siblings.
 * - **A `HOLDERS` row with an empty binding list classifies nothing**, so a
 *   binding added to `src/lib/media/index.ts` passes vacuously until it is listed.
 * - **`__tests__` directories are skipped**, so a test file importing
 *   `ExifCapture` never registers as a holder.
 *
 * ---------------------------------------------------------------------------
 * Comment lines are stripped first, and that is not a convenience
 * ---------------------------------------------------------------------------
 * `CLAUDE.md` §Technology Decisions calls this repo's most-repeated measurement
 * error by name: a file's description of what it must not do looks exactly like
 * the thing it must not do, and the files in this scan are unusually full of such
 * prose — `location.ts` and `places.ts` both explain the rounding at length. So
 * comment lines are stripped, and **the filter is verified both ways**: that it
 * reads clean now, and that it still catches a real instance. The second half is
 * the last `describe` in this file, and it carries every shape the review used to
 * break the first draft. Without it a detector that has quietly stopped matching
 * passes for ever and looks exactly like a clean repo.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const srcRoot = path.resolve(repoRoot, 'src')

/**
 * Where the coordinate is born and where it is decided — the two exemptions the
 * rule itself names.
 *
 * `exif.ts` parses the fix out of the file, so it is the one place that must
 * handle it unrounded. `location.ts` holds `resolvePhotoLocation`, which §D7
 * names as the boundary: it is the only function allowed to emit the unrounded
 * value, and only under the `precise` marker. That the five shapes it emits are
 * correct is `src/lib/media/__tests__/location.test.ts`'s job, not this file's.
 * The cost of exempting it whole is written in the header.
 */
const EXEMPT = new Set(['src/lib/media/exif.ts', 'src/lib/media/location.ts'])

/**
 * Every file allowed to hold an `ExifCapture`, with the identifiers it binds one
 * to.
 *
 * Adding a row here is the deliberate act this test exists to force. It is not a
 * rubber stamp: a new holder means a new path the unrounded fix can travel, and
 * the bindings listed are what section (2) then classifies every read off.
 */
const HOLDERS: Record<string, string[]> = {
  // Barrel. Re-exports the type and its parsers; binds nothing.
  'src/lib/media/index.ts': [],
  // Reads the fix off the file during upload and hands it straight back.
  'src/lib/media/upload.ts': ['capture'],
  // The composer. The only screen that holds a fix, and the only place a
  // coordinate read is anything other than a presence test.
  'src/components/postcards/CreatePostcardForm.tsx': ['capture'],
}

/** Producers of an `ExifCapture`. A file naming one can hold an unrounded fix. */
const CAPTURE_IMPORT = /\b(ExifCapture|readExifCapture|parseExifCapture|parseHeifExifPayload)\b/

/**
 * The functions a capture, or a coordinate off one, may be handed to.
 *
 * - `resolvePhotoLocation` — §D7's boundary itself.
 * - `roundToCoarseGrid` — the rounding helper; its whole purpose.
 * - `reverseGeocodePlace` — safe *because* it rounds at entry, which is section
 *   (3) below and not taken on trust.
 * - `uploadPostcardImage` — produces the capture rather than consuming one.
 */
const SANCTIONED_SINKS = [
  'resolvePhotoLocation',
  'roundToCoarseGrid',
  'reverseGeocodePlace',
  'uploadPostcardImage',
]

/** Fields on an `ExifCapture` that are not the fix and carry no location. */
const NON_COORDINATE_FIELDS = ['takenAt', 'takenAtOffsetMinutes']

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage', '__tests__'])

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Strip whole-line comments, in the syntaxes this repo commits. Deliberately
 * conservative: only lines that are ENTIRELY a comment go, so
 * `foo(capture.latitude) // note` is still classified.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const t = line.trim()
      const isComment =
        t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')
      return isComment ? '' : line
    })
    .join('\n')
}

/**
 * Is this read compared against null/undefined, and therefore a presence test?
 *
 * A presence test discloses nothing — it asks whether a fix exists, never what it
 * is. Judged at the read's own offset, in both directions, so
 * `if (c.latitude !== null) logRaw(c.latitude)` sanctions the first read and
 * leaves the second to be caught.
 */
function isPresenceRead(line: string, start: number, length: number): boolean {
  const after = line.slice(start + length)
  if (/^\s*(?:===?|!==?)\s*(?:null|undefined)\b/.test(after)) return true
  const before = line.slice(0, start)
  if (/(?:null|undefined)\s*(?:===?|!==?)\s*$/.test(before)) return true
  return false
}

/**
 * Does `prefix` end inside the still-open parentheses of a sanctioned call?
 *
 * Walking the depth is what makes this directional. Testing only that a sink name
 * appears in the window — the first draft — waved through anything written within
 * three lines *below* a completed call, so
 * `void resolvePhotoLocation(a, b, c)` followed by `analytics.emit(c.latitude)`
 * passed. Here the walk from `resolvePhotoLocation(` returns to depth 0 at its
 * own `)`, so it no longer covers what follows.
 */
function insideSanctionedCall(prefix: string): boolean {
  for (const sink of SANCTIONED_SINKS) {
    for (let at = prefix.indexOf(`${sink}(`); at !== -1; at = prefix.indexOf(`${sink}(`, at + 1)) {
      let depth = 0
      let closed = false
      for (let i = at + sink.length; i < prefix.length; i++) {
        if (prefix[i] === '(') depth++
        else if (prefix[i] === ')') depth--
        if (depth === 0) {
          closed = true
          break
        }
      }
      // Never closed before the read, so the read is one of its arguments.
      if (!closed) return true
    }
  }
  return false
}

/**
 * Classify every use of a capture binding inside one holder file.
 *
 * Two passes with different units, because they answer different questions.
 *
 * **A coordinate read** is judged on its own: sanctioned only if it is a presence
 * test, or an argument to a sanctioned call. Nothing else about the line can
 * excuse it.
 *
 * **A mention that reads no coordinate** — `return { path, capture }`, a type
 * annotation, storing the object in state — is judged per line, which is safe
 * because there is no coordinate on that line to leak and assertion (1) bounds
 * where the object itself can travel.
 *
 * The lookback is three non-empty lines, because
 * `resolvePhotoLocation(mode, capture ?? {…})` is written across three lines in
 * the composer and the argument line carries no callee. Three is the smallest
 * window spanning the calls actually written here.
 */
function classify(source: string, bindings: string[]): string[] {
  const violations: string[] = []
  const lines = stripCommentLines(source).split('\n')

  lines.forEach((line, index) => {
    const lookback = [lines[index - 3], lines[index - 2], lines[index - 1]]
      .filter((l) => l && l.trim() !== '')
      .join(' ')

    for (const binding of bindings) {
      if (!new RegExp(String.raw`\b${binding}\b`).test(line)) continue

      // ---- Pass 1: every coordinate read, judged at its own offset.
      const reads = new RegExp(
        String.raw`\b${binding}(?:\?)?\.(?:latitude|longitude)\b`,
        'g',
      )
      let read: RegExpExecArray | null
      let sawRead = false
      while ((read = reads.exec(line)) !== null) {
        sawRead = true
        if (isPresenceRead(line, read.index, read[0].length)) continue
        if (insideSanctionedCall(`${lookback} ${line.slice(0, read.index)}`)) continue
        violations.push(`${index + 1}: ${line.trim()}`)
      }
      if (sawRead) continue

      // ---- Pass 2: a mention carrying no coordinate.
      if (new RegExp(String.raw`\b${binding}\s*:\s*ExifCapture`).test(line)) continue
      if (new RegExp(String.raw`(?:const|let|var)\s+[^=]*\b${binding}\b[^=]*=`).test(line)) continue
      if (new RegExp(String.raw`!\s*${binding}\b`).test(line)) continue
      if (
        NON_COORDINATE_FIELDS.some((f) =>
          new RegExp(String.raw`${binding}(?:\?)?\.${f}\b`).test(line),
        )
      )
        continue
      if (insideSanctionedCall(`${lookback} ${line}`)) continue
      if (new RegExp(String.raw`set[A-Z]\w*\(\{[^}]*\b${binding}\b`).test(line)) continue
      // Returning it hands it to a caller, and every caller is a file that
      // imports the type — so assertion (1) is what bounds this flow. It reaches
      // only whole-object returns: a `return` carrying a coordinate was already
      // judged in pass 1.
      if (new RegExp(String.raw`^\s*return\b.*\b${binding}\b`).test(line)) continue

      violations.push(`${index + 1}: ${line.trim()}`)
    }
  })

  return violations
}

/**
 * Does `reverseGeocodePlace` still round both parameters before anything leaves?
 *
 * Returns the unrounded uses it found, so an empty array is the passing answer
 * and the detector can be checked against a mutated body.
 */
function unroundedUsesInReverseGeocode(source: string): string[] {
  const start = source.indexOf('export async function reverseGeocodePlace(')
  if (start === -1)
    return ['reverseGeocodePlace is gone — the sink list names a function that no longer exists']

  // To the next top-level export, which bounds the body. Slice from `start`, not
  // `start + 1`: dropping the leading `e` leaves the signature unmatchable by the
  // strip below, and its `latitude: number` parameter list then reads as a raw
  // use — a false positive that looks exactly like a real finding.
  //
  // The terminator is a bare `\nexport `, not a list of declaration keywords.
  // `reverseGeocodePlace` is currently the LAST export in the file, so a narrower
  // pattern finds nothing, runs to EOF and passes for a reason it does not
  // intend — and `places.ts` already declares `export class` three times, so the
  // spelling that would overrun is idiomatic here.
  const after = source.slice(start)
  const end = after.indexOf('\nexport ')
  const body = stripCommentLines(after.slice(0, end === -1 ? undefined : end))

  const missing = ['latitude', 'longitude']
    .filter((p) => !body.includes(`roundToCoarseGrid(${p})`))
    .map((p) => `${p} is never passed to roundToCoarseGrid`)

  // Every remaining mention of the raw parameter must be the signature or the
  // finiteness guard. Anything else is the raw value being used.
  const residual = body
    .replace(/export async function reverseGeocodePlace\([^)]*\)/, '')
    .replace(/roundToCoarseGrid\((?:latitude|longitude)\)/g, '')
    .replace(/Number\.isFinite\((?:latitude|longitude)\)/g, '')

  const leaked = ['latitude', 'longitude'].filter((p) =>
    new RegExp(String.raw`\b${p}\b`).test(residual),
  )

  return [...missing, ...leaked.map((p) => `${p} is used raw somewhere other than the rounding`)]
}

describe('the unrounded photo coordinate does not leave resolvePhotoLocation', () => {
  const files = walk(srcRoot)

  it('walks a non-trivial number of files, so a broken walk fails loudly', () => {
    // Without this, a bad path makes every assertion below pass over an empty
    // list — a guard reporting success having checked nothing at all.
    expect(files.length).toBeGreaterThan(100)
  })

  it('only the declared files hold an ExifCapture', () => {
    const holders = files
      .filter((f) => CAPTURE_IMPORT.test(stripCommentLines(readFileSync(f, 'utf8'))))
      .map((f) => path.relative(repoRoot, f).split(path.sep).join('/'))
      .filter((rel) => !EXEMPT.has(rel))
      .sort()

    // A new reader is PD-278's own named trigger. Declaring it in HOLDERS is the
    // deliberate act; until then this fails and says which file appeared.
    expect(holders).toEqual(Object.keys(HOLDERS).sort())
  })

  it('finds the coordinate reads it is meant to be classifying', () => {
    // The anti-vacuity check for section (2): if the bindings stopped matching —
    // a rename, a refactor — every classification below would pass over nothing.
    const composer = readFileSync(
      path.join(repoRoot, 'src/components/postcards/CreatePostcardForm.tsx'),
      'utf8',
    )
    const reads =
      stripCommentLines(composer).match(/\bcapture(?:\?)?\.(latitude|longitude)\b/g) ?? []
    expect(reads.length).toBeGreaterThanOrEqual(4)
  })

  it.each(Object.entries(HOLDERS))(
    '%s uses its capture only in sanctioned ways',
    (rel, bindings) => {
      const file = path.join(repoRoot, rel)
      expect(existsSync(file)).toBe(true)
      expect(classify(readFileSync(file, 'utf8'), bindings)).toEqual([])
    },
  )

  it('reverseGeocodePlace rounds both parameters, which is why it is a sanctioned sink', () => {
    const source = readFileSync(path.join(repoRoot, 'src/lib/data/places.ts'), 'utf8')
    expect(unroundedUsesInReverseGeocode(source)).toEqual([])
  })
})

/**
 * The other half of the filter check, per PD-278: a detector that has quietly
 * stopped matching anything passes every assertion above for ever.
 *
 * **Every shape the pre-merge review used to defeat the first draft is here**,
 * because each was a silent pass at the time and would be again under a
 * "simplification" back to line-level sanctions.
 */
describe('the detectors still catch a real violation', () => {
  it('catches the plain shapes', () => {
    expect(classify('console.log(capture.latitude)', ['capture'])).toHaveLength(1)
    expect(classify('void track({ lat: capture.latitude })', ['capture'])).toHaveLength(1)
    // The whole object handed somewhere new — the leak that writes no `.latitude`.
    expect(classify('await sendToVendor(capture)', ['capture'])).toHaveLength(1)
  })

  it('catches a coordinate aliased into a declaration — the review’s F1', () => {
    // The first draft cleared this because the line declares SOMETHING and
    // mentions the binding. It is §D7's own named prohibition ("not a log").
    expect(
      classify("const exactLat = upload.status === 'done' ? capture.latitude : null", ['capture']),
    ).toHaveLength(1)
    expect(classify('let lat = capture.latitude', ['capture'])).toHaveLength(1)
  })

  it('does not let a sanctioned call cover the lines below it — the review’s F2', () => {
    expect(
      classify(
        [
          'void resolvePhotoLocation(a, b, c)',
          'foo()',
          'bar()',
          'analytics.emit(capture.latitude)',
        ].join('\n'),
        ['capture'],
      ),
    ).toHaveLength(1)
  })

  it('catches a coordinate in a return, while a whole-object return stays safe — F3', () => {
    expect(classify('  return { lat: capture.latitude, lon: capture.longitude }', ['capture']))
      .toHaveLength(2)
    expect(classify('  return <Map lat={capture.latitude} />', ['capture'])).toHaveLength(1)
    expect(classify('  return { path, capture }', ['capture'])).toEqual([])
  })

  it('catches a raw coordinate put into state — the review’s F4', () => {
    expect(classify('setForm({ exactLat: capture.latitude })', ['capture'])).toHaveLength(1)
    expect(classify("setUpload({ status: 'done', path, capture })", ['capture'])).toEqual([])
  })

  it('sanctions one read without clearing the rest of the line — the review’s F5', () => {
    expect(
      classify('if (capture.latitude !== null) logRaw(capture.latitude)', ['capture']),
    ).toHaveLength(1)
    expect(
      classify('<input value={capture.takenAt} data-lat={capture.latitude} />', ['capture']),
    ).toHaveLength(1)
    expect(classify('emit({ missing: !capture, lat: capture.latitude })', ['capture'])).toHaveLength(
      1,
    )
  })

  it('classifies every binding, not only the first to hit a sanction — the review’s F6', () => {
    // `HOLDERS` is typed for several bindings per file. The first draft `return`ed
    // out of the forEach callback, so a sanction on one binding ended the line for
    // all of them — latent today, live the moment the second binding is used.
    expect(classify('const capture = x; logRaw(fix.latitude)', ['capture', 'fix'])).toHaveLength(1)
  })

  it('does not flag the shapes that are genuinely safe', () => {
    expect(classify('if (capture.latitude === null) return', ['capture'])).toEqual([])
    expect(classify('if (capture.longitude !== null) go()', ['capture'])).toEqual([])
    expect(classify('if (!capture) return', ['capture'])).toEqual([])
    expect(
      classify('void reverseGeocodePlace(capture.latitude, capture.longitude)', ['capture']),
    ).toEqual([])
    expect(classify('const capture = await readExifCapture(file)', ['capture'])).toEqual([])
    expect(classify('const { path, capture } = await uploadPostcardImage(file)', ['capture'])).toEqual(
      [],
    )
    expect(classify('<input value={capture.takenAt} />', ['capture'])).toEqual([])
    // The multi-line call the lookback exists for.
    expect(
      classify(
        [
          'const location = resolvePhotoLocation(',
          '  activeMode,',
          '  capture ?? { latitude: null },',
          ')',
        ].join('\n'),
        ['capture'],
      ),
    ).toEqual([])
  })

  it('the comment strip works, and does not hide a real read behind a trailing comment', () => {
    expect(classify('// never log capture.latitude here', ['capture'])).toEqual([])
    expect(classify(' * capture.latitude must not be logged', ['capture'])).toEqual([])
    expect(classify('console.log(capture.latitude) // debugging', ['capture'])).toHaveLength(1)
  })

  it('catches the rounding being removed from reverseGeocodePlace', () => {
    const source = readFileSync(path.join(repoRoot, 'src/lib/data/places.ts'), 'utf8')

    // Exactly the regression the sink list cannot see: every call site unchanged,
    // the raw fix sent to the vendor.
    const mutated = source.replace(
      'const at = { lat: roundToCoarseGrid(latitude), lon: roundToCoarseGrid(longitude) }',
      'const at = { lat: latitude, lon: longitude }',
    )
    expect(mutated).not.toBe(source)
    expect(unroundedUsesInReverseGeocode(mutated).length).toBeGreaterThan(0)
  })

  it('bounds the body at the next export of any kind — the review’s F8', () => {
    // `reverseGeocodePlace` is the last export in `places.ts`, so a terminator
    // listing only `function`/`const` runs to EOF and passes by accident.
    const body = [
      'export async function reverseGeocodePlace(latitude: number, longitude: number) {',
      '  const at = { lat: roundToCoarseGrid(latitude), lon: roundToCoarseGrid(longitude) }',
      '  return at',
      '}',
      '',
      'export class Later { m() { return latitude } }',
    ].join('\n')
    expect(unroundedUsesInReverseGeocode(body)).toEqual([])
  })

  it('catches the function being renamed out from under the sink list', () => {
    expect(unroundedUsesInReverseGeocode('export const nothing = 1')).toHaveLength(1)
  })
})
