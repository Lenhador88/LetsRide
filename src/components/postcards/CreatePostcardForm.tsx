'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { ImageIcon } from '@/components/icons/generated'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { createPostcard } from '@/lib/actions/postcards'
// Seed state comes from the plain module, never from the `'use server'` one — a
// const exported from there is not importable and takes the route down at module
// evaluation. See the comment at the top of lib/actions/postcards.ts.
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { uploadPostcardImage, validateImageFile } from '@/lib/media'
import { POSTCARD_CAPTION_MAX_LENGTH } from '@/lib/validation/postcards'
import type { Club } from '@/types'

type ClubOption = Pick<Club, 'id' | 'name'>

type Upload =
  | { status: 'idle' }
  | { status: 'uploading'; percent: number }
  | { status: 'done'; path: string }
  | { status: 'failed'; message: string }

/**
 * Upload happens on file selection, not on submit.
 *
 * That split is what lib/media/upload.ts was built for: compression and the
 * PUT are separate awaits so real progress can be shown against an XHR, and so
 * a rider who loses signal does not lose the photo they already picked. By the
 * time this form submits, the image is in Storage and only its path travels
 * with the FormData — which is exactly the contract createPostcard expects.
 *
 * The photo box is measured against `v2 / Component / Input / Image`
 * (`1918:17004`, PD-112, 2026-08-08): a single tappable box with Empty/Filled
 * variants, no separate picker button beside it — so the box itself is the
 * control in both states. The rest of the layout — caption/audience order
 * relative to it, and the progress treatment — is still inferred; the create
 * flow's own frame was never in the read set. See docs/FIGMA-FIDELITY-TODO.md
 * §Create postcard.
 */
export function CreatePostcardForm({ clubs }: { clubs: ClubOption[] }) {
  const [state, formAction, pending] = useActionState(createPostcard, emptyActionState)
  useActionRedirect(state)
  const [upload, setUpload] = useState<Upload>({ status: 'idle' })
  const [preview, setPreview] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // The preview is an object URL, which the browser holds until it is revoked.
  // Revoking on replacement and on unmount keeps a rider who cycles through
  // several photos from pinning all of them in memory.
  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    // Checked here as well as inside uploadPostcardImage so an oversized or
    // wrong-typed file is refused before it is compressed.
    const validation = validateImageFile(file)
    if (!validation.ok) {
      setUpload({ status: 'failed', message: validation.error })
      setPreview(null)
      return
    }

    setPreview(URL.createObjectURL(file))
    setUpload({ status: 'uploading', percent: 0 })

    try {
      const { path } = await uploadPostcardImage(file, {
        onProgress: ({ loaded, total }) =>
          setUpload({ status: 'uploading', percent: total > 0 ? Math.round((loaded / total) * 100) : 0 }),
      })
      setUpload({ status: 'done', path })
    } catch (error) {
      setUpload({
        status: 'failed',
        message: error instanceof Error ? error.message : 'Upload failed. Try again.',
      })
    }
  }

  const ready = upload.status === 'done'
  const remaining = POSTCARD_CAPTION_MAX_LENGTH - caption.length

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {ready && <input type="hidden" name="imagePath" value={upload.path} />}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.status === 'uploading'}
          aria-label={preview ? 'Choose a different photo' : undefined}
          className="flex aspect-4/5 w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border-strong bg-surface disabled:opacity-50"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: object URL, not a remote asset next/image can optimise
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 px-6 text-center text-xs text-muted">
              <ImageIcon className="h-6 w-6" aria-hidden="true" />
              Add photo
            </span>
          )}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="sr-only"
        />

        {upload.status === 'uploading' && (
          <div className="flex flex-col gap-1.5">
            <div
              role="progressbar"
              aria-valuenow={upload.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
              className="h-1.5 w-full overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${upload.percent}%` }}
              />
            </div>
            <p className="text-xs text-muted">Uploading… {upload.percent}%</p>
          </div>
        )}

        {upload.status === 'failed' && (
          <p role="alert" className="text-sm text-danger">
            {upload.message}
          </p>
        )}
      </div>

      <Textarea
        name="caption"
        label="Caption"
        rows={4}
        maxLength={POSTCARD_CAPTION_MAX_LENGTH}
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        placeholder="Say something about this ride."
      />
      {/* Only warns near the limit — a counter on an empty 2000-character field
          is noise, and maxLength already makes overrun impossible. */}
      {remaining <= 100 && (
        <p className="-mt-4 text-xs text-muted">{remaining} characters left</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="clubId" className="text-sm font-medium text-muted">
          Who can see this
        </label>
        <select
          id="clubId"
          name="clubId"
          defaultValue=""
          className="h-14 w-full rounded-lg border-2 border-border bg-surface px-4 text-base text-foreground transition-colors focus:border-accent focus:outline-none"
        >
          {/* '' is the app-wide feed — postcardClubIdSchema turns it into null,
              and club_id being null IS the audience. */}
          <option value="">Everyone on LetsRide</option>
          {clubs.map((club) => (
            <option key={club.id} value={club.id}>
              {club.name} (members only)
            </option>
          ))}
        </select>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" loading={pending} disabled={!ready}>
        {ready ? 'Post' : 'Choose a photo first'}
      </Button>
    </form>
  )
}
