'use client'

import { useActionState, useRef, useState } from 'react'
import { ImageIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { createClub } from '@/lib/actions/clubs'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { uploadClubAvatarImage, uploadClubCoverImage } from '@/lib/media'
import { CLUB_DESCRIPTION_MAX, CLUB_NAME_MAX } from '@/lib/validation/clubs'

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
  const [state, formAction, pending] = useActionState(createClub, emptyActionState)
  useActionRedirect(state)

  const [avatarPath, setAvatarPath] = useState('')
  const [coverPath, setCoverPath] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [name, setName] = useState('')

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
    <form action={formAction} className="flex flex-col gap-6">
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

        <Textarea name="description" label="Description" rows={4} maxLength={CLUB_DESCRIPTION_MAX} />

        {/* Public by default, matching 001's column default and the product
            owner's call. The design's "until then we only have private clubs"
            note is out of date — see clubSchema. */}
        <div className="flex flex-col gap-1">
          <Checkbox name="is_public" label="Make this club public" defaultChecked />
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

      {/*
        Gated on `name` alone — the only `required` field below — rather than a
        new rule: `clubSchema` already refuses an empty name. Without this, an
        empty-form tap meets the browser's own unstyleable "Please fill out this
        field" bubble instead of the app's own validation, on a v2 screen.
      */}
      <Button type="submit" size="lg" loading={pending} disabled={busy || !name.trim()}>
        {name.trim() ? 'Create club' : 'Name your club first'}
      </Button>
    </form>
  )
}
