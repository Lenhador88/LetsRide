import { countryFlag, countryName } from '@/lib/countries'
import { cn } from '@/lib/utils'

/**
 * One flag's visual content — the emoji plus its accessible name — with no
 * affordance of its own. Shared by `ProfileCountries` (the editor, which
 * wraps this in a `<button>` carrying the remove action and its own
 * `aria-label`) and `CountryFlags` below (the read-only grid), so the two
 * draw identical pills from one definition rather than two copies that can
 * drift on the flag/name pairing.
 */
export function CountryBadge({ code }: { code: string }) {
  return (
    <>
      <span aria-hidden="true">{countryFlag(code)}</span>
      <span className="sr-only">{countryName(code)}</span>
    </>
  )
}

/**
 * The read-only flag grid — `view-rider-profile` task 3.5.
 *
 * `ProfileCountries` holds selection state, a search box and a write
 * transition, so it MUST NOT be reused on another rider's profile: it would
 * draw an editing affordance over countries that are not the viewer's to
 * change. This is the flag-rendering half extracted out of it instead — the
 * same pill markup, with no button, no remove control and no picker.
 *
 * Renders nothing for an empty list, matching the spec's *no empty section
 * headings* rule: a rider who has marked no countries gets no "Countries"
 * heading at all, which is the caller's job to gate on, not this
 * component's — `codes.length === 0` here is silence, not a heading over an
 * empty grid.
 */
export function CountryFlags({ codes, className }: { codes: string[]; className?: string }) {
  if (codes.length === 0) return null

  return (
    <ul className={cn('flex flex-wrap gap-2 px-6', className)}>
      {codes.map((code) => (
        <li
          key={code}
          className="flex items-center gap-1 rounded bg-surface px-2 py-1 text-sm text-foreground"
        >
          <CountryBadge code={code} />
        </li>
      ))}
    </ul>
  )
}
