#!/usr/bin/env node
/**
 * Removes postcard images in Storage that no `postcards` row points at.
 *
 * ## Why this is a script and not SQL
 *
 * `delete from storage.objects` is refused by Supabase's own guard:
 *
 *   42501: Direct deletion from storage tables is not allowed.
 *   Use the Storage API instead.
 *   HINT: This prevents accidental data loss from orphaned objects.
 *
 * The guard is right. The row is metadata; the bytes live in object storage,
 * and deleting the row alone would strand them somewhere nothing can list. So
 * the Storage API is the only correct path, and this script is what drives it.
 *
 * ## Why it signs in as a rider rather than using a service-role key
 *
 * Decision #8: no service-role key, anywhere. It bypasses every RLS policy, and
 * a maintenance script is exactly where one gets introduced "just this once".
 *
 * None is needed. Migration 010 grants each rider DELETE on their own
 * `postcards/<their uid>/` folder, so a rider signed in normally can clean up
 * after themselves — and cannot touch anyone else's folder even if this script
 * had a bug. The blast radius is a property of the policy, not of the code.
 *
 * ## How an orphan happens
 *
 * The upload runs before the insert, so a failed insert leaves an unreferenced
 * object. `createPostcard` cleans that up itself — but only if it actually
 * runs. The orphans this was written for came from `/postcards/new` throwing at
 * module evaluation (fixed in #21), where the action never executed at all.
 *
 * The remaining known leak: picking a second photo before submitting abandons
 * the first upload. Registered in docs/FIGMA-FIDELITY-TODO.md.
 *
 * ## Usage
 *
 *   NEXT_PUBLIC_SUPABASE_URL=...  NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   RIDER_EMAIL=...  RIDER_PASSWORD=... \
 *   node scripts/storage/sweep-orphans.mjs [--delete]
 *
 * Dry run by default. It prints what it would remove and exits without
 * touching anything; `--delete` is the deliberate second step.
 */
import { createClient } from '@supabase/supabase-js'
import { argv, env, exit } from 'node:process'

const BUCKET = 'media'
const FOLDER = 'postcards'
const PAGE = 100

const required = (name) => {
  const value = env[name]
  if (!value) {
    console.error(`${name} is not set.`)
    console.error('Needs: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, RIDER_EMAIL, RIDER_PASSWORD')
    exit(1)
  }
  return value
}

const url = required('NEXT_PUBLIC_SUPABASE_URL')
const anonKey = required('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const email = required('RIDER_EMAIL')
const password = required('RIDER_PASSWORD')
const commit = argv.includes('--delete')

const supabase = createClient(url, anonKey)

const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password })
if (authError || !auth?.user) {
  console.error(`Could not sign in: ${authError?.message ?? 'no session returned'}`)
  exit(1)
}

const uid = auth.user.id
const prefix = `${FOLDER}/${uid}`
console.log(`Signed in as ${email} (${uid})`)
console.log(`Sweeping ${BUCKET}/${prefix}/\n`)

// Every object in this rider's own folder. Paged, because list() caps out and a
// silent truncation would report orphans as clean.
const objects = []
for (let offset = 0; ; offset += PAGE) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(prefix, { limit: PAGE, offset })

  if (error) {
    console.error(`Could not list ${prefix}: ${error.message}`)
    exit(1)
  }
  objects.push(...data)
  if (data.length < PAGE) break
}

// Their own postcards. The author branch of the SELECT policy is unconditional,
// so this returns every one of theirs — including any in a club they have left,
// whose images must NOT be swept.
const { data: postcards, error: readError } = await supabase
  .from('postcards')
  .select('image_path')
  .eq('author_id', uid)

if (readError) {
  console.error(`Could not read your postcards: ${readError.message}`)
  console.error('Refusing to sweep — without this list every object looks unreferenced.')
  exit(1)
}

const referenced = new Set(postcards.map((row) => row.image_path))
const orphans = objects
  .map((object) => ({ path: `${prefix}/${object.name}`, bytes: object.metadata?.size ?? 0 }))
  .filter((object) => !referenced.has(object.path))

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`
const total = orphans.reduce((sum, o) => sum + o.bytes, 0)

console.log(`${objects.length} object(s) in your folder, ${referenced.size} referenced by a postcard.`)

if (orphans.length === 0) {
  console.log('No orphans. Nothing to do.')
  exit(0)
}

console.log(`\n${orphans.length} orphan(s), ${mb(total)}:`)
for (const orphan of orphans) console.log(`  ${orphan.path}  ${mb(orphan.bytes)}`)

if (!commit) {
  console.log('\nDry run — nothing deleted. Re-run with --delete to remove them.')
  exit(0)
}

const { data: removed, error: removeError } = await supabase.storage
  .from(BUCKET)
  .remove(orphans.map((orphan) => orphan.path))

if (removeError) {
  console.error(`\nDelete failed: ${removeError.message}`)
  exit(1)
}

console.log(`\nDeleted ${removed?.length ?? 0} object(s), ${mb(total)} reclaimed.`)
