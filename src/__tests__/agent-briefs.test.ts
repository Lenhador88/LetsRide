import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A tripwire for the squad's briefs, added 2026-08-08 after an audit found three
 * of ten materially wrong at once.
 *
 * Why this is worth a test rather than a convention: a brief is the ONLY thing a
 * fresh subagent reads. It has no conversation history to correct it and no
 * running app to contradict it, so a false sentence there is executed rather than
 * noticed. And `.claude/` sat in ci.yml's denylist, which meant the files with the
 * highest blast radius per line were the only ones no job ever looked at.
 *
 * The three that were live when this landed, all in the same direction — a brief
 * describing a world that had moved on:
 *
 *   - realtime.md  "Chat and notifications are unbuilt — no messages, conversations
 *                   or notifications tables". Both shipped: 034 and 036.
 *   - test.md      "Playwright is not installed — no dependency". `playwright-core`
 *                   is a devDependency and `npm run walk` drives a browser with it.
 *   - data.md      "pending friend requests" as the core leak risk, three months
 *                   after 013 dropped `friendships`.
 *
 * Scope, deliberately narrow: this asserts only facts with a single unambiguous
 * ground truth in the repo — a dropped table, an uninstalled package, a shipped
 * migration. It cannot check whether a brief's ADVICE is good, and it must not
 * grow into a prose linter; that judgement is `reviewer`'s, which now reads these
 * files as logic (see .claude/agents/reviewer.md §classify).
 */

const AGENTS_DIR = path.resolve(__dirname, '../../.claude/agents')

function briefs(): Array<{ name: string; body: string }> {
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f, body: readFileSync(path.join(AGENTS_DIR, f), 'utf8') }))
}

/**
 * Strip the passages that exist to say a thing is GONE. Without this the test
 * fires on its own fix: the corrected briefs all name the retired concept in
 * order to warn about it, which is the repo's most-repeated measurement error
 * (CLAUDE.md §the comment trap — "a grep for a retired pattern counts its own
 * obituaries").
 *
 * It requires a CORRECTION MARKER, not merely a negation. The first draft
 * exempted bare `not`/`no`/`never`, which matched ~27% of all brief lines — so
 * "A friend request is not visible to a blocked rider" sailed through, a
 * sentence that treats the dropped concept as live while happening to contain
 * "not". Caught by `reviewer` on the commit that added this file, which is the
 * false negative the both-ways probe did not think to try.
 *
 * A marker is a date stamp or an explicit past-tense retirement verb — things a
 * sentence about REAL current behaviour has no reason to carry.
 *
 * **Matched against the line alone, deliberately.** A draft widened this to the
 * line plus its two neighbours, reasoning that the briefs wrap at ~100 columns
 * so a correction and its date can land on different lines. `reviewer`
 * falsified both halves: the motivating case (realtime.md's own fix) carries
 * `said` on its first line and so exempts itself, and the window raised the
 * escape rate for an injected wrong line from 0% to 6.8% overall and **19.3% in
 * realtime.md** — the very file whose false claim prompted this test. A wrong
 * sentence placed anywhere near a migration citation went undetected. Measured:
 * a line-only exemption produces zero false positives across all ten briefs
 * today, so the window bought nothing and blinded the test where it matters
 * most. Do not widen it again without re-running that escape-rate measurement.
 *
 * Migration numbers (`0\d\d`) are deliberately NOT markers either: current-state
 * sentences cite them constantly — realtime.md alone references 015, 003 and 034
 * while describing what is true now.
 */
const EXEMPT =
  /\b(20\d\d-\d\d-\d\d|until 20\d\d|dropped|retired|superseded|uninstalled|used to|no longer|stopped being|this brief said|said|gets designed back in)\b/i

function offendingLines(body: string, pattern: RegExp): string[] {
  return body.split('\n').filter((line) => pattern.test(line) && !EXEMPT.test(line))
}

