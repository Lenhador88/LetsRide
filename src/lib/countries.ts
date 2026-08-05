/**
 * The country list behind the profile's "Countries" section.
 *
 * **No names and no flag assets are stored here — both are derived.** The design
 * draws 32×24 flag rectangles for 22 countries, which read as ~40 SVGs to
 * export and maintain. They are not:
 *
 * - The **name** comes from `Intl.DisplayNames`, which every runtime this app
 *   targets ships. That also means the picker is already translated the day the
 *   app is, rather than carrying an English list that would then need one.
 * - The **flag** is the two regional-indicator code points for the same two
 *   letters. `NL` → `🇳🇱` is arithmetic, not an asset.
 *
 * The cost is stated rather than buried: **emoji flags do not render on
 * Windows**, which shows the two letters instead (`NL`). That is a real
 * deviation from a design drawn in rectangles, it is a deliberate trade against
 * ~40 committed SVGs plus a sprite pipeline, and it is logged in
 * docs/FIGMA-FIDELITY-TODO.md §Profile. For a mobile-first app whose users are
 * on iOS and Android it costs nothing on the screens that matter; swapping in
 * real assets later touches this file and nothing else.
 *
 * The codes are ISO 3166-1 alpha-2, matching `profile_countries`' CHECK
 * constraint exactly. Stored as one string and split at module load because a
 * 249-element array literal is 249 lines of diff nobody will ever read.
 */
const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'

export const COUNTRY_CODES: readonly string[] = CODES.split(' ')

/**
 * The denominator in the section header. The design draws `22/195` — the count
 * of UN member states — while this list is the full ISO 3166-1 set, which also
 * carries territories and dependencies (Guernsey, Réunion, Antarctica). The
 * number shown is therefore **this list's length, not 195**, because a
 * denominator that disagrees with what the picker offers is worse than one that
 * disagrees with the mock: a rider could otherwise tick 200 of 195.
 */
export const COUNTRY_TOTAL = COUNTRY_CODES.length

const REGIONAL_INDICATOR_A = 0x1f1e6
const LETTER_A = 'A'.charCodeAt(0)

/**
 * `NL` → `🇳🇱`. Two regional indicator symbols, which every emoji font pairs
 * into a flag. Falls back to the raw code for anything that is not two ASCII
 * letters, so a malformed value renders visibly rather than as a broken glyph.
 */
export function countryFlag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code
  return String.fromCodePoint(
    ...[...code].map((letter) => REGIONAL_INDICATOR_A + letter.charCodeAt(0) - LETTER_A)
  )
}

// Constructing a DisplayNames is not free and the picker asks for ~250 names on
// every keystroke, so it is built once rather than per call.
let displayNames: Intl.DisplayNames | null = null

/**
 * `NL` → `Netherlands`. Falls back to the code itself, which is what a runtime
 * without the region data returns anyway — a picker listing bare codes is
 * usable, one that throws is not.
 */
export function countryName(code: string): string {
  try {
    displayNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return displayNames.of(code) ?? code
  } catch {
    return code
  }
}
