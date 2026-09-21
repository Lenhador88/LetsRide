/**
 * send-moderation-digest/shape.ts — every decision the digest makes, with no
 * Deno global and no `jsr:` import in the file.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS SEPARATELY FROM `index.ts`
 * ---------------------------------------------------------------------------
 * `tsconfig.json` excludes `supabase/functions`, so `npx tsc --noEmit` does not
 * see the sibling `index.ts` or `mail.ts`, and neither does Vitest or
 * `next build`. That is `delete-account`'s rule 4. `search-places` answered it
 * by putting the decisions in a `shape.ts` that a unit test under
 * `src/__tests__/` imports — which drags the file back inside `tsc`'s graph and
 * Vitest's — and `push-notify/shape.ts` copied it. This is the third instance
 * of the same split, and `src/__tests__/moderation-digest-shape.test.ts` holds
 * the other end.
 *
 * **Keep the split.** Anything here that grows a `Deno.` reference or a `jsr:`
 * import silently drops out of both tools, and nothing goes red when it does.
 *
 * ---------------------------------------------------------------------------
 * THE RENDERER IS A WHITELIST, AND THAT IS THE SECURITY PROPERTY
 * ---------------------------------------------------------------------------
 * A privileged role assembles this mail, so RLS is not in the path and there is
 * no viewer to test a predicate against — the reader is the account owner, who
 * can already read every row in the database. `design.md` D5 therefore states
 * the containment as **a list of columns and nothing else**, and the enforcement
 * is in two places that must both hold:
 *
 * 1. `claim_moderation_digest`'s `returns table (...)` — the projection never
 *    leaves the database in the first place, pinned as text by the RLS suite so
 *    widening it fails a test.
 * 2. `renderEntry` below, which reads named fields off the row and never
 *    iterates it. Handed a row carrying a caption, an `image_path`, a
 *    `reporter_id` or a `posthog_session_id`, it emits none of them — and
 *    `moderation-digest-shape.test.ts` proves that by handing it exactly such a
 *    row rather than by trusting this paragraph.
 *
 * The second is not redundant. The RPC is the gate; this is the thing that stops
 * a later `select *` convenience in the RPC from becoming a data leak in the
 * same commit that introduced it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DECIDE
 * ---------------------------------------------------------------------------
 * Three things live in the migration and must not be re-implemented here,
 * because a second copy is a second thing that can drift:
 *
 * 1. **What may leave the database** — the projection, above.
 * 2. **The attempt cap and what a capped entry becomes.**
 *    `complete_moderation_digest` counts attempts and leaves a capped entry
 *    **unsent** rather than `sent` (which would lose it) or deleted (which would
 *    re-mail it for ever).
 * 3. **The reclaim window** for a run that died mid-send.
 */

/**
 * The source kinds. One per report table plus rider feedback.
 *
 * **This list and `claim_moderation_digest`'s `source` CHECK are the same list
 * written twice**, which is a drift surface with nothing automatic between them
 * — Deno cannot reach the database and the RLS suite cannot reach this file. It
 * is the same necessary duplication `push-notify/shape.ts` carries for
 * `pathForPayload` against `src/lib/routes.ts`, and it is handled the same way:
 * the unit test asserts the set, so removing or renaming a kind here goes red.
 */
export type DigestSource =
  | 'postcard_report'
  | 'club_thread_report'
  | 'ride_thread_report'
  | 'postcard_comment_report'
  | 'feedback'

/**
 * The sources this build actually sweeps, in digest order.
 *
 * **It is a constant rather than a derivation, and the footer prints it, because
 * a digest that covers some report surfaces and not others must say so.** The
 * failure it prevents: a moderator reads a digest naming no ride-thread report,
 * concludes nobody reported a ride thread, and is wrong — which trains them that
 * no mail means no report, the one reading that makes an alerting channel worse
 * than none. Printing the swept list makes silence unambiguous.
 *
 * Keep it equal to the `union all` in `claim_moderation_digest`. A kind present
 * in `DigestSource` and absent here is a source the RPC does not read.
 */
export const SWEPT_SOURCES: readonly DigestSource[] = [
  'postcard_report',
  'club_thread_report',
  'ride_thread_report',
  'postcard_comment_report',
  'feedback',
]

/**
 * One claimed entry, exactly as `claim_moderation_digest` returns it.
 *
 * The report columns and the feedback columns are both nullable because the RPC
 * is one `union all` over shapes that do not agree: a report has a `reason`, a
 * feedback row has a `body`, and neither has the other's. `source` is what says
 * which half is populated.
 */
