# Positioning — who this is for, what we may claim, and the store listing

<!-- Reference, not position. CLAUDE.md carries a signpost; this file is the content.
     It is reached by name, not auto-loaded. -->

The repo has always been able to answer *what is built*. It has never been able to answer
**what we say about it to someone who has never heard of it**, which is a different question
with different failure modes — the worst being a store listing that promises a feature the
build does not have, and a rejection or a one-star review for it.

This file is the durable half: the rider we are talking to, the claims the code actually
supports, the naming and slogan decisions, and the listing copy with its real character caps.
`.claude/agents/product.md` is the agent that maintains it.

**Everything here about the market is a stance, not a measurement.** Nothing in this container
can survey riders or read a competitor's install base, so every claim of the form *"riders
want X"* is flagged **[unvalidated]** and stays flagged until someone talks to riders. A guess
that loses its label becomes a fact nobody rechecks — `CLAUDE.md` §Working Principles.

---

## The rider we are talking to

Not the same person `.claude/agents/rider-ux.md` designs for. That brief's rider is already
*on* a ride, gloves on, at a petrol station. This one is on a sofa, on their phone, in
February, and has not ridden with anybody in a while.

Three states, and only the first is who the store listing is for:

1. **Rides alone and would rather not.** Has a bike, has no crew — moved city, mates sold up,
   or never had a group. This is the acquisition target and the only one who reads a store
   page cold. What they need to believe in one sentence: *there are people near me to ride
   with, and I can find them without joining a Facebook group full of strangers.*
2. **Already has a crew, organises badly.** Rides get planned in a WhatsApp thread where the
   meeting point scrolls away. They arrive through the first rider's invite link, never
   through the store. The listing is not aimed at them, but the **invite link landing**
   is — `/rides/join?token=…` is the app's first public non-auth route.
3. **Runs a club.** The highest-value rider and the smallest group: one of them brings ten.
   Nothing in the listing speaks to them yet, and that is a gap rather than a decision.

**[unvalidated]** All three are reasoned from the design and the schema, not from riders.
The cheapest way to test them is (2) and (3): ask the first ten riders who arrive by invite
link how they would have described the app to the person who invited them.

## What we may honestly claim

Marketing copy is a claim about the build, and the build is smaller than the design. Check
this list against the code before writing any listing — `docs/reference/product-scope.md`
§Product Scope is the per-domain state, and it moves faster than this section.

**Claimable today:**

- **A photo feed of rides, as the home screen.** Postcards — a card deck you swipe, with
  likes, comments and a link share. This is the app's actual centre of gravity and the thing
  most competing apps do not have.
- **Clubs.** Join, browse, a timeline of everything the club did, titled threads, member
  invites and invite links.
- **Rides.** Plan one with a meeting point, a date and a club; a static map thumbnail and a
  hand-off to Google Maps; a crew list; Going / Maybe / No; titled threads; shareable invite
  links with an expiry and a revoke.
- **Notifications** for the things other riders do.
- **Safety and control.** Block a rider, report a postcard or a thread, hide a postcard,
  and delete the account outright — all four are built and reachable.

**Not claimable — do not write these words:**

| Do not say | Because |
|---|---|
| "chat", "message a rider", "DMs" | There are no direct messages. Rides and clubs have **threads**, which is deliberately not chat — `docs/reference/product-scope.md` says so in the Clubs row |
| "track your rides", "record your route", "GPS" | Nothing records a route. Decision #3 is a static thumbnail plus a deeplink, and background location is roadmap, not build |
| "navigation", "turn-by-turn" | Google Maps does that; we hand off to it |
| "your garage", "log your bike", "gear", "badges" | The Garage domain is not built |
| "browse rides without signing up" | Decision #1 — there is no anonymous access anywhere, and `is_public` means "visible to any signed-in rider" |
| "free forever", "no ads, ever" | Nobody has decided the business model. Do not invent one in a store listing |

The last row is the general rule: **a listing is the one place where an unstated assumption
becomes a public promise.** If a claim is not in the first list, it needs a decision before it
needs copy.

## Four things that shape every campaign

These are constraints, not to-dos. Each one changes what marketing is even possible.

1. **Nothing is visible without an account.** Decision #1. There is no web page a curious
   rider can look at, no shareable feed, no SEO surface — a shared postcard link unfurls the
   generic app description and then asks for a login. So **every acquisition channel has to
   carry the whole pitch itself**; the app cannot help. This is the single biggest difference
   between marketing this app and marketing a normal social product.
2. **Onboarding is required and not skippable.** Decision #5. Between the install and the
   first screenshot-worthy moment sit terms, a username with live availability checking, and
   a location step. Every one is a place a rider leaves. This is the funnel worth
   instrumenting before any spend — `docs/reference/analytics.md` §What each number is for
   already counts the four stamps.
3. **A new rider lands in a club rather than an empty app.** `complete_onboarding` joins them
   to the club carrying `clubs.is_default`. That is the answer to the cold-start problem and
   it is already built, so the listing may honestly promise company on day one — provided
   that club has something in it.
4. **The backend pauses.** Supabase's free tier auto-pauses after ~7 days idle and serves
   nothing, with no alert. **Any campaign against a paused project converts to a blank
   screen.** `docs/reference/native-shell.md` §Store readiness has this as row 6, owner-only.

## The name, and the slogan

