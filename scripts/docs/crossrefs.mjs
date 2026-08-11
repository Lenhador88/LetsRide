/**
 * Cross-reference resolution for the repo's prose.
 *
 * WHY THIS EXISTS. This repo points at itself constantly — "`CLAUDE.md`
 * §Supabase Rules", "`docs/reference/linear.md` §The statuses",
 * "`.claude/agents/native.md` §Before you report done". Count them rather than
 * trusting a figure here — `resolveAll` returns `checked` and `bare`, and
 * `crossrefs.test.mjs` prints both. *Nothing* checked any of them before this
 * file existed. `registry.mjs` guards the
 * numeric claims and guards them well, but a reference is not a number: it can
 * rot without any figure changing, and it rots in exactly one situation —
 * someone moves a section.
 *
 * That happened on 2026-08-10, when five sections left `CLAUDE.md` for
 * `docs/reference/`. Four *numeric* claims moved with them and CI went red,
 * because `registry.test.mjs` re-locates every claim. Fifteen prose references
 * broke in the same commit and nothing noticed — they were found by a reviewer
 * reading the diff by hand. A pointer into a file that no longer has the
 * section is worse than no pointer at all: it looks live, so the reader stops
 * looking, and the rule it was guarding goes unread.
 *
 * HOW MUCH IT ACTUALLY CATCHES — measured, not asserted. Replaying this gate
 * across the split commit surfaces **3 of those 15** broken pointers. The other
 * twelve were bare `§` forms with no path attached, which `references()`
 * excludes on purpose (see there for why guessing their target is worse than
 * skipping it). So this is a partial net over the failure that motivated it,
 * and the honest claim is "it would have caught a fifth of them" rather than
 * "it would have caught this".
 *
 * It also answers only "does this file still have a section by roughly this
 * name", never "is this still the right place to look". A section renamed in
 * place, or a pointer at a real heading that no longer says what the citing
 * prose claims, both pass. Those need a reader.
 */

/** Words too common to identify a heading on their own — see `matchesHeading`. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'for', 'from',
  'how', 'if', 'in', 'is', 'it', 'its', 'no', 'not', 'of', 'on', 'or', 'that',
  'the', 'them', 'then', 'there', 'these', 'this', 'to', 'was', 'were', 'what',
  'when', 'where', 'which', 'why', 'with',
])

/**
 * Reduce a heading or a citation to comparable words.
 *
 * Both sides get the same treatment, which is the point: headings carry
 * backticks, bold, em-dashes and parenthetical asides, and citations carry
 * possessives and trailing prose punctuation. Comparing raw text fails on
 * "§Product Scope's Inbox row" against "## Product Scope (from Figma)" for
 * reasons that have nothing to do with whether the section exists.
 */
