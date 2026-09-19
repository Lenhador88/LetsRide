/**
 * send-moderation-digest/mail.ts — the ONLY file in this repository that knows
 * a mail provider exists.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DOORWAY IS A WHOLE FILE FOR ONE `fetch`
 * ---------------------------------------------------------------------------
 * `CLAUDE.md` lists **email delivery beyond Supabase's built-in auth mails** as
 * *deliberately undecided — raise rather than invent*. PD-457 is the raise, and
 * the product owner answered the question it asked (*should reports reach me by
 * mail*) and not the one it did not (*through whom*). So the provider is an
 * assumption this build states rather than a decision it was handed, and the
 * file boundary is what keeps that assumption cheap to overturn: swapping
 * provider is this file and nothing else — no call site, no type, no test.
 *
 * `design.md` D7 is the contract. `proposal.md` §The provider has the
 * comparison and the axes; the short version is that a provider reachable by one
 * `POST` with a `Bearer` key needs no SDK in Deno, and SES was ruled out on
 * hand-rolling SigV4 rather than on price.
 *
 * ---------------------------------------------------------------------------
 * THREE SECRETS, NO DEFAULTS, AND THE ABSENCE OF A DEFAULT IS THE POINT
 * ---------------------------------------------------------------------------
 * **The three are the key, the recipient and the sender. `MAIL_PROVIDER_ENDPOINT`
 * is a fourth variable, it is not one of them, and it DOES have a default** —
 * `design.md` D7's recommended provider, so the common deploy sets three values
 * rather than four. It is named here rather than left to be discovered because
 * it decides which host receives the bearer key: switching provider means
 * setting it in the SAME step as `MAIL_PROVIDER_API_KEY`, or a Brevo key is
 * POSTed to Resend. Its default is safe in the way the address defaults are not
 * — a wrong endpoint is a refused send, never a digest delivered to a stranger —
 * which is why it has one and they must not.
 * ---------------------------------------------------------------------------
 * **No address literal appears in this directory** — not the recipient, not the
 * sender, not a fallback. `src/__tests__/moderation-digest-secrets.test.ts`
 * asserts that, and it is the mechanism behind N46/N47: the app's *published*
 * support address (`SUPPORT_EMAIL`, PD-300) and the owner's *private* mailbox
 * are different addresses with different audiences, and the way they stay
 * unconflatable is that this function cannot name either one. A Deno function
 * cannot import a `src/` module, so `SUPPORT_EMAIL` is out of reach by
 * construction; the test is what stops somebody re-typing its value here.
 *
 * An absent secret is a **refusal to send**, reported as a status this module's
 * caller classifies as `failed` — never a send to a default address. A digest
 * that quietly mailed a placeholder inbox would be the worst available outcome:
 * the reports leave the database and reach nobody.
 */

import { classifyMailStatus, type DigestMail, type MailDisposition } from './shape.ts'

/** The provider's API key. Function secret store only — never `src/`. */
const MAIL_PROVIDER_API_KEY = Deno.env.get('MAIL_PROVIDER_API_KEY') ?? ''

/**
 * The owner's private mailbox. **Not** the app's published support address.
 *
 * Read here and never passed in, so no call site can name an address (N3, N46):
 * the function takes no arguments and has no recipient parameter, which is also
 * what stops a caller who somehow got past the service-role check from
 * redirecting a digest.
 */
const DIGEST_RECIPIENT = Deno.env.get('DIGEST_RECIPIENT') ?? ''

/**
 * The envelope sender. A secret rather than a constant because it is per
 * project and per provider: a provider's own onboarding sender works before any
 * DNS exists, and a verified custom domain replaces it later without a deploy.
 */
const DIGEST_SENDER = Deno.env.get('DIGEST_SENDER') ?? ''

const PROVIDER_ENDPOINT = Deno.env.get('MAIL_PROVIDER_ENDPOINT') ?? 'https://api.resend.com/emails'

/**
 * The outcome of one attempt.
 *
 * **This deviates from `design.md` D7 deliberately, in the direction of less
 * untested code.** D7 sketched `{ ok, retryable, status }`, which puts the
 * transient-vs-permanent judgement in *this* file — and this file is not
 * type-checked by `tsc`, not seen by Vitest and reachable only by `deno check`.
 * The judgement is the one thing here whose failure is silent (a blip read as
 * permanent burns the attempt cap on real reports), so it belongs in `shape.ts`
 * where a unit test covers it. This module reports what happened; `shape.ts`
 * says what it means.
 */
export type MailOutcome = {
  status: number
  disposition: MailDisposition
}

/** `0` is this module's code for *the request never got an answer* — see `shape.ts`. */
const NO_ANSWER = 0

/** `422` stands in for *this function is not configured*: permanent, not retried. */
const NOT_CONFIGURED = 422

export function missingMailSecrets(): string[] {
  return [
    MAIL_PROVIDER_API_KEY ? null : 'MAIL_PROVIDER_API_KEY',
    DIGEST_RECIPIENT ? null : 'DIGEST_RECIPIENT',
    DIGEST_SENDER ? null : 'DIGEST_SENDER',
  ].filter((name): name is string => name !== null)
}

export async function sendDigestMail(mail: DigestMail): Promise<MailOutcome> {
  if (missingMailSecrets().length > 0) {
    return { status: NOT_CONFIGURED, disposition: classifyMailStatus(NOT_CONFIGURED) }
  }

  let status = NO_ANSWER
  try {
    const response = await fetch(PROVIDER_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MAIL_PROVIDER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: DIGEST_SENDER,
        to: [DIGEST_RECIPIENT],
        subject: mail.subject,
        text: mail.text,
      }),
    })
    status = response.status
    // The body is read and dropped on purpose. A provider's error body can echo
    // the payload it rejected, so keeping it — in a column, in a log line, in a
    // returned value — is keeping a copy of the digest somewhere nothing
    // enumerated (N37). The status is the whole of what the caller needs.
    await response.body?.cancel()
  } catch {
    // DNS, a dropped socket, a timeout. Indistinguishable from a 5xx and must
    // not be treated as a 4xx.
    status = NO_ANSWER
  }

  return { status, disposition: classifyMailStatus(status) }
}
