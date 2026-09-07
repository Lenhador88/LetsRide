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
   auth screen or static copy**, which is `guard.ts`'s own wording and worth quoting exactly:
   drop the second clause and `/legal/*` alone falsifies it. (`/` is public and older still, and
   is neither — it is a resolver that renders nothing, which is why no phrasing of this claim
   should lean on it.)

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
on `main`**, because `108`/`109` are DEV-only.

**Exactly one word flips, and reading the caveat wider than that is how it becomes the defect it
warns about.** On `main`, "chat" is *accurate* for a ride. **"message a rider" and "DMs" are
wrong on both branches and always have been** — the Inbox epic's remaining half is DMs, unbuilt
everywhere. Treating the whole do-not-say row as suspended on production puts two phrases into a
listing for an app that has no direct messages, which is Guideline 2.3. Re-derive the gap rather
than trusting this paragraph —
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

**DECIDED by the product owner, 2026-09-07 — the Netherlands, alone.** That is the whole of the
decision; everything after this sentence is this file's reasoning and is reopenable on its own
terms.

Geography is the whole product — a rider opens the app to find *people near them*, and a club
with three members in the wrong country is worth nothing. Splitting the launch across two
countries would have halved the density in each while doubling the localisation work, and density
is the thing being tested. On that reading Portugal is a later market rather than a parallel one.
The repo already agreed: `APP_TIME_ZONE` in `src/lib/utils.ts` is `Europe/Amsterdam`.

**PROPOSED by the product owner and agreed here, 2026-09-07 — English first, app and listing
both.** Their words were *"should we start with english? as there are a lot of expats in NL?"*,
which is a question rather than a settled decision: **treat this as agreed-pending-confirmation,
not as closed.** The argument below is this file's, not theirs.

It is not a budget compromise; the reason is a targeting one. **The expat rider in the
Netherlands IS rider state 1**, exactly: someone who moved country, whose riding mates are in another one, who has a bike
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

**A store listing localises by LANGUAGE, not by country — and getting that backwards is how a
launch plan misses the people it was written for.** Checked 2026-09-07 rather than recalled, but
**the two halves have different provenance and the weaker one is Google's**: Apple's help page is
directly reachable from this container and was fetched; `support.google.com` is refused at the
egress proxy, so the Play half comes from search results quoting those help pages rather than
from the pages. Re-verify the Play half from a machine that can reach it before betting a launch
on it.

- **App Store Connect localisations are per language/locale.** `Dutch`, `Portuguese (Portugal)`
  and `Portuguese (Brazil)` are three separate listing languages; there is no way to write
  different copy for the Netherlands storefront than for Belgium's. Which one a customer sees
  depends on their device language, the App Store language for their region, the languages you
  added and your primary language — **and when nothing matches, they get the primary language**.
- **Play is the same for translations, and has a separate feature for the other axis.** Store
  listing translations are per language; *custom store listings* are the country/region tool,
  they are not auto-translated, and they are not what "localise the listing" usually means.

**What that establishes is that a Dutch listing is IRRELEVANT to the expat — neutrality, not
support, and the distinction matters.** A Dutch localisation reaches devices set to Dutch
wherever they are, Belgium included, and never reaches an English-set phone in Amsterdam, so the
state-1 expat gets the **primary-language** listing either way. Two things follow, and only the
first is an argument for the decision: the English listing is not a fallback here, it is the one
that has to be good. The second cuts the other way — **since a Dutch localisation costs the wedge
nothing, these mechanics are a reason it would be cheap, not a reason to skip it.** The reason to
skip it is the first bullet above, that a Dutch listing over an English app is a mismatch. Do not
let the vendor mechanics appear to vote on a product-consistency question.

Two things to carry into any later localisation:

- **`pt-PT` is not `pt-BR`.** The everyday word for the machine is `mota` in Portugal and `moto`
  in Brazil, and a `pt-BR` listing serves Brazilian-Portuguese devices anywhere rather than
  staying inside Brazil. Writing Brazilian Portuguese for a Portuguese launch is the most likely
  single mistake here.
- **Dutch `motor` means motorcycle**, not engine, in ordinary speech — so the searched terms are
  `motor`, `motorrijden`, `motorrijders`, `motorclub`. **Do not let a model write the final
  strings**: a plausible translation no rider types is invisible until the listing underperforms
  with no way to tell why. The mechanism above is verified; every specific word in this bullet is
  **[unvalidated]** and wants one native rider's eye.

**This raises i18n, which `CLAUDE.md` lists as deliberately undecided.** A localised listing
that lands a Dutch rider in an English-only app is a conversion question rather than a bug, and
the app is more English than it looks. **Do not measure that with a grep for `en-US`** — it
returns four call sites, three of which are `formatToParts` calls extracting numeric date
components under a locale that cannot show, and it misses every formatter a rider actually
reads. Ask for the constructions instead:

