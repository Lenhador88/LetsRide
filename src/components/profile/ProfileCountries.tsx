'use client'

import { useMemo, useState, useTransition } from 'react'
import { CheckIcon, CloseIcon, PlusIcon } from '@/components/icons/generated'
import { CountryBadge } from '@/components/profile/CountryFlags'
import { Input } from '@/components/ui/Input'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { addCountry, removeCountry } from '@/lib/actions/profile'
import { COUNTRY_CODES, COUNTRY_TOTAL, countryFlag, countryName } from '@/lib/countries'
import { cn } from '@/lib/utils'

/**
 * `Profile / View your profile / Profile` → `Countries` — the flag grid and its
 * `22/195` meta, plus the picker the design does not draw.
 *
 * **The picker is invented and the grid is not.** The design shows the result
 * (rows of 32×24 flags under a section header) but no way to change it, because
 * every profile frame in the file is a view. Marking countries by hand was the
 * product owner's call on 2026-08-05; how it is done was not specified, so a
 * search field plus a tappable list is ours and is logged as such.
 *
 * Flags are emoji rather than assets — see `lib/countries.ts` for the trade and
 * its one real cost (Windows renders the two letters instead).
 *
 * Optimistic by hand, like `RideAttendanceBar`: the tap has to feel immediate
 * and the value has to survive the action's revalidation, and a `useOptimistic`
 * would need a form it does not have. On failure it rolls back to what the
 * server last said and shows why.
 */
export function ProfileCountries({ codes }: { codes: string[] }) {
  const [selected, setSelected] = useState<string[]>(codes)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return COUNTRY_CODES
    // Matches the name a rider reads AND the code they might type. Sorted by
    // whether the name *starts* with the query, so typing "ne" offers
    // Netherlands before Sierra Leone.
    return COUNTRY_CODES.filter(
      (code) => countryName(code).toLowerCase().includes(needle) || code.toLowerCase() === needle
    ).sort((a, b) => {
      const aStarts = countryName(a).toLowerCase().startsWith(needle) ? 0 : 1
      const bStarts = countryName(b).toLowerCase().startsWith(needle) ? 0 : 1
      return aStarts - bStarts || countryName(a).localeCompare(countryName(b))
    })
  }, [query])

  function toggle(code: string) {
    const had = selected.includes(code)
    const previous = selected

    setSelected(had ? selected.filter((value) => value !== code) : [...selected, code])
    setError(null)

    startTransition(async () => {
      const result = had ? await removeCountry(code) : await addCountry(code)
      if (result.error) {
        setSelected(previous)
        setError(result.error)
      }
    })
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Countries" meta={`${selected.length}/${COUNTRY_TOTAL}`} />

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-6">
          {selected.map((code) => (
            <li key={code}>
              <button
                type="button"
                onClick={() => toggle(code)}
                aria-label={`Remove ${countryName(code)}`}
                className="flex items-center gap-1 rounded bg-surface px-2 py-1 text-sm text-foreground"
              >
                <CountryBadge code={code} />
                <CloseIcon className="h-4 w-4 text-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="px-6 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="px-6">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-1 text-sm font-semibold text-accent"
        >
          <PlusIcon className="h-5 w-5" aria-hidden="true" />
          {open ? 'Done' : 'Add countries'}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-2 px-6">
          <Input
            label="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Netherlands"
          />
          {/* Bounded height with its own scroll: ~250 rows inside a page that
              also scrolls would bury the rest of the profile. */}
          <ul className="max-h-64 overflow-y-auto rounded-lg bg-surface">
            {matches.map((code) => {
              const isSelected = selected.includes(code)
              return (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => toggle(code)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-2 text-left text-sm',
                      isSelected ? 'font-semibold text-foreground' : 'text-muted'
                    )}
                  >
                    <span aria-hidden="true">{countryFlag(code)}</span>
                    {countryName(code)}
                    {isSelected && <CheckIcon className="ml-auto h-4 w-4 text-accent" aria-hidden="true" />}
                  </button>
                </li>
              )
            })}
            {matches.length === 0 && (
              <li className="px-4 py-3 text-sm text-muted">No country matches that.</li>
            )}
          </ul>
        </div>
      )}
    </section>
  )
}
