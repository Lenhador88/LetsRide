# Design — the Explore question row

Read this before `tasks.md`. Eight findings, each of which changes what the obvious implementation
would be. D1, D2 and D8 contradict something the issue or a neighbouring file currently asserts.

## D1 — `nearLabel()` can return the literal string `you`, so the new copy MUST NOT use it

Both tab roots pass `town={label?.name}` where `label = nearLabel(position, city.data)`, and both
Explore screens pass `town={nearLabel(position, city.data)?.name}`. `nearLabel` returns
`{ name: 'you' }` in **two** branches — a device-sourced position, and a profile-sourced position
whose city `localityOf` declines to shorten:

```ts
if (position.source === 'device') return { name: 'you' }
const locality = localityOf(profileCity)
return { name: locality ?? 'you' }
```

Today's label absorbs that harmlessly: `Near you · Use my location` is a sentence. The new copy does
not: **`Still in you?`**. So the row takes the **raw `profiles.location`** and reduces it with
`localityOf` itself — which is `describeRiderLocation`'s shape in `src/lib/location/setting.ts`, and
the reason that function takes `town` raw with the comment *"Reduced with `localityOf` here rather
than by the caller"*.

`localityOf` returns `null` only for an empty or whitespace string, and a profile-sourced position
implies a non-empty town that geocoded — so in `refine` and `confirm` the name always exists and
there is no fallback string to invent. That is a property worth a test in both directions, because
it is the whole reason the `you` fallback can be dropped rather than translated.

**The rule the row obeys is still `near-label.ts`'s** — *the name must come from the same source as
the number* — it just cannot obey it by calling that function.

## D2 — the issue's list of tests to rewrite includes one that this change does not touch

`src/components/rides/__tests__/ExploreRidesStrip.test.tsx` asserts the strip's place clause and that
the door renders in all three states. Neither the strip nor its props change; the file contains no
reference to `UseMyLocationRow`, the location row or the priming states:

```bash
grep -c "UseMyLocationRow\|Location" src/components/rides/__tests__/ExploreRidesStrip.test.tsx   # 0
```

It stays as it is. What the change owes that file instead is a **negative** check: the tab roots'
rendered output no longer contains a second `h-14 … bg-surface` row in the strip's slot.

## D3 — the copy does NOT belong in `explore-label.ts` or `near-label.ts`

Those two modules exist because one *sentence about distance* was written twice and drifted
(PD-427), and they are read by four surfaces: both strips and both Explore lists. The question is a
different sentence with a different subject, read by one component. Putting it there would widen two
modules that were narrowed on purpose two days ago, and a future edit to the Explore sentence would
land in the same file as the question.

It goes beside the decision that produces it, in `src/lib/location/priming.ts` — one module owning
*the state and the string for that state*, which is `setting.ts`'s shape for the profile screen.

## D4 — a sixth state, rather than the component re-reading the permission

The lifted exclusion (profile position + `denied`/`unavailable`) needs a row whose tap goes to the
town sheet and never to the device offer. Two implementations:

- **Return `refine` and branch in the component on `permission === 'denied'`.** Rejected: the
  component then re-derives the very exclusion the pure function is supposed to own, and the dead end
  can come back through a second door. `priming.ts`'s own header says the split exists so that "every
  state gets a named test; folded into the component, only the two states a `renderToStaticMarkup`
  pass can reach do".
- **Add `confirm`.** Taken. Six states, six named tests, and the destination is a property of the
  state rather than of the render.

`LocationPrimingState` therefore becomes
`'hidden' | 'ask' | 'blocked' | 'town' | 'refine' | 'confirm'`.

## D5 — the `riderOpenedSheet` latch is deletable only because the timer is

The latch exists for one reader — the timer's closure, which cannot see `open`/`askingTown` without
re-arming itself on every open and close. Its long header documents a sub-frame race that `act()`
flushes away. With no timer there is no reader, and it is dead rather than merely unused. **Delete
the ref and its header together**; leaving the header behind is the comment trap being created
deliberately, since it describes machinery that no longer exists.

## D6 — `JSON.parse('1')` succeeds, so the guard must test the shape

The stored value moves from `'1'` to a record. Any read that only wraps `JSON.parse` in a `try`
accepts `1`, `"x"`, `null` and `[]` as valid, and `null.at` then throws somewhere less obvious. The
parse must assert: a non-null object, `at` a finite number, `n` a non-negative integer. Anything else
is *absent* — which fails **open**, the direction `ask-once.ts`'s header already argues for and this
change keeps.

A new key (`letsride.location.dismissedQuestion`) rather than the old one, and the old key is
**removed** rather than left: an unread `letsride.location.asked === '1'` on a returning rider's
device means "the automatic ask was spent", and after this change nothing may act on that.

## D7 — the two Explore screens draw the row in different places, and one of them is gated on the list

`/clubs/explore` mounts the row **above** its `clubs.error` / `!clubs.data` branch, so it renders
during load and on the error path. `/rides/explore` mounts it **inside** the success branch, so a
rider whose ride list is failing or still loading sees no row at all — even though the row's inputs
(permission, position, town) have nothing to do with that read.

The row's states must be a function of its own inputs. Both screens move it outside the list gate,
which makes the placement one decision instead of two and puts the question on the error path, where
it is at least as useful.

## D8 — three neighbours assert things this change makes false

Each is a load-bearing comment or doc claim, not prose:

1. **`src/components/push/PushPrimingRow.tsx`** — *"That is task 2.9's decision and it is narrower
   than the location row's, which draws on **three screens**"* and *"**There is deliberately no
   automatic ask.** `UseMyLocationRow` has one, on a timer, for the Explore screens"*. After this
   change the location row draws on **two** screens and has **no** automatic ask, so the push row's
   narrowness argument inverts: it is now the same posture, not a stricter one.
2. **`docs/reference/running-locally.md`** — line 15 names `src/lib/location/__tests__/ask-once.test.ts`
   in the Node-26 `localStorage` measurement (4 failing tests in that file), and line 487 justifies
   `UseMyLocationRow.dom.test.tsx` as *"a timer inside a mounted effect"*. Renaming the module and
   deleting the timer makes both stale, and the first is a *measurement* someone will re-run.
3. **`scripts/walk.mjs`** — `dismissLocationSheet()` is called at three points to clear a sheet that
   opened by itself. With no automatic ask it can never fire. It asserts nothing and swallows its own
   failures (`.catch(() => false)`), so it will not go red; it will simply become a helper that reads
   as live and is dead. The walk's Explore phases get *more* reliable without it.

## D9 — where the ladder is read and written

| Event | Effect on the record |
|---|---|
| Row rendered | read only; never written |
| Sheet closed without an answer (button, scrim, Escape) | `{ at: now, n: prev.n + 1 }` |
| Town stored — any route through `setRiderTown` | `{ at: now, n: 0 }` |
| Device permission granted (a fix came back) | record removed |
| Sign-out | record removed |
| Read fails or does not parse | treated as absent — the row draws |
| Write fails | nothing; the row draws again next visit (the accepted nuisance) |

The reset lives **inside `setRiderTown`**, not in the two sheets' callbacks: it is the column's only
writer, so every route — the row's sheet, `/profile`'s `LocationSetting`, onboarding — resets by
construction, and a fourth route added later cannot forget. `signOut` already clears five device-local
things beside the session, so a sixth is the established shape rather than a new one.

**A failed *reset* fails closed** — the rider acted and the row stays quiet for the remaining
interval. That is the one direction that does not fail open, and it is accepted: the question has
just been answered, so silence is the correct outcome anyway; only the ladder position is wrong, and
one dismissal later than it should be.
