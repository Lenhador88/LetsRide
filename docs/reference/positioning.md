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
can survey riders, so every claim of the form *"riders want X"* — or search for X, or read X —
is flagged **[unvalidated]** and stays flagged until someone talks to riders. A guess that
loses its label becomes a fact nobody rechecks, which is `CLAUDE.md`'s rule about an
unlabelled guess.

**A competitor is NOT in that class, and treating it as one is how the label becomes an excuse
not to look.** A rival listing is a public web page, and `product` holds `WebFetch` and
`WebSearch`, so what another app claims to do is *checkable*. A comparison below that carries
the label carries it because nobody has looked yet — never because nobody could.

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

   **In the launch market this state has a name: the expat.** Someone who moved to the
   Netherlands, whose riding mates are in another country, and for whom the existing option is
   a club that organises in Dutch. They are the sharpest available wedge — the state-1 rider
   who is concentrated, reachable, and least served by what exists — and they are why the app
   ships in English. See §Launch market.
2. **Already has a crew, organises badly.** Rides get planned in a WhatsApp thread where the
   meeting point scrolls away. They arrive through an invite link, never through the store —
   `/rides/join?token=…` and `/clubs/join?token=…`, the first public paths that are **not an
   auth screen or static copy**. Drop that second clause and the claim is simply false: `/`
   and `/legal/*` are public, non-auth and older.

   **Neither landing is a pitch surface, and neither may be turned into one.** They are public
   so they can *hold a credential* through the auth round trip, never so they can show
   anything — a visitor with no session gets a generic sentence and two buttons, because the
   preview RPC needs `auth.uid()` for its block and participation checks. `src/lib/auth/guard.ts`
   says so in as many words, and decision #1 is what makes it non-negotiable. What can be
   improved is the **hand-off**: what the sharing rider's message says, and how few taps sit
   between the tap and the ride once there is a session.
3. **Runs a club.** The highest-value rider and the smallest group: one of them brings ten.
   Nothing in the listing speaks to them yet, and that is a gap rather than a decision.

**[unvalidated]** All three are reasoned from the design and the schema, not from riders.
The cheapest way to test them is (2) and (3): ask the first ten riders who arrive by invite
link how they would have described the app to the person who invited them.

## What we may honestly claim

Marketing copy is a claim about the build, and the build is smaller than the design. Check
this list against the code before writing any listing — `docs/reference/product-scope.md`
§Product Scope is the per-domain state, and it moves faster than this section.

**Measured against `development` on 2026-09-07 — which is not what a rider installs.** A
listing describes the *promoted* build, and `main` runs five migrations behind. One row differs
today and it is one this file leans on: **a ride has titled threads on `development` and a chat
on `main`**, because `108`/`109` are DEV-only. So the claim below and the do-not-say row about
"chat" are both right for `development` and both wrong for production until that promotion
lands. Re-derive the gap rather than trusting this paragraph —
`docs/reference/migrations.md` §Applied state, and `list_migrations` against both refs.

**Claimable today:**

- **A photo feed of rides, as the home screen.** Postcards — a card deck you swipe, with
  likes, comments and a link share. This is the app's actual centre of gravity — a claim about
  the build, and safe. That **most competing apps do not have it** is a different claim,
  **[unvalidated]**, and it must not be laundered into a listing as "the only motorcycle app
  with a photo feed": nothing here has read a competitor's listing, and `product` can.
- **Clubs.** Join, browse, a timeline of everything the club did, titled threads, member
  invites and invite links.
- **Rides.** Plan one with a meeting point, a date and a club; a static map thumbnail and a
  hand-off to Google Maps; a crew list; Going / Maybe / No; titled threads; shareable invite
  links with an expiry and a revoke.
- **Notifications** for the things other riders do.
- **Safety and control.** Block a rider, hide a postcard, report a postcard or a **club**
  thread, and delete the account outright. **Reporting is not uniform, and a listing must not
  imply it is: a RIDE thread has no report affordance.** That is a deferral rather than a
  decision — `094` gave `club_thread_reports` no ride counterpart — and it is the gap App Store
  Review Guideline 1.2 asks about. Check rather than trust it:
  `grep -rn "export async function report" src/lib/actions/` names two.

**Not claimable — do not write these words:**

| Do not say | Because |
|---|---|
| "chat", "message a rider", "DMs" | There are no direct messages — `docs/reference/product-scope.md` establishes that in its **Inbox** row. Rides and clubs have **threads** instead. Do not cite the Clubs row for this: its version of the sentence argues a thread is not a chat *because the ride has a Chat*, which PD-402 retired on `development` |
| "report any post", "report anything" | Reporting covers postcards and club threads only. See the safety bullet above — over-claiming here is this table's worst failure, because Guideline 1.2 is the one that checks |
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
   first screenshot-worthy moment sit **two** screens — terms, and a username with live
   availability checking. Both are places a rider leaves. **Two, not three: `075` (PD-286)
   deleted the location step, and `complete_onboarding(p_location text)` kept the argument, so
   the RPC signature reads as corroboration for a screen that is gone.** The check is
   `ls src/app/onboarding/`. This is the funnel worth instrumenting before any spend —
   `docs/reference/analytics.md` §What each number is for already counts the four stamps.
