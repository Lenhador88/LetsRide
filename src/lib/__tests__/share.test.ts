import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shareAppLink } from '@/lib/share'

/**
 * `shareAppLink` had no test at all, which is how PD-344 survived: every one of
 * its five callers treats `'shared'` as *"the native sheet was its own
 * feedback, say nothing"*, and the function returned `'shared'` from both arms
 * of its `navigator.share` try/catch. So on any platform where the sheet exists
 * and the call rejects for a reason that is **not** a dismissal, the rider got
 * silence — a control that visibly does nothing.
 *
 * ## What was measured, and why it is not what the issue predicted
 *
 * PD-344's reported symptom — the label never changing in this container's
 * Chromium — is NOT this defect. Measured directly against the dev server on
 * 2026-09-06: `navigator.share` is `undefined` there and
 * `navigator.clipboard.writeText` resolves, so the clipboard arm is the one
 * that runs and the outcome is `'copied'`. The `navigator.share` arm the issue
 * blamed cannot have executed at all. That leaves the reported observation
 * explained by `ShareButton`'s own 2-second `setNotice` reset rather than by
 * the share path — but the defect the issue *describes* is real on every
 * platform that has a share sheet, which is every platform a rider is on.
 *
 * ## The case that matters is the third one
 *
 * A dismissal must stay silent, and that was already right. A rejection that is
 * not a dismissal must not be — and the distinction is `AbortError`, which the
 * Web Share API specifies for a cancelled share and for nothing else. The old
 * code never looked.
 */
describe('shareAppLink', () => {
  const ORIGIN = 'https://app.letsride.social'

  beforeEach(() => {
    // `canonicalOrigin()` falls back to `window.location.origin`, and there is
    // no window under `environment: 'node'`. Setting the configured origin is
    // the honest way to pin it — it is the branch the native bundle takes.
    vi.stubEnv('NEXT_PUBLIC_CANONICAL_ORIGIN', ORIGIN)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  /** A `navigator` with exactly the capabilities a given platform has. */
  function stubNavigator({
    share,
    writeText,
  }: {
    share?: (data: unknown) => Promise<void>
    writeText?: (text: string) => Promise<void>
  }) {
    vi.stubGlobal('navigator', {
      ...(share ? { share } : {}),
      ...(writeText ? { clipboard: { writeText } } : {}),
    })
  }

  /** What the platform throws when the rider cancels the sheet. */
  const abortError = () => Object.assign(new Error('Share canceled'), { name: 'AbortError' })

  it('reports a completed native share as shared, and hands it the canonical origin', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share, writeText: vi.fn() })

    expect(await shareAppLink('/postcards/detail?id=abc', 'A postcard')).toBe('shared')
    expect(share).toHaveBeenCalledWith({
      url: `${ORIGIN}/postcards/detail?id=abc`,
      title: 'A postcard',
    })
  })

  it('treats a dismissal as shared and does NOT copy behind the rider', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share: vi.fn().mockRejectedValue(abortError()), writeText })

    expect(await shareAppLink('/clubs/detail?id=abc', 'A club')).toBe('shared')
    // The whole point of the `AbortError` branch: the rider decided not to
    // share, so a "Link copied" banner would be the app doing it anyway.
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls through to the clipboard when the share sheet fails for any other reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    // `NotAllowedError` is what a share outside a transient user activation
    // raises — the exact case PD-344 describes as leaving the rider in silence.
    stubNavigator({
      share: vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotAllowedError' })),
      writeText,
    })

    expect(await shareAppLink('/rides/detail?id=abc', 'A ride')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/rides/detail?id=abc`)
  })

  it('reports unavailable when the sheet fails and the clipboard does too', async () => {
    stubNavigator({
      share: vi.fn().mockRejectedValue(new TypeError('bad data')),
      writeText: vi.fn().mockRejectedValue(new Error('denied')),
    })

    expect(await shareAppLink('/rides/detail?id=abc', 'A ride')).toBe('unavailable')
  })

  it('copies when the platform has no share sheet at all', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ writeText })

    expect(await shareAppLink('/postcards/detail?id=abc', 'A postcard')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/postcards/detail?id=abc`)
  })

  it('reports unavailable when there is neither a sheet nor a working clipboard', async () => {
    stubNavigator({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })

    expect(await shareAppLink('/postcards/detail?id=abc', 'A postcard')).toBe('unavailable')
  })

  /**
   * The mutation that reverses PD-344's fix is `catch { return 'shared' }` — it
   * looks like a tidy-up and restores the silence. This is the assertion that
   * fails when someone writes it, and it is deliberately phrased as the
   * OUTCOME rather than as "isDismissal was called", because the outcome is the
   * property riders have.
   */
  it('never reports a non-AbortError rejection as shared', async () => {
    for (const name of ['NotAllowedError', 'NotSupportedError', 'DataError', 'InvalidStateError']) {
      stubNavigator({
        share: vi.fn().mockRejectedValue(Object.assign(new Error(name), { name })),
        writeText: vi.fn().mockResolvedValue(undefined),
      })
      expect(await shareAppLink('/rides/detail?id=abc', 'A ride')).not.toBe('shared')
    }
  })
})