```bash
grep -o "Intl\.[A-Za-z]*('[A-Za-z-]*'" src/lib/utils.ts | sort | uniq -c
#   1 Intl.DateTimeFormat('en-CA'     5 Intl.DateTimeFormat('en-GB'
#   3 Intl.DateTimeFormat('en-US'     1 Intl.RelativeTimeFormat('en-US'
```

**The character class has to admit uppercase.** `[a-z-]` matches nothing at all here — every
locale in the file is uppercase-suffixed, so the pattern reaches `en-` and then fails on `G`,
and the command returns zero lines with exit 0. A command that prints nothing reads exactly like
a clean file.

Ten constructions, three hardcoded locales, not one. That is a decision to take deliberately before a launch, not a
task to slip into a copy change — and a session that "fixes i18n" by editing the four `en-US`
literals ships with every visible date still hard-formatted `en-GB`, with the grep green.

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
bytes. **A pure-ASCII candidate is unaffected, which is the trap**: a table of ASCII candidates
measures correctly, and the first line carrying `—`, `–`, `’` or `…` is silently over while
everything around it is right. Those are exactly the characters a copy pass introduces.
**`LC_ALL=C.UTF-8 wc -m`, or `python3 -c "print(len(…))"`.**

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

### The subtitle, measured

**"Share your story" names the home screen, and that instinct is the right one.** The app opens
on a photo deck, not a route planner — so selling it as a ride-planning tool would file it beside
apps that also do navigation and route recording, which this one deliberately does not.
**[unvalidated]** as a market claim; sound as a description of the build.

Three owner proposals, all measured:

| Proposed | Chars | Verdict |
|---|---|---|
| `Share your story, ride together` | 31 | One over. Its reversal is 31 too |
| `Tell your story, ride together` | 30 | Fits exactly — `Tell` for `Share` buys the character |
| `Join Motorcycle rides and share your trips` | 42 | **Twelve over as a subtitle — but it is the best Play short description written so far**, and the style is right (see below) |

**The third one changes the shape of the answer, and its style is better than a slogan's.**
Apple's subtitle is meant to say what the app *does*; "Join motorcycle rides and share your
trips" is verb-first and concrete where "Tell your story, ride together" is two imperatives with
no object. **But it does not need the word `Motorcycle`** — by this file's own rule below, a word
the name already owns is *wasted* in another field. Dropping it is what makes the line fit:

| Subtitle | Chars | Adds to the index |
|---|---|---|
| `Join rides, tell your story` | 27 | **The recommendation.** `join`, `rides`, `tell`, `story` — and it is the owner's own wording from both messages |
| `Join rides, share your trips` | 28 | `trips` instead of `story` |
| `Tell your story, ride together` | 30 | `together`, but `ride` nearly duplicates the brand |
| `Join group rides, share trips` | 29 | `group rides` as a phrase |

**The recommended set — the name carries the category, the subtitle says what happens:**

| Field | Proposed | Chars |
|---|---|---|
| Name | `LetsRide: Motorcycle Clubs` | 26 |
| Subtitle | `Join rides, tell your story` | 27 |
| Play short description | `Join motorcycle rides, find a club near you, and share your trips.` | 66 |

**`Lets ride: Tell your story.` (27) was proposed as the NAME and is the one thing here to push
back on.** It fits, and it is distinctive. But it moves `Motorcycle` out of the name and into the
subtitle, and the census says the category word in the name is table stakes while the name field
carries the most search weight of any — so the trade spends the highest-weight slot on a phrase
nobody searches. It is also a **third** spelling of the brand, after `LetsRide` (the domain, the
OG `siteName`, the icon) and `Let's Ride`. The phrase is worth keeping; the name is the wrong
field for it, and it survives intact in the subtitle above.

**On the apostrophe.** `Let's Ride: …` is over the cap on every construction, but the real
reason not to use it is that the brand is already `LetsRide` in the places that are expensive to
change — the domain, the OG `siteName`, the icon. Two spellings is two brands.

### Choosing the second half of the name

The brand half is fixed, so the name is one decision: which nine characters follow
`LetsRide: Motorcycle `. **`LetsRide: ` is 10 of the 30 and `Motorcycle ` is another 11**, so
nothing longer than nine fits without dropping something — `Community` is exactly nine, `Clubs`
is five.

**The recommendation is `LetsRide: Motorcycle Clubs` (26)**, and the census below is the whole
argument for it. Read that first: every alternative here is judged against it.

| Name | Chars | For | Against |
|---|---|---|---|
| `LetsRide: Motorcycle Clubs` | 26 | **The recommendation.** Exactly true of the product — clubs *are* the social graph — and the one second-slot word **no app in the census uses** | `motorclub` carries a connotation in Dutch it does not carry in English (below) |
| `LetsRide: Motorcycle Rides` | 26 | Two plain category words, both true of the product | `Rides` is **3 of 7** in the census — as contested as `Community` — and it echoes both the brand and the subtitle |
| `LetsRide: Motorcycle Community` | 30 | Says "social" outright, which is the pitch | **3 of 7**, and three incumbents have optimised for it. Spends every character, leaving no room for a later word |
| `LetsRide: Motorcycle Meetups` | 28 | `meetup` is a social word | Suggests events; this app plans rides |
| `LetsRide: Motorcycle Riders` | 27 | Names the person rather than the activity | Close to the brand, adds little |
| `LetsRide: Riders & Clubs` | 24 | Two product-true nouns | **Drops `Motorcycle`, which is disqualifying** — see the census |

