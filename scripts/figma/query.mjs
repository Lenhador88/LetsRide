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
const term = rest.join(' ').trim()

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

/** Name match is case-insensitive substring, plus exact node id. */
function resolve(needle) {
  if (!needle) {
    console.error('Give a frame or component name, or a node id.')
    exit(1)
  }
  const lower = needle.toLowerCase()
  const matches = entries.filter(
    (e) => e.id === needle || e.name.toLowerCase().includes(lower),
  )

  if (!matches.length) {
    console.error(`Nothing matches "${needle}". Try \`npm run figma -- ls\`.`)
    exit(1)
  }
  if (matches.length > 1) {
    const exact = matches.filter((e) => e.name.toLowerCase() === lower || e.id === needle)
    if (exact.length === 1) return exact[0]
    console.error(`"${needle}" is ambiguous:\n${matches.map((m) => `  ${m.name}  [${m.id}]`).join('\n')}`)
    exit(1)
  }
  return matches[0]
}

function* walkPruned(node, depth = 0) {
  yield { node, depth }
  for (const child of node.children ?? []) yield* walkPruned(child, depth + 1)
}

switch (command) {
  case 'ls': {
    const lower = term.toLowerCase()
    const shown = entries.filter((e) => !term || e.name.toLowerCase().includes(lower))
    for (const e of shown) {
      const variants = e.variants ? ` (${e.variants} variants)` : ''
      console.log(`${e.type.padEnd(14)} ${e.name}${variants}\n${' '.repeat(15)}${e.page} · ${e.id}`)
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
    for (const { node, depth } of walkPruned(root)) {
      const box = node.box ? ` ${node.box.w}×${node.box.h}` : ''
      const style = node.styles ? `  {${Object.values(node.styles).join(', ')}}` : ''
      const chars = node.characters ? `  "${node.characters.replace(/\n/g, '\\n').slice(0, 40)}"` : ''
      console.log(`${'  '.repeat(depth)}${node.type} · ${node.name}${box}${style}${chars}`)
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
        '  npm run figma -- tokens [pattern]  print the token tables\n' +
        '  npm run figma -- icons             list exported icons',
    )
    if (command) exit(1)
}
