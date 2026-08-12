> **⚠ COORDINATION — `Storage object ownership SHALL remain database-enforced` is already
> modified by the active `add-account-deletion` change, and OpenSpec will not warn you.**
> Archiving folds a delta in by replacing the requirement **wholesale**, so whichever change
> archives second silently discards the first one's edit.
>
> They are reconcilable in substance and they touch different scenarios:
> `add-account-deletion` extends the requirement toward **deletion ordering** — objects deleted
> before the rows that name them — and this one extends it toward **read audience** and the
> folder enumeration. The merged text keeps both scenario sets and one updated opening
> paragraph.
>
> **Before archiving whichever of these goes second: re-read
> `openspec/specs/database-enforced-integrity/spec.md` as the first one left it and rewrite this
> delta against *that* text**, not against the version below. Diff **prose and every scenario
> body**, not scenario names: `openspec archive` compares names only, so a reverted body is
> exactly as silent as a reverted paragraph.
>
> **The other delta now names `ride-maps/` too (2026-08-12, PD-104 task 7.1)**, so the two no
> longer disagree about the folder set — but it carries three scenarios this one does not
> (*Sweeping a departed rider's folders widens nobody's grant*, *An ownership transfer leaves no
> path pointing at a departed rider*, *A relaxation, if adopted at all, still refuses a forged
> path*) and this one carries three that it does not (*A rider cannot read another rider's object
> whose owning row is invisible to them*, *A row cannot widen an object's audience by naming it*,
> *A ride's map tile is visible to exactly the ride's audience*). **All six survive into the
> merged text.** Neither delta states a policy count any more; do not reintroduce one.

## MODIFIED Requirements

### Requirement: Storage object ownership SHALL remain database-enforced

A rider MUST NOT be able to upload outside their own folder, nor reference an object in another
rider's folder from a row they author, nor **read** an object whose owning row they cannot read.

Every upload surface binds its path to the uploader in SQL: `postcards` through the INSERT
policy's `image_path like 'postcards/' || auth.uid() || '/%'`, and `profiles`, `clubs` and `rides`
through CHECK constraints on the row. **Six** folders now exist in the `media` bucket — `avatars`,
`covers`, `club-avatars`, `club-covers`, `postcards` and `ride-maps` — none granted to anything but
`authenticated`, and none of them UPDATE. Re-derive the policy count rather than reading it here,
because it has been stated as a number once already and a folder added without its three policies
looks exactly like this sentence being right:

```sql
select cmd, count(*) from pg_policies
 where schemaname = 'storage' and tablename = 'objects' group by cmd order by cmd;
```

**The read half is the addition, and it is the half that fails silently.** Measured 2026-08-09:
this repo's INSERT and DELETE policies check the folder prefix and the caller's uid **only**, while
every SELECT policy carries an `EXISTS` against the parent row evaluated under the caller's own
RLS. Both shapes are correct in their own position, and they are one line apart in a migration — a
write policy pasted into a read position grants every signed-in rider every object in the folder,
and reviews as a consistent-looking pair.

**Read the SELECT policies as a disjunction, not a conjunction.** Five of the six are
`own-folder OR EXISTS(parent)`; only `postcards` is the bare `EXISTS`. The own-folder arm is
permitted where the folder's uid identifies the same rider the owning row is about, and forbidden
where it identifies a mere uploader — `stored-media-visibility` owns that rule and the reasoning.
Describing the shape as "folder pin **plus** an `EXISTS`" is the error to avoid: it reads as a
conjunction and hides the arm entirely.

#### Scenario: A rider cannot claim another rider's object
- **WHEN** a rider inserts a `postcards` row whose `image_path` sits in another rider's folder
- **THEN** the write SHALL be rejected by the INSERT policy

#### Scenario: A rider cannot upload outside their own folder
- **WHEN** a rider uploads to `avatars/<another uid>/…`, `covers/`, `club-avatars/`,
  `club-covers/` or `ride-maps/` outside their own folder
- **THEN** Storage SHALL refuse the upload

