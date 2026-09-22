# "Where you ride from" becomes the rider's own words, and the town question can read the phone

PD-476 and PD-477, built as one group because both land on the same two controls: the profile's
location section and the town question.

## Why

**PD-476.** A profile should carry a line the rider writes themselves (*"from the moon"*, *"the
wrong side of the Maas"*). The only column that looks like it is `profiles.location`, and that
column is the second source in `resolveRiderLocation`'s chain. `resolveFromProfile` geocodes it,
and the result drives *near you* on `/rides/explore`, `/clubs/explore` and `/clubs` and biases
every place typeahead. Loosening it to free text would let a rider overwrite their own placed town
with a string that geocodes to nothing, which quietly empties every distance list. That is the
defect PD-425 closed, in a new shape. So the attribute needs a column of its own.

**PD-477.** The wizard is three steps (`terms`, `username`, `town`) and none of them offers the
phone's location. The app's only invite is `LocationQuestionRow`, which PD-447 put on the two
Explore screens. A rider who never opens Explore is never asked, so the device source in
`resolveRiderLocation` stays unused for them.

## What changes

1. **`127` adds `profiles.rides_from`**, a nullable free-text column with a length CHECK that
   mirrors `018`'s `profiles_location_length`. It gets column-scoped SELECT and UPDATE for
   `authenticated` and nothing for `anon`. There is no backfill and no default. `profiles.location`
   and the resolver chain are untouched.
2. **`EditProfileForm` gains a "Where you ride from" `<Input>`** beside `bike_model` and `bio`.
   `profileEditSchema` gains the member, `updateProfile` writes it, and `retaining(...)` retains it.
3. **The profile screens show `rides_from` when it is set, and the placed town otherwise.** That
   applies to the rider's own `/profile` and to another rider's `/profile/detail`, so no existing
   profile loses its line the day this ships.
4. **`LocationSetting`'s section is renamed "Distances measured from"**, so only one control on
   the screen is headed "Where you ride from". `TownQuestionSheet`'s accessible label changes the
   same way.
5. **A "Use my current location" control on the town question.** One component,
   `TownFromDeviceButton`, sits under the typeahead in both places a town is asked for: the
   onboarding town step and `TownQuestionSheet`. A tap asks the OS for a fix, reverse-geocodes it
   to a town through `search-places`, and puts the answer into the field as a pick. The pick stays
   editable, and Submit/Save stays the rider's own action.
6. **The rule that only one module may raise the location dialog becomes a two-caller allowlist,
   enforced by a test.** The two callers are `LocationQuestionRow` and `TownFromDeviceButton`, and
   both call it only from a tap.

## The open parameters, settled

- **PD-476: the column name is `rides_from`**, pairing with `home_country`. The display heading
  is "Where you ride from" and the setting's heading is "Distances measured from".
- **PD-477: does the profile get the control too? Yes, through the same sheet, and not as a new
  button on `LocationSetting`.** The profile's *Change town* / *Set your town* opens
  `TownQuestionSheet`, and the control lives in that sheet. So it appears wherever a town is asked,
  and one component answers both screens. `LocationSetting` keeps its own rule: opening it reads
  state and never prompts.
- **PD-477: the timeout is 20 seconds from the tap**, covering the fix and the reverse geocode
  together (`TOWN_FROM_DEVICE_CEILING_MS`). `requestDeviceLocation` arms no backstop while the OS
  dialog may be on screen, so a WebView shim that never calls back would otherwise spin forever.
  A rider still reading the OS dialog at 20 s can tap again; the second tap reads `granted` and
  returns within the native 4 s timeout.

## Who must NOT see or do this

- **`anon` reads and writes nothing.** No grant, and no policy names the role (decision #1).
- **Another rider cannot write your `rides_from`.** `001`'s UPDATE policy (`auth.uid() = id`)
  already binds every column, and `127` adds an assertion for this column.
- **A rider who blocks you, or whom you block, cannot read it.** The `profiles` SELECT policy is
  block-aware for the whole row, and `127` asserts it for this column. Owner, admin, member and
  non-member of a shared club get no extra reach: a club role confers nothing on a profile, as
  `113.8` already shows for `home_country`.
- **Nothing may read `rides_from` for a position.** That covers the resolver chain, the typeahead
  bias, any "near you" query and any future fallback that geocodes it when the placed town is
  missing. A string that happens to name a real town is still not a position. A test restricts
  the files that may mention the column to a fixed list.
- **Nothing pre-fills `rides_from`, ever.** Onboarding writes the placed town and nothing else,
  so a rider who has not written the line has NULL.
- **No screen raises the location dialog without a tap.** The new control is a button; nothing
  opens a sheet or calls the requesting API from an effect, a mount or a timer.
- **A denial is not retried in-app.** After a denial the control disappears and no copy suggests
  asking again, because iOS shows the dialog once per install.

## Negative cases, by outcome

| Rider state | What they see |
|---|---|
| Writes `rides_from`, later clears it | NULL is stored; the profile falls back to the placed town, never a blank line |
| No `rides_from` and no placed town | No location line at all, as today for NULL `location` |
| Writes `"   "` or 101 characters | Zod refuses with a field message; `127`'s CHECK refuses a direct PostgREST write (`23514`) |
| Taps *Use my current location*, **denies** | Control disappears, no message; the typeahead works as today |
| Grants, **no fix arrives** (indoors, airplane mode) | Within 20 s: control back to idle, one muted line, *type your town instead* |
| Grants, **reverse geocode fails** or `search-places`' 2000/24h ceiling is spent | Same as the row above; a coordinate the app cannot name is not a town |
| Grants, the fix names **a town the rider is not in** | The town appears as an editable pick; nothing is written until they press Continue/Save |
| Types or picks a town **while the lookup is in flight** | The late answer is dropped; it never overwrites the rider's own answer |
| Device has **no geolocation**, or permission already `denied` | The control never renders |
| **Prerender pass** | Permission is read in an effect and the request runs in a click handler; nothing touches `navigator` during render |
| **The walk** (headless, no permission) | The control renders or not, and is never tapped; `WALK_FIXTURES` is unaffected |

## Sequencing

**`127` goes migration-first.** The client WRITES the column, so a bundle that serves ahead of it
answers `PGRST204` on every profile save (CLAUDE.md §The sequencing rule). The migration only adds
a column, so it is safe against the bundle serving today. It adds no second PostgREST relationship,
so nothing argues for deploy-first. Promotion order to PROD is the same: `127`, then the merge.

## Out of scope

- Repointing the resolver chain to a "town chosen at onboarding" source that is separate from
  `profiles.location`. This change takes the cheap end of the split the owner described; the chain
  keeps reading the placed town exactly as it does today.
- Offering the control on `LocationSetting` directly (see the open parameters).
- Any change to `LocationQuestionRow`'s state machine or its priming sheet.