**`Let's Ride: …` is over the cap on every construction**, but the real reason not to use it is
that the brand is already `LetsRide` where it is expensive to change — the domain, the OG
`siteName`, the icon. Two spellings is two brands.

### What the category actually named itself — read 2026-09-07

Search volume sits behind a paid ASO tool. The one honest proxy available without one:
**every competitor has already done this research, and their store names are the answer they
bought.**

| Store name | Category word | Second slot |
|---|---|---|
| `REVER - Motorcycle GPS & Rides` | Motorcycle | GPS, **Rides** |
| `MotoVerse - Motorcycle Community` | Motorcycle | **Community** |
| `MOTOSPOT Motorcycle Social App` | Motorcycle | Social |
| `TONIT Motorcycle App` | Motorcycle | — |
| `MotoCommunity — Find Your Ride` | Moto | **Community**, **Ride** |
| `MotoMate: Group Rides` | Moto | Group **Rides** |
| `EatSleepRIDE` | **none** | — (its tagline says "the motorcycle community") |

**Six of the seven NAMES carry `Motorcycle` or `Moto`.** The seventh is the interesting one and
must not be counted as a confirmation: `EatSleepRIDE`'s name carries no category word at all. It
is also a decade-old brand with an established community, which is the condition under which a
name can be pure brand. **A new app with no ratings does not have that option**, so the rule
stands as *table stakes for us* rather than as a law — stated that way because the exception is
sitting in the same table.

**The second slot is where the census earns its place.** `Community` is **3 of 7** (MotoVerse,
MotoCommunity, EatSleepRIDE's tagline) and `Rides`/`Ride` is **3 of 7** (REVER, MotoCommunity,
MotoMate) — **equally contested, which is why neither is recommended**. `Clubs` is **0 of 7**,
and it is the one word exactly true of this product. A new app with no ratings does not out-rank
three incumbents on a phrase they have all optimised for; a narrower term with matching intent
is the standard answer, fewer impressions and more installs.

**The limit of the method, which is a real one.** A census of names is a proxy for volume, not
volume — nothing here can measure volume, and no claim in this section should be read as one. In
particular it cannot tell whether *"motorcycle clubs"* is searched by riders looking for a club
to join or by people interested in outlaw-MC culture, and **that distinction decides whether the
recommendation above is an opportunity or a trap**. See §Blocked, and needed from the owner.

**On `motorclub`, precisely** — because the imprecise version was doing real work here.
`motorclub` is the ordinary Dutch word for **any** motorcycle club, and it is a term Dutch
riders search. Dutch media also carries a strong outlaw association the English word lacks,
driven by a run of high-profile club bans — but that sense is normally *marked*
(`verboden motorclub`, `criminele motorclub`, `OMG`). **[unvalidated]** as an effect on installs.
So it is a reason to watch the Dutch listing's wording if one is ever written, **not** a reason
to reject `Clubs` in an English name — which is how an earlier draft of this file used it.

### The name does not have to carry everything

The 100-character keyword field is indexed too, and both stores build phrases across the fields,
so **a word already in the name or subtitle is wasted if repeated there** — asserted from
knowledge and worth confirming in App Store Connect, unlike the localisation rules above which
were checked. With `LetsRide: Motorcycle Clubs` and `Tell your story, ride together`, the name
and subtitle own `motorcycle`, `clubs`, `ride`, `story`, `together`. The keyword field spends its
100 characters on what they do not:

```
group,rides,riders,near,me,community,social,meetup,biker,motorbike,crew,tour,bike,trip
```

So `community` and `group rides` are still bid for — just not in the 30 characters where they
would cost the uncontested word. **Not `friends`**: the app has no such concept (see the
do-not-say table), and a keyword is a claim like any other.

**Regenerate that line if the name changes.** It is derived from the recommended name, and a
keyword field computed for a different title wastes a slot on a word the name already owns while
giving away the one it does not.

### Blocked, and needed from the owner

Two capabilities would turn this section's central argument from a proxy into a measurement, and
neither can be restored from inside a session:

- **`apps.apple.com`, `itunes.apple.com` and `play.google.com` are refused at this container's
  egress proxy** (`403` to `CONNECT`, logged in its own failure list). So the seven names above
  are read from search-result titles rather than from the listings, and no subtitle, description
  or rating count could be read at all.
- **No ASO tool.** A free tier (App Radar, AppTweak) returns estimated volume and difficulty per
  keyword per storefront, which settles `Clubs` vs `Community` in an hour and resolves the
  outlaw-MC ambiguity above. It needs a login.

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
