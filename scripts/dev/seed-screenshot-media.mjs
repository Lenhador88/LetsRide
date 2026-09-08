#!/usr/bin/env node
/**
 * Puts image bytes and map tiles behind the rows `supabase/seeds/screenshot-account.sql`
 * writes, so a DEV simulator can be photographed for the App Store listing
 * (PD-448).
 *
 * ## Why this is a script and not part of the seed
 *
 * `image_path`, `avatar_path`, `cover_image_path` and the two `rides.map_*_path`
 * columns are Storage OBJECT PATHS. SQL writes the path; only the Storage API
 * can put a JPEG at it, which is the same reason `scripts/storage/sweep-orphans.mjs`
 * exists. A postcard whose object is missing does not fall out of the deck — it
 * renders the grey panel "This photo could not be loaded", which photographs
 * worse than an empty state.
 *
 * ## Why it signs in as each rider rather than using a service-role key
 *
 * Decision #8, and `010`/`014`/`016`'s Storage policies make it the natural
 * route anyway: a rider may write only under `<prefix>/<their own uuid>/`, and
 * every path the seed writes is pinned by a CHECK to the uuid that owns the row.
 * So the rider who owns the row is exactly the credential that can upload it,
 * and a bug here cannot reach anybody else's folder.
 *
 * ## Where the pictures come from
 *
 * They are DRAWN HERE, in SVG, and rendered to JPEG by the Chromium that is
 * already installed for the walk. Nothing is downloaded and nothing is
 * borrowed, so there is no licence to settle before these ship — which matters,
 * because a store listing is published.
 *
 * **They are illustrations, not photographs, and that is a real limit rather
 * than a detail.** They make every screen render as a complete screen with no
 * broken thumbnails, which is what this story needs. A finished listing wants
 * photographs the owner holds the rights to; dropping those in is one directory
 * away (`--photos <dir>`), and until then this is the honest placeholder.
 *
 * ## Usage
 *
 *   NEXT_PUBLIC_SUPABASE_URL=...  NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   SEED_PASSWORD=<the -v seed_password you passed to the SQL> \
 *   node scripts/dev/seed-screenshot-media.mjs [--photos <dir>] [--replace] [--skip-tiles]
 *
 *   node scripts/dev/seed-screenshot-media.mjs --preview <dir>   # draw only
 *
 * Idempotent: a path that already holds an object is left alone, and a ride
 * that already has a tile is not re-rendered. Re-running after re-running the
 * SQL is the ordinary case, because the seed's uuids are fixed, so the objects
 * from the previous run are still exactly where the new rows point.
 *
 * `--photos <dir>` uses `<dir>`'s JPEGs, in filename order, for the postcards
 * and covers instead of the drawn ones, and falls back to drawing when it runs
 * out. That is the hook for real photography; it takes no code change. **Pair
 * it with `--replace`** on anything but a first run — the bucket has no UPDATE
 * policy, so an existing object is skipped and the photographs would go
 * nowhere.
 *
 * `--preview <dir>` draws the set to files and stops, asking for no
 * credentials. Look at them before uploading eighteen of them.
 *
 * `--skip-tiles` stops before `resolve-ride-location`, which is the only step
 * that spends a vendor credit.
 */
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright-core'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { argv, env, exit } from 'node:process'

const CHROMIUM =
  env.WALK_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BUCKET = 'media'

/**
 * The five accounts `screenshot-account.sql` owns, in its order. The uuids are
 * NOT repeated here — they are read back off the database, so this file cannot
 * drift from the seed by getting one wrong. The emails are the only thing both
 * files have to agree on, and a mismatch fails loudly at sign-in.
 */
const RIDERS = [
  'sofia@letsride.dev',
  'jonas@letsride.dev',
  'lieke@letsride.dev',
  'marco@letsride.dev',
  'nadia@letsride.dev',
]

