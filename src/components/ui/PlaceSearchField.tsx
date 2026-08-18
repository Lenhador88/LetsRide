'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, LocationOutlineIcon, SearchIcon } from '@/components/icons/generated'
import { PLACE_SEARCH_MIN_CHARS, searchPlaces } from '@/lib/data/places'
import { resolveRiderLocation } from '@/lib/location/rider-location'
import { cn } from '@/lib/utils'
import type { PlaceSearchResult } from '@/types'

/**
 * A place, as a form field: a tappable box showing what is chosen, and a
 * full-screen sheet to change it.
 *
 * ## Where this lives, and why it is a `ui/` primitive rather than a club part
 *
 * PD-259 (a club's location) and PD-114 (a ride's meeting point) want the same
 * control, and PD-259 says so explicitly: *"whichever lands first builds it;
 * the second should find it in `src/components/ui/`, not write a second one."*
 * So this knows nothing about clubs — it takes a value, returns a value, and
 * writes four hidden inputs the caller names.
 *
 * **What PD-114 will need on top, and what it must NOT change.** A ride's
 * meeting point is free text *with* search on top — "the layby past the second
 * roundabout" is a real meeting point and a picker that refuses it is worse
 * than the bare field it replaced. That is a `required`/free-text prop added
 * here, not a second component and not a rewrite of this one.
 *
 * ## The design, and what is deliberately not taken from it
 *
 * `Rides / Add starting location - Filled` (`1918:15967`) is the only frame in
 * the file for this control. Its *composition* is what is built here — a
 * full-screen sheet, a header with a title and a `Cancel`, a search field, and
 * 72px result rows with a `Location Outline` pin, a Label and a Meta line.
 * Its *styling* is v1 (`Grey (OLD)/*`, and the epic is To do), so v2 primitives
 * are applied exactly as `CreateClubForm` and `CreateRideForm` did rather than
 * transcribing OLD tokens — decision #4.
 *
 * **The frame's inline ghost-text autocomplete is not built.** It is the
 * fiddliest part of that design, PD-114's own build notes say to leave it until
 * last, and it is the one element that cannot degrade — a half-working
 * completion rewrites what the rider typed. The field works completely without
 * it.
 *
 * ## Debounce, abort, and the reason both are required rather than polite
 *
 * `search_places()`'s own contract says to debounce, and not as advice: cost is
 * roughly linear in rows matched, and the broadest tokens are street-type
 * suffixes rather than city names. `039`'s measurements put a nationwide
 * `straat` at 11,458 ms on the real index — inside the 8 s statement timeout
 * only because `050`'s candidate cap now bounds it. So every keystroke that
 * fires a query is a real cost to a shared database, not a wasted round trip.
 *
 * The in-flight request is aborted per keystroke for the reason `searchPlaces`
 * threads a signal at all: without it, results arrive out of order and the
 * list flickers back to an older term's answers.
 *
 * ## The bias, and why this asks for it rather than taking it as a prop
 *
 * `resolveRiderLocation()` is memoised with a TTL and never prompts, so asking
 * for it here costs nothing after the first call and cannot fire an OS
 * permission dialog because somebody opened a search sheet. Passing it in would
 * make every caller remember to, and a caller that forgot would get the
 * nationwide search path — 171–2,957 ms against 17–152 ms — with nothing
 * visibly wrong.
 *
 * **Resolved when the sheet OPENS, not on mount.** A form with this field on it
 * must not read a position for a rider who never touches it.
 */
export type PlaceValue = {
  name: string
  placeId: string
  lat: number
  lon: number
}

