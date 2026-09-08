'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon, CloseIcon } from '@/components/icons/generated'
import { COUNTRY_CODES, countryFlag, countryName } from '@/lib/countries'
import { cn } from '@/lib/utils'

/**
 * A single-select country picker — PD-428's onboarding "home country" step.
 * One value, from `COUNTRY_CODES` (`src/lib/countries.ts`, 249 ISO 3166-1
 * alpha-2 codes), never several.
 *
 * ## There is no Figma frame for this control — a design departure
 *
 * Two nearby things exist in `design/` and neither is it:
 *
 * - `Component / Search Results / Country` (v1, `318:4732`) is the travel-log
 *   picker behind `profile_countries` — a **checkbox multi-select** ("which
 *   countries has this rider ridden in"). Different question, different
 *   control. Its **semantics are not reused** — only its 390×56 row geometry
 *   (a 24×18 flag, a label, a trailing indicator), which this file borrows for
 *   the option row and replaces the checkbox with a single `CheckIcon` next
 *   to the picked country, consistent with v2's rule that green is a sparing
 *   accent (selection/active) rather than the multi-select box v1 drew it as.
 * - `Login / Onboarding › Add your location` (`2074:5185`), the onboarding
 *   step `075` deleted, is **not** a country picker either — its one field is
 *   a free-text `City` `Input / Text`, asking a different question
 *   ("where, in your own words") from PD-428's ("which country, exactly
 *   one"). Its container IS the source for the 72px bordered
 *   label-above-value box below, the same shape `Input.tsx` and
 *   `PlaceSearchField.tsx` already use — that part carries over faithfully.
 *
 * So the option row's geometry and the field's container are both traced from
 * real frames; the combobox behaviour that connects them — typing to filter,
 * arrow keys, a listbox — is invented for this control and has no frame to
 * check it against. Log this departure in `docs/FIGMA-FIDELITY-TODO.md`
 * (this file may not edit it).
 *
 * ## Behaviour
 *
 * A single text field shows the picked country (flag + name) when idle and a
 * typed filter while the rider is searching — the same "draft vs. picked
 * value" split `PlaceSearchField` uses for its place mode, and for the same
 * reason: what is on screen while typing is a search term, never the stored
 * value, so an unpicked draft reverts to the real value on blur rather than
 * being submittable. Filtering matches the country **name** and the ISO
 * **code**, case- and accent-insensitively (`Curaçao` matches `curacao`) —
 * `Intl`'s own `normalize('NFD')` plus a diacritic strip, no dependency
 * added.
 *
 * ## Accessibility
 *
 * This is a required, unskippable onboarding step (decision #5), so a rider
 * who cannot see the screen has to be able to finish it same as one who can:
 *
 * - `role="combobox"` on the input, `aria-expanded`, `aria-controls`,
 *   `aria-activedescendant` pointing at the highlighted `role="option"` —
 *   the ARIA "editable combobox with listbox popup" pattern, matching
 *   `PlaceSearchField`'s wiring.
 * - Arrow keys open the list and move the highlight, `Enter` picks the
 *   highlighted option (and only that one — `Enter` with nothing
 *   highlighted reverts the draft and lets a surrounding form submit rather
 *   than swallowing the key), `Escape` closes without picking or clearing.
 *   `resolveCountryKey`/`wrapCountryIndex` below are the pure decision,
 *   tested the same way `PlaceSearchField`'s `resolveComboboxKey`/`wrapIndex`
 *   are (`CLAUDE.md`'s test table: a `node`-environment test for the pure
 *   half, `jsdom` for the mounted interaction).
 * - Opening with a value already picked starts the highlight ON that option,
 *   not at the top of 249 rows — so a screen reader user who has already
 *   chosen a country lands back on it rather than at "Andorra" every time.
 * - Option rows are real `<button>`s for pointer/click support but carry
 *   `tabIndex={-1}`: the combobox pattern drives the list via
 *   `aria-activedescendant`, and a focusable option would let `Tab` walk
 *   through up to 249 rows instead of leaving the field.
 * - `error` wires to the input via `aria-describedby`, matching `Input`.
 * - 56px option rows (borrowed geometry, above) already clear the 44×44
 *   floor; the field's own 72px box does too.
 *
 * `name`, if passed, renders a hidden `<input>` carrying the code — the same
 * shape `Input`/`Checkbox` give a `useActionState` action reading `FormData`,
 * and optional for the same reason `PlaceSearchField`'s `names` prop is: a
 * caller that only wants `onChange` should not have to submit anything.
 */