const required = (name) => {
  const value = env[name]
  if (!value) {
    console.error(`${name} is not set.`)
    console.error('Needs: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SEED_PASSWORD')
    exit(1)
  }
  return value
}

const flag = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1]
}

const previewDir = flag('--preview')
const photosDir = flag('--photos')
const skipTiles = argv.includes('--skip-tiles')
const replace = argv.includes('--replace')

// `--preview` draws to disk and touches no database, so it asks for no
// credentials — which is the point of having it.
const url = previewDir ? '' : required('NEXT_PUBLIC_SUPABASE_URL')
const anonKey = previewDir ? '' : required('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const password = previewDir ? '' : required('SEED_PASSWORD')

/* -------------------------------------------------------------------------- */
/* The pictures                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Eight palettes, each `[skyTop, skyBottom, sun, ...bands]`, darkest band last.
 * They exist so seven postcards in one deck do not read as one image repeated:
 * the deck is the screen a listing leads with, and a repeated sky is the first
 * thing that gives a mock-up away.
 */
const PALETTES = [
  ['#F6C177', '#EB6F52', '#FFF1C9', '#8C4A46', '#5E3038', '#37202C', '#1E1620'],
  ['#9FD3E8', '#DCEEF5', '#FFFFFF', '#7FA8A8', '#4E7A72', '#2F5049', '#1B2E2C'],
  ['#2B3D6B', '#7A6FA8', '#FFE9B0', '#3D3A63', '#2A2647', '#1B182F', '#12101F'],
  ['#BFE3B4', '#F2F6D8', '#FFFFFF', '#7FA86A', '#4F7A45', '#33552F', '#1F361D'],
  ['#C9D3DA', '#8E9AA6', '#E8EDF1', '#69747F', '#4A535C', '#333A41', '#20252A'],
  ['#FFD9A0', '#FFB27A', '#FFF6DE', '#B87C63', '#7E5147', '#4E3131', '#2C1D20'],
  ['#101A2E', '#26314F', '#FFE7A6', '#1A2440', '#141B31', '#0E1324', '#080B18'],
  ['#EFC7A0', '#D98E63', '#FFF2D6', '#A8613F', '#733F31', '#472725', '#281618'],
]

/** A deterministic 0..1 from an integer — so a scene is the same on every run. */
const noise = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/**
 * A ridge line across the full width, filled down to the bottom edge.
 *
 * Cubic segments with mirrored control points, NOT a chain of `T` commands: a
 * smooth-quadratic run needs a preceding `Q` to reflect, and without one the
 * whole path degenerates into a single wedge. That is what the first version of
 * this file drew, and it looked deliberate enough in code to survive review —
 * hence rendering one and looking at it before uploading eighteen.
 */
const ridge = (w, h, baseY, amp, seed) => {
  const steps = 6
  const pts = []
  for (let i = 0; i <= steps; i += 1) {
    const wave =
      Math.sin(seed * 1.7 + i * 1.1) * 0.62 +
      Math.sin(seed * 0.7 + i * 2.6) * 0.38 +
      (noise(seed * 31 + i) - 0.5) * 0.4
    pts.push([(w * i) / steps, baseY + wave * amp])
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i <= steps; i += 1) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const dx = (x1 - x0) / 2
    d += ` C ${(x0 + dx).toFixed(1)} ${y0.toFixed(1)}, ${(x1 - dx).toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }
  return `${d} L ${w.toFixed(1)} ${h.toFixed(1)} L 0 ${h.toFixed(1)} Z`
}

/**
 * A road running from a vanishing point on the ridge to the bottom edge,
 * catching the same light as the sky — a dark ribbon over dark hills is
 * invisible except where it crosses a paler band, which reads as a post rather
 * than a road.
 */
const road = (w, h, horizon, index) => {
  const vanish = w * (0.42 + noise(index * 17) * 0.2)
  const top = horizon + (h - horizon) * 0.12
  const half = w * 0.014
  const leftFoot = -w * 0.12 + w * 0.5 * noise(index * 23)
  const rightFoot = leftFoot + w * 0.62
  const midY = top + (h - top) * 0.55
  return (
    `M ${(vanish - half).toFixed(1)} ${top.toFixed(1)} ` +
    `C ${(vanish - w * 0.09).toFixed(1)} ${midY.toFixed(1)}, ` +
    `${(leftFoot + w * 0.16).toFixed(1)} ${(h - (h - top) * 0.18).toFixed(1)}, ` +
    `${leftFoot.toFixed(1)} ${h.toFixed(1)} ` +
    `L ${rightFoot.toFixed(1)} ${h.toFixed(1)} ` +
    `C ${(rightFoot - w * 0.12).toFixed(1)} ${(h - (h - top) * 0.22).toFixed(1)}, ` +
    `${(vanish + w * 0.07).toFixed(1)} ${midY.toFixed(1)}, ` +
    `${(vanish + half).toFixed(1)} ${top.toFixed(1)} Z`
  )
}

const landscapeSvg = (w, h, index) => {
  const [skyTop, skyBottom, sun, ...bands] = PALETTES[index % PALETTES.length]
  const horizon = h * (0.5 + noise(index) * 0.1)
  const sunX = w * (0.18 + noise(index * 7) * 0.64)
  const sunY = horizon * (0.3 + noise(index * 13) * 0.4)
  const layers = bands
    .map((colour, i) => {
      const t = (i + 1) / bands.length
      const baseY = horizon + (h - horizon) * t * 0.78 - (h - horizon) * 0.1
      const amp = (h - horizon) * (0.16 / (i * 0.6 + 1)) + h * 0.012
      return `<path d="${ridge(w, h, baseY, amp, index * 5 + i * 3 + 1)}" fill="${colour}"/>`
    })
    .join('\n  ')
  const showRoad = index % 3 !== 1
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${skyTop}"/>
      <stop offset="72%" stop-color="${skyBottom}"/>
      <stop offset="100%" stop-color="${sun}" stop-opacity="0.55"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${sun}" stop-opacity="0.95"/>
      <stop offset="45%" stop-color="${sun}" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="${sun}" stop-opacity="0"/>
    </radialGradient>
    <!-- Both edges fade. A gradient that starts opaque leaves a hard rule
         across the sky at the top of the rect, which is the one artefact in
         this drawing that reads as a bug rather than a style. -->
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${sun}" stop-opacity="0"/>
      <stop offset="55%" stop-color="${sun}" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="${sun}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vig" cx="50%" cy="45%" r="72%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.34"/>
    </radialGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  <circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${(w * 0.34).toFixed(0)}" fill="url(#glow)"/>
  <circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${(w * 0.045).toFixed(0)}" fill="${sun}"/>
  <rect x="0" y="${(horizon - h * 0.14).toFixed(0)}" width="${w}" height="${(h * 0.24).toFixed(0)}" fill="url(#haze)"/>
  ${layers}
  ${showRoad ? `<path d="${road(w, h, horizon, index)}" fill="${sun}" opacity="0.17"/>` : ''}
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.09"/>
  <rect width="${w}" height="${h}" fill="url(#vig)"/>
</svg>`
}

/* -------------------------------------------------------------------------- */
/* The renderer                                                               */
/* -------------------------------------------------------------------------- */

const browser = await chromium.launch({ executablePath: CHROMIUM })
const context = await browser.newContext()

const render = async (svg, w, h) => {
  const page = await context.newPage()
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(
    `<style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block}</style>${svg}`,
  )
  const buffer = await page.screenshot({ type: 'jpeg', quality: 84 })
  await page.close()
  return buffer
}

/** Real photographs, when `--photos` names a directory holding some. */
const photos = await (async () => {
  if (!photosDir) return []
  const names = (await readdir(photosDir))
    .filter((n) => /\.jpe?g$/i.test(n))
    .sort()
  return names.map((n) => path.join(photosDir, n))
})()
let photoCursor = 0

/**
 * `photo: true` means a real photograph is used here when `--photos` supplies
 * one. Avatars are excluded on purpose: a photograph in a directory is a
 * landscape or a bike, and cropping one to a 512-square face is not something
 * this script can do well or should guess at.
 */
const SHAPES = {
  postcards: { w: 1200, h: 1500, photo: true },
  covers: { w: 1200, h: 640, photo: true },
  'club-covers': { w: 1200, h: 640, photo: true },
  avatars: { w: 512, h: 512, photo: false },
  'club-avatars': { w: 512, h: 512, photo: false },
}

let drawn = 0
const bytesFor = async (objectPath, index) => {
  const prefix = objectPath.split('/')[0]
  const shape = SHAPES[prefix]
  if (!shape) throw new Error(`no shape for prefix ${prefix}`)
  if (shape.photo && photoCursor < photos.length) {
    return readFile(photos[photoCursor++])
  }
  drawn += 1
  return render(landscapeSvg(shape.w, shape.h, index), shape.w, shape.h)
}

/**
 * `--preview <dir>` draws the set to files and stops, before any sign-in.
 *
 * It is here because the first version of the ridge path rendered a single
 * wedge on a blank sky, and nothing between writing it and eighteen objects
 * being live on DEV would have said so. Looking at one is the only check there
 * is on a drawing.
 */
if (previewDir) {
  await mkdir(previewDir, { recursive: true })
  for (const [prefix, shape] of Object.entries(SHAPES)) {
    for (let i = 0; i < 4; i += 1) {
      const buffer = await render(landscapeSvg(shape.w, shape.h, i), shape.w, shape.h)
      const file = path.join(previewDir, `${prefix}-${i}.jpg`)
      await writeFile(file, buffer)
      console.log(`  ${file}  (${(buffer.length / 1024).toFixed(0)} kB)`)
    }
  }
  await browser.close()
  exit(0)
}

/* -------------------------------------------------------------------------- */
/* The upload                                                                 */
/* -------------------------------------------------------------------------- */

const signIn = async (email) => {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    console.error(`Could not sign in as ${email}: ${error.message}`)
    console.error('Run supabase/seeds/screenshot-account.sql first, and pass the same password.')
    exit(1)
  }
  return { client, userId: data.user.id }
}