export function PlaceSearchField({
  label,
  sheetTitle,
  placeholder = 'Search for a town or place',
  value,
  onChange,
  names,
  disabled,
}: {
  /** The field's own label, e.g. `Location`. */
  label: string
  /** The sheet's heading, e.g. `Set club location`. */
  sheetTitle: string
  placeholder?: string
  value: PlaceValue | null
  onChange: (value: PlaceValue | null) => void
  /**
   * What the four hidden inputs are called, so the caller's action reads them
   * back off `FormData` under its own column names. Required rather than
   * defaulted: two different tables want this control and a shared default
   * would silently write a club's column names onto a ride.
   */
  names: { name: string; placeId: string; lat: string; lon: string }
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const fieldId = useId()

  return (
    <div className="flex w-full flex-col gap-1.5">
      {/* The value travels as four hidden fields rather than as JSON in one:
          the action parses them with `readClubLocation`, and four named
          strings are what a `FormData` round trip cannot half-decode. */}
      <input type="hidden" name={names.name} value={value?.name ?? ''} />
      <input type="hidden" name={names.placeId} value={value?.placeId ?? ''} />
      <input type="hidden" name={names.lat} value={value ? String(value.lat) : ''} />
      <input type="hidden" name={names.lon} value={value ? String(value.lon) : ''} />

      <div
        className={cn(
          'flex h-[72px] w-full items-center gap-3 rounded-lg border-2 border-border bg-surface px-4 py-3 transition-colors focus-within:border-accent',
          disabled && 'opacity-50'
        )}
      >
        <button
          type="button"
          id={fieldId}
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left focus-visible:outline-none"
        >
          <span className="text-sm font-medium text-muted">{label}</span>
          <span
            className={cn(
              'w-full truncate text-base font-medium',
              value ? 'text-foreground' : 'text-muted'
            )}
          >
            {value?.name ?? placeholder}
          </span>
        </button>

        {/* Only when there is something to clear. A permanently-visible clear
            control on an empty optional field reads as a broken affordance. */}
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors active:bg-border"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        )}
      </div>

      {open && (
        <PlaceSearchSheet
          title={sheetTitle}
          placeholder={placeholder}
          onClose={() => setOpen(false)}
          onPick={(place) => {
            onChange({
              name: placeLabel(place),
              placeId: place.id,
              lat: place.lat,
              lon: place.lon,
            })
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

/**
 * What gets stored as the location's name.
 *
 * The place's own label, and the locality only when it adds something — `Shell
 * Pernis Werk` on its own is not a location a rider can place, while
 * `Utrecht, Utrecht` is a stutter. The comparison is case-insensitive because
 * Overture's `name` and `locality` disagree on capitalisation often enough to
 * matter.
 *
 * `meta` is street-and-locality joined, so the locality is its last segment.
 */
export function placeLabel(place: PlaceSearchResult): string {
  const locality = place.meta?.split(',').pop()?.trim()
  if (!locality) return place.label
  if (locality.toLowerCase() === place.label.toLowerCase()) return place.label
  return `${place.label}, ${locality}`
}

/** How long the field waits after the last keystroke before it searches. */
const DEBOUNCE_MS = 250

function PlaceSearchSheet({
  title,
  placeholder,
  onClose,
  onPick,
}: {
  title: string
  placeholder: string
  onClose: () => void
  onPick: (place: PlaceSearchResult) => void
}) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<PlaceSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The bias, resolved once when the sheet opens. Held in a ref rather than
  // state: nothing renders it, and setting state for it would re-run the
  // search effect the moment it landed.
  const bias = useRef<{ lat: number; lon: number } | null>(null)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    inputRef.current?.focus()

    let cancelled = false
    // In an effect, never during render — `resolveRiderLocation` throws by
    // design in the SSR pass, where there is no `navigator` and no session for
    // its profile fallback. See `src/lib/supabase/resolve.ts`'s header.
    resolveRiderLocation()
      .then((position) => {
        if (!cancelled && position) bias.current = { lat: position.lat, lon: position.lon }
      })
      // A missing bias is an ordinary state, not a failure: the search still
      // works, it is just nationwide. `resolveRiderLocation` already warns.
      .catch(() => {})

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelled = true
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    const trimmed = term.trim()
    // Below the minimum there is nothing to search and nothing to reset:
    // `SheetBody` reads the term itself and draws the prompt, so stale rows
    // from a longer term are never rendered. Resetting state here would be a
    // synchronous setState in an effect body — a cascading render for a value
    // no branch reads.
    if (trimmed.length < PLACE_SEARCH_MIN_CHARS) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      // Inside the timer rather than beside it, for the same reason: by the
      // time this runs the effect body has long returned, so this is an
      // ordinary async update rather than a render cascade.
      setSearching(true)
      searchPlaces(trimmed, bias.current, controller.signal)
        .then((rows) => {
          setResults(rows)
          setError(null)
        })
        .catch((cause: unknown) => {
          // A cancellation is a rider who kept typing, not a broken query —
          // `searchPlaces` rethrows it as a plain AbortError precisely so this
          // branch can tell them apart. Showing an error for one would put a
          // failure message on every fast typist's screen.
          if (cause instanceof Error && cause.name === 'AbortError') return
          setError('Places could not be searched. Check your connection.')
          setResults([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term])

  // Through a portal for the reason `ContextMenu` documents: any ancestor with
  // a transform becomes the containing block for `position: fixed`, and this
  // sheet is opened from inside forms that live under animated wrappers.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div className="flex items-center justify-between gap-4 px-4 pt-6 pb-4">
        <h2 className="truncate text-xl font-medium text-foreground">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-sm font-medium text-accent"
        >
          Cancel
        </button>
      </div>

      <div className="px-4 pb-4">
        <div className="flex h-12 items-center gap-3 rounded-lg border-2 border-border bg-surface px-4 transition-colors focus-within:border-accent">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={placeholder}
            aria-label={title}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-base font-medium text-foreground placeholder:text-muted focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <SheetBody
          term={term}
          results={results}
          searching={searching}
          error={error}
          onPick={onPick}
        />
      </div>
    </div>,
    document.body
  )
}

function SheetBody({
  term,
  results,
  searching,
  error,
  onPick,
}: {
  term: string
  results: PlaceSearchResult[] | null
  searching: boolean
  error: string | null
  onPick: (place: PlaceSearchResult) => void
}) {
  const trimmed = term.trim()

  // The prompt, not a "no results" — nothing has been searched yet. Naming the
  // minimum rather than saying "keep typing" is what stops a rider deciding the
  // field is broken after three characters.
  if (trimmed.length < PLACE_SEARCH_MIN_CHARS) {
    return (
      <p className="py-8 text-center text-sm font-medium text-muted">
        Type at least {PLACE_SEARCH_MIN_CHARS} characters to search.
      </p>
    )
  }

  if (error) {
    return <p className="py-8 text-center text-sm font-medium text-danger">{error}</p>
  }

  // `results === null` is "not yet", `[]` is "nothing matched" — the same
  // distinction `useQuery` callers draw, and conflating them shows "no places
  // found" for a moment on every search that is about to succeed.
  if (results === null) {
    return <p className="py-8 text-center text-sm font-medium text-muted">Searching…</p>
  }

  if (results.length === 0) {
    return (
      <p className="py-8 text-center text-sm font-medium text-muted">
        {searching ? 'Searching…' : 'No places match that search.'}
      </p>
    )
  }

  return (
    <ul className="flex flex-col">
      {results.map((place) => (
        <li key={place.id}>
          <button
            type="button"
            onClick={() => onPick(place)}
            className="flex w-full items-center gap-3 rounded-lg py-3 pr-2 pl-2 text-left transition-colors active:bg-surface"
          >
            <LocationOutlineIcon className="h-6 w-6 shrink-0 text-muted" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-base font-medium text-foreground">
                {place.label}
              </span>
              {place.meta && (
                <span className="truncate text-sm font-medium text-muted">{place.meta}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
