'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { ImageIcon, LocationOutlineIcon } from '@/components/icons/generated'
import { Button } from '@/components/ui/Button'
import { ButtonGroup } from '@/components/ui/ButtonGroup'
import { PlaceSearchField, type PlaceValue } from '@/components/ui/PlaceSearchField'
import { Textarea } from '@/components/ui/Textarea'
import { createPostcard } from '@/lib/actions/postcards'
import { LOCATION_MODES, resolveLocationCopy } from '@/components/postcards/locationCopy'
import { reverseGeocodePlace } from '@/lib/data/places'
// Seed state comes from the plain module, never from the `'use server'` one — a
// const exported from there is not importable and takes the route down at module
// evaluation. See the comment at the top of lib/actions/postcards.ts.
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { useRestoreSelection } from '@/lib/actions/retain'
import { seedClubId } from '@/lib/clubs/seed-club-id'
import { seedRideId } from '@/lib/rides/seed-ride-id'
import type { RideOption } from '@/lib/data/rides'

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
import {
  POSTCARD_CAPTION_MAX_LENGTH,
  POSTCARD_PLACE_NAME_MAX_LENGTH,
} from '@/lib/validation/postcards'
import type { Club } from '@/types'

type ClubOption = Pick<Club, 'id' | 'name'>

