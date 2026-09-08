/**
 * How long the "where do you ride from?" question stays quiet after a rider
 * closes it without answering — PD-447.
 *
 * ## What replaced what
 *
 * This is `ask-once.ts` rewritten. That module answered one question — *has the
 * one automatic ask been spent* — because PD-419's row opened a sheet by itself
 * at Explore, once, ever. **There is no automatic ask any more**: no sheet in
 * this app opens without a rider gesture, so a once-ever boolean has nothing
 * left to guard. What is worth remembering instead is that the rider was asked
 * and said, in effect, *yes, still here* — and the row should stop asking for a
 * while.
 *
 * ## The ladder, and why it starts at a month rather than a week
 *
 * A town changes maybe twice in a rider's life, and the row carries the device
 * permission offer alongside the question — so re-asking weekly is a monthly
 * permission nag under another name. The interval is a month, doubling on each
 * *consecutive* dismissal and capped at six:
 *
 * ```
 * n:        0     1     2     3     4      5 …
 * quiet:   30d   30d   60d  120d  180d   180d
 * ```
 *
 * **The rider acting resets it** — a stored town, or a device fix coming back.
 * So the ladder only ever climbs for a rider who keeps declining to answer,
 * which is exactly the rider who should be asked least often.
 *
 * **`profiles.location` has TWO writers and neither guarantees the other**:
 * `setRiderTown` (the row's sheet and `/profile`'s setting) and `setHomeTown`
 * (the wizard's town step, which writes the column directly). Each calls
 * `recordAnswered` itself. There is no single writer to hang the reset on, so a
 * third route into a stored town owes the call explicitly rather than getting
 * it by construction — which is the sentence this header carried wrongly until
 * the pre-merge review, and the reason a `git grep -n "recordAnswered"` is the
 * check rather than this paragraph.
 *
 * ## Why it persists, where every other one-shot in this app does not
 *
 * `introduction-dismissal.ts` is the shape next door and it is deliberately
 * **per session**: a club's introduction prompt should come back tomorrow,
 * because the rider may well introduce themselves then. This one must not — a
 * question that returns on the next cold start is a question the rider learns
 * to swipe away, and the row carries the device's one-way permission offer with
 * it.
 *
 * It is per device rather than per rider for the same reason it always was: the
 * offer beside the question is the OS permission, which is per device. **It does
 * not survive sign-out** — `signOut` clears it, so a shared phone does not hand
 * the next rider up to six months of inherited silence about a town that is not
 * theirs.
 *
 * ## Failing open is the safe direction, and it is a real decision
 *
 * Every read and write is wrapped, because `localStorage` **throws** rather than
 * returning null in a private window, under a browser set to block site data,
 * and inside some WebView previews. **Anything that is not a well-formed record
 * is treated as absent, and absent means the row draws.** The worst case is a
 * rider being asked again; the alternative reading — treat an unreadable store
 * as quiet — silently removes the question for that rider with no signal
 * anywhere that it happened.
 *
 * **A failed WRITE is the one that costs**, and it is unavoidable: if the store
 * refuses it, the row is back on the next visit. That is the same nuisance and
 * it is the only outcome available; there is nowhere else to put this.
 *
 * **A failed RESET is the one direction that fails closed** — the rider stored
 * a town and the row stays quiet for the remainder of the interval. Accepted:
 * the question has just been answered, so silence is the right outcome anyway,
 * and only the rung is wrong.
 */
const KEY = 'letsride.location.dismissedQuestion'

/**
 * `ask-once.ts`'s key. **Removed rather than read.** A leftover
 * `letsride.location.asked === '1'` means "the automatic ask was spent", and
 * after PD-447 nothing may act on that — so `clearDismissal` deletes it and no
 * code path anywhere derives behaviour from its presence.
 */
const RETIRED_ASK_ONCE_KEY = 'letsride.location.asked'

