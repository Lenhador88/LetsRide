import { USERNAME_TAKEN_MESSAGE } from '@/lib/validation/profile'

/**
 * One availability answer, carrying the value it was computed for.
 *
 * Without the value, editing the field keeps the previous verdict on screen for
 * the whole debounce window — type "abc", see "available", add a "d", and it
 * still reads available for a name nobody checked.
 */
export type UsernameCheck = {
  value: string
  available: boolean
  error: string | null
}

/**
 * The case-insensitive key a verdict is stored and looked up under.
 *
 * It matches **`profiles_username_lower_key`, not `usernameSchema`** — since
 * `056` the schema preserves the rider's capitals and the index folds them, so
 * the key has to follow the authority rather than the input. A refusal of
 * `Pedro` is equally a refusal of `pedro` and `PEDRO`, because the index cannot
 * tell those apart, and all three therefore have to land on one entry.
 */
export function normaliseUsername(input: string): string {
  return input.trim().toLowerCase()
}

/**
 * What the username field should say right now, given what the live check
 * answered and what the *database* has already refused.
 *
 * **A refusal outranks any later "available", and that is the whole point of
 * this function** (PD-146). The two sources disagree by construction and only
 * one of them is the authority:
 *
 * - `profiles_username_lower_key` is a plain unique index on `lower(username)`.
 *   It is global, so a name is taken against everyone — including a rider the
 *   holder has blocked, who gets `23505` on submit.
 * - `isUsernameTaken` reads through the block-aware `profiles` SELECT policy,
 *   which hides the holder's row from that same rider. So the check reports
 *   **free**, every time it is asked, for a name that can never be saved.
 *
 * Making the check agree with the index is not the fix: it would have to see
 * past the block, which would leak the existence of a blocked rider's username
 * — precisely what the policy exists to prevent. So the index's answer is
 * remembered client-side and wins, which removes the contradiction the rider
 * sees without moving the inference channel anywhere it was not already.
 *
 * Sticky rather than one-shot for the same reason. Overwriting the current
 * verdict alone would flip back to green the moment the rider retypes the name
 * — the debounce refires, the block-aware read answers "free" again, and the
 * dead end returns with the rider now certain the app is broken.
 *
 * `null` means "nothing to say yet": no check has landed for what is in the
 * field, and nothing has been refused.
 */
export function usernameVerdict(
  input: string,
  checked: UsernameCheck | null,
  refused: readonly string[]
): UsernameCheck | null {
  const value = normaliseUsername(input)
  if (!value) return null

  if (refused.includes(value)) {
    return { value, available: false, error: USERNAME_TAKEN_MESSAGE }
  }

  // Only a verdict that belongs to what is currently in the field.
  return checked && checked.value === value ? checked : null
}

/**
 * Whether the field should say the availability check did not answer at all.
 *
 * The check is advisory — `setUsername` and the unique index are what decide —
 * so a failed read must not be drawn as "taken": that would refuse a name that
 * is very probably free, on the step a rider cannot skip. But it must not be
 * drawn as *nothing* either, which is what a `.then()` with no `.catch()` gave.
 * A rejected promise notifies no one, so the field simply stays blank and the
 * rider is left waiting for an answer that is never coming.
 *
 * A verdict outranks a failure: a remembered refusal is the authority (PD-146)
 * and a landed answer is fresher than a read that failed before it.
 *
 * Keyed by the folded value for the same reason `usernameVerdict` is — the note
 * must disappear the moment the rider edits the field, or it describes a name
 * nobody tried to check.
 */
export function usernameCheckUnanswered(
  input: string,
  verdict: UsernameCheck | null,
  failedFor: string | null
): boolean {
  if (verdict || !failedFor) return false
  return normaliseUsername(input) === failedFor
}

/**
 * The refused list after a submit — the accumulating half of the rule above.
 *
 * It lives in the form's own `useActionState` state rather than in a ref or an
 * effect, and both alternatives are worse in a way worth stating once. A ref
 * would have to be read during render, which the React compiler rejects. An
 * effect runs *after* the refusal has been painted, so the rider gets a frame
 * of green "available" over a red "taken" — the exact contradiction this change
 * removes, flashed on the way to removing it. Returned from the reducer, the
 * list is already correct on the first render of the new state.
 *
 * Returns the same array when there is nothing to add, so a re-render caused by
 * something else does not hand the field a new identity.
 *
 * **It folds on the way in, and that is load-bearing since `056`.** `setUsername`
 * reports the value the index refused with the rider's own capitals — `Pedro` —
 * while `usernameVerdict` reads the list back through `normaliseUsername`.
 * Storing the raw value would write the refusal under one key and look it up
 * under another: the field flips straight back to green for a name that can
 * never be saved, which is PD-146 reintroduced with every other test passing.
 */
export function rememberRefusal(
  refused: readonly string[],
  taken: string | undefined
): readonly string[] {
  if (!taken) return refused
  const key = normaliseUsername(taken)
  if (refused.includes(key)) return refused
  return [...refused, key]
}
