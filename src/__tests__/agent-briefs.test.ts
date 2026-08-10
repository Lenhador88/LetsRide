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
     * **Known gap, accepted rather than overlooked:** ci.yml's carve-out is
     * `^\.claude/(agents|commands)/`, so a PR confined to `CLAUDE.md` or
     * `docs/HANDOFF.md` sets `app=false` and never runs this test. The case that
     * matters is covered — *renaming a heading* touches `queue-pickup.md`, which
     * does trigger it, and it then validates all 16 cross-file references at
     * once. What escapes is a bad reference newly written in a docs-only PR.
     * Widening the denylist to catch that would run the whole app job on every
     * documentation change, which is the cost the scoping change exists to
     * remove, so this is a deliberate trade rather than an oversight.
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

  it('every brief naming an mcp__ tool also lists ToolSearch in its frontmatter', () => {
    /*
     * PD-154's rule, and it needs a test rather than the obvious shell check.
     * `grep -l "mcp__" .claude/agents/*.md | xargs grep -L ToolSearch` reads
     * CLEAN with the frontmatter entry stripped, because every brief covered by
     * the rule also writes `ToolSearch` in the prose that tells it what to do —
     * measured, not feared. That is this repo's signature failure (a guard that
     * silently stopped matching) sitting inside the fix for silent failure, so
     * the assertion is scoped to the frontmatter block and to the parsed list.
     *
     * The trigger is the `mcp__` prefix rather than a connector name, because
     * the ids rotating IS the defect: on 2026-08-08 every MCP server
     * re-registered under a UUID prefix and `mcp__Supabase__*` stopped
     * resolving, with no error, leaving the agent no way to look for one.
     *
     * The exemption is keyed on the PROPERTY that justifies it — every declared
     * connector tool being Figma — never on a filename. `design-system` is out
     * because CLAUDE.md forbids the Figma API for design questions in favour of
     * the committed `design/` snapshot, so a rotation degrades an already-
     * secondary path. A filename exemption outlives that rationale silently:
     * measured, `EXEMPT_BRIEFS.has(name)` let design-system.md take a Supabase
     * tool with no ToolSearch and still pass.
     *
     * `checked` is the both-ways half, and it is the reason this reads like
     * `no-service-role-key.test.ts`: a guard that quietly stops matching passes
     * for ever and looks exactly like a clean repo. Two ways this one could:
     * the exemption above, and the `tools:` regex, which matches nothing if a
     * brief is ever reformatted to YAML block style — `declared` becomes [''],
     * every brief is skipped, and stripping ToolSearch from all seven still
     * passes. Asserting WHICH briefs were examined closes both. Adding an
     * eighth Supabase-reaching brief is meant to fail here: add it to the list.
     */
    const checked: string[] = []
    for (const { name, body } of briefs()) {
      const frontmatter = body.split('\n---')[0]
      const declared = (/^tools: (.*)$/m.exec(frontmatter)?.[1] ?? '').split(',').map((t) => t.trim())
      const connectors = declared.filter((t) => t.startsWith('mcp__'))
      if (connectors.length === 0) continue
      if (connectors.every((t) => t.startsWith('mcp__Figma__'))) continue
      checked.push(name)
      expect(
        declared,
        `${name} declares an mcp__ tool but no ToolSearch — after a connector id rotation it cannot even find out why it has no database`,
      ).toContain('ToolSearch')
    }

    expect(
      checked.sort(),
      'the guard examined a different set of briefs than expected — a `tools:` line it can no longer parse skips silently',
    ).toEqual([
      'data.md',
      'feature.md',
      'media.md',
      'openspec.md',
      'realtime.md',
      'reviewer.md',
      'test.md',
    ])
  })

  it('every connector brief still tells the agent to REPORT an unreachable tool', () => {
    /*
     * The companion to the test above, and the half that actually fires. That
     * one keeps `ToolSearch` on the `tools:` line so an agent can *diagnose* a
     * rotation; this one keeps the sentence that makes the agent *say so*.
     *
     * Diagnosis alone changes nothing the caller can see. CLAUDE.md §The Agent
     * Squad settles it — a keyword search "buys diagnosis, not recovery", so
     * "**the fix is therefore the *report***". Measured 2026-08-09: a reviewer
     * subagent lost both Supabase and Linear, and the only reason the gap was
     * visible at all is that its brief told it to lead with the passes that did
     * not run. A review that stays quiet returns findings and is byte-identical
     * to one that reached everything.
     *
     * This is prose, so it is exactly the kind of line a docs-tightening pass
     * deletes as redundant — all seven briefs say the same thing in nearly the
     * same words, which reads like duplication and is not. Nothing else in the
     * repo would notice it going.
     *
     * `\s+` rather than a space in every pattern, because these files are
     * hard-wrapped at ~95 columns and the phrase straddles the wrap in five of
     * the seven. A single-line grep for `stop and say so` reports FIVE briefs
     * missing the clause they in fact carry — measured while writing this test,
     * twice. That is the same shape as CLAUDE.md's comment trap: the obvious
     * command returns a confident wrong answer.
     */
    const DEGRADED_REPORT = /stop and say\s+so|emit a\s+FINDING/
    const NAMES_BOTH_FAILURES = [/InputValidationError/, /No such tool\s+available/]

    const checked: string[] = []
    for (const { name, body } of briefs()) {
      const frontmatter = body.split('\n---')[0]
      const declared = (/^tools: (.*)$/m.exec(frontmatter)?.[1] ?? '').split(',').map((t) => t.trim())
      const connectors = declared.filter((t) => t.startsWith('mcp__'))
      if (connectors.length === 0) continue
      if (connectors.every((t) => t.startsWith('mcp__Figma__'))) continue
      checked.push(name)

      expect(
        body,
        `${name} never tells the agent to report an unreachable connector — a degraded run is indistinguishable from a clean one`,
      ).toMatch(DEGRADED_REPORT)

      for (const failure of NAMES_BOTH_FAILURES) {
        expect(
          body,
          `${name} does not name both connector failures — reading a deferred schema as a missing permission produces a false degraded report, which is its own wrong answer`,
        ).toMatch(failure)
      }
    }

    expect(
      checked.sort(),
      'the guard examined a different set of briefs than expected — a `tools:` line it can no longer parse skips silently',
    ).toEqual([
      'data.md',
      'feature.md',
      'media.md',
      'openspec.md',
      'realtime.md',
      'reviewer.md',
      'test.md',
    ])
  })

  it('every connector probe names a tool the brief itself holds', () => {
    /*
     * PD-184's actual lesson, and the reason that issue read as a live outage
     * for a day. A subagent was asked to probe Supabase with `list_projects`,
     * got `No such tool available`, and reported the database lost. The
     * connector was fine — `list_projects` is simply not on any brief's `tools:`
     * line here, so the refusal was SCOPING. Measured 2026-08-10: `execute_sql`
     * answered from the same subagent, under its unchanged name.
     *
     * The two failures are byte-identical at the call site — same string, and
     * nothing else to look at — so the only defence is to probe with a name the
     * brief actually declares. That is mechanically checkable, which is what
     * earns this a test rather than the prose rule alone: the prose says why,
     * and this says the examples still obey it.
     *
     * Scope matches the file's charter — a single unambiguous ground truth in
     * the repo (the `tools:` line two dozen lines above the probe). It cannot
     * judge whether a probe is a GOOD choice, only that it is a real one.
     *
     * Suffix match, not equality: briefs write the bare `execute_sql` in a
     * keyword search and the qualified `mcp__Supabase__execute_sql` in a
     * `select:`, and both are correct usage of ToolSearch.
     *
     * **The counter-example's formatting is load-bearing.** Every brief's prose
     * names `list_projects` as the name that was wrongly probed, and it stays
     * invisible to this test only because it is written as a bare
     * `` `list_projects` `` — no `+`, no `select:`. Reformat it into the keyword
     * form the same paragraph demonstrates two lines above and the test starts
     * asserting against the counter-example.
     *
     * That fails LOUDLY in six briefs and SILENTLY in test.md, which is the one
     * that declares `mcp__Supabase__list_projects` — the suffix match just
     * succeeds. So the dangerous edit is reformatting test.md ALONE; a sweep
     * across all seven trips six red assertions and stops. Recorded because
     * fixing test.md in isolation is precisely what the review of this commit
     * asked for, so the next editor here is likelier than average to do it.
     *
     * The both-ways half is `probes.length`. Without it every regex here could
     * stop matching — a brief rewording `+execute_sql supabase` into prose, say
     * — and the test would pass by examining nothing, which is this repo's
     * signature failure sitting inside the fix for it. Asserting each brief
     * yielded at least one probe closes that, and the `checked` list closes the
     * same hole one level up.
     */
    const KEYWORD = /`\+([a-z_]+) (?:supabase|linear)`/gi
    const SELECT = /select:(mcp__\w+__\w+)/g

    const checked: string[] = []
    for (const { name, body } of briefs()) {
      const frontmatter = body.split('\n---')[0]
      const declared = (/^tools: (.*)$/m.exec(frontmatter)?.[1] ?? '').split(',').map((t) => t.trim())
      const connectors = declared.filter((t) => t.startsWith('mcp__'))
      if (connectors.length === 0) continue
      if (connectors.every((t) => t.startsWith('mcp__Figma__'))) continue
      checked.push(name)

      const probes = [
        ...[...body.matchAll(KEYWORD)].map((m) => m[1]),
        ...[...body.matchAll(SELECT)].map((m) => m[1]),
      ]

      expect(
        probes.length,
        `${name} tells the agent to probe its connector but names no tool to probe with — the rule cannot be followed`,
      ).toBeGreaterThan(0)

      for (const probe of probes) {
        expect(
          connectors.some((t) => t === probe || t.endsWith(`__${probe}`)),
          `${name} probes with \`${probe}\`, which is not on its own tools: line — a refusal there is scoping, indistinguishable from a rotation, and gets reported as a lost connector (PD-184)`,
        ).toBe(true)
      }
    }

    expect(
      checked.sort(),
      'the guard examined a different set of briefs than expected — a `tools:` line it can no longer parse skips silently',
    ).toEqual([
      'data.md',
      'feature.md',
      'media.md',
      'openspec.md',
      'realtime.md',
      'reviewer.md',
      'test.md',
    ])
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
