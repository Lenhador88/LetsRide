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
 * 2. **Inside a holder, every mention of the capture is classified.** Not only
 *    coordinate reads: any new use of the binding must fall into a sanctioned
 *    category or fail. That is what stops a whole-object pass being added to a
 *    file already on the list above.
 * 3. **`reverseGeocodePlace` rounds both parameters.** It is on the sanctioned
 *    sink list *because* it rounds at its own entry, so without this assertion
 *    the list is a claim about a function nothing checks — delete the rounding
 *    and every call site is unchanged, so (2) still passes. That is the same
 *    defect one level up that PD-278 warns about for the detector itself.
 *
 * ## What it cannot see, stated rather than implied
 *
 * It is a source scan, like `no-service-role-key.test.ts` and with the same
 * honesty about its reach. It classifies by identifier and by line, not by types,
 * so it cannot follow a capture aliased through an untyped `any`, stored in a
 * module-level variable and read three files away, or reached by index
 * (`c['lat' + 'itude']`). It catches the ordinary case: somebody adds a reader,
 * or adds a use inside a file that already holds one. That is the case that
 * actually happens, and the one no reviewer catches twice.
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
 * the last `describe` in this file. Without it a detector that has quietly
 * stopped matching passes for ever and looks exactly like a clean repo.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const srcRoot = path.resolve(repoRoot, 'src')

/** This file legitimately contains every pattern it hunts for. */
const SELF = path.resolve(here, 'no-unrounded-photo-coordinate.test.ts')

/**
 * Where the coordinate is born and where it is decided — the two exemptions the
 * rule itself names.
 *
 * `exif.ts` parses the fix out of the file, so it is the one place that must
 * handle it unrounded. `location.ts` holds `resolvePhotoLocation`, which §D7
 * names as the boundary: it is the only function allowed to emit the unrounded
 * value, and only under the `precise` marker. That the five shapes it emits are
 * correct is `src/lib/media/__tests__/location.test.ts`'s job, not this file's —
 * this one asserts nothing else gets to make that decision.
 */
const EXEMPT = new Set(['src/lib/media/exif.ts', 'src/lib/media/location.ts'])

/**
 * Every file allowed to hold an `ExifCapture`, with the identifiers it binds one
 * to.
 *
 * Adding a row here is the deliberate act this test exists to force. It is not a
 * rubber stamp: a new holder means a new path the unrounded fix can travel, and
 * the bindings listed are what section (2) then classifies every use of.
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
 * A presence test discloses nothing — it asks whether a fix exists, never what
 * it is. `!capture`, `capture.latitude === null` and `!== undefined` are all this
 * shape.
 */
function isPresenceTest(line: string, binding: string): boolean {
  const coordinate = String.raw`${binding}(?:\?)?\.(?:latitude|longitude)`
  const nullish = String.raw`(?:===?|!==?)\s*(?:null|undefined)`
  if (new RegExp(String.raw`${coordinate}\s*${nullish}`).test(line)) return true
  if (new RegExp(String.raw`(?:null|undefined)\s*${nullish.replace('\\s*', '')}\s*${coordinate}`).test(line))
    return true
  return false
}

/**
 * Classify every mention of a capture binding inside one holder file.
 *
 * The window matters: `resolvePhotoLocation(mode, capture ?? {...}, place)` is
 * written across three lines in the composer, so the argument line carries no
 * callee. Sink detection therefore looks at the matched line plus the three
 * non-empty lines above it. Widening it further would start swallowing unrelated
 * statements, so three is the smallest window that spans the calls actually
 * written here.
 */