const DAY_MS = 24 * 60 * 60 * 1000

/** The first rung, and the one a rider who answers is put back on. */
export const QUIET_BASE_MS = 30 * DAY_MS
/** The ceiling the doubling stops at — six months. */
export const QUIET_CAP_MS = 180 * DAY_MS

export type DismissalRecord = {
  /** When the dismissal happened, epoch ms. */
  at: number
  /** Consecutive dismissals, `0` meaning "the rider answered". */
  n: number
}

/**
 * How long a record with `n` consecutive dismissals keeps the row quiet.
 *
 * A pure function of the count, so every rung is testable without a clock:
 * `30d × 2^(max(n,1) − 1)`, capped. `n: 0` and `n: 1` deliberately share the
 * base rung — the first is a rider who answered and the second a rider who
 * declined once, and neither has earned a longer silence than a month.
 */
export function quietFor(n: number): number {
  return Math.min(QUIET_BASE_MS * 2 ** (Math.max(n, 1) - 1), QUIET_CAP_MS)
}

/**
 * The stored record, or `null` for anything that is not one.
 *
 * **The shape is validated, not just the parse.** `JSON.parse('1')` succeeds
 * and returns a number — and `'1'` is precisely the value the retired key held,
 * so a guard that only wraps the parse in a `try` accepts it and then throws on
 * a property read somewhere less obvious. A non-object, a missing field, a
 * non-finite `at` and a negative or fractional `n` are all *absent*.
 */
export function readDismissal(): DismissalRecord | null {
  let raw: string | null | undefined
  try {
    raw = globalThis.localStorage?.getItem(KEY)
  } catch {
    // Unreadable store — see the header. "Never dismissed" is the failure this
    // app can live with; the other one is invisible.
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const { at, n } = parsed as { at?: unknown; n?: unknown }
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null

  return { at, n }
}

/**
 * Whether a record silences the question at `now`.
 *
 * **A record stamped in the future is treated as absent.** A device clock that
 * moved backwards — or forwards and then back — would otherwise silence the
 * question until the clock caught up, which for a year-ahead clock is for ever,
 * with nothing on any screen to explain it.
 */
export function isQuiet(record: DismissalRecord | null, now: number): boolean {
  if (!record) return false
  if (now < record.at) return false
  return now < record.at + quietFor(record.n)
}

/** The two above, against the store. The row's only read. */
export function isQuestionQuiet(now: number = Date.now()): boolean {
  return isQuiet(readDismissal(), now)
}

/**
 * The rider closed the question without answering it — one rung up.
 *
 * `previous` comes through the same validated read, so a corrupt record
 * restarts the ladder at 1 rather than at `NaN`.
 */
export function recordDismissal(now: number = Date.now()): void {
  const previous = readDismissal()
  write({ at: now, n: (previous?.n ?? 0) + 1 })
}

/**
 * The rider answered — quiet for the base interval, with the ladder back to
 * zero. Called from **both** writers of `profiles.location`, `setRiderTown` and
 * `setHomeTown`, each on a successful write of a non-null town. Never on the
 * clear path: removing a town is unanswering the question.
 */
export function recordAnswered(now: number = Date.now()): void {
  write({ at: now, n: 0 })
}

/**
 * Forget the whole thing — a device fix came back, or the rider signed out.
 * Also removes the retired `ask-once` key; see its constant.
 */
export function clearDismissal(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
    globalThis.localStorage?.removeItem(RETIRED_ASK_ONCE_KEY)
  } catch {
    // Nothing to clear, and nowhere to say so.
  }
}

/** Test seam, matching `resetRiderLocationCacheForTests`. Nothing in the app
 *  calls it. */
export function resetDismissalForTests(): void {
  clearDismissal()
}

function write(record: DismissalRecord): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(record))
  } catch {
    // Nowhere else to record it. The question comes back next visit, which is
    // the nuisance the header prices rather than a state to recover from.
  }
}
