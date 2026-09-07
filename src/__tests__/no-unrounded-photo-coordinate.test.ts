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
 * So the unit of classification is **the individual mention, at its offset** —
 * for the coordinate *and* for the whole object, which took a second review round
 * to get right. A coordinate read is sanctioned only by a fact about itself: it
 * is compared to null/undefined, or it is an argument to a sanctioned call. An
 * object mention is sanctioned by **who receives it** — the innermost call whose
 * parentheses are still open — falling back to the shape of the statement only
 * when it sits in no call at all.
 *
 * The second round is worth stating, because the fix that suggests itself is the
 * one that failed: making pass 2 line-level again, on the argument that a line
 * carrying no coordinate has nothing to leak. A line can carry both, and
 * `if (c.latitude !== null) sendToVendor(c)` is the counter-example — a
 * *sanctioned* coordinate read clearing the line for the object. So is
 * `return sendToVendor(capture)`, where `return` looks like the bare
 * whole-object return that assertion 1 genuinely bounds and is not one.
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

/**
 * How far back to look for the callee of a multi-line call.
 * `resolvePhotoLocation(mode, capture ?? {…})` spans three lines in the composer.
 * Six is slack over that: because `enclosingCall` tracks real paren depth rather
 * than matching a name, a wider window is strictly more accurate — it only ever
 * recovers context the truncation would have lost.
 */
const LOOKBACK_LINES = 6

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

/** Control-flow words that take parentheses but are not calls and sink nothing. */
const NOT_A_CALL = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'await',
  'void',
  'do',
  'else',
])

/**
 * The name of the **innermost** call whose parentheses are still open at the end
 * of `prefix` — i.e. the call this mention is an argument to. `undefined` when
 * the mention sits in no call at all; `null` for an anonymous group.
 *
 * **Innermost is what makes this sound, and two review rounds turned on it.**
 * Asking merely whether a sanctioned sink appears somewhere unclosed lets an
 * outer sanctioned call launder an inner unsanctioned one —
 * `setForm({ lat: sendToVendor(capture) })` — and lets a stray `(` inside a
 * trailing comment cover the next several lines. Taking the top of the stack
 * asks the only question that matters: *who receives this value*.
 *
 * String literals are skipped, so a `)` inside one no longer closes the walk
 * early. That was a false positive rather than a leak, and this file's own header
 * records why that still matters: a detector that fails closed on correct code
 * invites loosening, which is how the earlier holes would come back.
 */
function enclosingCall(prefix: string): string | null | undefined {
  const stack: (string | null)[] = []

  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i]

    // A trailing comment, skipped to end of line. `stripCommentLines` keeps these
    // deliberately (so a read cannot hide behind one), which left two holes here:
    // an apostrophe in ordinary English — "the rider's choice" — opened a string
    // that swallowed the call's closing paren and held a sanctioned frame open
    // over the lines below; and a bare `(` in a comment stayed the innermost
    // frame. Both need real line boundaries, which is why the lookback is joined
    // with newlines rather than spaces.
    if (ch === '/' && prefix[i + 1] === '/') {
      const nl = prefix.indexOf('\n', i)
      if (nl === -1) break
      i = nl
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < prefix.length && prefix[i] !== quote) {
        if (prefix[i] === '\\') i++
        i++
      }
      continue
    }

    if (ch === '(') {
      const callee = prefix.slice(0, i).match(/([A-Za-z_$][\w$]*)\s*$/)?.[1]
      stack.push(callee && !NOT_A_CALL.has(callee) ? callee : null)
    } else if (ch === ')') {
      stack.pop()
    }
  }

  return stack.length ? stack[stack.length - 1] : undefined
}

/**
 * State setters that may hold the capture object, named rather than matched.
 *
 * **`/^set[A-Z]/` was the first spelling and it is far too broad** — it sanctions
 * `setRequestHeader`, which `upload.ts` (a declared holder) already calls three
 * times, plus `localStorage.setItem`, `Sentry.setContext` and
 * `posthog.setPersonProperties`, all live doorways in this repo. Those are §D7's
 * named prohibitions — a lookup, a bias, a log — so the pattern sanctioned
 * exactly the sinks the rule exists to refuse. An allowlist makes adding one the
 * same deliberate act as adding a `HOLDERS` row.
 */
const STATE_SETTERS = ['setUpload']