function classify(source: string, bindings: string[]): string[] {
  const violations: string[] = []
  const lines = stripCommentLines(source).split('\n')

  lines.forEach((line, index) => {
    for (const binding of bindings) {
      const mentions = new RegExp(String.raw`\b${binding}\b`)
      if (!mentions.test(line)) continue

      // A type annotation or a re-declaration names the binding without reading
      // anything off it.
      if (new RegExp(String.raw`\b${binding}\s*:\s*ExifCapture`).test(line)) return
      // The binding being established, including the destructure that creates it.
      if (new RegExp(String.raw`(?:const|let|var)\s.*\b${binding}\b`).test(line)) return
      if (isPresenceTest(line, binding)) return
      // `!capture`, `capture &&`, `!upload.capture` — existence, not value.
      if (new RegExp(String.raw`!\s*${binding}\b`).test(line)) return

      // Fields that are not the fix.
      if (
        NON_COORDINATE_FIELDS.some((f) =>
          new RegExp(String.raw`${binding}(?:\?)?\.${f}\b`).test(line),
        )
      )
        return

      // A sanctioned sink, looked for across the call's own lines.
      const window = [lines[index - 3], lines[index - 2], lines[index - 1], line]
        .filter(Boolean)
        .join(' ')
      if (SANCTIONED_SINKS.some((sink) => window.includes(`${sink}(`))) return

      // Storing the capture back into this file's own state is not a new sink.
      if (new RegExp(String.raw`set[A-Z]\w*\(\{[^}]*\b${binding}\b`).test(line)) return

      // Returning it hands it to a caller, and every caller is a file that
      // imports the type — so the holder assertion above is what bounds this
      // flow, not a classification here. `uploadPostcardImage` is the live case:
      // it reads the fix off the file and returns it to the composer.
      if (new RegExp(String.raw`^\s*return\b.*\b${binding}\b`).test(line)) return

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
  if (start === -1) return ['reverseGeocodePlace is gone — the sink list names a function that no longer exists']

  // To the next top-level declaration, which is enough to cover the body. Slice
  // from `start`, not `start + 1`: dropping the leading `e` leaves the signature
  // unmatchable by the strip below, and its `latitude: number` parameter list
  // then reads as a raw use — a false positive that looks exactly like a real
  // finding.
  const after = source.slice(start)
  const end = after.search(/\nexport (?:async )?function |\nexport const /)
  const body = stripCommentLines(after.slice(0, end === -1 ? undefined : end))

  const rounded = ['latitude', 'longitude'].filter((p) => body.includes(`roundToCoarseGrid(${p})`))
  const missing = ['latitude', 'longitude']
    .filter((p) => !rounded.includes(p))
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
  const files = walk(srcRoot).filter((f) => f !== SELF)

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
    const reads = stripCommentLines(composer).match(/\bcapture(?:\?)?\.(latitude|longitude)\b/g) ?? []
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
 * stopped matching anything passes every assertion above for ever. These are the
 * real shapes a regression would take, not approximations.
 */
describe('the detectors still catch a real violation', () => {
  it('catches a coordinate read that is neither a presence test nor a sanctioned sink', () => {
    expect(classify('console.log(capture.latitude)', ['capture'])).toHaveLength(1)
    expect(classify('void track({ lat: capture.latitude })', ['capture'])).toHaveLength(1)
    // The whole object handed somewhere new — the leak that writes no `.latitude`.
    expect(classify('await sendToVendor(capture)', ['capture'])).toHaveLength(1)
  })

  it('does not flag the shapes that are genuinely safe', () => {
    expect(classify('if (capture.latitude === null) return', ['capture'])).toEqual([])
    expect(classify('if (capture.longitude !== null) go()', ['capture'])).toEqual([])
    expect(classify('if (!capture) return', ['capture'])).toEqual([])
    expect(classify('void reverseGeocodePlace(capture.latitude, capture.longitude)', ['capture'])).toEqual([])
    expect(classify('const capture = await readExifCapture(file)', ['capture'])).toEqual([])
    expect(classify('<input value={capture.takenAt} />', ['capture'])).toEqual([])
    // The multi-line call the window exists for.
    expect(
      classify(
        ['const location = resolvePhotoLocation(', '  activeMode,', '  capture ?? { latitude: null },', ')'].join('\n'),
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

  it('catches the function being renamed out from under the sink list', () => {
    expect(unroundedUsesInReverseGeocode('export const nothing = 1')).toHaveLength(1)
  })
})
