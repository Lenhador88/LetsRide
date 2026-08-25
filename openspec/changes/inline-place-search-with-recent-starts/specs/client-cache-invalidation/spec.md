## ADDED Requirements

### Requirement: A form's accelerator read SHALL be cached under a named key and SHALL be moved by the writes that change it

The recents list is read while a rider is filling a form, on focus, and re-read on every subsequent
focus of that field. It SHALL be cached, its key SHALL be spelled in `src/lib/query/keys.ts` like
every other key, and it SHALL NOT be fetched with a key written inline at the call site — a key that
happens to be right is still a key nothing can reconcile.

**The key SHALL be filed under the domain that owns the rows it reads**, so the writes that change it
already reach it. Recents are derived from `rides`, and creating, editing and deleting a ride each
already invalidate the whole `rides` prefix; a key nested there is therefore moved by all three with
**no new invalidation call site**. Over-invalidating is the safe direction — an RSVP will also
refetch it, costing one small read and never a wrong answer.

A stale recents list SHALL be bounded rather than perfect: it is an accelerator, and the worst
outcome of a stale one is that a rider taps search instead. It SHALL NOT be revalidated on a timer,
polled, or subscribed to.

The list SHALL be **destroyed** rather than refreshed when the session ends, for the reason sign-out
destroys the cache rather than invalidating it: on a shared device, refetching would repopulate one
rider's meeting points while another signs in.

#### Scenario: Creating a ride moves the list
- **WHEN** a rider creates a ride with a picked start
- **THEN** the next focus of a start field SHALL offer that start, without a page reload
- **AND** the freshness SHALL come from the ride domain's existing invalidation rather than from a new
  claim made by the recents read

#### Scenario: Editing or deleting a ride moves it too
- **WHEN** a rider changes a ride's start, types over it, or deletes the ride
- **THEN** the recents list SHALL reflect that on its next read
- **AND** no invalidation SHALL be needed that the ride's own write does not already make

#### Scenario: The key is declared, not spelled
- **WHEN** the recents read is issued
- **THEN** its key SHALL come from `keys.ts`
- **AND** the mapping test that forbids inline keys SHALL cover it like every other read

#### Scenario: Sign-out destroys it
- **WHEN** a rider signs out
- **THEN** the cached recents SHALL be destroyed with the rest of the cache rather than invalidated
- **AND** the next rider on the device SHALL NOT be able to read them from anywhere
