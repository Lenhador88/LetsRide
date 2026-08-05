import { z } from 'zod'
import { CLUB_AVATAR_PATH_RE, CLUB_COVER_PATH_RE } from '@/lib/media/constants'

/**
 * Club name and description bounds.
 *
 * **These live only here.** `001` declares both as bare `text` with no CHECK, so
 * the database will accept a megabyte of name — the same gap `bio`,
 * `bike_model` and `location` carry on `profiles`, recorded rather than quietly
 * assumed. If a length rule ever needs to be load-bearing it belongs in a
 * migration; until then the Server Action parsing this is the only enforcement,
 * which is why no client may write `clubs` directly.
 *
 * 60 and 500 are chosen, not measured: `Create club` is drawn in the OLD
 * stylesheet and marked **To do**, so the design specifies neither. Named here
 * so the next person knows which numbers came from Figma and which did not.
 */
export const CLUB_NAME_MAX = 60
export const CLUB_DESCRIPTION_MAX = 500

export const clubSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give your club a name.')
    .max(CLUB_NAME_MAX, `Keep the name under ${CLUB_NAME_MAX} characters.`),
  description: z
    .string()
    .trim()
    .max(CLUB_DESCRIPTION_MAX, `Keep the description under ${CLUB_DESCRIPTION_MAX} characters.`)
    // An empty textarea is NULL in the column, not ''. The distinction is the
    // one the card reads: `description && <p>` must not render an empty line.
    .transform((value) => value || null)
    .nullable(),
  /**
   * Private by default, which inverts `001`'s column default and is deliberate.
   * The `View not joined public club` epic carries the note "Public clubs are
   * Post-MVP. Until then we only have private clubs." A form that defaults to
   * public would make every club created before that epic ships the thing the
   * designer says does not exist yet. Flagged for the product owner rather than
   * treated as settled — the column default is untouched, so this is the form's
   * opinion and one line to change.
   */
  is_public: z.boolean().default(false),
  /**
   * Paths, never URLs, and shape-checked here so a malformed one fails as a
   * field error rather than as `016`'s raw 23514. Both regexes come from
   * `lib/media/constants`, which is the same source the uploader builds from —
   * the SQL side is a third copy that nothing automatically reconciles, the
   * standing risk `constants.ts` already documents.
   */
  avatar_path: z.string().regex(CLUB_AVATAR_PATH_RE, 'That image could not be attached.').nullable(),
  cover_image_path: z
    .string()
    .regex(CLUB_COVER_PATH_RE, 'That image could not be attached.')
    .nullable(),
})

export type ClubInput = z.infer<typeof clubSchema>