export type CountrySelectProps = {
  /** The field's own label, e.g. `Home country`. */
  label: string
  value: string | null
  onChange: (code: string | null) => void
  error?: string
  placeholder?: string
  disabled?: boolean
  id?: string
  /** `FormData` field name for the hidden input. Omitted writes no form field. */
  name?: string
}

type CountryOption = { code: string; name: string }

// Built once, like `countryTokenSet` in `lib/countries.ts` and for the same
// reason: every keystroke filters this, so it is not worth rebuilding per
// render or even per mount.
let cachedOptions: CountryOption[] | null = null

function getCountryOptions(): CountryOption[] {
  if (cachedOptions) return cachedOptions
  cachedOptions = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
  return cachedOptions
}

/** Lowercased, diacritic-stripped — `Curaçao` and `curacao` compare equal. */
export function normalizeCountryQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * Matches on the country **name** or the ISO **code**, both normalized. An
 * empty query returns every option unfiltered — a rider who opens the list
 * without typing gets the full alphabetical set to arrow through, not an
 * empty panel.
 */
export function filterCountryOptions(
  query: string,
  options: CountryOption[] = getCountryOptions()
): CountryOption[] {
  const normalized = normalizeCountryQuery(query)
  if (!normalized) return options
  return options.filter(
    (option) =>
      normalizeCountryQuery(option.name).includes(normalized) ||
      option.code.toLowerCase().includes(normalized)
  )
}

/** Row height the listbox scrolls at — the borrowed 56px row. */
const ROW_HEIGHT = 56
/** How many rows show before the panel scrolls inside itself. */
const VISIBLE_ROWS = 6

/**
 * What a key press means, as a pure function — same split as
 * `PlaceSearchField`'s `resolveComboboxKey`, and the same two rules:
 *
 * - **`Enter` with a highlighted option selects it and must not submit the
 *   form.** Without this a rider picking a country on the onboarding form
 *   would submit a half-filled step and blame the field.
 * - **`Escape` closes only.** It never clears the field or drops the pick.
 */
export type CountrySelectKeyAction =
  | { type: 'none' }
  | { type: 'open' }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'select' }
  | { type: 'close' }

export function resolveCountryKey(
  key: string,
  state: { open: boolean; optionCount: number; activeIndex: number }
): CountrySelectKeyAction {
  const { open, optionCount, activeIndex } = state

  if (key === 'Escape') return open ? { type: 'close' } : { type: 'none' }

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (optionCount === 0) return { type: 'none' }
    if (!open) return { type: 'open' }
    return { type: 'move', delta: key === 'ArrowDown' ? 1 : -1 }
  }

  if (key === 'Enter') {
    const hasActive = open && activeIndex >= 0 && activeIndex < optionCount
    return hasActive ? { type: 'select' } : { type: 'none' }
  }

  return { type: 'none' }
}

/** Wraps at both ends, so Up from the first row lands on the last. */
export function wrapCountryIndex(activeIndex: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1
  if (activeIndex < 0) return delta === 1 ? 0 : count - 1
  return (activeIndex + delta + count) % count
}

