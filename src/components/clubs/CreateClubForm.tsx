'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { ImageIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { PlaceSearchField, type PlaceValue } from '@/components/ui/PlaceSearchField'
import { Textarea } from '@/components/ui/Textarea'
import { createClub } from '@/lib/actions/clubs'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { retaining, seedRetained, wasChecked } from '@/lib/actions/retain'

import { uploadClubAvatarImage, uploadClubCoverImage } from '@/lib/media'
import {
  CLUB_DESCRIPTION_MAX,
  CLUB_LOCATION_FIELD_NAMES,
  CLUB_NAME_MAX,
  clubSchema,
  readClubLocation,
} from '@/lib/validation/clubs'

// `name` is controlled already (the header mirrors it as you type), so only the
// two React would otherwise erase are named here.
const retainClub = retaining(createClub, ['description', 'is_public'])
const initialState = seedRetained(emptyActionState)

/**
 * `Create club`.
 *
 * **The composition here is ours, and that is not a shortcut.** The design's
 * `Create club` frame (`1951:8583`) is drawn entirely in the OLD stylesheet —
 * 37 `Grey (OLD)/*` references, `Component / Input / User` rather than any
 * `v2 / Component / *` — and its epic cover reads **To do**. There is no v2
 * design for this screen to build from, so what this does is apply the settled
 * v2 primitives to the fields that already exist, rather than invent a layout
 * and present it as measured.
 *
 * Two things the v1 frame draws that are deliberately absent, because both are
 * whole features rather than form fields: **member invitations** (rows with a
 * `(Pending)` state and a delete control) and an **Admin** role distinct from
 * owner. `club_members.role` has an `admin` value and nothing has ever written
 * it. Inventing an invite flow off a v1 frame marked To do is exactly the guess
 * this repo keeps paying for.
 *
 * The upload is **upload-first, insert-second**, which is forced rather than
 * chosen: 016's paths are keyed on the uploader because the club row does not
 * exist yet when the image has to land. A failure between the two leaves an
 * orphaned object, never a club pointing at an image that is not there.
 */