describe('agent briefs do not describe a world that has moved on', () => {
  it('no brief presents `friendships` as a live concept', () => {
    // 013 dropped the table on 2026-08-04. The social graph is clubs plus blocking.
    for (const { name, body } of briefs()) {
      expect(offendingLines(body, /friend(ship|s|\srequest)/i), name).toEqual([])
    }
  })

  it('no brief presents ride chat or notifications as unbuilt', () => {
    // 034 shipped `ride_messages`; 036 shipped `notifications` and its six triggers.
    for (const { name, body } of briefs()) {
      // `no <x, y or z> table(s)` is here because it was literally half of the
      // wording this test exists to catch: realtime.md said BOTH "unbuilt" and
      // "no messages, conversations or notifications tables", and the first
      // draft matched only the first half.
      const claims = body.split('\n').filter(
        (l) =>
          /\b(unbuilt|not built|no route|does not exist|no\s+(\w+[,\s]+){0,3}(or\s+\w+\s+)?tables?)\b/i.test(l) &&
          // `notifications?` with no trailing \b — `\bnotification\b` does not
          // match the plural, which is the form every real sentence uses. That
          // let "no messages, conversations or notifications tables" through on
          // a probe: the line has no "chat", so the plural was its only hook.
          /\b(chat|notifications?|ride_messages)/i.test(l) &&
          !EXEMPT.test(l) &&
          // DMs really are unbuilt — the one third of this domain that has not shipped.
          !/\bDMs?\b|direct message/i.test(l),
      )
      expect(claims, name).toEqual([])
    }
  })

  it('no brief claims a package is absent that package.json installs', () => {
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const installed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })

    // Match the FAMILY name, not just the exact id. The real defect said
    // "Playwright is not installed" while the installed package was
    // `playwright-core` — an exact-id guard reads clean on exactly the sentence
    // it exists to catch, which is the silently-stopped-matching shape CLAUDE.md
    // keeps warning about. Verified both ways: this fires on that sentence.
    //
    // The length floor drops exactly one term in practice — `node`, from
    // `@types/node`, which is a word every brief uses in prose. It does NOT
    // spare `next` or `zod`, as an earlier version of this comment claimed:
    // those are dep ids in their own right and get added on the line above
    // regardless. Kept anyway, because the floor is what stops a future
    // short-named dependency doing what `node` would.
    const terms = new Set<string>()
    for (const dep of installed) {
      terms.add(dep)
      const family = dep.replace(/^@[^/]+\//, '').split('-')[0]
      if (family.length >= 5) terms.add(family)
    }

    for (const { name, body } of briefs()) {
      for (const term of terms) {
        // "<term> is not installed" / "no <term> dependency" — the shape that was wrong.
        const wrong = new RegExp(
          `${term.replace(/[/\-@.]/g, '\\$&')}[^.\\n]{0,40}\\b(is not installed|not installed|no dependency)`,
          'i',
        )
        expect(
          body.split('\n').filter((l) => wrong.test(l) && !/until 2026|used to|said/i.test(l)),
          `${name} claims ${term} is absent, but package.json installs it`,
        ).toEqual([])
      }
    }
  })

  it('every STEP cross-reference resolves to a real step in queue-pickup.md', () => {
    /*
     * This is why `.claude/commands/` is in ci.yml's carve-out alongside
     * `.claude/agents/`. Without a check of its own the carve-out spends a CI
     * run (~40s for the app job, measured on recent `development` pushes) on a
     * file no test reads.
     *
     * A dangling STEP reference is this procedure's characteristic defect rather
     * than a hypothetical: it is 1,100 lines of steps that point at each other,
     * CLAUDE.md spends 15 lines documenting a "step 5 vs STEP 5" collision
     * between two of these files, and collapsing the review passes moved a pass
     * between steps — the exact edit that strands a reference.
     *
     * **The CROSS-FILE references are the dangerous half, which is why the read
     * is a glob rather than the one file.** An editor renaming a step sees the
     * intra-file references in the same buffer; they do not see CLAUDE.md's
     * seven, docs/HANDOFF.md's seven, or reviewer.md's two. Only queue-pickup.md
     * defines headings — every other file here is a pure consumer.
     *
     * Case-sensitive on purpose: CLAUDE.md's own list uses lowercase `step 5`
     * for a DIFFERENT step, and conflating the two is the documented collision.
     */
    const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')
    const STEP = /\b(STEP [0-9]+(?:\.[0-9]+|[a-z])?)/g

    const proc = read('.claude/commands/queue-pickup.md')
    const headings = new Set(
      [...proc.matchAll(/^## (STEP [0-9]+(?:\.[0-9]+|[a-z])?)/gm)].map((m) => m[1]),
    )
    expect(headings.size, 'no STEP headings found — did the format change?').toBeGreaterThan(5)

    const consumers = [
      '.claude/commands/queue-pickup.md',
      'CLAUDE.md',
      'docs/HANDOFF.md',
      '.claude/agents/reviewer.md',
    ]
    const dangling: string[] = []
    for (const rel of consumers) {
      for (const ref of new Set([...read(rel).matchAll(STEP)].map((m) => m[1]))) {
        if (!headings.has(ref)) dangling.push(`${rel} -> ${ref}`)
      }
    }
    expect(dangling, 'referenced but no such step heading in queue-pickup.md').toEqual([])
  })

  it('every brief still declares a name and a model', () => {
    // Frontmatter damage is silent: an agent with no `name` is simply unreachable.
    for (const { name, body } of briefs()) {
      expect(body.startsWith('---\n'), `${name} has no frontmatter`).toBe(true)
      expect(body, name).toMatch(/^name: \S+$/m)
      expect(body, name).toMatch(/^model: \S+$/m)
    }
  })
})
