## Purpose

The one-shot OS permission prompt: when it is spent, what the rider reads first, where the offer
appears, and every state the row and the sheet can be in — including the two the location priming
precedent has no analogue for, one of which is a silent failure with no user-visible symptom.

## ADDED Requirements

### Requirement: The OS prompt SHALL be reached only by a deliberate tap, behind an explainer

`PushNotifications.requestPermissions()` SHALL be called from exactly one place: the `Continue`
button of a priming sheet the rider opened. No effect, no boot path, no navigation and no screen
render SHALL reach it. Dismissing the sheet SHALL spend nothing.

This is `LocationPrimingSheet`'s rule and it applies for a stronger reason. iOS shows its
notification alert **once per install**, and after a decline the only route back is the Settings
app. A prompt fired cold both converts worse and cannot be retried, and one tap disables every
notification this app will ever send to that rider.

#### Scenario: Only Continue reaches the API
- **WHEN** the sheet is dismissed by `Not now`, the scrim, Escape or a back gesture
- **THEN** no permission API SHALL have been called
- **AND** the row that opened it SHALL still be there on the next visit

#### Scenario: The prompt is never spent during onboarding
- **WHEN** a rider has not completed onboarding
- **THEN** the row SHALL NOT draw and the sheet SHALL NOT open
- **AND** two reasons SHALL be recorded: `register_push_token` refuses a caller for whom
  `private.may_participate()` is false, so registration would fail anyway; and spending a
  once-per-install prompt on a rider who has not yet seen what the app does is the worst available
  moment for it

#### Scenario: The rationale copy is treated as a store-review surface
- **WHEN** the sheet's copy is written
- **THEN** every claim in it SHALL be true of the code, and the claims SHALL be listed in the
  component's header the way `LocationPrimingSheet` lists its two
- **AND** if one stops being true, that copy SHALL be the first thing changed

### Requirement: The priming decision SHALL be a pure function with its own tests, and SHALL draw nothing while undecided

A pure `pushPrimingState({ platform, permission, registration })` SHALL own the decision and SHALL
return `hidden` while any input is undecided. It SHALL be tested directly rather than through the
component.

`locationPrimingState` is the precedent and the reason is the same: the decision has more states
than a `renderToStaticMarkup` pass can reach, so folded into a component only two of them get a
test. `undefined` is "not settled" and a decided value is a decided value — a row drawn against an
unread permission is drawn against a guess, and the guess flashes onto the screen and vanishes for
exactly the rider who already granted.

#### Scenario: Nothing renders before both inputs are decided
- **WHEN** the platform check or the permission read has not answered
- **THEN** the state SHALL be `hidden`
- **AND** no row SHALL appear and later disappear

#### Scenario: A granted permission ends the offer
- **WHEN** the permission reads granted **and** a token has been registered
- **THEN** the state SHALL be `hidden`

### Requirement: The web build SHALL be `unavailable` in its entirety, and this SHALL NOT be a per-platform edge case

On any non-native platform `pushPrimingState` SHALL return `hidden` without consulting a
permission API, checked through `Capacitor.isNativePlatform()` — the guard `secure-store.ts`
already uses.

`locationPrimingState`'s `unavailable` covers a platform that happens to lack geolocation. Here it
covers **the entire web app, permanently**: Web Push, a service worker and a manifest are all
settled against, and reintroducing any of them to make this row work on the web would be
reintroducing a render model this app has left.

#### Scenario: No push affordance exists on the web
- **WHEN** the app is served in a browser
- **THEN** no priming row, sheet, permission read or registration attempt SHALL occur
- **AND** the Notification API and `PushManager` SHALL NOT be referenced anywhere in `src/`

### Requirement: A granted permission with no token SHALL be a named state, not a success

Push registration is two steps, not one: a permission grant, then `register()`, then a
`registration` **event** that may never fire. `pushPrimingState` SHALL be able to express *granted,
registered, no token received*, and the app SHALL NOT report success on the permission alone.

**This is the state most likely to ship broken, because every gate in this repo is green while it
is happening.** A missing `aps-environment` entitlement, a provisioning profile without the Push
capability, a misconfigured FCM project or an absent `google-services.json` each produce a granted
permission, no token, no error, and no user-visible symptom at all. Location has no analogue: a
granted geolocation permission that yields no fix is a visible failure with a visible retry.

#### Scenario: The state is distinguishable
- **WHEN** the permission is granted and no `registration` event has arrived after a bounded wait
- **THEN** the state SHALL be distinguishable from both `granted` and `denied`
- **AND** the rider SHALL be told something is not working rather than shown nothing

#### Scenario: A registration error is surfaced rather than swallowed
- **WHEN** the plugin emits its `registrationError` event
- **THEN** it SHALL be surfaced to the rider and recorded
- **AND** it SHALL NOT be treated as equivalent to a decline, because the rider did nothing wrong
  and the remedy is not in Settings

#### Scenario: The device checks that only a device can run are named as such
- **WHEN** the tasks for this capability are written
- **THEN** every step requiring a Mac, a provisioning profile, a real device or a provider SHALL be
  marked as such
- **AND** a green CI run SHALL NOT be presented as evidence that registration works

### Requirement: The offer SHALL be persistent while unanswered, and SHALL have a `blocked` mode that says where the switch is

The row SHALL keep drawing while the permission is neither granted nor satisfied, and SHALL open
the sheet's `blocked` copy once the device has refused.

`locationPrimingState` hides its row for a rider who already has a position, because the geocoded
onboarding city keeps the distance features working — *"the row is for the state where the feature
is otherwise INVISIBLE"*. **Push has no approximate answer.** There is no degraded push, no
partial push and no fallback: a rider who declines receives nothing, for ever, and on iOS the only
route back is a Settings screen riders do not find. So the offer persists where location's does
not, and `blocked` carries far more weight here than it does there.

#### Scenario: Declining does not remove the offer
- **WHEN** a rider dismisses the sheet without continuing
- **THEN** the row SHALL draw again on the next visit

#### Scenario: `blocked` explains the route back
- **WHEN** the device has already refused
- **THEN** the sheet SHALL say what is lost and where the platform switch is
- **AND** it SHALL NOT re-call the permission API, which on iOS would return the refusal without
  showing anything

#### Scenario: The row's location and its cost are both recorded
- **WHEN** the row's placement is chosen
- **THEN** it SHALL draw at the top of `/notifications` and nowhere else
- **AND** the cost SHALL be recorded: a rider who never opens that screen is never asked
- **AND** the alternative — a one-time sheet after onboarding completes — SHALL be recorded as the
  open question it is, rather than silently discarded

#### Scenario: A permission revoked outside the app is detected
- **WHEN** a rider turns notifications off in the OS settings and returns to the app
- **THEN** the app SHALL detect it on its next permission read and SHALL release its token rows
- **AND** the reason SHALL be recorded: providers continue to accept sends for a token whose app
  permission was revoked and silently drop them, so nothing else would ever notice
