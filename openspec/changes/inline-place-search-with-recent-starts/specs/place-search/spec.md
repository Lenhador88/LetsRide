## MODIFIED Requirements

<!-- These three requirements currently live in
     openspec/changes/replace-places-index-with-geocoder/specs/place-search/spec.md,
     which cannot be archived yet (46 open tasks), so `place-search` is not in
     openspec/specs/. Each is restated here IN FULL so that folding is mechanical
     whenever that change closes. -->

### Requirement: The lookup surface SHALL tell its seven states apart

Zero rows on this surface has six distinct causes and a seventh state that is not zero rows at all.
A rider's next action differs for every one, so the surface SHALL NOT collapse them.

**The surface is now the suggestion list attached to the field's own input**, not a full-screen
sheet. That is a change of where the states are drawn and of nothing else: an inline list has less
room than a sheet, and the temptation is to collapse two states into one line to save it. The
enumeration is unchanged and SHALL NOT be weakened.

| State | What the rider is told | What they should do |
|---|---|---|
| Below the minimum | The minimum, named as a number | Keep typing |
| Searching | That it is searching | Wait |
| No matches | That nothing matched **that search** | Try fewer words, or type it themselves |
| Unavailable | That search could not be reached | Retry, or type it themselves |
| Rider hourly ceiling | That they have searched a lot **just now** | Try again shortly, or type it themselves |
| Rider daily ceiling | That they have searched a lot **today** | Type it themselves; searching resumes tomorrow |
| Offline | That the device has no connection | Reconnect, or type it themselves |

**"Below the minimum" has two presentations and is still one state.** With an empty input on a
field that offers recents, the list SHALL show the recents; in every other case below the minimum —
an empty input with no recents to show, and any input of 1 to 3 characters — it SHALL show the
minimum named as a number. The gap between a recents list disappearing and a lookup firing is
deliberate: it is what tells the rider a request is about to be made.

**The two rider ceilings SHALL NOT share a message**, and this is the requirement above applied to
itself rather than a separate rule. `PER_RIDER_HOURLY` and `PER_RIDER_DAILY` are both enforced in
the same INSERT policy, and "wait" means an hour under one and until tomorrow under the other — a
24× difference in what the rider should do next. A single "you have searched a lot" message tells a
rider who could retry in ten minutes to give up, and tells a rider who is done for the day to keep
poking a surface that will refuse them all evening. The refusal SHALL therefore carry which ceiling
was hit; a reason code is enough, and no number, quota or vendor name reaches the rider.

"Not yet searched" and "searched and found nothing" SHALL remain distinguishable, as they are today:
a null result set is *not yet*, an empty one is *nothing matched*. Conflating them shows
"no places found" for a moment on every search that is about to succeed.

The application-wide ceiling SHALL be presented as **unavailable** rather than as the rider's own
ceiling. It is not the rider's fault and there is nothing about their own behaviour they can change.

#### Scenario: A failed lookup is not rendered as an empty one
- **WHEN** the proxy returns an error, times out, or the device is offline
- **THEN** the suggestion list SHALL show the matching message from the table above
- **AND** it SHALL NOT show "no places match that search"
- **AND** it SHALL NOT show the vendor's name, status code, or error text

#### Scenario: The rider's typing survives every failure state
- **WHEN** any of the failure states above occurs while a rider is filling a form
- **THEN** closing the list SHALL leave everything already typed in the form intact — including a
  meeting point typed before the list was opened
- **AND** no failure state SHALL clear a pick already made

#### Scenario: A retry costs a credit and says so by requiring a tap
- **WHEN** the surface offers a retry after an unavailable state
- **THEN** the retry SHALL be an explicit action rather than an automatic re-issue
- **AND** an automatic retry SHALL NOT be armed on a timer

#### Scenario: The states are drawn where the rider is looking
- **WHEN** any of the seven states is shown
- **THEN** it SHALL be rendered in the list attached to the field the rider is typing in
- **AND** no state SHALL be reported only by a control that is off screen, and none SHALL be
  collapsed into another to save vertical space

### Requirement: Attribution SHALL be paid on the surface that renders results, and the retired credit SHALL be removed with the data

The surface rendering place results SHALL carry the answering provider's required credit, and the
retired data set's credit SHALL be removed in the same change that removes the data.

The retired index's credit is specific to that data set and becomes wrong the moment the data is
gone: it names contributors who supplied nothing to what the rider is now looking at.