export function CountrySelect({
  label,
  value,
  onChange,
  error,
  placeholder = 'Search for your country',
  disabled,
  id,
  name,
}: CountrySelectProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-list`
  const errorId = error ? `${inputId}-error` : undefined

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  // A search term, distinct from the picked value — see the file header.
  // `null` means "no draft", and the field falls back to the pick.
  const [draft, setDraft] = useState<string | null>(null)

  const allOptions = getCountryOptions()
  const options = filterCountryOptions(draft ?? '', allOptions)
  const text = draft ?? (value ? `${countryFlag(value)} ${countryName(value)}` : '')

  const inputRef = useRef<HTMLInputElement>(null)
  const activeOptionRef = useRef<HTMLButtonElement>(null)

  // The list scrolls at `VISIBLE_ROWS`, and neither the highlight nor
  // `aria-activedescendant` moves it on their own — without this, arrowing
  // past the visible rows moves a highlight the rider cannot see.
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function pick(code: string) {
    onChange(code)
    setDraft(null)
    setActiveIndex(-1)
    setOpen(false)
  }

  function clear() {
    onChange(null)
    setDraft(null)
    setActiveIndex(-1)
    // Same reason `PlaceSearchField.clear` does this: without refocusing, the
    // tap blurs the field and closes the very list the rider was reaching for.
    inputRef.current?.focus()
    setOpen(true)
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      {name && <input type="hidden" name={name} value={value ?? ''} />}

      <div
        className={cn(
          'flex h-[72px] w-full items-center gap-3 rounded-lg border-2 border-border bg-surface px-4 py-3 transition-colors focus-within:border-accent',
          disabled && 'opacity-50'
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <label htmlFor={inputId} className="text-sm font-medium text-muted">
            {label}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={text}
            onChange={(event) => {
              setDraft(event.target.value)
              setActiveIndex(-1)
              setOpen(true)
            }}
            onFocus={() => {
              setOpen(true)
              // Land the highlight on the current pick rather than at the top
              // of 249 rows — see the file header's accessibility note.
              setActiveIndex(value ? allOptions.findIndex((option) => option.code === value) : -1)
            }}
            onBlur={() => {
              setOpen(false)
              setActiveIndex(-1)
              // What is on screen must be what is stored — an unpicked draft
              // is dropped and the field reverts to the pick (or empty).
              setDraft(null)
            }}
            onKeyDown={(event) => {
              const action = resolveCountryKey(event.key, {
                open,
                optionCount: options.length,
                activeIndex,
              })
              if (action.type === 'none') {
                // A submit from inside the focused field never blurs, so the
                // blur revert above never runs — without this an unpicked
                // draft could be left on screen while the form submits the
                // old value. No `preventDefault`: the form still submits.
                if (event.key === 'Enter') {
                  setDraft(null)
                  setOpen(false)
                }
                return
              }
              // Only for a key this control actually handles — an
              // unconditional preventDefault would stop Enter submitting a
              // surrounding form at all.
              event.preventDefault()
              if (action.type === 'open') setOpen(true)
              if (action.type === 'move') {
                setOpen(true)
                setActiveIndex(wrapCountryIndex(activeIndex, action.delta, options.length))
              }
              if (action.type === 'select') pick(options[activeIndex].code)
              if (action.type === 'close') {
                setOpen(false)
                setActiveIndex(-1)
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className="w-full min-w-0 bg-transparent text-base font-medium text-foreground placeholder:text-muted focus:outline-none"
          />
        </div>

        {/* Only when there is something to clear — a permanently visible
            clear control on an untouched required field reads as broken. */}
        {(text.length > 0 || value !== null) && !disabled ? (
          <button
            type="button"
            onClick={clear}
            // Without this the tap blurs the input before the click lands,
            // and `clear` would be refocusing a field the rider was just
            // thrown out of — same reason the panel below does it.
            onMouseDown={(event) => event.preventDefault()}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors active:bg-background"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        ) : (
          <ChevronDownIcon
            className={cn('h-5 w-5 shrink-0 text-muted transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        )}
      </div>

      {open && !disabled && (
        <div
          className="overflow-y-auto rounded-lg border-2 border-border bg-surface"
          style={{ maxHeight: `${VISIBLE_ROWS * ROW_HEIGHT}px` }}
          // On the whole panel rather than per-row, so a click anywhere in it
          // (including a row) never blurs the input first — the same
          // trick `PlaceSearchField`'s panel uses.
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.length > 0 ? (
            <ul id={listId} role="listbox" aria-label={label} className="flex flex-col gap-0.5 px-2 py-1">
              {options.map((option, index) => (
                <li key={option.code} role="none">
                  <button
                    type="button"
                    id={`${listId}-${index}`}
                    ref={index === activeIndex ? activeOptionRef : null}
                    role="option"
                    // See the file header: a focusable option would let `Tab`
                    // walk all 249 rows instead of the combobox driving them
                    // via `aria-activedescendant`.
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    onClick={() => pick(option.code)}
                    className={cn(
                      'flex min-h-[56px] w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors active:bg-background',
                      index === activeIndex && 'bg-background'
                    )}
                  >
                    <span className="text-xl leading-none" aria-hidden="true">
                      {countryFlag(option.code)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
                      {option.name}
                    </span>
                    {option.code === value && (
                      <CheckIcon className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm font-medium text-muted">
              No countries match that search.
            </p>
          )}
        </div>
      )}

      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
