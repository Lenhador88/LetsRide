import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import {
  REPORT_REASON_WHEN_UNDRAWN,
  reportPostcardCommentSchema,
  reportPostcardSchema,
} from '@/lib/validation/comments'
import type { ActionState } from '@/lib/actions/state'

/**
 * Hiding and reporting are separate rights on purpose — 011 keeps them in
 * separate tables for the same reason. A rider may want one, the other, or
 * both, and an action that quietly does both takes that choice away. If a
 * screen wants "report and hide" as one tap, it calls both.
 */

/**
 * Per-viewer and one-directional: this only ever removes the postcard from
 * *your* feed. That is the whole difference from a block, which is symmetric
 * and needs a security definer helper to resolve a row the blocked party
 * cannot read.
 *
 * `ignoreDuplicates` for the same reason as likes and blocks: 011 grants no
 * UPDATE on `postcard_hides`, so the default `on conflict do update` would fail
 * 42501, and pressing Hide twice should be a no-op rather than an error.
 *
 * Hiding your own postcard is accepted and inert — 009 made the author branch
 * of the postcards SELECT policy unconditional so a rider never loses their own
 * photo, and 011 deliberately kept the hide predicate inside the *other*
 * branch. Delete is the affordance for not wanting your own post.
 */
export async function hidePostcard(postcardId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase
    .from('postcard_hides')
    .upsert(
      { postcard_id: postcardId, user_id: user.id },
      { onConflict: 'postcard_id,user_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not hide that postcard. Try again.' }

  invalidate(queryKeys.postcards.all())
  return { error: null }
}

/**
 * No `.eq('user_id', ...)` — 011's DELETE policy already scopes this to the
 * caller's own hide. Unhiding restores the postcard along with its likes,
 * comments and image in one go, because all of those delegate to the postcards
 * SELECT policy this predicate lives in. Nothing was ever deleted.
 */
export async function unhidePostcard(postcardId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase.from('postcard_hides').delete().eq('postcard_id', postcardId)

  if (error) return { error: 'Could not unhide that postcard. Try again.' }

  invalidate(queryKeys.postcards.all())
  return { error: null }
}

/**
 * **A report currently goes nowhere anyone can read.** 011 grants SELECT only
 * to the reporter, because this project has no admin role and no moderator
 * claim to key a policy on. The table exists because a Report button that
 * writes nothing is worse, and because the moderator path is additive later —
 * but nobody should believe a filed report gets triaged today. The KNOWN GAP
 * at the top of migration 011 says the same thing.
 *
 * A duplicate report is a no-op, not an error: `unique (reporter_id,
 * postcard_id)` is the anti-brigading mechanism, and telling a rider "you
 * already reported this" is friendlier than a constraint violation — and it
 * does not leak anything, since they can read their own reports anyway.
 */
export async function reportPostcard(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = reportPostcardSchema.safeParse({
    postcardId: formData.get('postcardId'),
    reason: formData.get('reason'),
    note: formData.get('note'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { postcardId, reason, note } = parsed.data

  const { error } = await supabase
    .from('postcard_reports')
    .upsert(
      { reporter_id: user.id, postcard_id: postcardId, reason, note },
      { onConflict: 'reporter_id,postcard_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not send that report. Try again.' }

  return { error: null }
}

/**
 * Reports a comment — `123`, PD-454, `reportPostcard`'s shape one subject
 * over. The comment and the postcard it sits on are different subjects with
 * different authors — a comment on somebody else's photo could not be
 * reported at all before this, only the photo could.
 *
 * **Sends `REPORT_REASON_WHEN_UNDRAWN`, always** — no reason-picker frame for
 * a comment report either (`design.md` Q2), so `reason` carries no signal
 * while this is the only caller. Beside the two entries already recording
 * that gap for the postcard itself, `docs/FIGMA-FIDELITY-TODO.md` §Postcard
 * overflow menu.
 *
 * **A report currently goes nowhere anyone can read** — `123`'s own
 * `private.postcard_comment_report_queue`, revoked from every client role
 * including `service_role`. Not the commenter, not the postcard's author, who
 * already holds a delete right over every comment on their own photo and
 * gains no read alongside it (`design.md` D5, the `076` question).
 * `invalidate` is deliberately not called: nothing this rider — or anyone
 * else — can read changes.
 *
 * A duplicate report is a no-op, not an error: `unique (reporter_id,
 * comment_id)` is the anti-brigading mechanism, and they can read their own
 * report regardless.
 *
 * **`ignoreDuplicates: true` is a PRIVILEGE requirement, not a preference about
 * duplicates** — the same reason `hidePostcard` above states for
 * `postcard_hides`. `123` grants `authenticated` no UPDATE on this table, so
 * the default merge-duplicates form 42501s **every** report including a rider's
 * first. Pinned at `123.6` in the emitted form.
 */
export async function reportPostcardComment(commentId: string): Promise<ActionState> {
  const parsed = reportPostcardCommentSchema.safeParse({
    commentId,
    reason: REPORT_REASON_WHEN_UNDRAWN,
    note: null,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'That comment could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase
    .from('postcard_comment_reports')
    .upsert(
      {
        reporter_id: user.id,
        comment_id: parsed.data.commentId,
        reason: parsed.data.reason,
        note: parsed.data.note,
      },
      { onConflict: 'reporter_id,comment_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not send that report. Try again.' }

  return { error: null }
}
