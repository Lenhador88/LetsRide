'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { ClockIcon, CloseIcon, LocationOutlineIcon, SearchIcon } from '@/components/icons/generated'
import {
  PLACE_SEARCH_CACHE_MS,
  PLACE_SEARCH_MAX_CHARS,
  PLACE_SEARCH_MIN_CHARS,
  searchPlaces,
} from '@/lib/data/places'
import { resolveRiderLocation } from '@/lib/location/rider-location'
import { getSnapshot, setQueryData, useQuery, type QueryKey } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { cn } from '@/lib/utils'
import type { PlaceSearchResult } from '@/types'

/**
 * A place, as a form field: an input the rider types in, and a suggestion list
 * that opens under it.
 *
 * ## Where this lives, and why it is a `ui/` primitive rather than a club part
 *
 * PD-259 (a club's location) and PD-114 (a ride's meeting point) want the same
 * control, and PD-259 says so explicitly: *"whichever lands first builds it;
 * the second should find it in `src/components/ui/`, not write a second one."*
 * So this knows nothing about clubs or rides — it takes a value, returns a
 * value, and writes four hidden inputs the caller names.
 *
 * ## One shape, and no second screen — PD-274
 *
 * The lookup used to be a full-screen sheet with its own search box, opened
 * from the field. The product owner's call, 2026-08-19, is that the
 * suggestions belong on the field itself: *"moving the autocomplete to the
 * first input, so we could exclude the location search screen."* So there is
 * one input, and the list opens beneath it.
 *
 * That collapsed the two shapes this control used to have. A club's location
 * was a value *button*; it is an input now too, and §D5 of the change is what
 * keeps that safe — **the club input carries no `name`**, so typed-but-unpicked
 * text is a search term and never a stored location, and it reverts on blur so
 * the rider is never shown a location a submit would not store.
 *
 * **The two modes that remain are about what the text MEANS**, not about how
 * it is drawn:
 *
 * - `freeText` (a ride's meeting point) — the visible input **is**
 *   `meeting_point`. "The layby past the second roundabout" is a real meeting
 *   point and a picker that refuses it is worse than the bare field it
 *   replaced, so search is an accelerator and never a gate. Typing throws the
 *   pin away (product owner, 2026-08-18): the database would accept text and
 *   pin disagreeing, and the screen must never show a pin the write will not
 *   store.
 * - place mode (a club's location) — the visible input is a search box, the
 *   pick is the value, and typing changes neither until the rider picks.
 *
 * **In free-text mode the text and the pick are separate props on purpose.**
 * The text is what gets stored and what a refused submit has to give back, so
 * the form owns it; the pick is this field's own output. Folding them into one
 * value would make "the rider typed over a pick" indistinguishable from "the
 * rider picked something whose label happens to differ".
 *
 * ## The design, and what is deliberately not taken from it
 *
 * `Rides / Add starting location - Filled` (`1918:15967`) draws the retired
 * sheet — a full-screen surface with a header, a Cancel and 72px result rows.
 * Its *result row* is what survives here (a pin, a Label and a Meta line); its
 * surface does not, by the decision above. Its styling is v1
 * (`Grey (OLD)/*`, epic To do), so v2 primitives are applied as
 * `CreateClubForm` and `CreateRideForm` did rather than transcribing OLD
 * tokens — decision #4.
 *
 * **The frame's inline ghost-text autocomplete is still not built**, and moving
 * the list onto the field is exactly when it would get built by accident. It is
 * the one element that cannot degrade — a half-working completion rewrites what
 * the rider typed.
 *
 * ## Debounce, abort, and the reason both are required rather than polite
 *
 * Every keystroke that settles costs a credit against a shared, metered daily
 * vendor quota (`search-places/shape.ts`), and `069`'s ledger row is written
 * before the vendor is even called — so aborting is a flicker fix and never a
 * spend control (`place-search`'s "Abort SHALL survive" names this).
 *
 * **The debounce carries more weight since PD-274 than it did behind the
 * sheet.** The rider used to type into a search box they had deliberately
 * opened; in free-text mode they are now typing a *meeting point* into the
 * same input, so a long typed answer that was never meant as a search settles
 * several times on its way through. That is why `DEBOUNCE_MS` is 400 here and
 * not the sheet's 250, and why the per-rider hourly ceiling (`069`: 20/hour)
 * is worth watching now that a rider can spend it without ever wanting a
 * lookup.
 *
 * The in-flight request is aborted per keystroke because out-of-order results
 * would otherwise flicker the list back to an older term's answers, and a
 * generation counter backs that up rather than relying on abort timing alone:
 * an aborted fetch can still resolve before the browser tears it down.
 *
 * ## The bias, and why this asks for it rather than taking it as a prop
 *
 * `resolveRiderLocation()` is memoised with a TTL and never prompts, so asking
 * for it here costs nothing after the first call and cannot fire an OS
 * permission dialog because somebody focused a field. Passing it in would make
 * every caller remember to, and a caller that forgot would get the nationwide
 * search path with nothing visibly wrong.
 *
 * **Resolved on the field's FIRST FOCUS, not on mount** — the sheet resolved it
 * when it opened, and focus is the equivalent moment now that there is no
 * sheet. A form carrying this field must not locate a rider who never touches
 * it, and resolving on mount would do exactly that on every create-ride screen.
 */
