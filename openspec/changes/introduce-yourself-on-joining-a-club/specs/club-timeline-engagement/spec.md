## REMOVED Requirements

### Requirement: The words half of "say welcome" SHALL be rider-initiated and SHALL create no schema

**Reason**: The product owner replaced the affordance on 2026-09-01. The join row's ⋯ overflow and
its single `Say welcome` item are removed and the row's second target becomes the newcomer's own
introduction thread instead. The requirement's own reasoning is what makes the replacement safe
rather than a reversal: it refused an **automatic** thread because such a thread must name a rider
who did not write it, and because the joiner could then delete words other riders wrote. Neither
holds for a thread the newcomer typed and posted — they are the author, the title names nobody, and
deleting their own introduction is exactly the right `081` already gives every author.

Its third argument, that `058`'s default club would mint one thread per signup, is answered by
exempting that club from the prompt — the same carve-out `private.notify_club_joined` already
makes, and affordable here in a way it was not there, because the alternative is not "no welcome"
but "a modal inside the onboarding wizard".

**Migration**: The replacement lives in `club-introductions`. Specifically:

- *"No thread is created without a rider composing it"* is preserved and strengthened —
  `club-introductions` §*An introduction SHALL be written in ONE statement* keeps the rule that no
  trigger writes a `club_threads` row, and no trigger is added to `club_members` by this change
  either.
- *"The composer is pre-filled and fully editable"* has no successor and needs none: there is no
  pre-filled composer, because the words are the newcomer's rather than a welcomer's.
- *"A welcome thread names a rider who may leave"* is superseded by
  `club-introductions` §*Leaving a club SHALL detach the introduction and SHALL destroy nothing*,
  which is stricter — the thread now carries an explicit marker, and the marker is cleared on the
  leave while the thread survives.
- A member who wants to welcome a newcomer in words now **comments on the introduction**, which is
  what the count on the join row is counting. Where the newcomer wrote none, the thread composer
  keeps its entrances on the create bar and the club's ⋯ menu.

Every other requirement of `club-timeline-engagement` is untouched. The wave stays, on both
subjects, with its own-row absence, its per-viewer count and its fan-out exactly as `092` shipped
them — the product owner's words being *"this can be waved or commented"*.
</content>
