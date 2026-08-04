#!/usr/bin/env node
/**
 * Offline lookup over the committed snapshot. This is the tool an agent should
 * reach for instead of the Figma API — it needs no token, no network, and cannot
 * be rate limited.
 *
 * Usage:
 *   npm run figma -- ls [pattern]        list frames and components
 *   npm run figma -- show <name|id>      print one frame or component as JSON
 *   npm run figma -- tree <name|id>      print its structure, one line per node
 *   npm run figma -- text <name|id>      print every string in it
 *   npm run figma -- tokens [pattern]    print the token tables
 *   npm run figma -- icons               list exported icons
 */
import { readFile } from 'node:fs/promises'
import { argv, exit } from 'node:process'
import { DESIGN_DIR } from './lib.mjs'

const [command, ...rest] = argv.slice(2)
const flags = rest.filter((a) => a.startsWith('--'))
const term = rest.filter((a) => !a.startsWith('--')).join(' ').trim()

async function readDesign(relative) {
  try {
    return JSON.parse(await readFile(new URL(relative, DESIGN_DIR), 'utf8'))
  } catch {
    console.error(
      `design/${relative} is missing. The snapshot has not been captured yet —\n` +
        'run `npm run figma:pull` when the API is reachable.',
    )
    exit(1)
  }
}

const index = await readDesign('index.json')
const entries = [...index.frames, ...index.components]

/** "Hide postcard for me / Home - Postcards - All new" — how a screen is named. */
const qualified = (e) => (e.section ? `${e.section} / ${e.name}` : e.name)

/**
 * Name match is case-insensitive substring, plus exact node id.
 *
 * Six frames are called `Home - Postcards - All new` — one per flow that shows
 * the home screen — so a bare name is often ambiguous. Matching the *qualified*
 * name means the flow disambiguates it ("Hide postcard for me / Home - Postcards
 * - All new"), and the ambiguity message prints qualified names so the next
 * command is copy-pasteable rather than something to work out from node ids.
 */
function resolve(needle) {
  if (!needle) {
    console.error('Give a frame or component name, or a node id.')
    exit(1)
  }
  const lower = needle.toLowerCase()
  const matches = entries.filter(
    (e) => e.id === needle || qualified(e).toLowerCase().includes(lower),
  )

  if (!matches.length) {
    console.error(`Nothing matches "${needle}". Try \`npm run figma -- ls\`.`)
    exit(1)
  }
  if (matches.length > 1) {
    const exact = matches.filter(
      (e) => e.id === needle || qualified(e).toLowerCase() === lower || e.name.toLowerCase() === lower,
    )
    if (exact.length === 1) return exact[0]

    // All six may be the same screen drawn per flow; say so rather than implying
    // they are six different things.
    console.error(
      `"${needle}" matches ${matches.length}. Narrow it with the flow, or use an id:\n` +
        matches.map((m) => `  ${qualified(m)}  [${m.id}]`).join('\n'),
    )
    exit(1)
  }
  return matches[0]
}

/**
 * Figma keeps toggled-off layers in the file, so a component instance carries every
 * variant slot it does not use — a Home header still contains the back button it
 * hides. Building from those is a real and repeated mistake, so hidden subtrees are
 * omitted by default; pass --all to see them marked instead.
 */
const SHOW_HIDDEN = flags.includes('--all')

function* walkPruned(node, depth = 0, hidden = false) {
  const isHidden = hidden || node.visible === false
  if (isHidden && !SHOW_HIDDEN) return
  yield { node, depth, hidden: isHidden }
  for (const child of node.children ?? []) yield* walkPruned(child, depth + 1, isHidden)
}


switch (command) {
  case 'ls': {
    const lower = term.toLowerCase()
    const shown = entries.filter((e) => !term || qualified(e).toLowerCase().includes(lower))
    for (const e of shown) {
      const variants = e.variants ? ` (${e.variants} variants)` : ''
      // The flow is printed on the detail line because it is what makes an
      // otherwise duplicated screen name resolvable.
      const where = e.section ? `${e.page} · ${e.section}` : e.page
      console.log(`${e.type.padEnd(14)} ${e.name}${variants}\n${' '.repeat(15)}${where} · ${e.id}`)
    }
    console.log(`\n${shown.length} of ${entries.length}`)
    break
  }

  case 'show': {
    const entry = resolve(term)
    console.log(JSON.stringify(await readDesign(entry.file), null, 2))
    break
  }

  case 'tree': {
    const entry = resolve(term)
    const root = await readDesign(entry.file)
    for (const { node, depth, hidden } of walkPruned(root)) {
      const box = node.box ? ` ${node.box.w}×${node.box.h}` : ''
      const style = node.styles ? `  {${Object.values(node.styles).join(', ')}}` : ''
      const chars = node.characters ? `  "${node.characters.replace(/\n/g, '\\n').slice(0, 40)}"` : ''
      const rot = node.rotation ? `  rotate(${node.rotation}deg)` : ''
      const flag = hidden ? '  [hidden]' : ''
      console.log(`${'  '.repeat(depth)}${node.type} · ${node.name}${box}${rot}${style}${chars}${flag}`)
    }
    break
  }

  case 'text': {
    const entry = resolve(term)
    const root = await readDesign(entry.file)
    for (const { node } of walkPruned(root)) {
      if (node.type !== 'TEXT' || !node.characters) continue
      const t = node.text ?? {}
      console.log(`${JSON.stringify(node.characters)}\n    ${node.name} · ${t.fontSize ?? '?'}/${t.lineHeightPx ?? '?'} w${t.fontWeight ?? '?'} · ${node.styles?.text ?? 'unstyled'}`)
    }
    break
  }

  case 'tokens': {
    const tokens = await readDesign('tokens.json')
    const lower = term.toLowerCase()
    const hit = (name) => !term || name.toLowerCase().includes(lower)

    for (const c of tokens.colors.filter((c) => hit(c.name))) {
      console.log(`${c.value.padEnd(10)} ${c.name.padEnd(24)} n=${c.n}${c.ambiguous ? `  AMBIGUOUS: ${c.ambiguous.join(', ')}` : ''}`)
    }
    for (const t of tokens.type.filter((t) => hit(t.name))) {
      console.log(`${String(t.fontSize).padStart(4)}/${String(t.lineHeight).padEnd(4)} w${t.fontWeight}  ${t.name.padEnd(24)} n=${t.n}`)
    }
    break
  }

  case 'icons': {
    const icons = await readDesign('icons/index.json')
    for (const icon of icons.icons) console.log(`${icon.slug.padEnd(24)} ${icon.name}  ${icon.id}`)
    console.log(`\n${icons.count} icons`)
    break
  }

  default:
    console.log(
      'Usage:\n' +
        '  npm run figma -- ls [pattern]      list frames and components\n' +
        '  npm run figma -- show <name|id>    print one frame or component as JSON\n' +
        '  npm run figma -- tree <name|id>    print its structure, one line per node\n' +
        '  npm run figma -- text <name|id>    print every string in it\n' +
        '      add --all to tree/text to include layers Figma has toggled off\n' +
        '  npm run figma -- tokens [pattern]  print the token tables\n' +
        '  npm run figma -- icons             list exported icons',
    )
    if (command) exit(1)
}