3. **A new rider lands in a club rather than an empty app.** `complete_onboarding` joins them
   to the club carrying `clubs.is_default`. That is the answer to the cold-start problem and
   it is already built, so the listing may honestly promise company on day one — provided
   that club has something in it.
4. **The backend pauses.** Supabase's free tier auto-pauses after ~7 days idle and serves
   nothing, with no alert. **Any campaign against a paused project converts to a blank
   screen.** `docs/reference/native-shell.md` §Store readiness has this as row 6, owner-only.

## Launch market — one country, not two

The owner's initial vision names **the Netherlands or Portugal**, scaling from there. Two
things follow, and the first is the more important.

**DECIDED 2026-09-07: the Netherlands, alone.** Geography is the whole product — a rider opens
the app to find *people near them*, and a club with three members in the wrong country is worth
nothing. Splitting the launch across two countries would have halved the density in each while
doubling the localisation work, and density is the thing being tested. Portugal is a later
market, not a parallel one. The repo already agreed: `APP_TIME_ZONE` in `src/lib/utils.ts` is
`Europe/Amsterdam`.

**DECIDED 2026-09-07: English first — app and listing both.** Not a compromise, and the reason
is a targeting one rather than a budget one. **The expat rider in the Netherlands IS rider state
1**, exactly: someone who moved country, whose riding mates are in another one, who has a bike
and nobody to ride with. They are findable, they are concentrated in the Randstad, they are
under-served by anything organised in Dutch — and they are the hardest segment for a
Dutch-language product to reach. An English app is what serves them, and Dutch riders'
English is not the obstacle it would be in most markets **[unvalidated]** as a claim about any
individual rider.

Three consequences, and the second is the one that is easy to get wrong:

- **The listing stays English too, for now.** A Dutch listing over an English-only app is a
  mismatch — it converts a Dutch-language searcher into a disappointed installer, and it is the
  kind of inconsistency store review notices.
- **What that costs is Dutch keyword MATCHING, not visibility.** An un-localised listing still
  appears in the Dutch storefront under the app's primary language; what is given up is
  matching on `motorrijden`, `motorclub`, `motorrijders`. Verify that in App Store Connect
  before relying on it — this file's store mechanics are the class that moves.
- **Dutch becomes worth doing the day the app is Dutch**, which is the i18n decision
  `CLAUDE.md` holds open. Do not localise the listing ahead of the app to buy search terms.

**Localise the LISTING before localising the APP.** Both stores let the name, subtitle,
keywords and description differ per storefront, and the app itself does not have to change for
that to work — this is the largest ASO lever available and it costs nothing but the words.
Three mechanics worth knowing before anyone writes them:

- **`pt-PT` and `pt-BR` are separate storefront locales**, and Portugal is not Brazil. The
  everyday word for the machine is `mota` in Portugal and `moto` in Brazil. Writing the listing
  in Brazilian Portuguese for a Portuguese launch is the most likely single mistake here.
- **Dutch: `motor` means motorcycle**, not engine, in ordinary speech — so the searched terms
  are `motor`, `motorrijden`, `motorrijders`, `motorclub`.
- **Do not let a model write the final localised strings.** These are the words riders type,
  and a plausible translation that no rider uses is invisible until the listing underperforms
  with no way to tell why. The mechanism above is a store fact; every specific word in it is
  **[unvalidated]** and wants one native rider's eye before it ships.

**This raises i18n, which `CLAUDE.md` lists as deliberately undecided.** A localised listing
that lands a Dutch rider in an English-only app is a conversion question rather than a bug, and
the app is more English than it looks: `grep -n "en-US" src/lib/utils.ts` finds the locale
hardcoded at four `Intl` call sites. That is a decision to take deliberately before a launch,
not a task to slip into a copy change.

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
**Measure, do not estimate — and set the locale, because the obvious command is wrong here:**

```bash
printf '%s' "Share your story—ride together" | LC_ALL=C.UTF-8 wc -m   # 30 — correct
printf '%s' "Share your story—ride together" | wc -m                  # 32 — wrong
```

`wc -m` counts *characters* only under a UTF-8 locale. This container has `LANG` and `LC_ALL`
unset, so it falls back to counting bytes and an em-dash reads as three. `wc -c` is always
bytes. A pure-ASCII candidate is unaffected — which is the trap, because every count in the
tables below was ASCII and right, and the first candidate with a typographic character in it
was silently over by two. **`LC_ALL=C.UTF-8 wc -m`, or `python3 -c "print(len(…))"`.** The
characters that trigger it are exactly the ones a copy pass introduces: `—`, `–`, `’`, `…`.