The new provider's OpenStreetMap credit is **unconditional** and, unlike a map tile, a list of
search results carries no burned-in credit. The obligation therefore lands on the surface itself.

**The surface is the inline list, and the credit SHALL render whenever that list is open with any
rows in it — recents included.** A recent's visible label is not rider prose: it is the provider's
own label, chosen by the rider from a lookup and stored verbatim by the field. Crediting the live
list and not the recents list would make the obligation depend on how the same text got on screen.
A list showing only a message — the minimum-characters hint, searching, an error, a ceiling, no
matches — renders no provider-derived content and SHALL NOT be required to carry the credit; a
build that carries it in those states anyway is compliant and simpler, and either is acceptable.

#### Scenario: The list credits the provider that answered it
- **WHEN** the suggestion list is open with lookup results or recents in it
- **THEN** it SHALL carry the provider's required credit and the OpenStreetMap credit
- **AND** it SHALL NOT credit the retired data set
- **AND** the credit SHALL be a link that does not navigate away from a half-filled form

#### Scenario: The credit is reachable, not merely rendered
- **WHEN** a rider taps the credit link while the list is open
- **THEN** the link SHALL open, rather than being lost to the list closing under the tap
- **AND** the obligation SHALL be treated as discharged only by a credit a rider can actually follow

#### Scenario: The attributions page loses exactly what left
- **WHEN** the index is dropped
- **THEN** the retired provider's section SHALL be removed from `/legal/attributions` in the same change
- **AND** the existing tile credit SHALL be broadened to say it also covers search, rather than a second
  block being added that could drift from the first

#### Scenario: An obligation heavier than credit is resolved before riders are exposed to it
- **WHEN** the provider's terms are read for what they require of **stored** results and of results
  **shown in a list**
- **THEN** the answer SHALL be recorded, with its source, before this ships to production
- **AND** until it is read, the position SHALL be marked as inferred rather than settled — this repo has
  paid for an assumed data licence once already

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Naming them is what stops the next session reading an absence as an oversight and building half of
one.

- **No inline ghost-text completion.** The frame draws it (`Rides / Add starting location - Filled`,
  `1918:15967`, the `Autocomplete` text node); it was already deferred; it is the one element that
  cannot degrade, because a half-working completion rewrites what the rider typed. **Moving the list
  onto the field does not revive it** — it makes it look closer to hand, which is exactly when it
  gets built by accident.
- **No structured address entry** — no separate street, number, postcode and city fields. The vendor
  takes one string.
- **No device-held recent *searches*.** The deferral this bullet used to carry read "no saved or
  recent places", on the grounds that a list of a rider's recent searches is a list of addresses they
  care about, held on the device, surviving the session, and therefore a separate privacy decision.
  That decision has been taken, and it was taken **narrowly**: what is built is a read of the rider's
  own past *ride starts*, from rows this app already stores under the rider's own RLS. A **search
  term** is still never stored, never held on the device, and never shown back to anyone — so a term
  a rider typed and abandoned SHALL NOT appear in any list, ever. The distinction is the whole of the
  privacy decision and SHALL NOT be blurred by a later "we already keep recents" argument.
- **No saved or favourite places**, and no naming, pinning, reordering or deleting of a recent. A
  recent is a derived view of the rider's own rides, not a record they curate.
- **No offline search.** There is no local index any more and there SHALL NOT be a partial one.
- **No reverse geocoding** — "use my current location" as a *pick* is a second endpoint, a second
  credit and a second permission prompt.
- **No alerting when the quota is exhausted.** Error tracking is deliberately undecided, so the
  application-wide ceiling being reached is visible only to whoever looks. This is a **stated gap**,
  not a solved problem.

#### Scenario: An unbuilt surface is recognisable as a decision
- **WHEN** a later session finds one of these missing
- **THEN** it SHALL find it named here with its reason
- **AND** building one SHALL be a new proposal rather than an extension of this one

#### Scenario: An abandoned search term is not a recent
- **WHEN** a rider types a term, sees results, and picks nothing
- **THEN** that term SHALL NOT be retained anywhere, and SHALL NOT appear the next time the field is
  focused
- **AND** the only thing that can become a recent is a place a rider picked **and** saved onto a ride

## ADDED Requirements

### Requirement: The lookup surface SHALL be the field's own input, and no second screen SHALL be presented

