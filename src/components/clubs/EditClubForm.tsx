'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { ImageIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { DeleteClubControl } from '@/components/clubs/DeleteClubControl'
import { updateClub } from '@/lib/actions/clubs'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState, type ActionState } from '@/lib/actions/state'
import { getClubPublicRideCount } from '@/lib/data/clubs'
import { uploadClubAvatarImage, uploadClubCoverImage } from '@/lib/media'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { CLUB_DESCRIPTION_MAX, CLUB_NAME_MAX, clubSchema } from '@/lib/validation/clubs'
import type { ClubForEdit } from '@/types'

/**
 * `/clubs/[id]/edit` — PD-101. Composition-is-ours for the same reason
 * `CreateClubForm`'s is (that component's header carries the full argument),
 * and the image upload flow is copied from it unchanged — upload straight to
 * Storage, hold the path in state, submit it with everything else.
 *
 * **Controlled, unlike `CreateClubForm`, for the same reason `EditRideForm`
 * is controlled and that component's isn't** — see its header. An edit form
 * reverting an uncontrolled field to the club's OLD value on a rejected save
 * discards what the owner just typed; a create form reverting to empty only
 * ever discards nothing.
 *
 * The privacy toggle's disclosure (`club-lifecycle`'s privacy requirement)
 * only fires reading `willGoPrivate` — the club is public today and the
 * checkbox is about to uncheck it — because `getClubPublicRideCount` is a
 * read this form has no reason to issue for an already-private club or for a
 * public club staying public.
 */
export function EditClubForm({ club }: { club: ClubForEdit }) {
  const boundUpdateClub = useCallback(
    (prev: ActionState, formData: FormData) => updateClub(club.id, prev, formData),
    [club.id]
  )
  const [state, formAction, pending] = useActionState(boundUpdateClub, emptyActionState)
  useActionRedirect(state)

  const [name, setName] = useState(club.name)
  const [description, setDescription] = useState(club.description ?? '')
  const [isPublic, setIsPublic] = useState(club.is_public)

  const [avatarPath, setAvatarPath] = useState(club.avatar_path ?? '')
  const [coverPath, setCoverPath] = useState(club.cover_image_path ?? '')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(club.avatar_url)
  const [coverPreview, setCoverPreview] = useState<string | null>(club.cover_image_url)
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const avatarInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)

  async function handleFile(kind: 'avatar' | 'cover', file: File | undefined) {
    if (!file) return
    setUploadError(null)
    setUploading(kind)
    try {
      const { path } =
        kind === 'avatar' ? await uploadClubAvatarImage(file) : await uploadClubCoverImage(file)
      // A local preview rather than a re-signed URL: the new object has no
      // club row pointing at it yet, so 016's SELECT policy has nothing to
      // match on until the save lands — same reasoning as CreateClubForm.
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

  // Moves focus to the schema-rejected field on error — reading controlled
  // state directly, the same reasoning EditRideForm's own effect carries.
  useEffect(() => {
    if (!state.error) return
    const parsed = clubSchema.safeParse({
      name,
      description,
      is_public: isPublic,
      avatar_path: avatarPath || null,
      cover_image_path: coverPath || null,
    })
    const field = parsed.success ? undefined : parsed.error.issues[0]?.path[0]
    if (typeof field === 'string') {
      document.getElementsByName(field)[0]?.focus()
    }
    // Only on a fresh error — not on every keystroke that follows one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // propagate_club_privacy_to_rides (022) fires only on a real public ->
  // private flip, so the read is scoped to exactly that transition.
  const willGoPrivate = club.is_public && !isPublic
  const publicRides = useQuery(
    willGoPrivate ? queryKeys.clubs.publicRideCount(club.id) : null,
    () => getClubPublicRideCount(club.id)
  )

  const busy = pending || uploading !== null

  return (
    <div className="flex flex-col gap-6">
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
            aria-label="Change the club avatar"
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
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <div className="flex flex-col gap-1">
            <Checkbox
              name="is_public"
              label="Make this club public"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            <p className="pl-8 text-xs font-medium text-muted">
              Anyone signed in can find a public club and join it. A private club is only visible
              to its members.
            </p>
            {willGoPrivate && (
              <p role="alert" className="pl-8 text-xs font-medium text-danger">
                {publicRides.data === undefined
                  ? 'This will also make this club’s public rides private.'
                  : publicRides.data === 0
                    ? 'This club has no public rides to affect.'
                    : `This will also make ${publicRides.data} public ${publicRides.data === 1 ? 'ride' : 'rides'} private.`}{' '}
                Making the club public again will not restore them.
              </p>
            )}
          </div>
        </div>

        {(state.error || uploadError) && (
          <p role="status" aria-live="polite" className="text-sm text-danger">
            {state.error ?? uploadError}
          </p>
        )}

        <Button type="submit" size="lg" loading={pending} disabled={busy}>
          Save changes
        </Button>
      </form>

      <DeleteClubControl clubId={club.id} />
    </div>
  )
}