#### Scenario: A rider cannot read another rider's object whose owning row is invisible to them
- **WHEN** a rider fetches an object **outside their own folder** while the row naming it is not
  visible to them under that row's own SELECT policy
- **THEN** the fetch SHALL be refused
- **AND** the refusal SHALL come from an `EXISTS` against the owning row rather than from the path,
  which is constructed from ids the rider can already see and is therefore not a secret
- **AND** the own-folder arm SHALL NOT be treated as an exception to this, because it admits only
  the rider whose uid the folder names — a rider reaching their own bytes has learned nothing

#### Scenario: A row cannot widen an object's audience by naming it
- **WHEN** a rider sets a path column on a row they author to an object in another rider's folder
- **THEN** the write SHALL be refused by a CHECK pinning the path to the row's own owner column
- **AND** the SELECT policy SHALL independently require the object's owner segment to match that
  column, so the two controls fail independently rather than in series

#### Scenario: A ride's map tile is visible to exactly the ride's audience
- **WHEN** a rider fetches an object under `ride-maps/`
- **THEN** it SHALL be permitted if and only if the `rides` row naming it is visible to them
- **AND** the policy SHALL NOT narrow it to the crew, because the tile depicts `meeting_point`,
  which the same screens render as text to everyone who can see the ride
- **AND** `private.is_ride_crew` SHALL NOT appear in any `storage.objects` policy

#### Scenario: Unenforced capacity is recorded, not silently assumed
- **WHEN** `rides.max_riders` is set
- **THEN** nothing SHALL claim it is enforced: no policy, trigger or constraint limits
  `ride_members` by it, and this migration does not add one

## ADDED Requirements

### Requirement: A column whose value comes from a third party SHALL carry the evidence that admitted it

Where a column's value is obtained from an external provider rather than authored by a rider, the
row SHALL also carry the quality signal that justified storing it, and a CHECK SHALL make the two
inseparable. A value SHALL NOT be storable without its evidence.

`rides.latitude` is a **guess** produced by geocoding free text. A coordinate with no record of how
confident the geocoder was is indistinguishable from a coordinate somebody typed, and the rule that
would have rejected it lives in a function that a client can decline to call.

#### Scenario: The coordinate and its confidence stand or fall together
- **WHEN** a coordinate is written to a ride
- **THEN** a CHECK SHALL require a confidence value at or above the stated floor to be present in
  the same row
- **AND** the CHECK SHALL equally require that a row with no coordinate carries no confidence, so
  the two cannot drift apart

#### Scenario: The derived artifact requires the value it was derived from
- **WHEN** a tile path is written to a ride
- **THEN** the CHECK SHALL require a coordinate to be present
- **AND** the converse SHALL NOT be required, because a successful geocode followed by a failed
  render or upload is a real end state that must remain writable

#### Scenario: What the database cannot check is stated rather than implied
- **WHEN** the constraint is documented
- **THEN** it SHALL state that the provider's match granularity is **not** checked by the database,
  because the row does not carry it
- **AND** the rule SHALL NOT be described as database-enforced on that axis
- **AND** a rider writing a value that disagrees with their own free-text field SHALL be recorded
  as within their authority, since they author that field

#### Scenario: A stale derivative is cleared by the database, not by the writer
- **WHEN** the source field a stored value was derived from changes
- **THEN** a trigger SHALL clear the derived value and every artifact of it in the same statement
- **AND** the clearing SHALL win over values supplied by that same statement, so it SHALL be a
  `BEFORE` trigger rather than a follow-up write a client could race

#### Scenario: The clearing trigger is scoped to the field it watches
- **WHEN** the trigger is written
- **THEN** it SHALL be scoped with `WHEN (old.<field> IS DISTINCT FROM new.<field>)`
- **AND** the reason SHALL be recorded against the bulk updates that already run on the table —
  `propagate_club_privacy_to_rides` rewrites `is_public` across every ride in a club, and an
  unscoped trigger would clear every one of their derivatives at that moment
