/**
 * Deliberately NOT a `'use server'` module. Those may only export async
 * functions — a plain const exported from one is either rejected or turned
 * into a server reference, and six client components need this value at module
 * scope to seed `useActionState`.
 */
export type ActionState = {
  error: string | null
  /**
   * Set by actions that finish without navigating, so the screen can tell
   * "not submitted yet" from "submitted, nothing to report" — both of which
   * are `error: null` otherwise.
   *
   * Two actions need it: `requestPasswordReset`, which renders a confirmation
   * in place, and `addComment`, which stays on the thread and whose composer
   * clears itself on it. Every other action redirects on success, so its
   * success state is never rendered. If you are adding a third, set this rather
   * than inventing a second success signal — and note that consecutive
   * successes are indistinguishable by value, so a screen reacting to it must
   * compare the state object's identity.
   */
  sent?: boolean
}

export const emptyActionState: ActionState = { error: null }