const results = { uploaded: 0, present: 0, failed: 0, tiles: 0, tilesSkipped: 0 }

const upload = async (client, objectPath, index) => {
  // **The bytes are in hand BEFORE the old object is removed**, and the order
  // is the whole point: `bytesFor` reads a file under `--photos` or renders in
  // a browser, and either can throw. Removing first would leave the object
  // deleted, the row pointing at nothing and the run dead — the grey "could not
  // be loaded" panel this script exists to prevent, produced by the script.
  const body = await bytesFor(objectPath, index)

  // `--replace` is what makes `--photos` usable on a second run: the bucket has
  // no UPDATE policy, so an existing object is otherwise skipped for ever and
  // the new photographs go nowhere. Every prefix carries an own-folder DELETE
  // grant (`010`, `014`, `016`, `051`), so this stays inside the same RLS the
  // upload does.
  if (replace) {
    const { error } = await client.storage.from(BUCKET).remove([objectPath])
    if (error) console.error(`  (could not remove ${objectPath}: ${error.message})`)
  }
  const { error } = await client.storage
    .from(BUCKET)
    .upload(objectPath, new Blob([body], { type: 'image/jpeg' }), {
      contentType: 'image/jpeg',
      upsert: false,
    })
  if (!error) {
    results.uploaded += 1
    console.log(`  uploaded  ${objectPath}  (${(body.length / 1024).toFixed(0)} kB)`)
    return
  }
  // A path that already holds an object is the re-run case, not a fault. The
  // bucket has no UPDATE policy on purpose, so there is nothing to overwrite
  // with and nothing that should be.
  const duplicate =
    error.statusCode === '409' || /exists|duplicate/i.test(error.message ?? '')
  if (duplicate) {
    results.present += 1
    console.log(`  present   ${objectPath}`)
    return
  }
  results.failed += 1
  console.error(`  FAILED    ${objectPath}: ${error.message}`)
}