A rider filling a form SHALL never lose sight of it to search for a place. The suggestions SHALL be
rendered as a list attached to the field being filled, on **every** caller of the shared field —
creating and editing a ride, creating and editing a club — so that one control does this job and
there is no second path to keep in step with it.

The list SHALL NOT be a modal dialog: it SHALL NOT trap focus, SHALL NOT be announced as a dialog,
and dismissing it SHALL NOT be a navigation. A hardware or gesture Back while the list is open SHALL
be understood by the rider as leaving the form, not as closing the list, so the list SHALL NOT
depend on Back to close.

The rider SHALL be able to ignore the list entirely: on a field that accepts free text, typing an
answer and submitting SHALL work whether or not the list was ever opened.

#### Scenario: The form stays on screen while a rider searches
- **WHEN** a rider focuses the location field on any of the four forms and types
- **THEN** the suggestions SHALL appear attached to that field
- **AND** the form SHALL remain on screen behind or around them
- **AND** no full-screen surface SHALL be presented

#### Scenario: One control, four callers
- **WHEN** a rider searches for a place on any of the four forms
- **THEN** the surface SHALL be the same control with the same states, keyboard behaviour and credit
- **AND** no caller SHALL present a second, different lookup surface

#### Scenario: The list is not a dialog
- **WHEN** the list is open
- **THEN** focus SHALL remain in the rider's own input and SHALL NOT be trapped
- **AND** assistive technology SHALL announce a suggestion list rather than a dialog

### Requirement: The list SHALL behave as a combobox, and SHALL NOT submit the form by accident

The retired sheet inherited Escape, focus containment and an unambiguous "you are in a search now"
reading from `role="dialog"`. An inline list inherits none of that and SHALL state it explicitly.

- The input SHALL be marked as a combobox that controls the list, and each row SHALL be an option;
  which option is active SHALL be exposed to assistive technology rather than shown only by colour.
- Arrow keys SHALL move the active option; the list SHALL NOT wrap silently past its ends in a way
  that hides where the rider is.
- **Escape SHALL close the list and SHALL NOT clear the field, SHALL NOT discard a pick, and SHALL
  NOT submit the form.**
- **Enter with an active option SHALL select that option and SHALL NOT submit the form.** Enter with
  no active option SHALL do whatever the form does, unchanged.
- Moving focus out of the field SHALL close the list without changing the field's value.
- The browser's own autofill or history dropdown SHALL NOT be offered on top of this list.

#### Scenario: Escape leaves the rider where they were
- **WHEN** a rider presses Escape with the list open and text typed
- **THEN** the list SHALL close
- **AND** the typed text SHALL remain exactly as typed, a pick already made SHALL remain, and the form
  SHALL NOT be submitted

#### Scenario: Enter picks rather than submits
- **WHEN** a rider has moved to an option with the arrow keys and presses Enter
- **THEN** that option SHALL be selected into the field
- **AND** the form SHALL NOT be submitted by that keystroke

#### Scenario: A screen reader can tell what is happening
- **WHEN** the list opens, changes length, or an option becomes active
- **THEN** the change SHALL be conveyed through the combobox's own roles and state
- **AND** the number of suggestions SHALL be discoverable without sight

#### Scenario: Only options live in the option list
- **WHEN** the panel renders a heading, the provider credit, a retry control, or any message state
- **THEN** none of them SHALL be a child of the option list, and none SHALL be announced as an option
- **AND** the option list SHALL contain selectable places and nothing else
- **AND** a message state SHALL replace the option list rather than being rendered inside it

#### Scenario: The combobox claims to be expanded only when it is
- **WHEN** the panel is open showing a message, a hint, an error or a searching state with no options
- **THEN** the combobox SHALL NOT report itself as expanded, and SHALL name no active option
- **AND** it SHALL report itself as expanded exactly when selectable options are present

#### Scenario: Every control in the panel can actually be used
- **WHEN** the panel holds a control that is not a place row — the provider credit link or a retry
  action
- **THEN** it SHALL be reachable and operable by tap and by keyboard while the panel is open
- **AND** the panel closing on lost focus SHALL NOT be able to swallow the interaction that was aimed
  at it
- **AND** this SHALL hold for the credit link in particular, since an obligation discharged by a link
  nobody can reach is not discharged

### Requirement: A rider SHALL be able to see and tap the suggestions with the keyboard open

