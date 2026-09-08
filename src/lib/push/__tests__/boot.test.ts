import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `registerOnBoot()` — the cold-start path, which had no test at all until
 * review pointed at it. PD-431.
 *
 * The doorway is mocked wholesale: the real one reaches the Capacitor bridge,
 * which does not exist in `node`. What is pinned here is the ORCHESTRATION —
 * the order, the two listener orderings, and that a teardown runs exactly once
 * — because every one of those regresses silently on a machine with no device.
 */

const isPushCapable = vi.fn(() => true)
const checkPushPermission = vi.fn(async () => 'granted' as string | undefined)
const requestProviderRegistration = vi.fn(async () => {})
const registerCurrentDevice = vi.fn(async (token: string) => void token)
const releaseCurrentDevice = vi.fn(async () => {})

/** Set by `onProviderToken` so a test can fire the provider's answer itself. */
let fireToken: ((token: string) => void) | undefined
let fireError: ((message: string) => void) | undefined
const removeListeners = vi.fn()
/** When true, the provider answers DURING `onProviderToken`'s own await. */
let answerImmediately = false

const onProviderToken = vi.fn(
  async (onToken: (t: string) => void, onError: (m: string) => void) => {
    fireToken = onToken
    fireError = onError
    if (answerImmediately) onToken('the-token')
    return removeListeners
  },
)

vi.mock('@/lib/push/registration', () => ({
  isPushCapable: () => isPushCapable(),
  checkPushPermission: () => checkPushPermission(),
  requestProviderRegistration: () => requestProviderRegistration(),
  registerCurrentDevice: (t: string) => registerCurrentDevice(t),
  releaseCurrentDevice: () => releaseCurrentDevice(),
  onProviderToken: (a: (t: string) => void, b: (m: string) => void) => onProviderToken(a, b),
}))

vi.mock('@/lib/push/installation', () => ({
  installationId: async () => '0189d3a1-2b4c-4d6e-8f01-23456789abcd',
}))

import { registerOnBoot } from '@/lib/push/boot'

beforeEach(() => {
  vi.clearAllMocks()
  isPushCapable.mockReturnValue(true)
  checkPushPermission.mockResolvedValue('granted')
  answerImmediately = false
  fireToken = undefined
  fireError = undefined
})

describe('registerOnBoot', () => {
  it('does nothing at all on a non-native platform', async () => {
    isPushCapable.mockReturnValue(false)

    await registerOnBoot()

    expect(checkPushPermission).not.toHaveBeenCalled()
    expect(onProviderToken).not.toHaveBeenCalled()
    expect(releaseCurrentDevice).not.toHaveBeenCalled()
  })

  it('never prompts — it reads the permission and never requests it', async () => {
    // The one-shot iOS dialog. A boot path that could raise it would spend the
    // single ask on app launch, which is the worst possible moment for it.
    //
    // **This is a text scan of one file, not a module-graph proof**, and the
    // difference is worth stating: it catches the named regression — somebody
    // adding `requestPushPermission` to this module's imports — and it does not
    // catch a boot path that reaches the plugin some other way. The doorway
    // test is what bounds that, by keeping the import in one file.
    await registerOnBoot()

    // **Comment-stripped, and the first version of this test was not.**
    // `boot.ts`'s header explains at length that the permission is read and
    // never requested — so it names `requestPushPermission` in prose, and a raw
    // scan reads that explanation as the call it forbids. That is this repo's
    // comment trap arriving inside the assertion written to prevent it.
    const raw = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../boot.ts', import.meta.url), 'utf8'),
    )
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    expect(code).not.toContain('requestPushPermission')
    // Both ways: the strip must not be what makes it pass.
    expect(code).toContain('requestProviderRegistration')
  })

  it('registers the token the provider hands back', async () => {
    await registerOnBoot()

    expect(requestProviderRegistration).toHaveBeenCalledTimes(1)
    fireToken?.('the-token')
    await Promise.resolve()

    expect(registerCurrentDevice).toHaveBeenCalledWith('the-token')
  })

  it('removes its listeners when the provider answers AFTER the subscribe resolves', async () => {
    await registerOnBoot()
    expect(removeListeners).not.toHaveBeenCalled()

    fireToken?.('the-token')

    expect(removeListeners).toHaveBeenCalledTimes(1)
  })

  it('removes its listeners when the provider answers DURING the subscribe', async () => {
    // The race the holder object exists for: `settle()` runs before the
    // unsubscribe has been assigned, so the teardown has to happen after the
    // await instead. A machine with no device can never reach this ordering
    // naturally, which is exactly why it is forced here.
    answerImmediately = true

    await registerOnBoot()

    expect(registerCurrentDevice).toHaveBeenCalledWith('the-token')
    expect(removeListeners).toHaveBeenCalledTimes(1)
  })

  it('removes them ONCE when both provider events fire', async () => {
    // `remove()` is `void`-ed at the call site, so a second call that rejects
    // is an unhandled rejection rather than a caught one.
    await registerOnBoot()

    fireToken?.('the-token')
    fireError?.('too late')

    expect(removeListeners).toHaveBeenCalledTimes(1)
  })

  it('releases this installation when the permission has been revoked — task 2.12', async () => {
    // A rider turns notifications off in the OS settings app. Nothing tells the
    // app; APNs and FCM go on ACCEPTING sends for that token and dropping them,
    // so the row survives, every fan-out pays for it, and the delivery log says
    // success. This read is the only moment the app can learn.
    checkPushPermission.mockResolvedValue('denied')

    await registerOnBoot()

    expect(releaseCurrentDevice).toHaveBeenCalledTimes(1)
    expect(onProviderToken).not.toHaveBeenCalled()
    expect(requestProviderRegistration).not.toHaveBeenCalled()
  })

  it('never lets a failure escape into the boot path', async () => {
    // A rider whose device cannot register must still get an app.
    checkPushPermission.mockRejectedValue(new Error('bridge unavailable'))

    await expect(registerOnBoot()).resolves.toBeUndefined()
  })
})
