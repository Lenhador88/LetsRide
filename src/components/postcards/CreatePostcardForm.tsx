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
import { useRestoreSelection } from '@/lib/actions/retain'

// The caption is controlled already; the audience was not, and it is the one
// that matters most here. A refusal reset this select to its first option —
// silently widening a postcard the rider had aimed at one club back to everyone
// on LetsRide, on the retry they were about to make.
//
// Controlled rather than fed back through `retaining`, because a `<select>` is
// the one control a restored `defaultValue` cannot reach — see the note in
// CreateRideForm, and the walk phase that measured it.
import { uploadPostcardImage, validateImageFile } from '@/lib/media'
import { cn } from '@/lib/utils'
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
 * The photo box is measured against the composer's own frame — `Home /
 * Create postcard` → `Home - Postcards - All new` [1918:16843] (390×844,
 * design/frames/home-create-postcard-home-postcards-all-new.json) — not only
 * the named `v2 / Component / Input / Image` set. The frame is fully
 * readable; it was missed the first time only because this exact screen name
 * repeats across six frames total, two of them inside this same flow
 * (CLAUDE.md §Development Workflow's screen-name trap), so qualify with the
 * flow to find it. It draws a 358×224 box, radius 8, `White/100` fill, 1px
 * solid `Grey/20%` stroke, and centred content — the 24×24 `Image` icon in
 * `Grey/60` above "Add photo" set as an `Accent Brand/100` 14/Semibold link
 * button, drawn only in the Empty state and sized to the button, not the
 * box. Making the whole box tappable is ours, logged as a deviation below.
 *
 * The rest of the frame is also now readable and differs on purpose from
 * what ships below: field order is box → Club → caption, and Post is a
 * small primary button in the header beside Cancel rather than inline at
 * the bottom. That reorder is separate follow-up work, not done here.
 * Box geometry, tap target, colours and label type are logged as deliberate
 * deviations rather than adopted — see docs/FIGMA-FIDELITY-TODO.md
 * §Create postcard for the full list.
 */
export function CreatePostcardForm({ clubs }: { clubs: ClubOption[] }) {
  const [state, formAction, pending] = useActionState(createPostcard, emptyActionState)
  const [clubId, setClubId] = useState('')
  const clubRef = useRef<HTMLSelectElement>(null)
  useRestoreSelection(clubRef, clubId, state)
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

    // Cleared immediately, not only on a successful upload — the browser
    // fires no `change` event on re-picking the same file otherwise, and the
    // photo itself is now the only retry affordance (a validation failure or
    // a failed upload both leave the rider retrying the same file).
    event.target.value = ''

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
          className={cn(
            'flex aspect-4/5 w-full items-center justify-center overflow-hidden rounded-xl bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50',
            !preview && 'border-2 border-dashed border-border-strong',
          )}
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
          className="hidden"
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
          ref={clubRef}
          name="clubId"
          value={clubId}
          onChange={(event) => setClubId(event.target.value)}
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
