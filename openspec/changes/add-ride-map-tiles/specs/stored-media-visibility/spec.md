## Purpose

Who may **read** a stored object, and what a signed URL is once it has been minted. The standing
set already says who may *upload* one and who may *claim* one; it says nothing about who may fetch
one, and nothing at all about the credential the app hands out on every image it renders.

**This is cross-cutting on purpose.** Five folders already exist — `avatars`, `covers`,
`club-avatars`, `club-covers`, `postcards` — and `ride-maps` is the sixth. The ride cover photo,
the Journal's ride-scoped postcards and any future club media each need the same three answers,
and writing them inside `ride-map-tiles` would mean the seventh folder either rediscovers them or
copies them. Same reasoning `add-ride-chat` used to keep `realtime-subscriptions` separate.

Every requirement is a statement about a role and a resource, so each maps onto an assertion in
`supabase/tests/rls_test.sql` — **except the signed-URL requirement**, which is a property of
Supabase Storage rather than of Postgres and is named as such where it appears.

## ADDED Requirements

### Requirement: A stored object's read audience SHALL be the audience of the row that names it

Every folder in the `media` bucket SHALL have a SELECT policy on `storage.objects` whose condition
is an `EXISTS` against the row referencing the object, evaluated under the caller's own row
security. An object's audience SHALL NOT be decided by its path, by the bucket, or by the folder
owner alone.

**A path is not a permission.** Object paths in this app are constructed from uids and row ids,
both of which are visible to riders in ordinary API responses, so a folder protected only by its
prefix is protected by nothing. The five existing SELECT policies already do this correctly and
are the pattern; the five INSERT and five DELETE policies check the prefix and the caller's uid
**only**, which is correct for a write and catastrophic if copied into a read.

#### Scenario: The read policy defers to the parent row's policy
- **WHEN** a SELECT policy is written for any folder
- **THEN** it SHALL match the object against a column of the owning row and require that row to be
  visible to the caller
- **AND** it SHALL restate none of the parent's audience logic — no block check, no club-privacy
  check, no membership check — so that a change to the parent's policy reaches the object
  automatically

#### Scenario: A prefix-only read policy is a defect
- **WHEN** a SELECT policy for a folder tests only `bucket_id` and the path segments
- **THEN** it SHALL be treated as a defect rather than a simplification
- **AND** the reason SHALL be recorded: it grants every signed-in rider every object in that
  folder, and looks identical in review to a correct write policy

#### Scenario: The object is pinned to the owning row's owner
- **WHEN** the SELECT policy is written
- **THEN** it SHALL additionally require that the object's owner segment matches the owning row's
  owner column
- **AND** the reason SHALL be recorded: without it, a rider who can write the referencing column
  can point it at another rider's object and publish it to their own row's audience

#### Scenario: An object no row names is unreadable
- **WHEN** an object exists that no row references
- **THEN** every fetch SHALL be refused, including from the rider whose folder it sits in
- **AND** an "or I own the folder" arm SHALL NOT be added to make it readable, because it would
  keep content readable after the row granting its audience was deleted

#### Scenario: A signed-out visitor reads no object
- **WHEN** a request for any object arrives with no session
- **THEN** it SHALL be refused
- **AND** no bucket SHALL be made public and no `anon` grant SHALL be added, per decision #1

### Requirement: A signed URL SHALL be treated as a bearer credential that outlives the policy which minted it

A signed URL SHALL be understood as granting access to its object until it expires, **regardless of
what happens to the policy, the row or the relationship that authorised it**. Its lifetime SHALL be
short, SHALL be stated, and SHALL bound any cache entry holding it.

**This is already true of every image this app serves and is written down nowhere.** Storage
checks the policy when the URL is *minted*, not when it is *fetched*. A rider who has been blocked,
removed from a club, or shown the door by a club going private continues to fetch any object whose
URL they already hold. The RLS suite cannot see this at all — it runs against Postgres, and the
signature is checked by Storage.

#### Scenario: Revocation is not immediate, and the window is stated
- **WHEN** a rider's access to a row is removed — by a block, by leaving a club, or by the club
  turning private
- **THEN** any signed URL they already hold SHALL keep working until it expires
- **AND** the expiry SHALL be short enough that this window is measured in minutes rather than
  days