| Field | Cap | Notes |
|---|---|---|
| App Store — app name | 30 | Highest keyword weight of any field **[unvalidated]** |
| App Store — subtitle | 30 | Second highest **[unvalidated]**. Shown under the name in search results |
| App Store — keywords | 100 | Comma-separated, **no spaces after commas**; never repeat a word already in the name or subtitle |
| App Store — promotional text | 170 | Editable without a new version — the only *marketing copy* field that is. The three URL fields are editable any time too |
| App Store — description | 4000 | Almost nobody expands it **[unvalidated]**; write for the first ~3 lines |
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
| Subtitle | `Tell your story, ride together` | 30 |
| Play short description | `Plan motorcycle rides, join a club, and share the photos from the road.` | 71 |

**The subtitle is the product owner's own wording, 2026-09-07, and it needs no edit** —
`Tell your story, ride together` is exactly 30. (`Share your story, ride together` is 31, and so
is its reversal; `Tell` for `Share` is what buys the character, with the comma intact.)

**On the apostrophe.** `Let's Ride: …` is over the cap on every construction, but the real
reason not to use it is that the brand is already `LetsRide` in the places that are expensive to
change — the domain, the OG `siteName`, the icon. Two spellings is two brands.

### Choosing the second half of the name

The brand half is fixed, so the name is one decision: which ~18 characters follow `LetsRide:`.
Measured candidates, and what each buys:

| Name | Chars | Buys | Costs |
|---|---|---|---|
| `LetsRide: Motorcycle Rides` | 26 | **The recommendation.** The two highest-volume category words, both literally true of the product | `Rides` overlaps the brand and the subtitle, so it may earn less than it looks |
| `LetsRide: Motorcycle Clubs` | 26 | The most product-exact — clubs *are* the social graph | In Dutch media `motorclub` is the ordinary word for an outlaw MC, which is a sharper cost in the launch market than in English |
| `LetsRide: Motorcycle Community` | 30 | Says "social" outright, which is the pitch | Spends every character, and nobody searches the phrase |
| `LetsRide: Motorcycle Meetups` | 28 | `meetup` is a social word people do search | Suggests events rather than rides; the app plans rides |
| `LetsRide: Motorcycle Riders` | 27 | Names the person rather than the activity | `Riders` is close to the brand and adds little |
| `LetsRide: Riders & Clubs` | 24 | Two product-true nouns | **Drops `Motorcycle`, which is disqualifying** — see below |

**`Motorcycle` is not optional, and the strongest evidence is from this project.** `LetsRide`
plus any word about riding reads as bicycles, horses or carpooling to someone who has never seen
it — and the product owner, whose app it is, wrote *"this is a cycling app"* in the same message
that proposed the name. If the word can slip for the person who built it, it will slip for a
stranger reading 26 characters in a search result. Whatever else the name carries, it carries
`Motorcycle`.

The reason the name changes shape: **the word "motorcycle" appears nowhere in "LetsRide" or
"Ride Together"**. That absence is a fact about two strings. **Everything drawn from it is
[unvalidated] ASO reasoning** — that a rider types the category into store search, that the
name field weighs a keyword most, and therefore that spending 18 of its 30 characters on the
category is the highest-value edit in the listing. It is this file's headline recommendation
and it rests on no measurement taken here; the first real test is the store's own search
results after a submission.

Alternatives, all within cap, if the owner prefers a different emphasis:

| Subtitle | Chars | Note |
|---|---|---|
| `Share your story—ride together` | 30 | **The recommendation.** Every word the owner chose, kept. The comma-and-space becomes an em-dash with no spaces, and that punctuation swap is the whole of where the missing character comes from |
| `Share the story, ride together` | 30 | Keeps the comma; `the` for `your` |
| `Ride together, share the story` | 30 | Leads with the promise rather than the loop |
| `Find your crew. Ride together.` | 30 | Aimed squarely at state 1 |
| `Where riders find their crew` | 28 | The place, not the action |

`Share your story, ride together` as written is **31** — one over — and reversing it does not
help, because `Ride together, share your story` is also 31.

### Description — the first three lines

Everything below the third line is read by almost nobody (**[unvalidated]** — rider behaviour,
the class this file cannot measure), so write as though the whole pitch lives in those three:

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

1. **The invite links — both of them.** Already built, already the strongest thing available:
   each arrives from someone the rider knows, with something specific attached. `/rides/join`
   carries a ride; `/clubs/join` carries a club (`093`, PD-360, built on the ride link's
   reasoning) and aims squarely at state 3, the rider this file calls the highest-value. What
   improves is the **hand-off**, never the landing screen — see the rider states above for why
   that route shows nothing by design.
2. **Club organisers.** One organiser brings a group. Nothing in the product courts them yet,
   and the club invite link is the one piece that already does half the job.
3. **Local meets and dealer noticeboards.** Geography is the whole product — a club with three
   members in the wrong country is worth nothing.
4. **Motorcycle communities online.** Cheap, and the place where "no anonymous browsing" hurts
   most: a link posted there shows nothing.
5. **Paid install ads.** Last, and not before the funnel in #2 above is instrumented and the
   backend is off the free tier.
