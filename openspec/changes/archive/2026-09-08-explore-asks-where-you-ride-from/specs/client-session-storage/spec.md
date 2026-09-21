# client-session-storage (delta)

> **ADDS one requirement, MODIFIES none.** Six standing requirements were read. One of them —
> **"Sign-out SHALL destroy every local trace of the rider"** — already covers the *outcome* this
> change needs, and its scenario *"The next rider sees nothing of the last one"* is the assertion
> that will be extended in `supabase/tests`' client-side equivalent rather than rewritten here. The
> requirement stands; what it does not say is what a **deferral** record may contain and which way it
> fails, which is what a device-local ladder introduces for the first time.
>
> Verified rather than assumed: `signOut` performs seven clears today, **six of them local** — the
> query cache, the guard cache, the rider position memo, the stashed invite tokens, the introduction
> dismissals and the session store — plus one server write (`releaseCurrentDevice`). The location
> flag is **not** among them, so it survives sign-out.

## ADDED Requirements

### Requirement: A device-local deferral record SHALL hold no rider data, SHALL fail open, and SHALL NOT survive sign-out

A record kept on the device to postpone a question SHALL contain only what postponing needs — a
timestamp and a count. It SHALL NOT hold a town, a coordinate, a rider id, an email or any other
value belonging to the rider. It SHALL be removed at sign-out. Every read and every write SHALL fail
in the direction that **asks again**.

The three properties are one requirement because each defeats a different failure:

- **No rider data**, because a device-local copy of a profile field outlives the session that wrote
  it and is readable by the next rider on the phone, in plain text, with no policy over it.
- **Cleared at sign-out**, because a boolean that outlived a rider was nearly harmless while it meant
  "the one automatic ask was spent" and is not harmless once it means *"this device answered, do not
  ask for up to six months"*. Rider B on a shared phone inherits rider A's silence and is never asked
  about their own town.
- **Fails open**, because the alternative reading of an unreadable store — *treat it as answered* —
  removes the question for that rider for ever, with no signal anywhere that it happened. A private
  window, a browser blocking site data and some WebView previews all **throw** rather than returning
  null.

A failed *write* is the residual and it is priced rather than recovered: the question returns on the
next visit. A failed *clear* after the rider answered is the one direction that fails closed, and it
is accepted because the question has just been answered — only the ladder position is wrong.

#### Scenario: The record carries nothing about the rider
- **WHEN** a deferral is stored
- **THEN** the persisted value SHALL contain only a timestamp and a non-negative count
- **AND** the town the question was about SHALL NOT be among the persisted fields

#### Scenario: The next rider on the device is asked
- **WHEN** rider A defers the question and signs out, and rider B signs in on the same device
- **THEN** B SHALL be asked according to B's own state, with no interval inherited from A

#### Scenario: An unreadable store asks rather than assumes
- **WHEN** reading the record throws, returns nothing, or returns a value that is not a record with
  a finite timestamp and a non-negative integer count
- **THEN** it SHALL be treated as absent and the question SHALL be asked
- **AND** the shape SHALL be validated rather than only the parse, because a stored `1` parses
  successfully and is not a record

#### Scenario: A retired key is removed rather than left unread
- **WHEN** a storage key's meaning is retired by a change
- **THEN** the key SHALL be removed from the device rather than merely stopped being read
- **AND** no behaviour SHALL be derived from its presence afterwards

#### Scenario: A clock that moves backwards does not silence the question for ever
- **WHEN** the stored timestamp is in the future relative to the device clock
- **THEN** the record SHALL be treated as absent and the question SHALL be asked