This surface is used almost exclusively on a phone with the on-screen keyboard raised — the design's
own frame draws it that way (`1918:15967`: a 349px keyboard on an 844px screen, 41% of the viewport),
and the field is the third control on the create-ride form, so the naive inline list opens into the
space the keyboard occupies.

The requirement is on the outcome, not the mechanism: with the keyboard raised, on the smallest
phone this app supports, a rider SHALL be able to **see at least two suggestions and tap any of them
without dismissing the keyboard first**, on every one of the four forms. Tapping a suggestion SHALL
NOT require scrolling a container the rider cannot see the edges of, and the list SHALL NOT render
underneath the keyboard with no indication that more rows exist.

The list SHALL also not push the rider's own input off screen: whatever it does to the layout, the
text being typed SHALL remain visible while the list is open.

#### Scenario: Suggestions are reachable on a phone
- **WHEN** a rider on a phone-sized viewport focuses the field and types enough to get results
- **THEN** at least two suggestions and the rider's own input SHALL be visible at once with the
  keyboard raised
- **AND** each visible suggestion SHALL be tappable at a glove-sized target without the keyboard
  being dismissed first

#### Scenario: The native shell is verified rather than assumed
- **WHEN** this ships toward the native build
- **THEN** the behaviour SHALL be checked on a real device in the shell, because the web viewport and
  the shell's keyboard resize behaviour are not the same thing
- **AND** if it cannot be satisfied without a native keyboard plugin, that SHALL be raised as a
  separate decision rather than added quietly, since every native plugin is a permission prompt, a
  review question and a supply-chain surface

### Requirement: Recents SHALL be shown exactly while the input is empty, and SHALL NOT be filtered

On a field that offers recents, the recents SHALL be shown **while the input's value is empty** and
SHALL NOT be shown while it holds anything. The trigger is the value, not a keystroke: paste, cut,
undo, an IME composition and the field's own Clear control all change the value without being one, and
a rule written on typing leaves recents on screen through the first four of those and removes them on
none of them.

The rider-visible behaviour is the one the product owner asked for, stated on the right quantity: the
moment there is anything in the field, the recents are gone, and they come back the moment there is
nothing in it again.

Recents SHALL NOT be filtered, ranked or narrowed by what the rider types. A three-row list is not
worth filtering, and the disappearance is doing a second job: it is what tells the rider the field
has stopped offering what it already knows and is about to ask the vendor.

Recents and lookup results SHALL NOT be shown at the same time, or merged into one list. A rider
SHALL always be able to tell which of the two they are looking at, because tapping one costs a
vendor credit's worth of provenance and the other does not.

Because visibility is derived from the current value, an answer that arrives late — recents resolving
after the rider has started typing — SHALL simply not be rendered. No separate discard rule is
needed, and none SHALL be added that could disagree with this one.

#### Scenario: Focus on an empty field offers the last three
- **WHEN** a rider focuses the ride's starting-location field with the input empty
- **THEN** up to three of their own most recent picked starts SHALL be offered
- **AND** no vendor call SHALL be made by focusing the field

#### Scenario: Anything in the field removes them
- **WHEN** the input's value becomes non-empty by any route — typing, pasting, an IME commit, or a
  restored value
- **THEN** the recents SHALL no longer be shown
- **AND** the surface SHALL show the minimum-characters state until the minimum is reached
- **AND** the recents SHALL NOT be filtered by that value at any point

#### Scenario: Emptying it by any route brings them back
- **WHEN** the value becomes empty again — deleting, cutting, undoing, or the field's Clear control
- **THEN** the recents SHALL be offered again
- **AND** the search results for the removed term SHALL NOT remain on screen beneath them

#### Scenario: A late answer never lands over typed text
- **WHEN** the recents read resolves after the rider has already put something in the field
- **THEN** they SHALL NOT be rendered, because the value is not empty
- **AND** a lookup response for a term the rider has since changed SHALL likewise not be rendered

### Requirement: Tapping a recent SHALL spend nothing, and recents SHALL survive the states in which lookup cannot

A recent is a row this application already stores, read under the rider's own session. Selecting one
SHALL make no vendor call, SHALL write no metering row, and SHALL count against neither the
per-rider nor the application-wide ceiling.

