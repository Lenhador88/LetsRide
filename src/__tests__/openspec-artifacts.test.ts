import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * A staleness alarm for the openspec CLI's two generated surfaces, added
 * 2026-08-16. Sibling of `scripts/figma/__tests__/generated-artifacts.test.mjs`;
 * between them they are the category `scripts/docs/registry.mjs` does not cover
 * — every claim in that registry verifies PROSE against CODE, and nothing
 * verified that a GENERATED-AND-COMMITTED ARTIFACT is still what its generator
 * would emit.
 *
 * `@fission-ai/openspec` emits two surfaces (its default `delivery` is
 * `'both'`):
 *
 *   - `.claude/skills/openspec-*\/SKILL.md`, which carry a `generatedBy` stamp
 *   - `.claude/commands/opsx/*.md`, which carry NO version stamp at all
 *
 * ## The theory this test was commissioned to encode, and why it is not here
 *
 * The brief that asked for this alarm held that the commands surface was output
 * by a PRE-1.7.0 openspec while the skills say 1.7.0 — evidenced by
 * `.claude/commands/opsx/explore.md` lacking the 103-line "Handling Different
 * Entry Points" section that the 1.7.0 and 1.9.0 `explore` templates contain.
 * The first draft of this file pinned that divergence as a known-stale baseline.
 *
 * It is wrong, and measurably so. The CLI does not render ONE template into two
 * surfaces: `dist/core/templates/workflows/explore.js` exports
 * `getExploreSkillTemplate()` AND `getOpsxExploreCommandTemplate()`, two
 * independently maintained texts, and **1.7.0's COMMAND template does not
 * contain that section either**. Measured 2026-08-16 against the installed
 * 1.7.0: all six committed command bodies and all six committed skill bodies
 * are byte-identical to that version's own templates. Neither surface is stale.
 *
 * Recorded because the evidence re-derives the wrong answer: comparing the two
 * committed surfaces is the obvious check, it shows a 103-line hole, and the
 * hole is by design. Anyone who repeats that comparison will reach the same
 * false conclusion.
 *
 * ## What is checked instead
 *
 * The real thing, since the theory turned out to be unnecessary: render the
 * installed CLI's own templates and byte-compare. That subsumes every heuristic
 * — no heading sets, no pinned baseline, no per-surface allowances — and it is
 * the only check that can see the commands surface at all, since it carries no
 * version stamp and nothing committed can date it.
 *
 * `@fission-ai/openspec` is already a devDependency, so `npm ci` supplies this;
 * nothing is installed for it and nothing here touches the network. The
 * `generatedBy`-vs-lockfile checks are kept alongside, because they need no
 * `node_modules` at all and they catch the one thing the byte compare cannot:
 * a lockfile hand-edited away from what the artifacts were generated with.
 *
 * ## Absence is tolerated; partial absence is not
 *
 * Which of the two surfaces this repo keeps is an open decision. So a surface
 * removed WHOLESALE passes here — but a surface removed by halves, or present
 * with no dependency behind it, is drift and fails. That line is the whole
 * design: "tolerate removal" must not decay into "pass when there is nothing
 * left to check", which is this repo's signature failure — a guard that quietly
 * stopped matching passes for ever and looks exactly like a clean repo.
 */

const ROOT = path.resolve(__dirname, '../..')
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills')
const COMMANDS_DIR = path.join(ROOT, '.claude', 'commands', 'opsx')

const PACKAGE = '@fission-ai/openspec'
// A private path, not a public export — the package's `exports` map names only
// `.`, and the templates are not re-exported from it. Deliberate: this is the
// generator's own source of truth, and reaching it is the only way to compare
// the artifact against what produced it. A CLI upgrade that moves it FAILS this
// file loudly, which is the correct outcome — a moved template layout is
// exactly when both surfaces need re-verifying by hand.
const TEMPLATES_DIR = path.join(ROOT, 'node_modules', PACKAGE, 'dist', 'core', 'templates', 'workflows')

type SkillTemplate = {
  name: string
  description: string
  instructions: string
  license?: string
  compatibility?: string
  metadata?: { author?: string; version?: string }
}
type CommandTemplate = {
  name: string
  description: string
  content: string
  category?: string
  tags?: string[]
}