type Upload =
  | { status: 'idle' }
  | { status: 'uploading'; percent: number }
  | { status: 'done'; path: string; capture: ExifCapture }
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
export function CreatePostcardForm({
  clubs,
  rides,
  initialClubId,
  initialRideId,
}: {
  clubs: ClubOption[]
  /** Rides this rider is crew of — exactly `041`'s write gate, per `getCrewRides`. */
  rides: RideOption[]
  /** See `clubId` below. */
  initialClubId?: string | null
  /** See `rideId` below. */
  initialRideId?: string | null
}) {
  const [state, formAction, pending] = useActionState(createPostcard, emptyActionState)
  /**
   * Which ride this composer was opened from, or null (PD-256) — `seedClubId`'s
   * rule, applied through `seedRideId`: seeded only when the id names a ride
   * this rider is actually crew of, so an unknown id in the URL cannot show one
   * ride and submit another.
   *
   * **Read before `clubId` below, and the order matters**: `clubId`'s own
   * initializer reads this ride's `club_id` to prefill the audience selector,
   * so a rider opening the composer from a ride's Journal is not asked to
   * re-pick a club they have already implied.
   */
  const [rideId, setRideId] = useState(() => seedRideId(rides, initialRideId))
  const rideRef = useRef<HTMLSelectElement>(null)
  useRestoreSelection(rideRef, rideId, state)
  /**
   * The club this composer was opened from, or null (PD-283).
   *
   * **Seeded only when the id is one of this rider's own clubs**, which is not
   * a security check — `017`'s INSERT policy and the audience rule decide, and
   * a select is a hint — but it is what keeps the control honest: a `<select>`
   * whose `value` matches no `<option>` renders as the first option while
   * reporting the unmatched id, so an unknown id in the URL would show one club
   * and submit another. Unmatched falls back to no club, which is the same
   * state as arriving here from the tab.
   *
   * **Opened from a ride, this also tries that ride's own `club_id` first**
   * (PD-256) — the product owner's complaint was partly that the composer asks
   * for an audience it could have inferred from the ride already picked. This
   * is a one-time prefill at mount, not a live link between the two selects:
   * both stay independently editable and a rider who changes the ride
   * afterwards does not have the club silently follow it. Keeping the two
   * selects from ever fighting over who owns the value was worth more than the
   * extra "moves with you until touched" behaviour, which would need its own
   * dirty-tracking state for a control that already has a sensible default.
   */
  const [clubId, setClubId] = useState(() => {
    const openedFrom = rideId ? rides.find((ride) => ride.id === rideId) : undefined
    if (openedFrom?.club_id) {
      const fromRide = seedClubId(clubs, openedFrom.club_id)
      if (fromRide) return fromRide
    }
    return seedClubId(clubs, initialClubId)
  })
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
  // The place field, in `PlaceSearchField`'s free-text shape: the text is the
  // stored name and the pick is an optional pin under it.
  //
  // **Free-text rather than place mode, and that is a requirement rather than a
  // preference.** Place mode reverts typed-but-unpicked text on blur, which is
  // what keeps a club from storing a location nobody picked. Here the opposite
  // is true: a rider who types "Berkhout" and never picks it has named their
  // location, and `072`'s arm 2 stores exactly that — a name with no pin. A
  // rider who is offline, or who has spent their lookup ceiling, has no other
  // way to answer, and a picker that refuses them would be a gate where the
  // owner asked for an accelerator.
  const [placeText, setPlaceText] = useState('')
  const [place, setPlace] = useState<PlaceValue | null>(null)
  // A mirror of `placeText` the town lookup can read when it lands, seconds
  // after it was fired. A closure over the state would hold the value from
  // before the request, and a functional updater cannot be used to DECIDE
  // anything outside itself: React runs it during render, so a flag set inside
  // one is not readable on the line after `setState`.
  const placeTextRef = useRef('')
  function writePlaceText(next: string) {
    placeTextRef.current = next
    setPlaceText(next)
  }
  // Which uploaded file the town lookup has already been attempted for, so
  // toggling `Town` off and on again does not spend a second credit against
  // `069`'s 20-an-hour. Reset with the photo, because a new photo is a new
  // question.
  const attemptedPrefillFor = useRef<string | null>(null)
  const [prefilling, setPrefilling] = useState(false)
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

    // Read before `setPreview` replaces it: this is "was there a photo before
    // this one", and it is what decides whether a named town was about that
    // photo or about nothing yet.
    const hadPhoto = preview !== null
    setPreview(URL.createObjectURL(file))
    setUpload({ status: 'uploading', percent: 0 })
    // Back to Hide for the new photo. A rider who picked Precise for a shot of
    // the coast road and then swapped in one taken at home must not inherit the
    // first photo's answer.
    setLocationMode(DEFAULT_PHOTO_LOCATION_MODE)
    attemptedPrefillFor.current = null

    // **The town goes only when there WAS a previous photo for it to describe.**
    // A town that described the first photo is just as wrong about the second,
    // so a swap clears it. But the Location block renders before any photo now,
    // which makes a new order reachable: type `Berkhout`, scroll up to the box
    // that says "Choose a photo first", pick one — and clearing unconditionally
    // would erase what the rider had just written, with no notice, for a photo
    // there was nothing to be wrong about.
    if (hadPhoto) {
      writePlaceText('')
      setPlace(null)
    }

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
  // not been picked yet. This block is no longer behind `ready`, which is
  // exactly the move that made the trap reachable: the Location section renders
  // before any photo exists now, so getting this wrong would draw a `Precise`
  // button for a photo nobody has chosen.
  const hasPhotoFix =
    capture !== null && capture.latitude !== null && capture.longitude !== null

  // **All three modes, always — `Precise` is no longer removed when the photo
  // carries no fix.** It used to be, on the reasoning that "the exact spot this
  // photo was taken" has no referent without one. The product owner hit the
  // other half of that on 2026-08-20: an iPad photo with no EXIF made the
  // option vanish from the screen, which reads as a feature that was taken
  // away rather than as a photo that knows nothing about itself.
  //
  // What makes keeping it honest is that `resolvePhotoLocation` now has a
  // second exact source — a place the rider PICKED — so `Precise` means "the
  // exact spot" either way, and the two are told apart in the hint below rather
  // than by hiding the control. With neither source it resolves to the same
  // answer as `Hide` and says so, which is the one state a rider could
  // otherwise misread as "saved exactly" when nothing is saved at all.
  const modes = LOCATION_MODES
  const activeMode: PhotoLocationMode = locationMode

  /**
   * **The town lookup fires here, in the event handler, and nowhere else.**
   *
   * Product owner, 2026-08-20. Firing it on upload would send a coordinate
   * derived from the photo to a third party while the control still reads
   * `Hide`, whose sentence is a promise about a rider who has chosen nothing.
   * Tapping `Town` IS the rider asking where they were, so it is the moment the
   * lookup becomes something they requested — and an event handler is where
   * `CLAUDE.md` says a read belongs when it is not a render's own data.
   *
   * Three things bound the spend against `069`'s 20-an-hour, and none of them
   * is a second ceiling on top of it: no fix means no call at all, one call per
   * file at most, and `reverseGeocodePlace` sends the rounded coordinate. A
   * failure of any kind — no connection, a spent ceiling, a proxy with no
   * reverse mode deployed — leaves the field empty and the rider types, which
   * is the state the owner already specified for "if not possible". It is never
   * an error on screen: this is a convenience nobody asked for by name.
   */
  function onModeChange(next: PhotoLocationMode) {
    setLocationMode(next)

    if (next !== 'place') return
    if (upload.status !== 'done' || !capture) return
    if (capture.latitude === null || capture.longitude === null) return
    if (attemptedPrefillFor.current === upload.path) return
    // Never over what the rider has already written. The field is theirs the
    // moment they touch it.
    if (placeTextRef.current.trim() !== '') return

    const path = upload.path
    attemptedPrefillFor.current = path
    setPrefilling(true)
    void reverseGeocodePlace(capture.latitude, capture.longitude)
      .then((found) => {
        // Guarded on the path, because a rider who swaps photos while this is
        // in flight would otherwise have the first photo's town land in the
        // field describing the second.
        if (!found || attemptedPrefillFor.current !== path) return
        // **Re-checked at LANDING, not only at fire.** The lookup is a round
        // trip to eu-west-1 and the rider can type straight through it; landing
        // on top of their own words would be this field's own warning — showing
        // a value the rider did not choose — with the app as the author.
        if (placeTextRef.current.trim() !== '') return
        const name = found.label.slice(0, POSTCARD_PLACE_NAME_MAX_LENGTH)
        writePlaceText(name)
        setPlace({ name, placeId: found.id, lat: found.lat, lon: found.lon, countryCode: found.countryCode })
      })
      .finally(() => setPrefilling(false))
  }

  // What actually travels — the rider's choice applied to what the photo knew
  // and what the rider named. Computed here rather than at submit so the hidden
  // inputs below can never hold a value the control does not currently say.
  const location = resolvePhotoLocation(
    activeMode,
    capture ?? { latitude: null, longitude: null },
    placeText.trim()
      ? {
          name: placeText,
          // The pin only counts while the text still IS the pick's name. Typing
          // over a picked town drops the pin inside `PlaceSearchField` already;
          // this is the same rule stated where the value is assembled, so the
          // two cannot disagree about what the rider currently means.
          lat: place?.lat ?? null,
          lon: place?.lon ?? null,
          // Same rule again, for the country: it rides along with the pin
          // rather than the text, so typing over a pick drops both together.
          countryCode: place?.countryCode ?? null,
        }
      : null
  )
  // Read off `location.precision` — what will ACTUALLY be stored — rather than
  // off the button, so the line under the control and the hidden inputs above
  // it come from one answer and cannot disagree about whether anything is being
  // saved. See `resolveLocationCopy` for the two states that needs.
  const { lead, hint } = resolveLocationCopy(activeMode, location.precision, hasPhotoFix)

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

      {/* The resolved location, or nothing at all. On `Hide` none of these
          render, so there is no field to strip and nothing to leak — the precise
          value and the town both stay in this component's memory and die with
          the page.

          **Each field is gated on its own value rather than on the marker**,
          because `072` has five legal arms and one of them is partial by
          design: a town the rider TYPED has a name and a marker and no
          coordinate at all. Gating the group on the coordinate — which is what
          this block used to do — would drop the name of every typed town. */}
      {location.precision !== null && (
        <input type="hidden" name="takenLocationPrecision" value={location.precision} />
      )}
      {location.latitude !== null && location.longitude !== null && (
        <>
          <input type="hidden" name="takenLatitude" value={String(location.latitude)} />
          <input type="hidden" name="takenLongitude" value={String(location.longitude)} />
        </>
      )}
      {location.placeName !== null && (
        <input type="hidden" name="takenPlaceName" value={location.placeName} />
      )}
      {location.placeCountryCode !== null && (
        <input type="hidden" name="takenCountryCode" value={location.placeCountryCode} />
      )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.status === 'uploading'}
          aria-label={preview ? 'Choose a different photo' : undefined}
          className={cn(
            'flex w-full items-center justify-center overflow-hidden rounded-lg bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50',
            !preview && 'border-2 border-dashed border-border-strong',
          )}
          // The design's own box — 358x224 inside a 390-wide frame, so a ratio
          // rather than a height, and it survives a wider screen. It is also
          // what the FEED draws (`PostcardCard`, 334/200): the previous
          // `aspect-4/5` showed the rider a tall crop of a photo that posts
          // landscape, so shrinking this made the preview honest as well as
          // smaller.
          style={{ aspectRatio: '358 / 224' }}
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

      {/* Ride tag, not a second audience — `club_id` above still decides who
          can see this. `041`'s write gate only admits rides this rider is
          crew of, which is exactly the list `rides` already is, so every
          option here is one the database will actually accept. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="rideId" className="text-sm font-medium text-muted">
          Ride
        </label>
        <select
          id="rideId"
          ref={rideRef}
          name="rideId"
          value={rideId}
          onChange={(event) => setRideId(event.target.value)}
          className="h-14 w-full rounded-lg border-2 border-border bg-surface px-4 text-base text-foreground transition-colors focus:border-accent focus:outline-none"
        >
          {/* '' is no ride — postcardRideIdSchema turns it into null. */}
          <option value="">No ride</option>
          {rides.map((ride) => (
            <option key={ride.id} value={ride.id}>
              {ride.title}
            </option>
          ))}
        </select>
      </div>

      {/* **Always mounted, photo or no photo** — product owner, 2026-08-20:
          "Location fields always show regardless if there is a photo there or
          not." It used to be gated on a completed upload, which meant the
          commonest photo there is — a HEIC, a screenshot, anything through
          another app's share sheet — got the sentence "This photo has no
          location." and no way for the rider to say where they were. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <LocationOutlineIcon className="h-4 w-4 text-muted" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">Location</span>
        </div>

        {/* Free-text, and carrying no `names`: the visible input is the stored
            name, and what actually gets submitted is decided by the buttons
            below it. See the state declaration for why place mode would be
            wrong here.

            **Not labelled `Region`, and the collision is the reason.** The
            section heading above already says `Location`, and `Region` is one
            of the mode buttons directly below — so the same word named the
            box you type a place into and the privacy setting that decides what
            leaves the device with it (PD-281). The label answers "what do I
            type here" instead. */}
        <PlaceSearchField
          label="Town or city"
          placeholder="Search for a town, city or area"
          value={place}
          onChange={setPlace}
          maxNameLength={POSTCARD_PLACE_NAME_MAX_LENGTH}
          freeText={{ text: placeText, onTextChange: writePlaceText }}
          disabled={pending}
        />

        {/* Only while a lookup the rider asked for is in flight. Silent on
            failure — see the prefill effect. */}
        {prefilling && (
          <p aria-live="polite" className="px-1 text-xs text-muted">
            Reading the location from your photo…
          </p>
        )}

        <ButtonGroup
          label="What to save about where this postcard was taken"
          options={modes.map(({ value, label }) => ({ value, label }))}
          value={activeMode}
          onChange={onModeChange}
          disabled={pending}
        />
        {/* `aria-live` because the hint is the only thing that changes when a
            button is pressed, and it is the part that carries the consequence. A
            rider using a screen reader hears the new label and would otherwise
            not hear what it means. */}
        <p aria-live="polite" className="text-xs text-muted">
          <span className="font-semibold text-foreground">{lead}</span>{' '}
          {hint}
        </p>
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
