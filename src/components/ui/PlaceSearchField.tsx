'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { CloseIcon, LocationOutlineIcon, SearchIcon } from '@/components/icons/generated'
import {
  PLACE_SEARCH_CACHE_MS,
  PLACE_SEARCH_MAX_CHARS,
  PLACE_SEARCH_MIN_CHARS,
  searchPlaces,
} from '@/lib/data/places'
import { resolveRiderLocation } from '@/lib/location/rider-location'
import { getSnapshot, setQueryData } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
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
 * **Two modes, and the second is why this is a primitive.** A club's location
 * IS a place, so the field is a value button and four hidden inputs. A ride's
 * meeting point is free text *with* search on top — "the layby past the second
 * roundabout" is a real meeting point and a picker that refuses it is worse
 * than the bare field it replaced. So `freeText` swaps the button for an
 * editable input and keeps everything else. PD-114 built it here rather than
 * writing a second picker, which is what PD-259 asked for in as many words.
 *
 * **In free-text mode the text and the pick are separate props on purpose.**
 * The text is what gets stored and what a refused submit has to give back, so
 * the form owns it; the pick is this field's own output. Folding them into one
 * value would make "the rider typed over a pick" indistinguishable from "the
 * rider picked something whose label happens to differ".
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
 * **Reworded for PD-273's geocoder switch — the reason changed, not the
 * requirement.** `search_places()`'s cost used to be a query plan against a
 * shared database; every keystroke now costs a credit against a shared,
 * metered daily vendor quota (`search-places/shape.ts`), which is a stronger
 * argument for debouncing rather than a weaker one — see
 * `PLACE_SEARCH_MIN_CHARS`'s own doc block in `lib/data/places.ts`.
 *
 * The in-flight request is aborted per keystroke for the reason `searchPlaces`
 * threads a signal at all — out-of-order results would otherwise flicker the
 * list back to an older term's answers — and a generation counter in
 * `PlaceSearchSheet` backs that up rather than relying on abort timing alone,
 * because an aborted fetch can still resolve before the browser tears it
 * down. Aborting still does not save the credit: `069`'s ledger row is
 * written before the vendor is even called, so cancelling client-side is
 * purely a flicker fix, never a spend control (`place-search`'s own
 * "Abort SHALL survive" names this explicitly).
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
  maxNameLength,
  disabled,
  freeText,
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
  /**
   * The column's own length bound, so what this writes can always be stored.
   *
   * **The bound is the column's, and the distribution behind it is gone.** It
   * was set from the retired index — `search_places()` returned `places.name`
   * verbatim, longest row 203 characters, 214 with a locality appended, over
   * 200 on exactly one row of 736,538 — and `070` dropped that table, so no
   * measurement stands behind the number now. The vendor's label is a
   * `name` -> `address_line1` -> `formatted` chain (`search-places/shape.ts`),
   * and `formatted` is a whole address on one line, so it is likelier to run
   * long than anything the index held. The CHECK is what makes this safe
   * regardless: this truncates to what the column accepts. A picker that can return a value its own
   * table's CHECK refuses is a dead end a rider cannot escape: the field owns
   * the value, so there is nothing for them to shorten.
   *
   * Omitted means no bound, which is only correct for a caller whose column
   * has none.
   */
  maxNameLength?: number
  disabled?: boolean
  /**
   * Present for a field whose value may be typed rather than picked — a ride's
   * meeting point. Absent for a field that is a place or nothing, like a club's
   * location.
   *
   * The caller holds the text because the caller has to put it back after a
   * refused submit; see `RIDE_FIELDS` and PD-199, which is the defect shape
   * this arrangement avoids.
   */
  freeText?: {
    text: string
    onTextChange: (text: string) => void
    /** `meeting_point` is `NOT NULL`, so a ride's field is required. */
    required?: boolean
  }
}) {
  const [open, setOpen] = useState(false)
  const fieldId = useId()

  return (
    <div className="flex w-full flex-col gap-1.5">
      {/* The value travels as named fields rather than as JSON in one: the
          action parses them with `readClubLocation`/`readRideLocation`, and
          named strings are what a `FormData` round trip cannot half-decode.

          `names.name` is hidden in place mode and the rider's own editable
          input in free-text mode — the other three are hidden in both. */}
      {!freeText && <input type="hidden" name={names.name} value={value?.name ?? ''} />}
      <input type="hidden" name={names.placeId} value={value?.placeId ?? ''} />
      <input type="hidden" name={names.lat} value={value ? String(value.lat) : ''} />
      <input type="hidden" name={names.lon} value={value ? String(value.lon) : ''} />

      <div
        className={cn(
          'flex h-[72px] w-full items-center gap-3 rounded-lg border-2 border-border bg-surface px-4 py-3 transition-colors focus-within:border-accent',
          disabled && 'opacity-50'
        )}
      >
        {freeText ? (
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <label htmlFor={fieldId} className="text-sm font-medium text-muted">
              {label}
            </label>
            <input
              id={fieldId}
              type="text"
              name={names.name}
              value={freeText.text}
              /* Typing throws the pin away — product owner, 2026-08-18. The
                 database would accept text and pin disagreeing; the screen
                 must never show a pin the write will not store. */
              onChange={(event) => {
                freeText.onTextChange(event.target.value)
                if (value) onChange(null)
              }}
              placeholder={placeholder}
              maxLength={maxNameLength}
              required={freeText.required}
              disabled={disabled}
              autoComplete="off"
              className="w-full min-w-0 bg-transparent text-base font-medium text-foreground placeholder:text-muted focus:outline-none"
            />
          </div>
        ) : (
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
        )}

        {/* Free-text mode needs its own way into the sheet, because the field
            itself is now a text input the rider is typing in. */}
        {freeText && !disabled && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Search for a place for ${label.toLowerCase()}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors active:bg-border"
          >
            <SearchIcon className="h-5 w-5" />
          </button>
        )}

        {/* Only when there is something to clear. A permanently-visible clear
            control on an empty optional field reads as a broken affordance.
            In free-text mode there is something to clear as soon as the rider
            has typed, pick or no pick. */}
        {(freeText ? freeText.text.length > 0 : value !== null) && !disabled && (
          <button
            type="button"
            onClick={() => {
              onChange(null)
              freeText?.onTextChange('')
            }}
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
            const name = boundName(placeLabel(place), maxNameLength)
            onChange({ name, placeId: place.id, lat: place.lat, lon: place.lon })
            // In free-text mode the visible field is the rider's own input, so
            // a pick has to write through to it — otherwise the pin is stored
            // and the text still says whatever they had typed.
            freeText?.onTextChange(name)
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

/**
 * Cuts an over-long place name to what the caller's column will take, ending it
 * with an ellipsis so the rider can see it was shortened.
 *
 * The ellipsis is inside the budget rather than added to it — a truncation that
 * overshoots the bound by one character is the bug this function exists to
 * prevent, arriving by a different door.
 */
export function boundName(name: string, max?: number): string {
  if (max === undefined || name.length <= max) return name
  return `${name.slice(0, max - 1).trimEnd()}\u2026`
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
  // The thrown error itself rather than a re-derived message — `searchPlaces`
  // already carries the rider-facing copy on `.message` (`PlaceSearchCeilingError`,
  // `PlaceSearchUnavailableError`, `PlaceSearchOfflineError` in `lib/data/places.ts`),
  // so this is the one place that copy is written rather than the second.
  const [failure, setFailure] = useState<Error | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The bias, resolved once when the sheet opens. Held in a ref rather than
  // state: nothing renders it, and setting state for it would re-run the
  // search effect the moment it landed.
  const bias = useRef<{ lat: number; lon: number } | null>(null)

  // Which invocation of `execute` is the current one — a rider who keeps
  // typing (or taps Retry) must never have an OLDER attempt's late response
  // land over a NEWER one's, whichever settles first. Stronger than relying
  // on abort timing alone: an aborted fetch can still resolve before the
  // browser tears it down, and this generation check is what actually decides
  // whether that resolution is allowed to touch state — the same pattern
  // `lib/query/queryClient.ts` uses for the same reason.
  const generationRef = useRef(0)
  // The controller backing whichever attempt is current, so a later one
  // (debounced or retried) can cancel an earlier in-flight request rather
  // than merely outracing it.
  const controllerRef = useRef<AbortController | null>(null)

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

  /**
   * The one place a search actually runs — reached from the debounce effect
   * below AND from the Retry tap, which is why it is pulled out rather than
   * living inline in the timer the way the RPC-backed version had it: a
   * retry is `place-search`'s own requirement ("A retry costs a credit and
   * says so by requiring a tap ... an automatic retry SHALL NOT be armed on
   * a timer"), and it must run the identical cache-check-then-fetch path a
   * debounced search does rather than a hand-rolled second copy.
   *
   * **Checks the shared query cache FIRST** — `queryKeys.places.search`'s first
   * caller (`client-cache-invalidation`'s "a read that costs money SHALL be
   * cached"). A hit answers with no round trip, no metering row and no
   * vendor call, exactly the way `PLACE_SEARCH_CACHE_MS`'s own doc block
   * describes. Only a genuine result set is ever written back — a failure is
   * never cached, so a retry after one is never served a stale refusal.
   */
  const execute = useCallback((trimmedTerm: string, controller: AbortController) => {
    const generation = ++generationRef.current

    const cacheKey = queryKeys.places.search(trimmedTerm, bias.current)
    const cached = getSnapshot<PlaceSearchResult[]>(cacheKey)
    if (cached.data !== undefined && Date.now() - cached.updatedAt < PLACE_SEARCH_CACHE_MS) {
      setFailure(null)
      setResults(cached.data)
      return
    }

    setFailure(null)
    setSearching(true)
    searchPlaces(trimmedTerm, bias.current, controller.signal)
      .then((rows) => {
        if (generationRef.current !== generation) return
        setQueryData(cacheKey, rows)
        setResults(rows)
      })
      .catch((cause: unknown) => {
        // A cancellation is a rider who kept typing, not a broken query —
        // `searchPlaces` rethrows it as a plain AbortError precisely so this
        // branch can tell them apart. Showing a failure for one would put a
        // message on every fast typist's screen.
        if (cause instanceof Error && cause.name === 'AbortError') return
        if (generationRef.current !== generation) return
        setFailure(cause instanceof Error ? cause : new Error('Places could not be searched.'))
        setResults([])
      })
      // Unconditionally, including on an abort — gating on `!signal.aborted`
      // left this stuck true whenever a rider deleted back below the minimum
      // mid-request, since nothing else would ever clear it. Scoped to this
      // attempt's own generation so an old attempt's `finally` cannot clear
      // the flag a newer, still-running one just set.
      .finally(() => {
        if (generationRef.current === generation) setSearching(false)
      })
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
    controllerRef.current = controller
    const timer = setTimeout(() => execute(trimmed, controller), DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term, execute])

  /** The explicit tap `place-search`'s spec requires — never armed on a
   *  timer, never fired automatically. Re-runs the CURRENT term immediately,
   *  bypassing the debounce, because a rider who tapped Retry has already
   *  waited. */
  const retry = () => {
    const trimmed = term.trim()
    if (trimmed.length < PLACE_SEARCH_MIN_CHARS) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    execute(trimmed, controller)
  }

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
        {/* `text-foreground`, not the frame's accent. `accent` on `background`
            computes to 3.00:1 against a 4.5:1 bar at this size, and that exact
            pairing is already logged in `docs/FIGMA-FIDELITY-TODO.md` as an
            unresolved designer question with four instances — adding a fifth
            and waiting is worse than deviating on one text button. Recorded
            there rather than only here. */}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-sm font-medium text-foreground"
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
            // `place-search`'s own requirement: a pasted essay is bounded
            // before it is sent. Native `maxLength` truncates a paste as well
            // as typing, so this is what `PLACE_SEARCH_MAX_CHARS` actually
            // enforces client-side — the proxy bounds it again regardless,
            // because this UI is not the only caller.
            maxLength={PLACE_SEARCH_MAX_CHARS}
            className="min-w-0 flex-1 bg-transparent text-base font-medium text-foreground placeholder:text-muted focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <SheetBody
          term={term}
          results={results}
          searching={searching}
          failure={failure}
          onPick={onPick}
          onRetry={retry}
        />
      </div>

      <PlaceDataCredit />
    </div>,
    document.body
  )
}

/**
 * The place-data credit, paid ONCE and rendered here rather than per result.
 *
 * **Names Geoapify and OpenStreetMap, not Overture** — PD-273's geocoder
 * switch. Every result the proxy returns carries `datasource.attribution: "©
 * OpenStreetMap contributors"` (measured live,
 * `openspec/changes/replace-places-index-with-geocoder/tasks.md` task 0.3),
 * and that credit is unconditional, unlike a map tile's burned-in one — a
 * list of results carries no credit of its own, so this line is the whole
 * obligation for the surface that renders them.
 *
 * On the shared control, so clubs are credited by the same link.
 *
 * **Its own component so it can be tested.** The sheet renders through a
 * portal and needs an event loop; this does not, so `renderToStaticMarkup`
 * reaches it in the repo's `node` test environment.
 */
export function PlaceDataCredit() {
  return (
    <p className="shrink-0 px-4 pt-2 pb-8 text-center text-sm font-medium text-muted">
      {/* `next/link`, not a bare anchor. The sheet opens on TOP of a
          create-ride or create-club form, so a document navigation would
          reload the bundle and take everything typed with it — the pick
          included. In the Capacitor shell it is a hard reload of the app. */}
      Place data from Geoapify and{' '}
      <Link href="/legal/attributions" className="underline">
        OpenStreetMap
      </Link>
    </p>
  )
}

function SheetBody({
  term,
  results,
  searching,
  failure,
  onPick,
  onRetry,
}: {
  term: string
  results: PlaceSearchResult[] | null
  searching: boolean
  /** The thrown error itself — see the field's own state comment for why the
   *  message lives on it rather than being re-derived here. */
  failure: Error | null
  onPick: (place: PlaceSearchResult) => void
  onRetry: () => void
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

  // The seven states `place-search`'s spec requires the surface to tell
  // apart, minus "below the minimum" (handled above) and "searching" (below):
  // a `PlaceSearchCeilingError` reads as one of two DISTINCT messages
  // depending on `.scope` — "wait" means an hour under one and until
  // tomorrow under the other — a `PlaceSearchOfflineError` names the device
  // rather than the surface, and everything else (`PlaceSearchUnavailableError`
  // included) gets the one retry affordance the spec requires: an explicit
  // tap, never armed on a timer. **The application-wide ceiling reads as
  // unavailable and lands here too** — reached by elimination in
  // `readCeilingScope` rather than by anything the refusal itself says, since
  // `069`'s three conjuncts all raise the same code. It is deliberately not
  // the rider's own fault, and the retry button is the affordance that says so.
  if (failure) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        {/* `danger-strong`, not `danger`. Measured against this sheet's own
            `bg-background` (#F2ECE6): `--color-danger` #D92140 is 4.22:1 and
            `--color-danger-strong` #99001A is 7.56:1. At `text-sm`/500 this is
            not large text, so the bar is 4.5:1 and the lighter token fails it.
            The pairing predates this change on one state; four of the seven
            render through here now, which is what made it worth fixing rather
            than inheriting. */}
        <p className="text-center text-sm font-medium text-danger-strong">{failure.message}</p>
        {failure.name === 'PlaceSearchUnavailableError' && (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    )
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
        {searching ? 'Searching…' : 'No places match that search. Try fewer words, or type it in.'}
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
