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
   * "not submitted yet" from "submitted, nothing to report". Only
   * requestPasswordReset needs it: every other action redirects on success, so
   * its success state is never rendered.
   */
  sent?: boolean
}

export const emptyActionState: ActionState = { error: null }
