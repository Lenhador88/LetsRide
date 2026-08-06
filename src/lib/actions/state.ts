/**
 * Deliberately NOT a `'use server'` module. Those may only export async
 * functions — a plain const exported from one is either rejected or turned
 * into a server reference, and six client components need this value at module
 * scope to seed `useActionState`.
 *
 * **No module under `lib/actions/` is a `'use server'` module any more.** The
 * render migration moved writes into the browser alongside reads (task 5.8 and
 * group 6): every caller was already a client component, `revalidatePath` has
 * no meaning without a server render, and group 6 deletes the server client
 * these modules used to import. The rule above still holds for this file
 * because it is the reason this file exists, and re-adding a directive to any
 * of them would break the same way it did in 2026-08.
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
   * clears itself on it. Every other action navigates on success, so its
   * success state is never rendered. If you are adding a third, set this rather
   * than inventing a second success signal — and note that consecutive
   * successes are indistinguishable by value, so a screen reacting to it must
   * compare the state object's identity.
   */
  sent?: boolean
  /**
   * Where the caller should navigate once this action succeeds — task 5.8's
   * replacement for the twelve `redirect()` call sites.
   *
   * `redirect()` signalled success by throwing, which is what made success
   * distinguishable from the unsubmitted state for free: neither was ever
   * rendered, so nobody had to tell them apart. Returning normally loses that,
   * and `{ error: null }` alone would leave a submitted form sitting on a
   * screen it should have left. This carries the destination the server used to
   * apply itself.
   *
   * **A client action cannot navigate on its own**, and should not try: these
   * modules are plain async functions now, callable from an event handler, a
   * `useActionState` transition or a test, and reaching for the router inside
   * one would make them untestable and tie every write to Next's navigation.
   * `useActionRedirect` in `navigate.ts` is the honouring half of this
   * contract, and every form that can receive a `redirectTo` must use it.
   */
  redirectTo?: string
}

export const emptyActionState: ActionState = { error: null }