export function words(text) {
  return text
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // markdown links -> their text
    .toLowerCase()
    .split(/[\s/—–-]+/)
    .map((w) => w.replace(/['’]s$/, '').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean)
}

/**
 * Does `citation` name `heading`?
 *
 * The hard part is that a citation runs into the sentence around it. The repo
 * writes "§Branching currently reads the other way" and means the section
 * `## Branching & CI`; it writes "§The necessity gate enforces this, and
 * carries a line budget" and means `### The necessity gate`. There is no
 * delimiter — the prose simply continues — so the citation's word count says
 * nothing about how much of it was meant as the name.
 *
 * So: match on the leading words, and require *two* of them when the first is a
 * stopword. One word is enough for "Branching" or "Sequencing", which identify
 * a section on their own. It is not enough for "The", which would let
 * "§The statuses" resolve against `## The Agent Squad` — the precise false pass
 * this rule exists to prevent, and a real citation from the split.
 *
 * `min(2, h.length)` rather than a flat 2, because a one-word heading cannot
 * supply a second word and would otherwise fail to match an exact citation of
 * itself. `## Why` is the mandated first heading of every OpenSpec proposal, and
 * it is the only heading in the repo that failed this way.
 */
export function matchesHeading(citation, heading) {
  const c = words(citation)
  const h = words(heading)
  if (!c.length || !h.length || c[0] !== h[0]) return false

  let k = 0
  while (k < c.length && k < h.length && c[k] === h[k]) k++
  return k >= Math.min(2, h.length) || !STOPWORDS.has(c[0])
}

/** Every ATX heading in a markdown document, in order. */
export function headings(markdown) {
  return markdown
    .split('\n')
    .filter((l) => /^#{1,6}\s+/.test(l))
    .map((l) => l.replace(/^#{1,6}\s+/, '').trim())
}

/**
 * Every *file-qualified* `§`-reference in a document — a path immediately
 * followed by a section name, as in "`CLAUDE.md` §Supabase Rules".
 *
 * ONLY the immediately-adjacent form is collected, and that narrowness is the
 * design. A bare "§The walk" is ambiguous in this repo: sometimes it means the
 * citing document's own section, sometimes the file named earlier in the
 * sentence, and sometimes CLAUDE.md — `queue-pickup.md` line 17 reads "Read
 * `CLAUDE.md` fully before acting … and §The roadmap lives in Linear defines
 * this board", where the target is two clauses back. Resolving those needs a
 * guess, and a checker that guesses produces false failures, which is how a
 * gate gets switched off. They are counted and reported as unchecked instead.
 *
 * The captured name deliberately over-reads into the following prose;
 * `matchesHeading` is what decides how much of it counted.
 */
// The name may run across ONE newline, because these files are hard-wrapped at
// ~100 columns and a reference does not care. Scanning line by line read
// "`CLAUDE.md` §The\nroadmap lives in Linear" as the section "The", which then
// failed against a file that genuinely contains it — a false failure caused
// entirely by where the author's line happened to end.
// A colon stays INSIDE the name: `reviewer.md` has a section literally titled
// "Then: classify the diff, …", and stopping at the colon reduced the citation to
// the single stopword "Then", which then failed. Over-reading is safe by
// construction — `matchesHeading` only ever looks at the leading words.
// The name stops before the NEXT cited path. Without that, "see `A.md` §One and
// `B.md` §Two" consumed "`B.md" into the first name, and the leftover ".md"
// could not re-match — so the second reference vanished into the `bare` count,
// where no number looked wrong. Latent (no instance today), silent by
// construction, hence the tempered token rather than a plain negated class.
const NOT_A_PATH = String.raw`(?:(?!\`?[A-Za-z0-9_./-]+\.(?:md|yaml|yml)\`)[^\n.;!?])`
const QUALIFIED = new RegExp(
  String.raw`(?:\[\s*)?\`?([A-Za-z0-9_./-]+\.(?:md|yaml|yml))\`?(?:\s*\]\([^)]*\))?[ \t]*§[ \t]*([A-Za-z]${NOT_A_PATH}{0,80}(?:\n[ \t>]*${NOT_A_PATH}{0,60})?)`,
  'g',
)
const BARE = /§[ \t]*[A-Za-z]/g

/**
 * Blank out fenced code so an example is not read as a pointer, preserving
 * offsets so line numbers survive.
 *
 * INDENTED code blocks are deliberately NOT masked. The obvious `^ {4,}\S` rule
 * cannot tell a code block from a hard-wrapped list continuation, and this repo
 * is full of the latter — it blanked 17 references, 10 of them file-qualified,
 * and they vanished from `checked` *and* from `bare`, so the printed report
 * looked identical. A silent narrowing of coverage is worse than the thing the
 * rule was guarding against, and the repo has no indented code block carrying a
 * `§` for it to guard against in the first place.
 */
function maskCode(markdown) {
  const blanked = (s) => s.replace(/[^\n]/g, ' ')
  return markdown.replace(/^(\s*>?\s*)```[\s\S]*?```/gm, blanked)
}

export function references(markdown) {
  const masked = maskCode(markdown)
  const lineOf = (index) => masked.slice(0, index).split('\n').length
  const out = []

  for (const m of masked.matchAll(QUALIFIED)) {
    out.push({ line: lineOf(m.index), file: m[1], name: m[2].replace(/\s+/g, ' ').trim() })
  }
  // Every § that did not bind to a path is unchecked, and is counted so the
  // report can say how much of the surface this gate does not cover.
  const bare = [...masked.matchAll(BARE)].length - out.length
  for (let b = 0; b < bare; b++) out.push({ line: 0, file: null, name: null })
  return out
}

/**
 * Resolve every reference in `docs` (a Map of path -> content).
 *
 * Returns `{ broken, checked, ambiguous, unresolvablePath, bare }`. The last
 * three are reported rather than swallowed: a citation matching two headings, a
 * reference naming a file this scan cannot find, and an unqualified `§`, are all
 * *unchecked-or-lucky* rather than healthy. A checker that silently drops what it
 * cannot handle is how a gate goes vacuous while still printing a reassuring
 * number — the same failure this repo already documents for a grep that counts
 * its own obituaries.
 *
 * `ambiguous` exists because a one-word leading match is accepted, so
 * "§Working Principles" resolves against BOTH `## Working Principles` and
 * `## Working With the Product Owner`. Today it lands on the right one; delete
 * the right one and it silently lands on the wrong one and stays green. That
 * hole cannot be closed by tightening the match — every tightening tried breaks
 * a legitimate citation like "§Branching currently reads the other way" against
 * `## Branching & CI` — so it is surfaced instead of pretended away.
 */
export function resolveAll(docs, isSource = () => true) {
  const broken = []
  const ambiguous = []
  const unresolvablePath = []
  let checked = 0
  let bare = 0

  const headingCache = new Map()
  const headingsOf = (path) => {
    if (!headingCache.has(path)) headingCache.set(path, headings(docs.get(path)))
    return headingCache.get(path)
  }

  const paths = [...docs.keys()]

  /**
   * Resolve a cited path from the citing file.
   *
   * A SIBLING WINS OVER A SUFFIX MATCH, and getting that order wrong is not a
   * near-miss — it silently checks the wrong document. Every OpenSpec change
   * cites its own `proposal.md`, `design.md` and `tasks.md` by bare filename, so
   * a suffix match resolves all of them to whichever change happens to sort
   * first. That produced one false failure here
   * (`tag-postcards-to-rides/tasks.md` citing its own `proposal.md` §Two
   * defects, checked against `add-account-deletion/proposal.md`) and, worse,
   * would silently pass any citation that happened to match a heading in the
   * wrong file.
   *
   * An ambiguous bare filename with no sibling is left UNRESOLVED rather than
   * guessed — see the note on the return shape.
   */
  const resolvePath = (from, cited) => {
    if (docs.has(cited)) return cited

    // Nearest first, then outward. An OpenSpec delta at
    // changes/<c>/specs/<cap>/spec.md cites "design.md" meaning its change's
    // design at changes/<c>/design.md — two levels up, and nearest-wins is what
    // makes that the right answer rather than some other change's.
    let dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
    while (true) {
      const candidate = dir ? `${dir}/${cited}` : cited
      if (docs.has(candidate)) return candidate
      if (!dir) break
      dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
    }

    // Last resort, and only when it is unambiguous.
    const suffix = paths.filter((p) => p.endsWith(`/${cited}`))
    return suffix.length === 1 ? suffix[0] : null
  }

  for (const [path, content] of docs) {
    // A file can be a resolution TARGET without being a SOURCE. Archived
    // OpenSpec changes are the case: pointing into one is legitimate — that is
    // where the reasoning was recorded — while a pointer written inside one is
    // a historical artefact nobody should be asked to keep fresh.
    if (!isSource(path)) continue
    for (const ref of references(content)) {
      if (!ref.file) { bare++; continue }

      const target = resolvePath(path, ref.file)
      if (!target) {
        unresolvablePath.push({ from: path, ...ref })
        continue
      }
      checked++
      const hits = headingsOf(target).filter((h) => matchesHeading(ref.name, h))
      if (!hits.length) broken.push({ from: path, target, ...ref })
      else if (hits.length > 1) ambiguous.push({ from: path, target, hits, ...ref })
    }
  }
  return { broken, checked, ambiguous, unresolvablePath, bare }
}