It follows that recents SHALL still be offered when lookup itself is refused or unreachable: a rider
at their hourly or daily ceiling, or one the application-wide ceiling has shut out, SHALL still be
offered their recents on an empty field and SHALL still be able to pick one. This is the strongest
argument for recents after the taps — the rider who most needs a start location without a lookup is
the one who cannot make a lookup.

**Offline is the honest exception and SHALL be stated rather than promised away.** Recents are a
database read, so with no connection they are available only if the client cache already holds them
from this session. When they cannot be read, the field SHALL behave as if the rider has none — no
error, no retry affordance, no blocked form — because a rider who has never picked a start has none
either and the field SHALL work identically for both.

#### Scenario: A recent costs no credit
- **WHEN** a rider taps one of their recent starts
- **THEN** no request to the vendor SHALL be made and no metering row SHALL be written
- **AND** the ride's meeting point, place id and coordinate SHALL be set exactly as a fresh pick sets
  them

#### Scenario: A rider at their ceiling can still set a start
- **WHEN** a rider whose hourly or daily lookup ceiling is reached focuses the empty field
- **THEN** their recents SHALL be offered and SHALL be selectable
- **AND** typing SHALL still produce the ceiling message from the states table, unchanged

#### Scenario: An unreadable recents list is not an error
- **WHEN** the recents read fails, times out, or the device is offline with nothing cached
- **THEN** the field SHALL show the minimum-characters state, exactly as it does for a rider with no
  recents
- **AND** no error message, retry control or blocked submit SHALL result

### Requirement: A club's location SHALL remain a pick or nothing, and the field SHALL never show what a submit would not store

The club fields become inputs so that one control has one shape. That introduces a hazard the value
button did not have: a rider can now type into a field whose column only accepts a picked place, and
typed text that is silently dropped looks exactly like a location that was saved.

**The rule for what typing does to a pick differs between the two modes, and the difference follows
from what is stored.**

- **Free-text mode (a ride's meeting point).** The visible input **is** the stored value, so typing
  SHALL drop the pick immediately — a coordinate that no longer matches the text is a pin the write
  will not store. Unchanged; product owner, 2026-08-18.
- **Place mode (a club's location).** The visible input is a **search box** whose text is never
  stored, so typing SHALL NOT drop a pick that is already held. The pick SHALL stand until the rider
  picks another or clears the field explicitly, and on blur the text SHALL revert to the held pick.

Clearing a pick in place mode SHALL therefore be an **explicit** act: the field's Clear control drops
the pick and empties the text together, and nothing else removes a stored club location. Typing must
not, because the revert would resolve to empty, the four hidden fields would submit as NULL, and — the
field being optional — the rider would be told nothing. A club that quietly lost its location because
its owner typed one character into a search box and tapped away is the defect this rule exists to
prevent.

A club SHALL remain creatable and editable with no location at all, with copy that reads as optional
rather than as an error, exactly as it is today.

#### Scenario: Typed club text is never stored as a location
- **WHEN** a rider types a town into a club's location field, picks nothing, and submits
- **THEN** the club SHALL be created or updated with no location written from that text
- **AND** the form SHALL NOT report an error, because the field is optional

#### Scenario: Typing does not remove a club's stored location
- **WHEN** the owner of a club that already has a location focuses the field, types a character, and
  moves focus away without picking
- **THEN** the stored location SHALL be unchanged
- **AND** the field SHALL show the held pick again, not the typed fragment
- **AND** a submit in that state SHALL write the same four values the club already had

#### Scenario: Clearing is the only way to remove it
- **WHEN** a rider uses the field's Clear control in place mode
- **THEN** the pick SHALL be dropped and the text SHALL be emptied together
- **AND** a submit in that state SHALL store no location, which is the rider asking for exactly that

#### Scenario: A submit from inside the focused field still shows the truth
- **WHEN** a rider types over a picked club location and submits directly from the field — Enter with
  the list open and no option active — so that no blur ever occurs
- **THEN** the field SHALL reconcile itself before the submit is read: the text SHALL revert to the
  held pick and the list SHALL close
- **AND** the submit SHALL NOT be prevented, because the rider asked to save
- **AND** what is written SHALL be what the field was showing, never the abandoned text

#### Scenario: A ride is not a club
- **WHEN** a rider types a meeting point on a ride form and picks nothing
- **THEN** the typed text SHALL be stored as the meeting point, unchanged
- **AND** no pick, coordinate or place id SHALL be stored with it