export type PlaceValue = {
  name: string
  placeId: string
  lat: number
  lon: number
}

/** How long the field waits after the last keystroke before it searches. */
const DEBOUNCE_MS = 400

/** A field that offers no recents still has to call the hook, and `useQuery`
 *  is disabled with a null key, so this is never invoked. */
const noRecents = () => Promise.resolve<PlaceValue[]>([])

/** How many rows the list shows before it scrolls inside itself. */
const VISIBLE_ROWS = 4

export function PlaceSearchField({
  label,
  placeholder = 'Search for a town or place',
  value,
  onChange,
  names,
  maxNameLength,
  disabled,
  freeText,
  recents,
}: {
  /** The field's own label, e.g. `Location`. */
  label: string
  placeholder?: string
  value: PlaceValue | null
  onChange: (value: PlaceValue | null) => void
  /**
   * What the four hidden inputs are called, so the caller's action reads them
   * back off `FormData` under its own column names. Never defaulted: two
   * different tables want this control and a shared default would silently
   * write a club's column names onto a ride.
   *
   * **Omitted means the field writes NO form fields at all** — it is a
   * controlled input whose only output is `onChange`, and the caller submits
   * whatever it decides the pick means. The postcard composer is the first such
   * caller and the reason this became optional: there, a picked town is only
   * one of three things the location control can mean, and which one is decided
   * by a button beneath this field. Hidden inputs carrying the town regardless
   * would submit it under `Hide` — the one state whose whole promise is that
   * nothing is sent.
   */
  names?: { name: string; placeId: string; lat: string; lon: string }
  /**
   * The column's own length bound, so what this writes can always be stored.
   *
   * The vendor's label is a `name` -> `address_line1` -> `formatted` chain
   * (`search-places/shape.ts`), and `formatted` is a whole address on one line,
   * so it is likelier to run long than anything the retired index held. The
   * CHECK is what makes this safe regardless: this truncates to what the column
   * accepts. A picker that can return a value its own table's CHECK refuses is
   * a dead end a rider cannot escape — the field owns the value, so there is
   * nothing for them to shorten.
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
  /**
   * The rider's own recent picks, offered the moment the field is focused with
   * an empty input — PD-274.
   *
   * **The loader is the caller's, so this stays ignorant of what it is a field
   * for.** The ride forms pass `getRecentRideStarts`; a club field passes
   * nothing, because a club's location is a town, a rider creates roughly one
   * club, and "recent club locations" has no content.
   *
   * Read through `cacheKey` so a second focus, a second field and a second
   * screen share one answer, and so the mutations that can change it already
   * move it: `createRide`/`updateRide`/`deleteRide` invalidate the `['rides']`
   * prefix, which `queryKeys.rides.recentStarts()` sits under.
   */
  recents?: {
    load: () => Promise<PlaceValue[]>
    cacheKey: QueryKey
    /** e.g. `Recent starts`. Rendered above the rows so the two lists cannot
     *  be mistaken for one. */
    heading: string
  }
}) {
  const fieldId = useId()
  const listId = `${fieldId}-list`

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  // Whether this field has ever had focus — what gates the recents read.
  const [touched, setTouched] = useState(false)
  // **What the lookup searches, and it is NOT the field's text.** Both edit
  // forms seed their text at mount — `EditRideForm` from `meeting_point`,
  // which is `NOT NULL`, and `EditClubForm` from a stored location — so a
  // lookup keyed on the text would call a metered vendor 400ms after the edit
  // screen renders, for a rider who has touched nothing. `069`'s ledger row is
  // written before the vendor call, so that spends a credit against a 20/hour
  // ceiling per screen open and cannot be taken back by aborting.
  //
  // Set by typing and cleared by everything that ends a search — a pick, a
  // clear, a blur. That also stops a pick from searching for its own name,
  // which the sheet got for free by unmounting.
  const [searchTerm, setSearchTerm] = useState('')

  // Place mode's visible text is a *search term* and is never submitted (§D5),
  // so this holds it — but only while the rider is actually typing one. `null`
  // means "no draft", and the input falls back to the pick.
  //
  // **A draft rather than a synced copy, and that is what makes the revert
  // free.** Dropping the draft on blur, on a pick and on a clear IS the revert;
  // an edit form seeding its location after its own read lands needs no effect
  // to push into, because with no draft the input already reads through to
  // `value`. The copy-and-sync version of this is where a stale club location
  // gets shown, and worse, submitted.
  const [draft, setDraft] = useState<string | null>(null)
  const text = freeText ? freeText.text : (draft ?? value?.name ?? '')
  const setText = freeText ? freeText.onTextChange : setDraft

  const { results, searching, failure, retry } = usePlaceLookup(searchTerm)
  // Read through the key `recents` names, and only once the rider has actually
  // touched the field: a form carrying this must not read a rider's history
  // because it rendered. `useQuery` rather than a hand-rolled fetch, so the
  // read is the cache's — which is what `createRide`/`updateRide`/`deleteRide`
  // already invalidate — and a failure is `undefined`, i.e. no recents, never
  // an error on screen for a convenience nobody asked for.
  const recentPicks =
    useQuery<PlaceValue[]>(recents?.cacheKey ?? null, recents?.load ?? noRecents, {
      enabled: touched && !!recents,
    }).data ?? []

  // Recents are shown on an EMPTY input and nothing else — which is the
  // owner's rule ("the results go away as soon as the user starts typing")
  // stated on the input's VALUE rather than on a keystroke, so a paste, a cut,
  // an undo and the field's own Clear button all obey it too. They are never
  // filtered by the term and never merged with results.
  const showRecents = text.trim().length === 0 && recentPicks.length > 0
  const options: SuggestionOption[] = showRecents
    ? recentPicks.map((pick) => ({ value: pick, label: pick.name, meta: null, recent: true }))
    : text.trim().length < PLACE_SEARCH_MIN_CHARS
      ? []
      : (results ?? []).map((place) => ({
          value: toPlaceValue(place, maxNameLength),
          label: place.label,
          meta: place.meta,
          recent: false,
        }))

  const inputRef = useRef<HTMLInputElement>(null)

  function pick(next: PlaceValue) {
    onChange(next)
    // In free-text mode the visible field is the rider's own input, so a pick
    // has to write through to it — otherwise the pin is stored and the text
    // still says whatever they had typed. In place mode the draft is dropped
    // and the input reads the new pick.
    if (freeText) freeText.onTextChange(next.name)
    else setDraft(null)
    setSearchTerm('')
    setOpen(false)
    setActiveIndex(-1)
  }

  /** The one way a rider removes a place, as opposed to typing over one: it
   *  drops the pick in both modes. Typing does that only in free-text mode,
   *  where the text IS the stored value. */
  function clear() {
    onChange(null)
    if (freeText) freeText.onTextChange('')
    else setDraft(null)
    setSearchTerm('')
    setActiveIndex(-1)
    // Clearing is how a rider gets back to their recents — `place-search`
    // names this control by name — so focus stays here and the list stays
    // open. Without it the tap blurs the input, the keyboard drops, and the
    // rider has to tap the field again to see the list they were reaching for.
    inputRef.current?.focus()
    setOpen(true)
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      {/* The value travels as named fields rather than as JSON in one: the
          action parses them with `readClubLocation`/`readRideLocation`, and
          named strings are what a `FormData` round trip cannot half-decode.
          A caller passing no `names` submits nothing from here at all — see
          the prop's own note.

          `names.name` is the rider's own editable input in free-text mode and
          hidden in place mode — the other three are hidden in both. In place
          mode the VISIBLE input carries no `name` at all, so a typed-but-
          unpicked club location cannot be submitted (§D5). */}
      {names && (
        <>
          {!freeText && <input type="hidden" name={names.name} value={value?.name ?? ''} />}
          <input type="hidden" name={names.placeId} value={value?.placeId ?? ''} />
          <input type="hidden" name={names.lat} value={value ? String(value.lat) : ''} />
          <input type="hidden" name={names.lon} value={value ? String(value.lon) : ''} />
        </>
      )}

      <div
        className={cn(
          'flex h-[72px] w-full items-center gap-3 rounded-lg border-2 border-border bg-surface px-4 py-3 transition-colors focus-within:border-accent',
          disabled && 'opacity-50'
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <label htmlFor={fieldId} className="text-sm font-medium text-muted">
            {label}
          </label>
          <input
            ref={inputRef}
            id={fieldId}
            /* `type="text"`, not `type="search"`: a search input renders a
               native clear affordance that duplicates this field's own. */
            type="text"
            /* Place mode's input is a search box and is deliberately nameless
               — see the hidden-input comment above. In free-text mode this IS
               the stored field, so a caller wanting free text and passing no
               `names` would submit nothing at all; `?.` keeps that from being a
               crash, and nothing in the app does it. */
            name={freeText ? names?.name : undefined}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setSearchTerm(event.target.value)
              setActiveIndex(-1)
              setOpen(true)
              // Typing throws the pin away in free-text mode ONLY, because
              // there the text is the stored value and a pin disagreeing with
              // it is a lie. In place mode the text is a search term: the pick
              // stands until another is chosen, which is what lets the input
              // revert to it on blur.
              if (freeText && value) onChange(null)
            }}
            onFocus={(event) => {
              setTouched(true)
              setOpen(true)
              // So the input and the first rows clear a raised keyboard. The
              // list renders in flow beneath the field, so the page's own
              // scroll container is what has to move.
              event.currentTarget.scrollIntoView({ block: 'nearest' })
            }}
            onBlur={() => {
              setOpen(false)
              setActiveIndex(-1)
              // A debounce still pending when the rider leaves would spend a
              // credit on a list nobody is looking at. The results already
              // fetched survive, so coming back to the same text costs
              // nothing.
              setSearchTerm('')
              // Place mode: what is on screen must be what a submit would
              // store, so an unpicked draft is dropped and the input goes back
              // to the pick — or to empty when there is none.
              if (!freeText) setDraft(null)
            }}
            onKeyDown={(event) => {
              const action = resolveComboboxKey(event.key, {
                open,
                optionCount: options.length,
                activeIndex,
              })
              if (action.type === 'none') {
                // A submit from inside the focused field never blurs, so the
                // blur revert below never runs — and place mode would submit
                // with the input showing text the hidden fields do not carry.
                // No `preventDefault`: the form still submits, it just stops
                // lying about what it is submitting first.
                if (event.key === 'Enter' && !freeText) {
                  setDraft(null)
                  setOpen(false)
                }
                return
              }
              // Only ever on a key this control actually handles: an
              // unconditional preventDefault here would stop Enter submitting
              // the form at all.
              event.preventDefault()
              if (action.type === 'open') setOpen(true)
              if (action.type === 'move') {
                setOpen(true)
                setActiveIndex(wrapIndex(activeIndex, action.delta, options.length))
              }
              if (action.type === 'select') pick(options[activeIndex].value)
              // Closes only: it does not clear the input, drop the pick, or
              // submit anything.
              if (action.type === 'close') {
                setOpen(false)
                setActiveIndex(-1)
              }
            }}
            placeholder={placeholder}
            /* The stored column's bound in free-text mode. In place mode the
               text is a search term, so it takes the term's bound instead —
               `place-search`'s "a pasted essay is bounded before it is sent",
               enforced natively so a paste is cut too. */
            maxLength={freeText ? maxNameLength : PLACE_SEARCH_MAX_CHARS}
            required={freeText?.required}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            className="w-full min-w-0 bg-transparent text-base font-medium text-foreground placeholder:text-muted focus:outline-none"
          />
        </div>

        {/* Only when there is something to clear. A permanently-visible clear
            control on an empty optional field reads as a broken affordance. */}
        {(text.length > 0 || value !== null) && !disabled ? (
          <button
            type="button"
            onClick={clear}
            /* Same reason the panel does it: without this the tap blurs the
               input before the click lands, and `clear` would be refocusing a
               field the rider has just been thrown out of. */
            onMouseDown={(event) => event.preventDefault()}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors active:bg-border"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        ) : (
          <SearchIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        )}
      </div>

      {/* Open is not enough: a prefilled edit form focused and not typed into
          has no recents (the input is not empty), no results (nothing has been
          searched) and nothing to say — so it shows no panel at all rather
          than a hint that contradicts the text sitting above it. */}
      {open && !disabled && (options.length > 0 || searchTerm.length > 0 || text.trim().length === 0) && (
        <div
          className="overflow-y-auto rounded-lg border-2 border-border bg-surface"
          style={{ maxHeight: `${VISIBLE_ROWS * 72}px` }}
          /* On the WHOLE panel rather than on the rows (§D6). A row handler
             would save a tap on a row and lose the two controls that are not
             rows — the attribution link and the Retry button — because the
             tap aimed at them would blur the input and unmount the list
             first. A credit nobody can tap is not a credit. */
          onMouseDown={(event) => event.preventDefault()}
        >
          <ListBody
            term={searchTerm}
            listId={listId}
            options={options}
            heading={showRecents ? recents?.heading : undefined}
            results={results}
            searching={searching}
            failure={failure}
            activeIndex={activeIndex}
            onPick={pick}
            onRetry={retry}
          />
        </div>
      )}
    </div>
  )
}

