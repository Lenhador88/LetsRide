'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { ImageIcon, LocationOutlineIcon } from '@/components/icons/generated'
import { Button } from '@/components/ui/Button'
import { ButtonGroup } from '@/components/ui/ButtonGroup'
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
import {
  DEFAULT_PHOTO_LOCATION_MODE,
  resolvePhotoLocation,
  uploadPostcardImage,
  validateImageFile,
  type ExifCapture,
  type PhotoLocationMode,
} from '@/lib/media'
import { cn } from '@/lib/utils'
import { POSTCARD_CAPTION_MAX_LENGTH } from '@/lib/validation/postcards'
import type { Club } from '@/types'

type ClubOption = Pick<Club, 'id' | 'name'>

type Upload =
  | { status: 'idle' }
  | { status: 'uploading'; percent: number }
  | { status: 'done'; path: string; capture: ExifCapture }
  | { status: 'failed'; message: string }

/**
 * The three buttons, and the line under each that says what it actually does.
 *
 * **The hint is the design, not decoration.** Each mode is described in the
 * rider's own terms rather than the schema's, and `Precise` says the quiet part
 * out loud — because the one thing a rider must not be able to do is publish
 * their driveway without having been told that is what they are doing.
 *
 * **`Hide` is scoped to the LOCATION on purpose, and the wording is load
 * bearing.** A photo's capture time is uploaded whatever mode is chosen, so a
 * string like "nothing about this photo leaves your phone" would be false.
 * Whether Hide *should* also cover the time was PD-265, and the product owner
 * settled it on 2026-08-18: it should not. So this copy must not be widened —
 * not pending an answer, but permanently — because widening it is how the app
 * starts making a promise the schema does not keep.
 */
const LOCATION_MODES: {
  value: PhotoLocationMode
  label: string
  lead: string
  hint: string
}[] = [
  {
    value: 'hide',
    label: 'Hide',
    lead: 'Nothing is saved.',
    hint: "The photo's location never leaves your phone.",
  },
  {
    value: 'region',
    label: 'Region',
    lead: 'Rounded to about a kilometre.',
    hint: 'Enough to place it on the ride.',
  },
  {
    value: 'precise',
    label: 'Precise',
    lead: 'Saved exactly.',
    hint: 'Anyone who can see this photo can see where you took it.',
  },
]

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
  // **Never seeded from the last upload, and never persisted.** A remembered
  // `Precise` is the one setting that could surprise a rider later — and its
  // failure mode is invisible, because nothing in the app draws a location yet.
  // A default whose misfire cannot be seen is a trap rather than a convenience.
  const [locationMode, setLocationMode] = useState<PhotoLocationMode>(DEFAULT_PHOTO_LOCATION_MODE)
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
    // Back to Hide for the new photo. A rider who picked Precise for a shot of
    // the coast road and then swapped in one taken at home must not inherit the
    // first photo's answer.
    setLocationMode(DEFAULT_PHOTO_LOCATION_MODE)

    try {
      const { path, capture } = await uploadPostcardImage(file, {
        onProgress: ({ loaded, total }) =>
          setUpload({ status: 'uploading', percent: total > 0 ? Math.round((loaded / total) * 100) : 0 }),
      })
      setUpload({ status: 'done', path, capture })
    } catch (error) {
      setUpload({
        status: 'failed',
        message: error instanceof Error ? error.message : 'Upload failed. Try again.',
      })
    }
  }

  const ready = upload.status === 'done'
  const capture = upload.status === 'done' ? upload.capture : null
  // `capture !== null` first, and not `capture?.latitude !== null`: optional
  // chaining yields `undefined` when there is no capture, and `undefined !== null`
  // is TRUE — so the short version reads "has a location" for a photo that has
  // not been picked yet. Unreachable today because the only consumer sits behind
  // `ready`, and tsc cannot see it because `undefined` is a legal comparand. Move
  // the block out of that gate and a photo with no EXIF would draw the three
  // buttons instead of saying it has no location.
  const hasLocation =
    capture !== null && capture.latitude !== null && capture.longitude !== null
  // What actually travels — the rider's choice applied to what the photo knew.
  // Computed here rather than at submit so the hidden inputs below can never
  // hold a value the control does not currently say.
  const location = capture
    ? resolvePhotoLocation(locationMode, capture)
    : { latitude: null, longitude: null, precision: null }
  const selectedMode = LOCATION_MODES.find((mode) => mode.value === locationMode)
  const remaining = POSTCARD_CAPTION_MAX_LENGTH - caption.length

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {ready && <input type="hidden" name="imagePath" value={upload.path} />}

      {/* Capture time goes up whatever the location mode says — it is not what
          the three buttons are about, and `Hide`'s copy is scoped to the
          location for exactly that reason. Omitted entirely when the photo
          carried none, which is the common case: HEIC, screenshots, and
          anything already through another app's share sheet.

          Gated on `takenAt` alone, and that is safe only because `exif.ts`
          returns the instant and its offset together or not at all — the type
          permits a non-null `takenAt` beside a null offset, and that shape would
          submit the string "null" and produce a Zod error with no field a rider
          could correct. If a second producer of `ExifCapture` ever appears,
          this gate has to check both. */}
      {capture?.takenAt && (
        <>
          <input type="hidden" name="takenAt" value={capture.takenAt} />
          <input
            type="hidden"
            name="takenAtOffsetMinutes"
            value={String(capture.takenAtOffsetMinutes)}
          />
        </>
      )}

      {/* The reduced coordinate, or nothing at all. On `Hide` these three do not
          render, so there is no field to strip and nothing to leak — the precise
          value stays in this component's memory and dies with the page. */}
      {location.latitude !== null && location.longitude !== null && (
        <>
          <input type="hidden" name="takenLatitude" value={String(location.latitude)} />
          <input type="hidden" name="takenLongitude" value={String(location.longitude)} />
          <input
            type="hidden"
            name="takenLocationPrecision"
            value={String(location.precision)}
          />
        </>
      )}

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

      {/* Only once there is a photo to talk about. Before that the block would
          be asking about something the rider has not chosen yet. */}
      {ready && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <LocationOutlineIcon className="h-4 w-4 text-muted" aria-hidden="true" />
            <span className="text-sm font-semibold text-foreground">Location</span>
          </div>

          {hasLocation ? (
            <>
              <ButtonGroup
                label="What to save about where this photo was taken"
                options={LOCATION_MODES.map(({ value, label }) => ({ value, label }))}
                value={locationMode}
                onChange={setLocationMode}
                disabled={pending}
              />
              {/* `aria-live` because the hint is the only thing that changes when
                  a button is pressed, and it is the part that carries the
                  consequence. A rider using a screen reader hears the new label
                  and would otherwise not hear what it means. */}
              <p aria-live="polite" className="text-xs text-muted">
                <span className="font-semibold text-foreground">{selectedMode?.lead}</span>{' '}
                {selectedMode?.hint}
              </p>
            </>
          ) : (
            /* Not a disabled control. A disabled ButtonGroup still draws three
               labels and a selected pill, which reads as a choice this rider
               made about a photo that has nothing to choose about — and a
               radiogroup with every option disabled is worse for a screen reader
               than one sentence. */
            <p className="text-xs text-muted">This photo has no location.</p>
          )}
        </div>
      )}

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