function declaredRange(): string | undefined {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  return { ...pkg.dependencies, ...pkg.devDependencies }[PACKAGE]
}

/**
 * The version `npm ci` would install — the lockfile's, never the range's.
 * `^1.7.0` quietly resolving to 1.9.0 on somebody's `npm install` is exactly
 * the event this alarm exists to notice, and reading the range would be blind
 * to it.
 */
function lockedVersion(): string | undefined {
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as {
    packages?: Record<string, { version?: string }>
  }
  return lock.packages?.[`node_modules/${PACKAGE}`]?.version
}

/** `openspec-sync-specs` -> `sync`, the basename of its command counterpart. */
const commandIdFor = (skillDir: string) => skillDir.replace(/^openspec-/, '').split('-')[0]

/** Everything before the artifact's closing frontmatter fence. */
const frontmatterOf = (body: string) => body.split('\n---\n')[0]
/** Everything after it — what the template's `instructions`/`content` produced. */
const bodyOf = (raw: string) => raw.split('\n---\n').slice(1).join('\n---\n').replace(/^\n/, '')

function skills(): Array<{ dir: string; id: string; raw: string }> {
  if (!existsSync(SKILLS_DIR)) return []
  return readdirSync(SKILLS_DIR)
    .filter((d) => existsSync(path.join(SKILLS_DIR, d, 'SKILL.md')))
    .sort()
    .map((dir) => ({
      dir,
      id: commandIdFor(dir),
      raw: readFileSync(path.join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8'),
    }))
}

function commands(): Array<{ file: string; id: string; raw: string }> {
  if (!existsSync(COMMANDS_DIR)) return []
  return readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => ({ file, id: file.replace(/\.md$/, ''), raw: readFileSync(path.join(COMMANDS_DIR, file), 'utf8') }))
}

const stampOf = (raw: string) => /^\s*generatedBy:\s*"?([^"\n]+)"?\s*$/m.exec(raw)?.[1]?.trim()

/**
 * Every workflow template the installed CLI can render, indexed by the `name`
 * it puts in the artifact's frontmatter.
 *
 * Discovered rather than listed: the factories are enumerated from the module's
 * exports, so a workflow added upstream is picked up without editing a map here.
 * A map would go stale silently in the one direction that matters — a new
 * surface written into `.claude/` with no template to compare it against would
 * simply not be looked at.
 */
async function loadTemplates(): Promise<{ skills: Map<string, SkillTemplate>; commands: Map<string, CommandTemplate> }> {
  const skillIndex = new Map<string, SkillTemplate>()
  const commandIndex = new Map<string, CommandTemplate>()

  for (const file of readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.js'))) {
    const mod = (await import(pathToFileURL(path.join(TEMPLATES_DIR, file)).href)) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== 'function' || !/^get.*Template$/.test(name)) continue
      const template = (value as () => SkillTemplate | CommandTemplate)()
      if ('instructions' in template) skillIndex.set(template.name, template)
      else if ('content' in template) commandIndex.set(template.name, template)
    }
  }
  return { skills: skillIndex, commands: commandIndex }
}

