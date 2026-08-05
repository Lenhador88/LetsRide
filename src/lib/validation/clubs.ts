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
   * No default here: the checkbox always sends a boolean, so a Zod default
   * would be dead code that reads like the decision. **Public is the default**,
   * set by `defaultChecked` on the form and by `001`'s column default, and
   * confirmed by the product owner.
   *
   * The design's `View not joined public club` epic carries a note — "Public
   * clubs are Post-MVP. Until then we only have private clubs" — and both
   * public-club epics are On hold. That note is **out of date rather than
   * binding**: public clubs are in scope, which is also what `/clubs/explore`
   * being marked Done already implied. Recorded because a future session
   * reading that frame will have the same question.
   */
  is_public: z.boolean(),
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