export type DigestEntry = {
  entry_id: string
  source: DigestSource
  source_id: string
  created_at: string
  /** Reports only. */
  reason: string | null
  note: string | null
  /**
   * Reports only, and **not** named `open_*`.
   *
   * There is no `resolved_at` anywhere in this schema — `076` and `094` both say
   * so deliberately, and this change's own delta keeps it that way — so there is
   * no such thing as a closed report and "open" would be a qualifier with
   * nothing behind it. These are all reports ever filed on the subject and on
   * its author, which is what `private.postcard_report_queue` already calls
   * `reports_on_this_postcard` / `reports_on_this_author`, unqualified.
   *
   * The distinction matters to the reader: the author count is monotonically
   * increasing, so it is a *history* rather than a backlog, and calling it open
   * would invite reading it as work outstanding.
   */
  reports_on_subject: number | null
  reports_on_author: number | null
  /** Feedback only. */
  body: string | null
  app_version: string | null
  route: string | null
  /**
   * Feedback only, and deliberately a boolean.
   *
   * `096` §3 added `feedback.posthog_session_id` so a bug report could be read
   * beside ninety seconds of footage. *There is footage* is the part worth
   * mailing; the id itself is a pointer into a recording of a rider's screens
   * and stays in the database, where only the owner can reach it.
   */
  has_session_replay: boolean | null
}

export type DigestMail = { subject: string; text: string }

/** The claim cap. One mail per tick; a backlog drains over subsequent ticks. */
export const BATCH_SIZE = 50

/** Human labels, singular and plural, for the subject line and the blocks. */
const SOURCE_LABELS: Record<DigestSource, { one: string; many: string; block: string }> = {
  postcard_report: { one: 'postcard report', many: 'postcard reports', block: 'REPORT · postcard' },
  club_thread_report: {
    one: 'club discussion report',
    many: 'club discussion reports',
    block: 'REPORT · club discussion',
  },
  ride_thread_report: {
    one: 'ride discussion report',
    many: 'ride discussion reports',
    block: 'REPORT · ride discussion',
  },
  postcard_comment_report: {
    one: 'comment report',
    many: 'comment reports',
    block: 'REPORT · postcard comment',
  },
  feedback: { one: 'feedback note', many: 'feedback notes', block: 'FEEDBACK' },
}

export function countsBySource(entries: DigestEntry[]): Map<DigestSource, number> {
  const counts = new Map<DigestSource, number>()
  for (const entry of entries) {
    counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1)
  }
  return counts
}

/**
 * The subject line, assembled from counts alone.
 *
 * **No rider-authored value reaches a mail header, ever** (N49). A subject built
 * from a report's `note` or a feedback `body` would put free text a rider typed
 * into the one field every mail client, every notification preview and every
 * log line displays — and a header is also the one place a newline is a protocol
 * boundary rather than a character. Counts have neither problem.
 */
export function subjectFor(entries: DigestEntry[]): string {
  const counts = countsBySource(entries)
  const parts = SWEPT_SOURCES.filter((source) => (counts.get(source) ?? 0) > 0).map((source) => {
    const n = counts.get(source) ?? 0
    const label = SOURCE_LABELS[source]
    return `${n} ${n === 1 ? label.one : label.many}`
  })
  return `LetsRide moderation: ${parts.join(', ')}`
}

