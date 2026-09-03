# A postcard of a past ride should sit where the riding happened — options, not a decision

> Linear **PD-377**. This proposal is filed by the owner's own instruction to end in
> `Needs decision` with no code, no migration, and no option chosen. It exists to enumerate the
> options and their trade-offs, per `CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that
> grows a specification is a bug."* The specification — such as it is — lives here; PD-377 points
> at it.

## Why

A rider photographs a ride and posts the postcard days later. Today the postcard is **new** —
`created_at`-ordered, badged unread, at the top of the feed — and that is the only fact the app
records: it has no memory of *when the ride happened*, only of *when the postcard was posted*.
Product owner, 2026-09-03: *"Riders may be wanting to post pictures in the past. Meaning these
postcards can still be highlighted as new, but then displayed somewhere in the past of the
timeline."*

So this is not "sort by an earlier date" — it is two facts that must both stay true at once:
**new** (unread, reachable through the feed a rider actually opens) and **old** (placed, on
whichever surface shows placement, at the time the ride happened rather than the time it was
told). Today recency wins and swallows the second fact entirely.

## What already exists, and what it does not cover

`064` and PD-255 already capture a photo's own moment: `postcards.taken_at` (from EXIF
`DateTimeOriginal`) and `taken_at_offset_minutes`. The ride Journal already orders on `taken_at`
rather than `created_at` — the exact "order on the riding, not the telling" this proposal asks
for, already shipped, on one screen.

Three gaps stop that from being the whole answer:

1. **`taken_at` is NULL whenever EXIF is missing or stripped.** A screenshot, a photo forwarded
   through a messaging app, or a rider who declined the camera's location/metadata permission all
   produce `taken_at IS NULL`. It cannot be the *only* mechanism — some rider input has to cover
   the NULL case, which is also exactly the case the product owner is describing ("posting
   pictures in the past" reads as an explicit, rider-stated backdate, not an EXIF read).
2. **Only the Journal reads `taken_at` today.** The feed, a club feed, and a profile all order on
   `created_at`. Extending the ordering to those surfaces is in scope for whichever option is
   chosen; which of them changes and which stays on `created_at` is decided per-option below,
   because they do not have to agree (a club feed's "recent activity" reading is a different
   question from a personal Journal's "the story in order").
3. **`taken_at`'s two privacy postures.** PD-265 settled that `Hide` (one of the location
   privacy modes `taken_location_precision` carries) covers the photo's *location* and not its
   *time* — `taken_at` renders on the Journal regardless of `Hide`. If any option below makes the
   *displayed feed position* depend on `taken_at`, that decision is being read again here rather
   than assumed to still hold, because "when" and "where" stop being independent the moment a
   feed's sort order becomes a public signal of "this rider was in this place, at this time."

## The negative cases every option must answer — `openspec/config.yaml`'s rule for this file

- **A backdated postcard must not be able to hide.** A feed ordered by a rider-supplied date lets
  a postcard dated 1990 sink below everything, permanently — including one that was reported.
  Every option below states what stops that.
- **Nor pin itself to the top.** The mirror case: a future date. `064` already refuses a future
  `taken_at` at the database layer; a rider-supplied backdate needs the identical CHECK, not a
  Zod mirror of one — `CLAUDE.md`: *"No new integrity rule may live only in a Zod schema."*
- **Unread must never follow the displayed date.** A postcard is new because the *viewer* has not
  seen it, not because of when it happened — `feed_reads` compares against `created_at`, which is
  server-owned and untouched by any option below. Moving "new" onto a client-legible date makes
  new/not-new forgeable by whoever controls the backdate.
- **What a rider may change after posting, if anything.** `044` made `postcards.created_at`
  server-owned specifically so a rider cannot rewrite their own feed position after the fact.
  Whatever field this proposal adds needs the same question answered explicitly, not inherited
  by assumption from `created_at`'s rule.
- **The Welcome club and any other automated poster.** None today, but any option that lets a
  rider *state* a date rather than only *read* one from EXIF should say whether that input is
  gated the same way every other content write is (`023`'s participation gate) — it already would
  be, by table, but say so rather than leave it silent.

## Options

### A) Read-only: extend the existing `taken_at` ordering to more surfaces, add nothing new

Use `taken_at` (falling back to `created_at` when NULL) as the sort/placement key on whichever
surfaces this option extends it to — most naturally the profile Journal-adjacent views, since the
feed and a club feed are activity streams first. No rider-facing date input; a postcard with no
EXIF timestamp keeps behaving exactly as today (posted-time ordering).

- **Fixes:** the camera-EXIF case only — a rider who shot photos on a real ride and posted them
  later, with EXIF intact.
- **Does not fix:** the case the product owner named directly — a rider *choosing* to post
  something as "from the past" with no EXIF to read (a screenshot, a forwarded photo, a stripped
  file). That is most of "posting pictures in the past" as stated.
- **Negative cases:** trivially satisfied — `taken_at` already has the future-date CHECK (`064`),
  and there is no new rider-supplied input to forge unread from.
- **Migration:** none. **Composer change:** none.

### B) Rider-supplied "this happened on" date, read-only display placement, `created_at` still gates unread

Add a nullable `postcards.displayed_at timestamptz` (name open) the composer can set at posting
time — defaulting to unset, meaning "now," so this is opt-in per postcard. Ordering/placement on
every surface this option extends becomes `coalesce(displayed_at, taken_at, created_at)`. Unread
stays keyed on `created_at` exclusively, per the negative case above, so a backdated postcard is
still badged new and still reachable through whatever "what's new" affordance exists — it simply
renders positioned in the past rather than at the top.

- **Fixes** the full request: a rider can post a photo (EXIF or not) and say when it belongs.
- **Database rule needed:** a CHECK refusing a future `displayed_at` (mirrors `064`'s `taken_at`
  rule) — belongs in the migration, not Zod.
- **Sinking to the bottom:** answered explicitly rather than left to "whatever falls out" — either
  a floor (refuse a `displayed_at` older than N, e.g. the rider's account creation, or the club's
  founding) or an accepted trade-off that a rider CAN bury their own postcard arbitrarily far back,
  which is a choice about the rider's own content and not obviously wrong — this is the one place
  this proposal asks for a product answer rather than proposing one.
- **Mutability:** open question — is `displayed_at` set once at posting time only (matching
  `044`'s posture on `created_at`), or editable after? The safer default is once-only, stated
  explicitly rather than left implicit.
- **Migration:** one column, one CHECK, one index if placement needs one for feed pagination —
  **and its own grant.** `postcards`' column grants are managed as the absolute
  `041 → 044 → 046` list (`docs/reference/migrations.md` §The ordering chain): a bare
  `alter table postcards add column displayed_at ...` does not itself grant `authenticated`
  anything on the new column, and re-running an earlier file in that chain after this one lands
  would revoke it again if the new grant is not folded into that same absolute list. The migration
  task for this option is "add the column, add the CHECK, and extend the grant list," not just the
  first two.
  **Composer change:** one optional date field.

### C) Same as B, but `displayed_at` also becomes the unread key for the surfaces it changes

Everything in B, except unread on the affected surfaces compares against `displayed_at` rather
than `created_at` where it is set.

- **This is the option the negative-case rule above forbids as stated**, and it is listed only so
  the trade-off is visible rather than silently avoided: it makes "new" mean "recently dated"
  instead of "unseen by you," which is forgeable (post a photo backdated to yesterday, and it
  reads as fresher than one truthfully dated last month) and breaks `feed_reads`' own invariant.
  **Not recommended** without a restated reason the negative case does not apply — included for
  completeness, since the product owner's own phrasing ("still be highlighted as new, but then
  displayed... in the past") reads as closer to B, but a reader comparing options should see why
  C was rejected rather than have it silently missing.

## Recommendation, not a decision

**B**, with the two open sub-questions (mutability, and whether "how far back" needs a floor)
put to the owner explicitly rather than guessed. A is real but partial — it should probably ship
regardless of what the owner decides on B, since it is a strict improvement with no new surface
and no negative cases to answer. C is named to be explicitly declined, not chosen.

## Not decided here

Which surfaces (feed, club feed, profile, Journal) each option extends to, `displayed_at`'s exact
name and mutability, and whether a floor is needed — all product decisions, all owed to the owner
rather than picked by this proposal.
