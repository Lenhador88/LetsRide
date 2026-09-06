# ride-chat (delta)

> **This delta removes the capability in full.** `public.ride_messages` (`034`) and
> `public.ride_reads` (`061`) are dropped, `/rides/detail/chat` is deleted, and nothing in the app
> reads or writes either table afterwards. Every requirement below is removed rather than modified,
> because a requirement about a table that no longer exists cannot be satisfied or falsified.
>
> **Where each rule GOES rather than dies is named per requirement.** Most of them are true of the
> replacement too and are re-stated in `specs/ride-threads/spec.md`, adapted to a titled thread. A
> removal here is a statement about `ride_messages`, never a repeal of the rule.
>
> **Archive-ordering hazard, recorded because it is silent.** Two unarchived changes carry
> `MODIFIED` deltas against requirements this one removes —
> `openspec/changes/add-ride-chat-unread/` (*The surfaces this change does not build SHALL be named
> rather than half-built*) and `openspec/changes/invite-riders-to-a-ride/` (*Chat visibility SHALL
> be the intersection of ride visibility and crew membership, never crew membership alone*). If
> either archives **after** this one, it modifies a requirement that is gone. See `design.md` D11
> for the order to archive in.

## REMOVED Requirements

### Requirement: A ride's chat SHALL be readable and writable by its crew, and by nobody else

**Reason:** `public.ride_messages` is dropped. There is no chat to scope.

**Migration:** the rule is preserved unchanged in `ride-threads` — *"A ride's threads SHALL be
readable and writable by its crew, and by nobody else"* — over `ride_threads` and
`ride_thread_messages`. `private.is_ride_crew` is reused verbatim, same signature and same grant,
so the predicate that carried this requirement is not rewritten.

### Requirement: Chat visibility SHALL be the intersection of ride visibility and crew membership, never crew membership alone

**Reason:** as above.

**Migration:** carried into `ride-threads` as the same intersection, applied to **both** new tables
rather than one. This is the single most load-bearing rule in the capability — `034`'s own header
records that its first draft used the crew predicate *instead of* the parent `EXISTS` and shipped a
leak — and the replacement restates it at every policy rather than inheriting it through a one-hop
`EXISTS`, following `082`'s grandchild ruling.

### Requirement: Leaving the crew SHALL end access without retracting the conversation

**Reason:** as above.

**Migration:** carried into `ride-threads` whole, including the sub-rule that the leaver's own
messages are not returned to them either and that the `author_id = auth.uid()` arm stays
**subordinate** to the crew and ride-visibility conjuncts rather than becoming a top-level
alternative. The one thing that changes is the remedy for the resulting stranded row: `034` left a
residual silent `DELETE 0` here, recorded in `docs/HANDOFF.md` and deliberately left open by `102`;
the replacement has no DELETE policy at all and uses a `security definer` RPC, which closes it.

### Requirement: Blocking SHALL remove a rider from the conversation in both directions, silently

**Reason:** as above.

**Migration:** carried into `ride-threads`, and **widened** — the block arm now applies to a
thread's author as well as a message's, so a blocked rider's *thread* disappears along with their
messages. `082`'s rule that a thread by an unblocked author may still hold messages by a blocked
one is adopted with it. Decision #2 is untouched by this change in either direction.

### Requirement: The crew count a chat screen shows SHALL be per-viewer and SHALL NOT be treated as a fact about the ride

**Reason:** the chat screen that drew the count is deleted.

**Migration:** the property is not lost — it is already stated for every count in
`client-cache-invalidation` (*"Counts SHALL stay per-viewer and SHALL NOT be cached across
viewers"*), which governs the ride's crew rail and the new thread list identically. Restating it per
screen was the redundancy; removing the screen removes the restatement, not the rule.

### Requirement: A message SHALL NOT be editable, and its deletion SHALL be limited with the gap recorded

**Reason:** `public.ride_messages` is dropped, and with it the DELETE policy this requirement
constrained.

**Migration:** the no-edit half is carried into `ride-threads` unchanged, backed by the same
absent-grant-plus-absent-policy pair. The delete half is **replaced rather than carried**: the KNOWN
GAP this requirement recorded — *"an organizer cannot delete a message they cannot see"*, because
Postgres applies the SELECT policy to a DELETE whose `WHERE` reads a column — is closed in the
replacement by `082`'s answer, no DELETE policy and no DELETE grant with deletion through
`public.delete_own_ride_thread_message(uuid)` and `public.moderate_ride_thread(uuid)`. The
requirement's own text named `011`'s `moderate_comment` as the shape of the eventual fix; this is
that fix.

### Requirement: A message's identity, order and time SHALL be owned by the server

**Reason:** as above.

**Migration:** carried into `ride-threads` in full — the client-supplied `id` as an idempotency key,
`created_at` withheld from the per-column INSERT grant rather than merely defaulted, the
`(created_at, id)` tiebreak used identically in the index, the read and the cursor, and the refusal
to forge `author_id`. Nothing here is relaxed; a titled thread adds one more server-owned column
than the chat had, not fewer.

### Requirement: The chat screen SHALL tell its three kinds of zero rows apart

**Reason:** `/rides/detail/chat` is deleted.

**Migration:** carried into `ride-threads` as **four** kinds of zero rows rather than three, because
a thread list sits between the ride and the messages: the ride is not available to you, you are not
on this crew, the crew has started no threads, and this thread has no messages you can see. The
underlying rule is `client-render-shell`'s *"Permission-denied and empty SHALL be told apart where
the rider can act on the difference"*, which is untouched.

### Requirement: The thread SHALL be paginated, and SHALL NOT be read whole

**Reason:** `RIDE_MESSAGES_PAGE_SIZE` and `getRideMessages` are deleted.

**Migration:** carried into `ride-threads` and **strengthened with a second obligation the chat did
not have**: the message list still pages by keyset cursor, and the *timeline* contribution is
additionally bounded by thread count rather than message count, so that
`src/lib/data/ride-timeline.ts`'s reason for not paging survives the arrival of an unbounded source.
See `design.md` D8.

### Requirement: Ride messages SHALL have a stated retention, and its absence SHALL be a decision

**Reason:** as above.

**Migration:** carried into `ride-threads` unchanged and still an open question with a stated
default (`proposal.md` Q6). One clause is **added** rather than carried: a thread has an author of
its own, so deleting a rider destroys threads they started *including other riders' replies inside
them* — two cascade levels that no single foreign key shows. That consequence is stated explicitly
in the new spec rather than inherited silently.

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

**Reason:** the surfaces it named — Pin, Mute, attachments, typing indicators, presence, the
unread badge — were named relative to a chat screen that no longer exists.

**Migration:** the *principle* is untouched and is stated once, generally, in the `notifications`
capability (*"The surfaces this change does not build SHALL be named rather than half-built"*).
`ride-threads` names its own deferrals — reply notifications, thread reports, waves — under
`proposal.md` Q3 and Q4 rather than rendering any of them as a disabled control. The unread-badge
sub-rule survives in fact as well as in principle: the replacement extends the per-audience
watermark model exactly as that scenario required, and introduces no per-message read table.