let index = 0
const sessions = []

for (const email of RIDERS) {
  const { client, userId } = await signIn(email)
  sessions.push({ email, client, userId })
  console.log(`\n${email}`)

  const [profile, clubs, postcards] = await Promise.all([
    client
      .from('profiles')
      .select('avatar_path, cover_image_path')
      .eq('id', userId)
      .maybeSingle(),
    client.from('clubs').select('avatar_path, cover_image_path').eq('owner_id', userId),
    client
      .from('postcards')
      .select('image_path')
      .eq('author_id', userId)
      .order('created_at', { ascending: true }),
  ])

  const paths = [
    profile.data?.avatar_path,
    profile.data?.cover_image_path,
    ...(clubs.data ?? []).flatMap((c) => [c.avatar_path, c.cover_image_path]),
    ...(postcards.data ?? []).map((p) => p.image_path),
  ].filter(Boolean)

  if (paths.length === 0) {
    console.log('  nothing to upload — is the SQL seed applied?')
  }
  for (const objectPath of paths) {
    await upload(client, objectPath, index)
    index += 1
  }
}

/* -------------------------------------------------------------------------- */
/* The map tiles                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `resolve-ride-location` is the only thing that produces a real tile: it
 * geocodes the meeting point, renders both sizes, uploads them under the
 * caller's own JWT and updates the five columns. `createRide` invokes it exactly
 * this way and ignores the answer; here the answer is worth reading, because a
 * seeded ride with no tile is the defect this script exists to prevent.
 */
