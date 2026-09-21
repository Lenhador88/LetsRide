# Design — a club says where it is based

Mechanism, the rejected alternatives, and the open questions. `proposal.md` is what changes; this is
why it is shaped that way.

## D1 — Two schemas, sharing one body

```
const clubFields = { name, description, is_public, avatar_path, cover_image_path }

export const clubSchema       = z.object({ ...clubFields, location: clubLocationSchema })
export const clubCreateSchema = z.object({ ...clubFields, location: <required> })
```

**One object literal, two wrappers.** The alternative — copying five field definitions so the two can
drift — is the failure mode this repo names elsewhere as "two copies drift, and the one that drifts
is always the one you did not read".

**How `location` is made required matters for the message.** `clubLocationSchema` is
`z.object({...}).nullable()`; simply using its inner object means `safeParse(null)` answers Zod's own
*"Invalid input: expected object, received null"*, which is a sentence about JavaScript shown to a
rider. So the required form carries an explicit message and keeps the inner four intact for a partial:

```
location: clubLocationSchema.refine(
  (value) => value !== null,
  { message: 'Pick where your club is based.' },
)
```

The narrowed type is then asserted at the call site, or the refinement written as a type predicate —
either is fine; what is not fine is `parsed.data.location!`, which throws away the only thing the
split bought.

**`CreateClubForm`'s focus effect parses `clubCreateSchema`, not `clubSchema`.** It parses a schema
today specifically so the form and the action cannot disagree about which field was rejected; leaving
it on the nullable one would make the form fail to find the field the action refused, silently and
only for the new case.

## D2 — Why the create submit stays enabled while the onboarding submit does not

Two screens in the same slot do the opposite thing, so the reason has to be written down or a later
session will "fix" one of them.

| | onboarding town step | `CreateClubForm` |
|---|---|---|
| Controls on screen | one | six |
| What a disabled submit reads as | *answer the question* | *this form is inert* |
| Tab order | nothing after the submit | a disabled submit ends it early |
| Recorded decision | PD-428's step gates on `country` | this file's own header: focus the rejected field instead |

`CreateClubForm`'s header records the disabled-submit approach as **tried and reverted**. Re-adding
it for the location would reintroduce a defect the file already paid for, on the same form, for a
field that is one of six. So the refusal is the schema's, the message is a field message, and focus
moves — which is the machinery this form already has.

## D3 — The pre-fill, and the three things that make the naive version wrong

`proposal.md` §3 has the decision. This is the mechanism and the evidence, because the naive version
looks obviously correct until you read the component.

**Seeding a `PlaceValue` is not possible.** `RiderLocation` is `{ lat, lon, source }` and
`getLocalityCentroid` returns `{ lat, lon }`. A pick needs a `name` and a `placeId` too, and
`clubs_location_coupling` needs all four columns. There is no path from a device fix to a valid pick,
so the issue's literal request cannot be built and the choice is only about the *search term*.

**Seeding the draft at mount is worse than nothing, for three independent reasons.** Any one of them
is disqualifying:

1. `onBlur` runs `if (!freeText) setDraft(null)`. The seed **erases itself** the first time the rider
   blurs the field — a form that empties a field the rider watched it fill.
2. Until then the field displays text that a submit would not store. The rider can reasonably press
   Create and be refused with the field visibly full, which is the worst possible refusal.
3. `searchTerm` is set by typing alone. A seeded draft therefore opens no suggestion list, so the
   *"one tap away"* the seed exists to buy is not delivered anyway.

**Seeding on first focus fixes all three.** The rider focuses the field (which they must, to answer
it), the draft and the search term are set together, the list opens on real geocoded results, and a
rider who never focuses sees an empty field — the truth. The credit is spent at the moment the rider
committed to searching, which is the same rule the component already applies to resolving its
geolocation bias.

**The prop.** One optional string on `PlaceSearchField`, applied once, guarded on *no value, no
draft, first focus*. It changes nothing for a caller that omits it, which is what
`ride-start-location`'s *One picker SHALL exist* requires of any extension.

**The read.** `getMyLocationText()` through `useQuery` under `queryKeys.profile.location()` — a key
that already exists and that `setRiderTown` already invalidates. No new key, no new invalidation
claim, no vendor call. Reading it on mount is fine: it is the rider's own row, cached, and free. It
is the *lookup* that is gated on focus, not the read.

**A pleasing interaction with PD-445, noted rather than depended on.** Once onboarding requires a
town, `profiles.location` is populated for every new rider, so the seed has something to offer for
essentially everybody. This change does not require that and works with an empty town today — it just
gets better when PD-445 lands. **Neither change blocks the other.**

## D4 — The focus defect

`CreateClubForm`'s effect does `form.elements.namedItem(field)` with `field = path[0]`. For a location
refusal that is `'location'`, and nothing is named `location`: in place mode `PlaceSearchField`'s
visible input has no `name` (deliberately — that is what makes typed-but-unpicked text a search term),
and the hidden `location_name` is not focusable.

So focus silently does not move, for the one field this change makes required. Two fixes:

- **Chosen: give the primitive an `inputRef`** the form can hold, and branch the effect on
  `'location'`. Optional, additive, ignored by every other caller, and it makes the field's focus
  reachable for anything later that needs it.
- **Fallback: a ref on the wrapping `<div>` and a scoped `querySelector('input')`.** No primitive
  change, but it reaches into another component's DOM and breaks the day the field grows a second
  input.

Non-blocking; the fallback ships the same behaviour if the reviewer would rather not widen the
primitive twice in one change.

## Open questions

Three. **All non-blocking**, each with a recommended default.

**Q1 — The refusal copy.** *Non-blocking. Product owner's; the default is safe.* Default:
**"Pick where your club is based."** — the voice of the four messages already in the file, naming
the action rather than the field type, because *typing* is exactly what does not work here.

**Q2 — Does the pre-fill ship in this change, or does the gate ship alone?** *Non-blocking. The
reviewer's.* Default: **together**. The gate without the pre-fill is the wall the code says it was
avoiding, and the pre-fill without the gate does nothing. If the primitive change draws a long
review, splitting it out and shipping option (c) first is a clean fallback that leaves the gate
correct.

**Q3 — Prompting existing club owners.** *Non-blocking, and it is the product owner's alone.* The
issue excludes it and so does this proposal. Default: **leave it out, and do not fold it into a
follow-up by reflex** — it is a decision about nagging (which screen, how often, what a decline
means), not about a form field. If it is wanted it is a new story, with its own five-rating block.