/** May a value handed to this call carry a capture, or a coordinate off one? */
function isSanctionedCallee(callee: string): boolean {
  // Storing the object in the holder's own state is not a new sink. Scoped to the
  // callee rather than the line, so a leak NESTED inside the state literal is the
  // innermost call and is still caught.
  return SANCTIONED_SINKS.includes(callee) || STATE_SETTERS.includes(callee)
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
 * **A mention of the whole object** is judged the same way, at its own offset,
 * by **who receives it** — the innermost call whose parentheses are still open.
 * An unsanctioned callee is a leak whatever else the line says. Only when the
 * mention sits in no call at all does the statement's shape decide it: binding it
 * to a local name, or returning it bare, both of which assertion (1) bounds
 * because whoever holds it next is a file that imports the type.
 *
 * **Do not make this pass line-level again.** The argument for it is seductive —
 * *a line carrying no coordinate has nothing to leak* — and false, because a line
 * can carry both, and because `return` is not always the bare return it looks
 * like. `if (c.latitude !== null) sendToVendor(c)` and `return sendToVendor(c)`
 * are the counter-examples, and both are regression tests below.
 *
 * `LOOKBACK_LINES` sets the window; its own docstring carries why six.
 */
function classify(source: string, bindings: string[]): string[] {
  const violations: string[] = []
  const lines = stripCommentLines(source).split('\n')

  lines.forEach((line, index) => {
    const lookback = lines.slice(Math.max(0, index - LOOKBACK_LINES), index).join('\n')
    const flag = () => violations.push(`${index + 1}: ${line.trim()}`)

    for (const binding of bindings) {
      if (!new RegExp(String.raw`\b${binding}\b`).test(line)) continue

      // ---- Pass 1: every coordinate read, judged at its own offset.
      const reads = new RegExp(String.raw`\b${binding}(?:\?)?\.(?:latitude|longitude)\b`, 'g')
      const readSpans: Array<[number, number]> = []
      let read: RegExpExecArray | null
      while ((read = reads.exec(line)) !== null) {
        readSpans.push([read.index, read.index + read[0].length])
        if (isPresenceRead(line, read.index, read[0].length)) continue
        const callee = enclosingCall(`${lookback}\n${line.slice(0, read.index)}`)
        if (typeof callee === 'string' && SANCTIONED_SINKS.includes(callee)) continue
        flag()
      }

      // ---- Pass 2: every OTHER mention of the binding — the whole object.
      //
      // Also per mention rather than per line. Skipping this pass whenever pass 1
      // found anything was itself the F5 defect one level up: a *sanctioned*
      // coordinate read then cleared the line for the object, so
      // `if (c.latitude !== null) sendToVendor(c)` passed.
      const mentions = new RegExp(String.raw`\b${binding}\b`, 'g')
      let mention: RegExpExecArray | null
      while ((mention = mentions.exec(line)) !== null) {
        const at = mention.index
        if (readSpans.some(([from, to]) => at >= from && at < to)) continue

        const after = line.slice(at + binding.length)
        const before = line.slice(0, at)

        if (new RegExp(String.raw`^(?:\?)?\.(?:${NON_COORDINATE_FIELDS.join('|')})\b`).test(after))
          continue
        if (/^\s*:\s*ExifCapture\b/.test(after)) continue
        if (/!\s*$/.test(before)) continue
        // `capture !== null` — a presence test on the object itself, which
        // discloses nothing, exactly as it does for a coordinate. The composer
        // opens its `hasPhotoFix` guard with one.
        if (isPresenceRead(line, at, binding.length)) continue

        // Who receives the object? The innermost open call is the only honest
        // answer, and an unsanctioned one is a leak whatever else the line says.
        const callee = enclosingCall(`${lookback}\n${before}`)
        if (typeof callee === 'string') {
          if (!isSanctionedCallee(callee)) flag()
          continue
        }

        // In no call at all: binding it to a local name, or returning it whole.
        // Both are bounded by assertion (1), since a caller that holds it is a
        // file that imports the type. `return sendToVendor(capture)` never
        // reaches here — its innermost call is unsanctioned, which is the review
        // finding that moved this check behind the one above.
        if (new RegExp(String.raw`(?:const|let|var)\s+[^=]*\b${binding}\b[^=]*=`).test(line))
          continue
        if (/^\s*return\b/.test(line)) continue

        flag()
      }
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

  it('catches a whole object returned THROUGH a call — the review’s F11', () => {
    // `return ` used to clear the line, on the argument that a return hands the
    // object to a caller and every caller imports the type. That holds for a bare
    // return and not when the return expression is itself a call: the object goes
    // to that function's parameter, which need not be typed `ExifCapture` at all,
    // so assertion 1 never sees it. `return <fn>(args)` is idiomatic in
    // `upload.ts`, so this is reachable rather than theoretical.
    expect(classify('  return sendToVendor(capture)', ['capture'])).toHaveLength(1)
    expect(classify('  return fetch(url, { body: JSON.stringify(capture) })', ['capture']))
      .toHaveLength(1)
    expect(classify('  return analytics.emit({ raw: capture })', ['capture'])).toHaveLength(1)
  })

  it('does not let a sanctioned coordinate read clear the object beside it — F12', () => {
    // F5 one level up: pass 2 used to be skipped entirely whenever pass 1 found
    // any read, so a presence test cleared the whole-object leak on the same line.
    expect(
      classify('if (capture.latitude !== null) sendToVendor(capture)', ['capture']),
    ).toHaveLength(1)
  })

  it('catches a leak nested inside a state literal, or beside a safe field — F13', () => {
    expect(classify('log(capture.takenAt); sendToVendor(capture)', ['capture'])).toHaveLength(1)
    expect(classify('setForm({ lat: sendToVendor(capture) })', ['capture'])).toHaveLength(1)
    expect(
      classify('setUpload({ ...prev, capture }); void sendToVendor(capture)', ['capture']),
    ).toHaveLength(1)
  })

  it('reads the INNERMOST open call, so nothing launders through an outer one — F14', () => {
    // A sink opening AFTER the mention must not cover it...
    expect(classify('logRaw(capture); resolvePhotoLocation(x', ['capture'])).toHaveLength(1)
    // ...and a stray paren inside a trailing comment must not either. Trailing
    // comments are deliberately kept (see the strip), so this is reachable in
    // files whose prose discusses `roundToCoarseGrid` at length — which is both
    // of them.
    expect(
      classify(
        [
          'void resolvePhotoLocation(a, b) // TODO roundToCoarseGrid(',
          'analytics.emit(capture.latitude)',
        ].join('\n'),
        ['capture'],
      ),
    ).toHaveLength(1)
  })

  it('does not fail closed on a paren inside a string — the review’s F16', () => {
    // A false positive rather than a leak, and it still matters: a detector that
    // rejects correct code invites loosening, which is how the earlier holes
    // would come back.
    expect(
      classify("void resolvePhotoLocation(a, ')', capture.latitude)", ['capture']),
    ).toEqual([])
  })

  it('does not sanction every setX callee — the review’s C1', () => {
    // `/^set[A-Z]/` sanctioned exactly the sinks §D7 refuses. `setRequestHeader`
    // is written three times in `upload.ts`, a DECLARED holder, and the other
    // three are live doorway modules in this repo.
    expect(classify("xhr.setRequestHeader('x-exif', capture)", ['capture'])).toHaveLength(1)
    expect(classify("localStorage.setItem('c', capture)", ['capture'])).toHaveLength(1)
    expect(classify("Sentry.setContext('photo', capture)", ['capture'])).toHaveLength(1)
    expect(classify('posthog.setPersonProperties({ capture })', ['capture'])).toHaveLength(1)
    // The one setter the composer actually needs stays sanctioned.
    expect(classify("setUpload({ status: 'done', path, capture })", ['capture'])).toEqual([])
  })

  it('is not fooled by an apostrophe or a paren in a trailing comment — C2', () => {
    // An ordinary English possessive used to open a "string" that swallowed the
    // call's closing paren, holding a sanctioned frame open over the lines below.
    // This is the composer's real multi-line call shape.
    expect(
      classify(
        [
          '  const location = resolvePhotoLocation(',
          "    activeMode,          // the rider's choice",
          '    capture ?? { latitude: null },',
          '  )',
          '  logRaw(capture)',
        ].join('\n'),
        ['capture'],
      ),
    ).toHaveLength(1)

    // And a bare `(` in a comment must not stay the innermost frame for a
    // mention that sits in no call at all.
    expect(
      classify(
        [
          'void resolvePhotoLocation(a, b) // see roundToCoarseGrid(',
          'globalThis.leak = capture',
        ].join('\n'),
        ['capture'],
      ),
    ).toHaveLength(1)
  })

  it('catches a destructured coordinate', () => {
    expect(classify('const { latitude } = capture', ['capture'])).toHaveLength(1)
    expect(classify('const { latitude: exactLat, longitude } = capture', ['capture'])).toHaveLength(
      1,
    )
    expect(classify("const lat = capture['latitude']", ['capture'])).toHaveLength(1)
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