describe('the openspec-generated surfaces still match the pinned CLI', () => {
  it('every SKILL.md was generated by the version the lockfile installs', () => {
    const present = skills()
    if (present.length === 0) return // whole surface removed — see the absence test below

    const locked = lockedVersion()
    expect(locked, `${PACKAGE} has no entry in package-lock.json`).toBeDefined()

    for (const { dir, raw } of present) {
      const stamp = stampOf(raw)
      expect(stamp, `.claude/skills/${dir}/SKILL.md carries no generatedBy stamp — the only thing that dates it`)
        .toBeDefined()
      expect(
        stamp,
        `.claude/skills/${dir}/SKILL.md was generated by ${stamp}, but package-lock.json installs ${locked}. ` +
          `Re-run the openspec CLI, or the agents follow a workflow the CLI no longer implements.`,
      ).toBe(locked)
    }
  })

  it('the lockfile version satisfies the range package.json declares', () => {
    // Cheap, and it catches a hand-edited lockfile. npm normally guarantees it,
    // which is precisely why nobody would notice when it stopped being true.
    const range = declaredRange()
    const locked = lockedVersion()
    if (range === undefined && locked === undefined) return // dependency removed entirely
    expect(range, 'package-lock.json pins the package but package.json does not declare it').toBeDefined()
    expect(locked, 'package.json declares the package but package-lock.json pins nothing').toBeDefined()

    const [rMajor, rMinor, rPatch] = range!.replace(/^[^0-9]*/, '').split('.').map(Number)
    const [lMajor, lMinor, lPatch] = locked!.split('.').map(Number)
    expect(lMajor, `${locked} is outside ${range}`).toBe(rMajor)
    expect(
      lMinor > rMinor || (lMinor === rMinor && lPatch >= rPatch),
      `${locked} is older than the floor ${range} declares`,
    ).toBe(true)
  })

  it('all the skills come from ONE generator run', () => {
    // A partial regeneration is the drift that reads most like health: six files
    // that all look freshly generated, two of them from a different version.
    const stamps = new Set(skills().map((s) => stampOf(s.raw)))
    if (stamps.size === 0) return
    expect([...stamps], 'the skills carry more than one generatedBy stamp').toHaveLength(1)
  })
})

describe('the committed surfaces are byte-identical to the CLI that generated them', () => {
  let templates: { skills: Map<string, SkillTemplate>; commands: Map<string, CommandTemplate> } | null = null

  beforeAll(async () => {
    if (declaredRange() === undefined) return // dependency gone; nothing to compare against
    if (!existsSync(TEMPLATES_DIR)) {
      throw new Error(
        `${PACKAGE} is a declared dependency but its workflow templates are not at ` +
          `node_modules/${PACKAGE}/dist/core/templates/workflows. Either dependencies are not installed ` +
          `(run \`npm ci\`), or the CLI was upgraded and moved them — in which case re-verify both ` +
          `.claude/skills/ and .claude/commands/opsx/ by hand and repoint TEMPLATES_DIR.`,
      )
    }
    templates = await loadTemplates()
  })

  it('found the CLI templates to compare against — an empty index is not a pass', () => {
    // The both-ways guard for the whole describe block. Every assertion below is
    // a loop over committed artifacts, so an index that silently came back empty
    // would still let each `.get()` miss — and without this, the per-artifact
    // `toBeDefined` is the only thing standing between that and a green run on
    // zero comparisons.
    if (templates === null) return
    expect(templates.skills.size, 'no skill templates discovered — the factory naming convention moved')
      .toBeGreaterThan(0)
    expect(templates.commands.size, 'no command templates discovered — the factory naming convention moved')
      .toBeGreaterThan(0)
  })

  it('every committed SKILL.md is exactly what its template renders', () => {
    if (templates === null) return
    for (const { dir, raw } of skills()) {
      const template = templates.skills.get(dir)
      expect(template, `.claude/skills/${dir}/ has no counterpart template in the installed CLI`).toBeDefined()

      expect(
        bodyOf(raw).trimEnd(),
        `.claude/skills/${dir}/SKILL.md has drifted from the CLI's template — regenerate it, do not hand-edit it`,
      ).toBe(template!.instructions.trimEnd())

      const frontmatter = frontmatterOf(raw)
      expect(frontmatter, `${dir} name`).toContain(`name: ${template!.name}`)
      expect(frontmatter, `${dir} description`).toContain(`description: ${template!.description}`)
      if (template!.license) expect(frontmatter, `${dir} license`).toContain(`license: ${template!.license}`)
      if (template!.compatibility) {
        expect(frontmatter, `${dir} compatibility`).toContain(`compatibility: ${template!.compatibility}`)
      }
    }
  })

  it('every committed opsx command is exactly what its template renders', () => {
    // The half with no version stamp, and therefore the half that has no other
    // check available at all. This is the answer to "can the commands surface be
    // caught going stale?": only here, and only because the generator is a
    // devDependency rather than something fetched.
    if (templates === null) return
    const byName = new Map([...templates.commands.values()].map((t) => [t.name, t]))

    for (const { file, raw } of commands()) {
      const declaredName = /^name:\s*"?([^"\n]+)"?\s*$/m.exec(frontmatterOf(raw))?.[1]?.trim()
      expect(declaredName, `.claude/commands/opsx/${file} has no name in its frontmatter`).toBeDefined()

      const template = byName.get(declaredName!)
      expect(
        template,
        `.claude/commands/opsx/${file} declares "${declaredName}", which no installed CLI template renders`,
      ).toBeDefined()

      expect(
        bodyOf(raw).trimEnd(),
        `.claude/commands/opsx/${file} has drifted from the CLI's template — regenerate it, do not hand-edit it`,
      ).toBe(template!.content.trimEnd())

      const frontmatter = frontmatterOf(raw)
      expect(frontmatter, `${file} description`).toContain(`description: "${template!.description}"`)
      if (template!.category) expect(frontmatter, `${file} category`).toContain(`category: "${template!.category}"`)
      if (template!.tags) {
        expect(JSON.parse(/^tags:\s*(\[.*\])\s*$/m.exec(frontmatter)?.[1] ?? '[]'), `${file} tags`)
          .toEqual(template!.tags)
      }
    }
  })
})