/** `2026-09-19 06:12 UTC` — unambiguous in a mailbox, and not the reader's zone. */
export function formatDigestTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`
  )
}

/**
 * Indent a rider-authored block so it cannot be mistaken for the digest's own
 * structure.
 *
 * `feedback.body` is the one free-text field this change deliberately exports
 * (D5, N20): a bug report with its text removed is not a bug report. It is
 * capped at 2000 characters by `084`'s CHECK, so there is no length to bound
 * here — what needs bounding is its *shape*, because a body containing a line
 * that looks like a block header would otherwise read as a second entry.
 */
function quoteBody(body: string): string {
  return body
    .split('\n')
    .map((line) => `    | ${line}`)
    .join('\n')
}

/**
 * One block per entry. Reads named fields and never iterates the row — see the
 * header's whitelist argument.
 */
export function renderEntry(entry: DigestEntry): string {
  const label = SOURCE_LABELS[entry.source] ?? {
    one: entry.source,
    many: entry.source,
    // An unknown kind is a migration this file has not caught up with. Say so
    // rather than dropping the entry: a claimed entry that renders to nothing is
    // a report the owner is never told about, which is the failure this whole
    // change exists to prevent.
    block: `UNKNOWN SOURCE (${entry.source})`,
  }

  const lines = [`${label.block} · ${formatDigestTime(entry.created_at)}`]

  if (entry.source === 'feedback') {
    const context = [
      entry.app_version ? `app ${entry.app_version}` : null,
      entry.route ? `route ${entry.route}` : null,
      `session replay: ${entry.has_session_replay ? 'yes' : 'no'}`,
    ].filter((part): part is string => part !== null)
    lines.push(`  ${context.join(' · ')}`)
    lines.push(entry.body ? quoteBody(entry.body) : '    | (no text)')
  } else {
    lines.push(`  reason: ${entry.reason ?? '(none given)'}`)
    if (entry.note) lines.push(`  note:\n${quoteBody(entry.note)}`)
    lines.push(`  reports on this item:  ${entry.reports_on_subject ?? 0}`)
    lines.push(`  reports on its author: ${entry.reports_on_author ?? 0}`)
  }

  // The subject id is what the owner pastes into the dashboard queue to see
  // everything this mail deliberately withheld. The entry id is what a runbook
  // needs to re-arm a capped entry.
  lines.push(`  subject id: ${entry.source_id}`)
  lines.push(`  entry id:   ${entry.entry_id}`)
  return lines.join('\n')
}

/**
 * The whole mail.
 *
 * **There is no link, no token, no attachment and no cursor** (N25). The digest
 * is a notification, not a query interface: its reader cannot use it to reach a
 * row it was not sent, and a forwarded copy grants nothing. The one pointer it
 * carries is the name of a view only the table owner can read at the dashboard.
 */
export function renderDigest(entries: DigestEntry[]): DigestMail {
  const swept = SWEPT_SOURCES.map((source) => SOURCE_LABELS[source].many).join(', ')

  const order = new Map(SWEPT_SOURCES.map((source, index) => [source, index]))
  const sorted = [...entries].sort((a, b) => {
    const byKind = (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99)
    if (byKind !== 0) return byKind
    return a.created_at.localeCompare(b.created_at)
  })

  const text = [
    `${entries.length} new ${entries.length === 1 ? 'item' : 'items'} need a look.`,
    '',
    sorted.map(renderEntry).join('\n\n'),
    '',
    '---',
    `Swept: ${swept}.`,
    'Anything this mail withheld — who reported, the photo, the text of a reported',
    'message — is in the private.*_report_queue views, readable by the project owner',
    'at the Supabase dashboard and by nobody else.',
    'Mailed is not handled: nothing here records that you acted.',
  ].join('\n')

  return { subject: subjectFor(entries), text }
}

/**
 * What the provider's HTTP status means for the entries in this batch.
 *
 * The three outcomes are `complete_moderation_digest`'s vocabulary, and the
 * classification is the one thing in this function whose failure is silent.
 * `push-notify`'s worked example is the precedent and the warning: there, a
 * transport error misread as a dead token unsubscribes every rider on a platform
 * having an outage. Here the equivalent mistake is milder but the same shape —
 * a `retry` misread as `failed` burns the attempt cap on a provider blip and
 * leaves real reports unsent until someone re-arms them by hand.
 *
 * - **2xx → `sent`.**
 * - **429 and 5xx → `retry`.** Rate limit and provider outage are both
 *   transient and both resolve without anyone doing anything.
 * - **Every other 4xx → `failed`.** A bad key, a malformed payload or an
 *   unverified sender does not fix itself, and retrying it hourly for ever turns
 *   one misconfiguration into a permanent load. **`failed` still does not lose
 *   the entry** — the migration leaves it unsent, and the source rows sit in the
 *   dashboard queues exactly as they do today.
 * - **0, or anything below 100 → `retry`.** That is this module's code for *the
 *   request never got an answer*: DNS, a dropped socket, a timeout. It cannot be
 *   distinguished from a 5xx and must not be treated as a 4xx.
 */
export type MailDisposition = 'sent' | 'retry' | 'failed'

export function classifyMailStatus(status: number): MailDisposition {
  if (status >= 200 && status < 300) return 'sent'
  // Not a real HTTP answer at all — see the note above.
  if (status < 100) return 'retry'
  if (status === 429 || status >= 500) return 'retry'
  return 'failed'
}