export function CreateClubForm() {
  const [state, formAction, pending] = useActionState(retainClub, initialState)
  useActionRedirect(state)
  const formRef = useRef<HTMLFormElement>(null)
  // What was on the form at submission, not what is on it now — see the same
  // ref in `CreateRideForm`. React resets uncontrolled fields to their
  // `defaultValue` once a form action settles, including on an error return,
  // so re-reading the live DOM here would parse an empty form and could focus
  // a different field than the one `state.error` is talking about.
  const submittedData = useRef<FormData | null>(null)

  // Same reasoning as `CreateRideForm`: a disabled submit here read as the
  // resting state of an untouched form and left the tab order early, so this
  // moves focus to the schema-rejected field instead, off the same `clubSchema`
  // the action parses (`lib/actions/clubs.ts`'s null-coalescing on the two path
  // fields), rather than a second, hand-rolled "is `name` empty" check that
  // could disagree with it.
  useEffect(() => {
    if (!state.error) return
    const data = submittedData.current
    const form = formRef.current
    if (!data || !form) return
    const parsed = clubSchema.safeParse({
      name: data.get('name'),
      description: data.get('description'),
      is_public: data.get('is_public') === 'on',
      avatar_path: (data.get('avatar_path') as string) || null,
      cover_image_path: (data.get('cover_image_path') as string) || null,
      location: readClubLocation(data),
    })
    const field = parsed.success ? undefined : parsed.error.issues[0]?.path[0]
    if (typeof field === 'string') {
      const el = form.elements.namedItem(field)
      if (el instanceof HTMLElement) el.focus()
    }
  }, [state])

  const [avatarPath, setAvatarPath] = useState('')
  const [coverPath, setCoverPath] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  // Controlled like `name` rather than retained through `seedRetained`: the
  // value is an object across four fields, and `retaining` restores strings.
  // The action returns an error without navigating, so this survives a failed
  // submit for the same reason the header's name mirror does.
  const [location, setLocation] = useState<PlaceValue | null>(null)

  const avatarInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)

  async function handleFile(kind: 'avatar' | 'cover', file: File | undefined) {
    if (!file) return
    setUploadError(null)
    setUploading(kind)
    try {
      const { path } =
        kind === 'avatar' ? await uploadClubAvatarImage(file) : await uploadClubCoverImage(file)
      // A local preview rather than a signed URL: the object exists but no club
      // points at it yet, so 016's SELECT policy has nothing to match on until
      // the insert lands. `createObjectURL` shows the rider what they picked
      // without pretending the server can see it.
      const preview = URL.createObjectURL(file)
      if (kind === 'avatar') {
        setAvatarPath(path)
        setAvatarPreview(preview)
      } else {
        setCoverPath(path)
        setCoverPreview(preview)
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'That image could not be uploaded.')
    } finally {
      setUploading(null)
    }
  }

  const busy = pending || uploading !== null

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(event) => {
        submittedData.current = new FormData(event.currentTarget)
      }}
      noValidate
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="avatar_path" value={avatarPath} />
      <input type="hidden" name="cover_image_path" value={coverPath} />

      <div className="relative">
        <button
          type="button"
          onClick={() => coverInput.current?.click()}
          disabled={busy}
          className="flex h-40 w-full items-center justify-center overflow-hidden rounded-lg bg-border text-muted disabled:opacity-50"
        >
          {coverPreview ? (
            <img src={coverPreview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex items-center gap-2 text-sm font-medium">
              <ImageIcon className="h-6 w-6" />
              {uploading === 'cover' ? 'Uploading…' : 'Add a cover image'}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => avatarInput.current?.click()}
          disabled={busy}
          aria-label="Add a club avatar"
          className="absolute -bottom-6 left-4 rounded-xl disabled:opacity-50"
        >
          {avatarPreview ? (
            <img
              src={avatarPreview}
              alt=""
              className="h-18 w-18 rounded-xl border-2 border-surface object-cover"
            />
          ) : (
            <Avatar
              name={name || '?'}
              size="xl"
              className="h-18 w-18 rounded-xl border-surface bg-surface"
            />
          )}
        </button>
      </div>

      <input
        ref={coverInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleFile('cover', event.target.files?.[0])}
      />
      <input
        ref={avatarInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleFile('avatar', event.target.files?.[0])}
      />

      <div className="mt-6 flex flex-col gap-4">
        <Input
          name="name"
          label="Club name"
          required
          maxLength={CLUB_NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <Textarea
          name="description"
          label="Description"
          rows={4}
          maxLength={CLUB_DESCRIPTION_MAX}
          defaultValue={state.retained.description}
        />

        {/* Optional, and the copy says so — Create club is the app's shortest
            creation flow and a required field would be a new wall in front of
            it. A club with no location still appears on Explore; it just
            cannot be sorted by distance. */}
        <div className="flex flex-col gap-1">
          <PlaceSearchField
            label="Where the club is based (optional)"
            sheetTitle="Set club location"
            placeholder="Search for a town or place"
            value={location}
            onChange={setLocation}
            names={CLUB_LOCATION_FIELD_NAMES}
            disabled={busy}
          />
          <p className="pl-1 text-xs font-medium text-muted">
            Riders looking for a club near them will find yours. This is the club&rsquo;s own
            location, not yours.
          </p>
        </div>

        {/* Public by default, matching 001's column default and the product
            owner's call. The design's "until then we only have private clubs"
            note is out of date — see clubSchema. */}
        <div className="flex flex-col gap-1">
          {/* See CreateRideForm — restoring the literal default would re-open a
              club the rider had just made private. */}
          <Checkbox
            name="is_public"
            label="Make this club public"
            defaultChecked={wasChecked(state.retained, 'is_public', true)}
          />
          <p className="pl-8 text-xs font-medium text-muted">
            Anyone signed in can find a public club and join it. A private club is only visible to
            its members.
          </p>
        </div>
      </div>

      {(state.error || uploadError) && (
        <p role="status" aria-live="polite" className="text-sm text-danger">
          {state.error ?? uploadError}
        </p>
      )}

      <Button type="submit" size="lg" loading={pending} disabled={busy}>
        Create club
      </Button>
    </form>
  )
}
