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
 * obituaries"). A line is exempt when it carries a negation or a date-stamped
 * correction near the term.
 */
const EXEMPT = /\b(not|no|never|dropped|gone|removed|absent|retired|deleted|gets designed back in|until 2026|gap)\b/i

function offendingLines(body: string, pattern: RegExp): string[] {
  return body
    .split('\n')
    .filter((line) => pattern.test(line) && !EXEMPT.test(line))
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
      const claims = body
        .split('\n')
        .filter((l) => /\b(unbuilt|not built|no route|does not exist)\b/i.test(l))
        .filter((l) => /\b(chat|notification|ride_messages)\b/i.test(l))
        .filter((l) => !/until 2026|used to|said|DM|direct message/i.test(l))
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
    // Families shorter than 5 chars are dropped: `next` and `zod` appear in
    // ordinary prose ("the next session"), where the family adds false positives
    // without adding reach — the exact id already covers them.
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

  it('every brief still declares a name and a model', () => {
    // Frontmatter damage is silent: an agent with no `name` is simply unreachable.
    for (const { name, body } of briefs()) {
      expect(body.startsWith('---\n'), `${name} has no frontmatter`).toBe(true)
      expect(body, name).toMatch(/^name: \S+$/m)
      expect(body, name).toMatch(/^model: \S+$/m)
    }
  })
})
