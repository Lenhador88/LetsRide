'use client'

import { useRef, useState, useTransition } from 'react'
import { ImageIcon } from '@/components/icons/generated'
import { updateAvatar, updateCover } from '@/lib/actions/profile'
import { uploadAvatarImage, uploadCoverImage } from '@/lib/media'
import { cn } from '@/lib/utils'

type Kind = 'avatar' | 'cover'

/**
 * The upload control behind the profile's avatar and its 390×200 cover.
 *
 * One component for both because the *flow* is identical — pick a file,
 * compress it in the browser (which strips EXIF, see compress.ts), upload
 * straight to Storage, then tell the server which object is now current — and
 * only the target path and the compression size differ. Two components would
 * have been two places to fix the next bug in that sequence.
 *
 * It renders as an overlay on whatever it wraps rather than as a button beside
 * it, because both surfaces are images: the affordance belongs *on* the thing it
 * replaces. `children` is the current avatar or cover, so this component has no
 * opinion about how either is drawn.
 *
 * **Progress is deliberately not a bar.** `uploadObject` exposes real progress
 * events and the postcard composer draws them, because a postcard photo is
 * full-size and the wait is real. An avatar is compressed to 512px — a few tens
 * of kilobytes — so a determinate bar would flash and vanish. A disabled state
 * plus a label is the honest amount of feedback for that duration.
 */
export function ProfileImageUpload({
  kind,
  children,
  className,
  label,
}: {
  kind: Kind
  children: React.ReactNode
  className?: string
  label: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [writing, startTransition] = useTransition()

  // BOTH phases, not just the second. `useTransition` wraps only the server
  // action; the compress-and-upload before it is the part that actually takes
  // seconds on a slow connection, and leaving the control live through it means
  // a rider taps twice, two uploads land, and the loser is orphaned. The
  // docstring above promised feedback for the wait — this is the wait.
  const busy = uploading || writing

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Resetting the input is what makes picking the SAME file twice work after a
    // failure: `change` does not fire when the value is unchanged.
    event.target.value = ''
    if (!file) return

    setError(null)
    setUploading(true)
    try {
      const { path } =
        kind === 'avatar' ? await uploadAvatarImage(file) : await uploadCoverImage(file)

      startTransition(async () => {
        const result = kind === 'avatar' ? await updateAvatar(path) : await updateCover(path)
        if (result.error) setError(result.error)
      })
    } catch (cause) {
      // The upload throws with a rider-readable message — validateImageFile's
      // rejection, or a network failure from uploadObject. Anything else is a
      // bug rather than a condition, and says so rather than leaking a stack.
      setError(cause instanceof Error ? cause.message : 'That image could not be uploaded.')
    } finally {
      // `finally`, so a thrown upload re-enables the control rather than
      // leaving it dead until a reload.
      setUploading(false)
    }
  }

  return (
    <div className={cn('relative', className)}>
      {children}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={label}
        className={cn(
          'absolute inset-0 flex items-center justify-center rounded-[inherit] transition-colors',
          'bg-scrim/0 text-transparent active:bg-scrim/40 active:text-surface',
          // Never hover-only: a touch device has no hover, and this is a
          // mobile-first app. The control is always the whole surface; only its
          // scrim is conditional.
          busy && 'bg-scrim/40 text-surface'
        )}
      >
        <ImageIcon className="h-6 w-6" aria-hidden="true" />
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        className="hidden"
        // Not `capture` — that forces the camera on mobile and hides the
        // library, and a rider choosing a profile picture usually wants a photo
        // they already have.
      />

      {error && (
        <p role="alert" className="absolute -bottom-6 left-0 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