/**
 * What a key press means, as a pure function — the same split
 * `src/lib/auth/guard.ts` makes for the same reason. The wiring around it
 * needs a layout and an event loop, which this repo's `node` test environment
 * has not got; the *decision* is what carries the two rules that would
 * otherwise have no gate at all:
 *
 * - **Enter with an active option selects, and must not submit the form.**
 *   Without it a rider picking a suggestion on `CreateRideForm` submits a
 *   half-filled ride and blames the field. Enter with NO active option is
 *   `none`, deliberately — the form submits exactly as it would with no list.
 * - **Escape closes the list only.** It does not clear the input, drop the
 *   pick, or reach anything that would submit or navigate.
 */
export type ComboboxKeyAction =
  | { type: 'none' }
  | { type: 'open' }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'select' }
  | { type: 'close' }

export function resolveComboboxKey(
  key: string,
  state: { open: boolean; optionCount: number; activeIndex: number }
): ComboboxKeyAction {
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
export function wrapIndex(activeIndex: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1
  if (activeIndex < 0) return delta === 1 ? 0 : count - 1
  return (activeIndex + delta + count) % count
}

/**
 * The lookup: debounce, abort, generation guard and the shared cache — moved
 * off the deleted sheet unchanged, because none of it is a property of the
 * surface.
 */
function usePlaceLookup(term: string) {
  const [results, setResults] = useState<PlaceSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  // The thrown error itself rather than a re-derived message — `searchPlaces`
  // already carries the rider-facing copy on `.message`
  // (`PlaceSearchCeilingError`, `PlaceSearchUnavailableError`,
  // `PlaceSearchOfflineError` in `lib/data/places.ts`), so this is the one
  // place that copy is written rather than the second.
  const [failure, setFailure] = useState<Error | null>(null)

  // The bias, resolved once on the field's first focus. Held in a ref rather
  // than state: nothing renders it, and setting state for it would re-run the
  // search effect the moment it landed.
  const bias = useRef<{ lat: number; lon: number } | null>(null)
  const biasAsked = useRef(false)

  // Which invocation of `execute` is the current one — a rider who keeps
  // typing (or taps Retry) must never have an OLDER attempt's late response
  // land over a NEWER one's, whichever settles first. Stronger than relying on
  // abort timing alone: an aborted fetch can still resolve before the browser
  // tears it down, and this generation check is what actually decides whether
  // that resolution may touch state — the same pattern
  // `lib/query/queryClient.ts` uses for the same reason.
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (term.length === 0 || biasAsked.current) return
    biasAsked.current = true

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

    return () => {
      cancelled = true
    }
  }, [term])

  /**
   * The one place a search actually runs — reached from the debounce effect
   * below AND from the Retry tap, which is why it is pulled out: a retry is
   * `place-search`'s own requirement ("A retry costs a credit and says so by
   * requiring a tap ... an automatic retry SHALL NOT be armed on a timer"),
   * and it must run the identical cache-check-then-fetch path a debounced
   * search does rather than a hand-rolled second copy.
   *
   * **Checks the shared query cache FIRST** — `queryKeys.places.search`'s first
   * caller (`client-cache-invalidation`'s "a read that costs money SHALL be
   * cached"). A hit answers with no round trip, no metering row and no vendor
   * call. Only a genuine result set is ever written back — a failure is never
   * cached, so a retry after one is never served a stale refusal.
   */
  const execute = useCallback((trimmedTerm: string, controller: AbortController) => {
    const generation = ++generationRef.current

    const cacheKey = queryKeys.places.search(trimmedTerm, bias.current)
    const cached = getSnapshot<PlaceSearchResult[]>(cacheKey)
    if (cached.data !== undefined && Date.now() - cached.updatedAt < PLACE_SEARCH_CACHE_MS) {
      setFailure(null)
      setResults(cached.data)
      // A superseded attempt's `finally` is scoped to its own generation and
      // this one never sets the flag, so without this the list reads
      // "Searching…" for ever whenever a cache hit lands over an in-flight
      // request and the next real answer is empty. Carried over from the
      // sheet, where it behaved the same way.
      setSearching(false)
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
      // attempt's own generation so an old attempt's `finally` cannot clear a
      // newer, still-running one's flag.
      .finally(() => {
        if (generationRef.current === generation) setSearching(false)
      })
  }, [])

  useEffect(() => {
    const trimmed = term.trim()
    // Below the minimum there is nothing to search and nothing to reset:
    // `ListBody` reads the term itself and draws the prompt, so stale rows from
    // a longer term are never rendered. Resetting state here would be a
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

  /** The explicit tap `place-search`'s spec requires — never armed on a timer,
   *  never fired automatically. Re-runs the CURRENT term immediately, bypassing
   *  the debounce, because a rider who tapped Retry has already waited. */
  const retry = useCallback(() => {
    const trimmed = term.trim()
    if (trimmed.length < PLACE_SEARCH_MIN_CHARS) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    execute(trimmed, controller)
  }, [term, execute])

  return { results, searching, failure, retry }
}

/**
 * What gets stored as the location's name.
 *
 * The place's own label, and the locality only when it adds something — `Shell
 * Pernis Werk` on its own is not a location a rider can place, while
 * `Utrecht, Utrecht` is a stutter. The comparison is case-insensitive because
 * the vendor's `name` and locality disagree on capitalisation often enough to
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
  return `${name.slice(0, max - 1).trimEnd()}…`
}

/**
 * The place-data credit, paid ONCE for the whole list rather than per result.
 *
 * **Names Geoapify and OpenStreetMap** — PD-273's geocoder switch. Every result
 * the proxy returns carries `datasource.attribution: "© OpenStreetMap
 * contributors"`, and that credit is unconditional, unlike a map tile's
 * burned-in one — a list of results carries no credit of its own, so this line
 * is the whole obligation for the surface that renders them.
 *
 * **It renders whenever the list has ROWS, recents included** — a recent's
 * label is provider-derived text this app stored verbatim, so it is credited on
 * the same terms it was when the rider first saw it. A list showing only a
 * message renders no provider content and no credit.
 *
 * On the shared control, so clubs are credited by the same link.
 *
 * **Its own component so it can be tested** with `renderToStaticMarkup` in the
 * repo's `node` test environment.
 */
export function PlaceDataCredit() {
  return (
    <p className="px-4 pt-2 pb-3 text-center text-sm font-medium text-muted">
      {/* `next/link`, not a bare anchor. The list sits on top of a create-ride
          or create-club form, so a document navigation would reload the bundle
          and take everything typed with it — the pick included. In the
          Capacitor shell it is a hard reload of the app. */}
      Place data from Geoapify and{' '}
      <Link href="/legal/attributions" className="underline">
        OpenStreetMap
      </Link>
    </p>
  )
}

/**
 * One row of the list, already normalised — so `ListBody` renders a recent and
 * a lookup result the same way and the seven states have one shape to reason
 * about. The conversion is the field's, because bounding a vendor label to the
 * caller's column is the field's job.
 */
type SuggestionOption = {
  value: PlaceValue
  label: string
  /** The design's second line. Recents have none — a stored meeting point is
   *  one string, and there is no second field to draw. */
  meta: string | null
  /**
   * Which list this row belongs to, drawn rather than only headed (§D8).
   * A rider has to be able to tell a place they have used before from one the
   * geocoder just offered, and a heading alone stops saying so the moment the
   * list is scrolled past it.
   */
  recent: boolean
}

function ListBody({
  term,
  listId,
  options,
  heading,
  results,
  searching,
  failure,
  activeIndex,
  onPick,
  onRetry,
}: {
  term: string
  listId: string
  options: SuggestionOption[]
  heading: string | undefined
  results: PlaceSearchResult[] | null
  searching: boolean
  /** The thrown error itself — see `usePlaceLookup`'s own state comment for
   *  why the message lives on it rather than being re-derived here. */
  failure: Error | null
  activeIndex: number
  onPick: (value: PlaceValue) => void
  onRetry: () => void
}) {
  const trimmed = term.trim()

  // The panel scrolls at four rows, and neither the highlight nor
  // `aria-activedescendant` moves it — so arrowing into row five would move a
  // cursor the rider cannot see, and Enter would take something they never
  // looked at.
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (options.length > 0) {
    return (
      <>
        {/* Outside the listbox, deliberately. A `listbox` admits only `option`
            and `group` children, so a heading inside it either announces as a
            fourth suggestion or drops out of the accessible tree — and the
            credit below has the same problem, which is why both are siblings
            of the list rather than rows in it. */}
        {heading && (
          <p className="px-4 pt-3 pb-1 text-sm font-medium text-muted">{heading}</p>
        )}
        <ul id={listId} role="listbox" aria-label={heading} className="flex flex-col px-2 pb-1">
          {options.map((option, index) => (
            <li key={option.value.placeId} role="none">
              <button
                type="button"
                id={`${listId}-${index}`}
                ref={index === activeIndex ? activeRef : null}
                role="option"
                aria-selected={index === activeIndex}
                onClick={() => onPick(option.value)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors active:bg-background',
                  index === activeIndex && 'bg-background'
                )}
              >
                {option.recent ? (
                  <ClockIcon className="h-6 w-6 shrink-0 text-muted" />
                ) : (
                  <LocationOutlineIcon className="h-6 w-6 shrink-0 text-muted" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base font-medium text-foreground">
                    {option.label}
                  </span>
                  {option.meta && (
                    <span className="truncate text-sm font-medium text-muted">{option.meta}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <PlaceDataCredit />
      </>
    )
  }

  // The prompt, not a "no results" — nothing has been searched yet. Naming the
  // minimum rather than saying "keep typing" is what stops a rider deciding the
  // field is broken after three characters, and with no recents to show it is
  // also what an empty focused field says for itself.
  if (trimmed.length < PLACE_SEARCH_MIN_CHARS) {
    return (
      <p className="px-4 py-6 text-center text-sm font-medium text-muted">
        Type at least {PLACE_SEARCH_MIN_CHARS} characters to search.
      </p>
    )
  }

  // The seven states `place-search`'s spec requires the surface to tell apart,
  // minus "below the minimum" (above) and "searching" (below): a
  // `PlaceSearchCeilingError` reads as one of two DISTINCT messages depending
  // on `.scope` — "wait" means an hour under one and until tomorrow under the
  // other — a `PlaceSearchOfflineError` names the device rather than the
  // surface, and everything else (`PlaceSearchUnavailableError` included) gets
  // the one retry affordance the spec requires: an explicit tap, never armed on
  // a timer. **The application-wide ceiling reads as unavailable and lands here
  // too** — reached by elimination in `readCeilingScope` rather than by
  // anything the refusal itself says, since `069`'s three conjuncts all raise
  // the same code. It is deliberately not the rider's own fault, and the retry
  // button is the affordance that says so.
  if (failure) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-6">
        {/* `danger-strong`, not `danger`. Measured against this list's own
            `bg-surface`: `--color-danger` #D92140 fails the 4.5:1 bar at
            `text-sm`/500 and `--color-danger-strong` #99001A clears it. */}
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
  if (results === null || searching) {
    return <p className="px-4 py-6 text-center text-sm font-medium text-muted">Searching…</p>
  }

  return (
    <p className="px-4 py-6 text-center text-sm font-medium text-muted">
      No places match that search. Try fewer words, or type it in.
    </p>
  )
}

/** A vendor result, as the value this field stores. */
function toPlaceValue(place: PlaceSearchResult, maxNameLength?: number): PlaceValue {
  return {
    name: boundName(placeLabel(place), maxNameLength),
    placeId: place.id,
    lat: place.lat,
    lon: place.lon,
  }
}