- **AND** this SHALL be stated as a known property rather than presented as revocation

#### Scenario: A signed URL can be forwarded to someone with no account
- **WHEN** a rider shares a signed URL outside the app
- **THEN** the recipient SHALL be able to fetch the object until expiry, with no session
- **AND** this SHALL be recorded as inherent to the mechanism rather than as a defect introduced
  by any one folder
- **AND** it SHALL be weighed whenever a folder holds location data about identified people

#### Scenario: The URL is minted per viewer and never shared between them
- **WHEN** a signed URL is generated
- **THEN** it SHALL be generated under the requesting rider's own session
- **AND** it SHALL NOT be cached under a key shared between riders, nor embedded in a payload
  served to more than one rider

#### Scenario: A cached signed URL is not reused past its expiry
- **WHEN** a signed URL is held in the client cache
- **THEN** its cache entry SHALL NOT outlive the signature
- **AND** an expired URL SHALL result in a re-mint rather than a broken image

#### Scenario: This requirement is not assertable in the RLS suite, and says so
- **WHEN** assertions are written for a folder
- **THEN** the policy behaviour SHALL be asserted in `supabase/tests/rls_test.sql`
- **AND** the signed-URL behaviour SHALL be recorded as verifiable only against the hosted project,
  so that its absence from the suite is not read as coverage

### Requirement: A rendered artifact SHALL NOT be more visible than the data it was rendered from

Where an object is a rendering, a thumbnail, a preview or a derivative of a field, its audience
SHALL be the audience of that field. It SHALL be neither wider nor narrower.

A derived artifact is easy to treat as less sensitive than its source because it looks like
decoration. A map of a meeting point is the meeting point; a preview of a private photo is the
photo.

#### Scenario: The derivative inherits, and does not re-derive, the audience
- **WHEN** an object is generated from a row's field
- **THEN** its read policy SHALL hang off that same row
- **AND** the audience SHALL NOT be recomputed from a different predicate, because two expressions
  of one rule drift and the copy is the one that fails open

#### Scenario: A narrower derivative is a defect too
- **WHEN** a derivative is made visible to fewer riders than the field it renders
- **THEN** it SHALL be treated as a defect rather than as caution
- **AND** the reason SHALL be recorded: the same screen renders the source field as text, so the
  narrowing hides a picture of a string the rider is already reading

#### Scenario: Regeneration does not widen the audience
- **WHEN** a derivative is re-rendered and replaces an earlier object
- **THEN** the new object SHALL fall under the same policy
- **AND** the superseded object SHALL be deleted or SHALL be left unreferenced and therefore
  unreadable

### Requirement: The set of folders and their policies SHALL be enumerable and SHALL be asserted per folder

Every folder in the bucket SHALL have its own SELECT, INSERT and DELETE policies, and each SHALL
carry its own assertions. A folder SHALL NOT rely on another folder's assertions.

Fifteen policies across five folders exist today with no per-folder test contract written down; a
sixth folder added without its own assertions looks exactly like a correct one.

#### Scenario: A new folder arrives with three policies and its own assertions
- **WHEN** a folder is added
- **THEN** SELECT, INSERT and DELETE policies SHALL be added for it
- **AND** assertions SHALL cover a permitted read, a refused read, a refused cross-folder write and
  a refused cross-rider write

#### Scenario: No folder carries UPDATE
- **WHEN** the policy set is reviewed
- **THEN** no folder SHALL carry an UPDATE policy on `storage.objects`
- **AND** replacing an object SHALL be a delete plus an insert, so that a replacement is subject to
  the same path pinning as the original

#### Scenario: The participation gate does not reach Storage, and each folder records that
- **WHEN** a folder's policies are written
- **THEN** it SHALL be recorded that `enforce_participation_gate` is attached to tables and not to
  `storage.objects`
- **AND** no folder SHALL be described as gated on onboarding or consent unless a policy on that
  folder says so

#### Scenario: Bucket-level rejections are documented where they can be mistaken for policy
- **WHEN** the bucket's MIME allowlist or size ceiling refuses an upload
- **THEN** it SHALL be recorded that the refusal happens above every policy
- **AND** a folder's assertions SHALL NOT be expected to explain it, because no policy ran