describe('the two generated surfaces have not drifted apart', () => {
  it('each surface is present in full or absent in full', () => {
    /*
     * The tolerance the open keep-which-surface decision needs, and its limit.
     * Deleting `.claude/skills/` or `.claude/commands/opsx/` outright is a
     * choice and passes. Dropping below four of six is drift — a half-removed
     * surface leaves an `/opsx:archive` that exists beside an `/opsx:apply` that
     * silently does not.
     *
     * State the threshold as four rather than as "partial absence fails": losing
     * one or two files DOES pass, so the stronger phrasing would be a claim this
     * code does not make. `>= 4` rather than an exact 6 on purpose — the CLI's
     * workflow set is its to change (1.7.0 ships 13 skills and 12 commands, of
     * which this repo keeps six of each), so pinning a count would turn an
     * upstream addition into a red build in a repo that has not upgraded. What is
     * NOT negotiable is that the two surfaces enumerate the same workflows —
     * asserted next.
     */
    const s = skills()
    const c = commands()
    if (s.length > 0) expect(s.length, 'the skills surface looks half-deleted').toBeGreaterThanOrEqual(4)
    if (c.length > 0) expect(c.length, 'the opsx commands surface looks half-deleted').toBeGreaterThanOrEqual(4)

    /*
     * The dependency and the committed output must appear and disappear together,
     * and BOTH directions need saying — the pair is what stops "tolerate removal"
     * decaying into "pass when there is nothing left to check".
     *
     * The second assertion is the one that was missing, and its absence was
     * reachable rather than theoretical: with `.claude/skills/` deleted, the
     * commands surface intact and ${PACKAGE} dropped from package.json, every
     * byte-compare early-returns on a null template, the stamp test early-returns
     * on an empty skills list, and the whole file went green over six committed
     * command files compared against nothing at all. Gating it on `&&` meant the
     * one surviving surface bought silence for the other.
     */
    if (s.length === 0 && c.length === 0) {
      expect(declaredRange(), `both openspec surfaces are gone but ${PACKAGE} is still a dependency`).toBeUndefined()
    } else {
      expect(
        declaredRange(),
        `committed openspec output exists but ${PACKAGE} is not a dependency, so nothing can verify it`,
      ).toBeDefined()
    }
  })

  it('the mapping from a skill directory to a command file is unambiguous', () => {
    // `openspec-sync-specs` -> `sync` is a lossy transform, so two future
    // workflows sharing a first segment would silently collapse onto one command
    // and the comparison below would pair the wrong files.
    const ids = skills().map((s) => s.id)
    expect(new Set(ids).size, `two skills map to the same command id: ${ids.join(', ')}`).toBe(ids.length)
  })

  it('both surfaces enumerate the same workflows', () => {
    const s = skills()
    const c = commands()
    if (s.length === 0 || c.length === 0) return // one surface deliberately absent

    expect(
      c.map((x) => x.id).sort(),
      'the two openspec surfaces list different workflows — one was regenerated and the other was not',
    ).toEqual(s.map((x) => x.id).sort())
  })
})