**The product is `LetsRide`, one word.** Already fixed by things that are expensive to move:
the domain (`letsride.social`), the OG `siteName`, the icon and the logo alt text. A store
listing that writes it `Let's Ride` creates a second brand for no gain. Check the app's own
copy rather than trusting this line:

```bash
grep -n "^const TITLE\|^const DESCRIPTION" src/app/layout.tsx
```

**"Ride together" is already the app's own tagline** — `LetsRide — Ride Together` is what
unfurls from every shared link today. Keep it. A store subtitle that says something different
from the link preview splits the brand at the exact moment a rider is checking whether the two
are the same app.

### The character caps are the whole design problem

The store fields are short in a way that is not obvious until copy is measured against them.
**Measure, do not estimate** — `wc -m` counts characters, `wc -c` counts bytes and will lie
the moment an apostrophe becomes a typographic one:

```bash
printf '%s' "Ride together, share the story" | wc -m    # 30
```

| Field | Cap | Notes |
|---|---|---|
| App Store — app name | 30 | Highest keyword weight of any field |
| App Store — subtitle | 30 | Second highest. Shown under the name in search results |
| App Store — keywords | 100 | Comma-separated, **no spaces after commas**; never repeat a word already in the name or subtitle |
| App Store — promotional text | 170 | Editable without a review — the only field that is |
| App Store — description | 4000 | Almost nobody expands it; the first ~3 lines are what is read |
| Play — title | 30 | |
| Play — short description | 80 | The one that appears above the fold |
| Play — full description | 4000 | Indexed for search, unlike Apple's |

**These caps move.** Check them against App Store Connect and the Play Console before a
submission rather than against this table.

### The proposed slogan, measured

The product owner's line is **"Share your story, ride together"**. Two findings:

- **It is 31 characters and the subtitle cap is 30.** One over. `"Share your story, ride
  together" | wc -m` → 31. Reversing it does not help: "Ride together, share your story" is
  also 31. Swapping `your` for `the` lands it exactly on 30.
- **The instinct is right and worth keeping.** "Share your story" names the *home screen* —
  the app opens on a photo deck, not on a route planner — and that is the honest
  differentiator. Selling this as a ride-planning tool would put it next to apps that also do
  navigation and route recording, which this one deliberately does not. **[unvalidated]** as a
  market claim; sound as a description of the build.

**The recommended split — the title carries the category, the subtitle carries the promise:**

| Field | Proposed | Chars |
|---|---|---|
| Name | `LetsRide: Motorcycle Rides` | 26 |
| Subtitle | `Ride together, share the story` | 30 |
| Play short description | `Plan motorcycle rides, join a club, and share the photos from the road.` | 71 |

The reason the name changes shape: **the word "motorcycle" appears nowhere in "LetsRide" or
"Ride Together"**, and it is the word a rider types into a store search. The name field is
where a keyword is worth the most, so spending 18 of its 30 characters on the category is the
highest-value edit available in the whole listing.

Alternatives, all within cap, if the owner prefers a different emphasis:

| Subtitle | Chars | Leads with |
|---|---|---|
| `Ride together, share the story` | 30 | Both — the recommendation |
| `Find your crew. Ride together.` | 30 | The lonely rider (state 1) |
| `Plan rides, join clubs, share` | 29 | The mechanics |
| `Where riders find their crew` | 28 | The place, not the action |

### Description — the first three lines

Everything below the third line is read by almost nobody, so the whole pitch lives there:

> Find riders near you, plan a ride together, and keep the photos.
>
> LetsRide is where motorcycle riders organise the next ride and share the last one. Join a
> club, see what everyone has been riding, and turn a group chat that lost the meeting point
> into a ride with a map, a time and a crew list.

Then the feature list, drawn only from the claimable table above.

## The two listing fields nobody owns yet

Both are submission blockers and neither is copy:

- **Support URL is required by App Store Connect, and there is no support page.** The public
  routes are `/legal/privacy`, `/legal/terms`, `/legal/attributions` and
  `/legal/account-deletion` — check rather than trust: `ls src/app/legal/`. The privacy policy
  URL is covered; the support URL is not, and the apex that would normally host it is
  unattached (`PD-34`, `docs/ENVIRONMENTS.md` §Domains).
- **The App Privacy label is wrong** and has been since the observability SDKs landed —
  `docs/reference/native-shell.md` §Store readiness row 8 owns it. It is a listing artefact
  that a product decision drives, so it belongs on this file's radar even though the work is
  `native`'s.

## Where a rider actually hears about this

**[unvalidated]** — no channel here has been tested, and the ordering is reasoning about the
constraints above, not evidence.

The binding constraint is #1: nothing is visible without an account, so channels that rely on
a link being interesting on its own are weak, and channels where a **person** does the
vouching are strong.

1. **The invite link.** Already built, already the strongest thing available: it arrives from
   someone the rider knows, with a specific ride attached. Every improvement to
   `/rides/join?token=…` is an acquisition improvement.
2. **Club organisers.** One organiser brings a group. Nothing in the product courts them yet.
3. **Local meets and dealer noticeboards.** Geography is the whole product — a club with three
   members in the wrong country is worth nothing.
4. **Motorcycle communities online.** Cheap, and the place where "no anonymous browsing" hurts
   most: a link posted there shows nothing.
5. **Paid install ads.** Last, and not before the funnel in #2 above is instrumented and the
   backend is off the free tier.