if (!skipTiles) {
  console.log('\nmap tiles')
  for (const { client, userId } of sessions) {
    // Every ride these five accounts organise is a seeded ride — the seed
    // creates the accounts and nothing else writes as them — so `organizer_id`
    // is the whole filter. An `id LIKE` prefix was the obvious second
    // condition and is not one: `id` is a uuid, PostgREST does not cast it for
    // `like`, and the request came back with NO rows and no error, which reads
    // exactly like "this rider organises nothing".
    const { data: rides, error } = await client
      .from('rides')
      .select('id, title, map_card_path')
      .eq('organizer_id', userId)
    if (error) {
      console.error(`  FAILED    reading rides: ${error.message}`)
      results.failed += 1
      continue
    }
    for (const ride of rides ?? []) {
      if (ride.map_card_path) {
        results.tilesSkipped += 1
        console.log(`  present   ${ride.title}`)
        continue
      }
      const { data, error } = await client.functions.invoke('resolve-ride-location', {
        body: { rideId: ride.id },
      })
      if (error) {
        console.error(`  FAILED    ${ride.title}: ${error.message}`)
        results.failed += 1
      } else if (data?.rendered) {
        results.tiles += 1
        console.log(`  rendered  ${ride.title}`)
      } else {
        // The function fails OPEN by design — a ride the geocoder cannot place
        // keeps its fallback panel and says nothing. Reported here because a
        // seed run is the one moment somebody wants to know.
        console.log(`  no tile   ${ride.title} — the geocoder did not place it`)
      }
    }
  }
}

await browser.close()

console.log(
  `\n${results.uploaded} uploaded, ${results.present} already present, ${results.tiles} tile(s) rendered, ` +
    `${results.tilesSkipped} ride(s) already had one, ${results.failed} failed.`,
)
console.log(
  photos.length > 0
    ? `${photos.length} photograph(s) taken from ${photosDir}; ${drawn} image(s) drawn.`
    : `${drawn} image(s) drawn — illustrations, not photographs. Pass --photos <dir> to use real ones.`,
)
if (results.failed > 0) exit(1)
