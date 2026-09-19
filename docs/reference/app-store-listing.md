# The App Store Connect listing — every field, measured

<!-- Reference, not position. Reached by name from `docs/reference/positioning.md`, never
     auto-loaded. `.claude/agents/product.md` maintains it. -->

`docs/reference/positioning.md` is the groundwork — who the rider is, what the build may honestly
claim, the naming decisions. **This file is the paste-ready text**: one section per App Store
Connect field, each counted, plus the two questionnaires (age rating, App Privacy) and the three
URLs. The owner pastes it; no session touches App Store Connect.

**Nothing here may claim a feature the build does not have.** Every sentence below was checked
against `docs/reference/positioning.md` §What we may honestly claim before it was written, and
that list is checked against the code rather than the Figma. Guideline 2.3 rejects a description
that does not match the app.

## What is verified, what is inherited, what is a guess

**The caps were re-measured against Apple's own help pages on 2026-09-19** — reachable from this
container, unlike the store fronts themselves, so these are read rather than recalled:

| Field | Cap | Source, fetched 2026-09-19 |
|---|---|---|
| Name | 2–30 characters | `developer.apple.com/help/app-store-connect/reference/app-information/app-information` — *"at least two characters and no more than 30 characters"* |
| Subtitle | 30 characters | same page — *"can't be longer than 30 characters"* |
| Promotional Text | 170 characters | `.../reference/app-information/platform-version-information` |
| Description | 4000 characters | same page — *"Limited to 4000 characters"* |
| Keywords | **100 bytes**, each keyword longer than two characters | same page — *"up to 100 **bytes** of content"*, *"each greater than two characters"* |
| What's New | 4000 characters, **not available for the first version** | same page |

**Two of those correct `positioning.md`, and both corrections are live below.** Keywords are
capped in **bytes**, not characters — identical for pure ASCII and not for anything else — and a
two-character keyword (`me`) is refused outright. That file's caps table now points here.

**Editability — and Apple documents far less of it than is convenient.** Exactly one marketing
field is stated to be changeable without a new submission: **Promotional Text**, which *"lets you
inform your App Store visitors of any current app features without requiring an updated
submission."* Subtitle, Description and Keywords carry only the page-level *"This property is
editable depending on the app status"*, which is not the same promise. The **Name** can be edited
until the app is submitted, and after that with a new version.

**So treat Promotional Text as the only field you can swap freely, and everything else as
shipped with the build.** An earlier draft of this section said the opposite, sourced it to these
same pages, and the pages do not say it — the trap is putting a perishable claim in the Subtitle
or Keywords and then finding it needs a version to change.

**What could NOT be checked here, and must be before upload:**

- **Whether `LetsRide: Motorcycle Clubs` is available as an App Store name.** `apps.apple.com`,
  `itunes.apple.com` and `play.google.com` are all refused at this container's egress proxy
  (`403` to `CONNECT`, re-tested 2026-09-19 against all three; `WebFetch` returns
  `EGRESS_BLOCKED`), and the iTunes Search API lives on the second of those. **Nothing in this
  file is evidence that the name is free.** App Store Connect answers it in ten seconds at
  app-record creation, and it is the first thing to do. **What web search alone could establish is
  that two other apps already trade under this brand — §Two apps already trade under this brand,
  and it is the most important unread thing in this file.**
- **What category the competitors chose.** Same block. The category argument below is reasoned
  from Apple's own category definitions, which are readable, and not from what REVER or TONIT did.
- **Anything about what riders search for.** Unchanged from `positioning.md`: **[unvalidated]**,
  and no amount of reading Apple's documentation makes it otherwise.

**Measure, never estimate** — and set the locale, because this container has `LANG` and `LC_ALL`
unset and `wc -m` then counts bytes:

```bash
printf '%s' "Join rides, tell your story" | LC_ALL=C.UTF-8 wc -m   # 27
```

Every count in this file is reproducible with the block in §Re-measuring every field at the end.

## The app name — 26 of 30, and the brand is contested

```
LetsRide: Motorcycle Clubs
```

**26 characters** (`printf '%s' 'LetsRide: Motorcycle Clubs' | LC_ALL=C.UTF-8 wc -m`). The whole
argument is `positioning.md` §Choosing the second half of the name and the census under it:
`Motorcycle` is table stakes for an app with no ratings, `Clubs` is the one second-slot word the
census found nobody using and the one exactly true of this product, and the brand must be in the
name because brand search is the highest-converting term any app has.

One spelling, `LetsRide`, matching the domain, the OG `siteName` and the icon. Never `Let's Ride`.

### Two apps already trade under this brand — searched 2026-09-19

An earlier version of this file said only that the name *could not be checked from here*. It can
be checked in part, and the partial answer is worse than "unknown":

| What is there | Where | What it is |
|---|---|---|
| **`LetsRide.`** — the exact brand plus a full stop, seller `LetsRide West Midlands` | App Store, `id1572666713` | A private-hire **taxi** app around Solihull and Birmingham |
| **`Let's Ride`**, whose own store copy calls the product `LetsRide` | Google Play, `com.ya6n.letsride` | A **motorcycle** app — route generation, turn-by-turn GPS navigation, a radar of riders near you, group rides |
| `Let's Ride` (`id1575861007`), `Let's Ride BC` (`id1661327557`), `Ride On: Let's Ride` (`id1434380853`) | App Store | Not established — the titles are all that was readable |

**Provenance, and it is weaker than every other fetched claim in this file.** `apps.apple.com`,
`itunes.apple.com` and `play.google.com` are all refused at the egress proxy — measured three times
independently — so **no listing page was ever opened**. Every row above comes from search-result
titles, snippets and the ids visible in result URLs.

**The table mixes two reliabilities and the distinction matters.** Titles, the bundle id and the
numeric App Store ids come off result URLs and are as good as the search index. The seller string,
the categories and the feature lists come out of snippet prose — what a snippet says, not what a
registered seller record or a category field says. Nothing here establishes a rating count, an
install range, a subtitle, or that any of them is still on sale. **The App Store app on a phone
settles the whole table in seconds, and is also the only place the name's availability can be
tested.**

**Two different risks, and the second is the one that matters.**

- **Availability is probably fine, and is not the problem.** Apple's rule is *"You can use an app
  name for one app per localization"* (`.../create-an-app-record/add-a-new-app`, fetched
  2026-09-19) — it collides on the exact string, and `LetsRide: Motorcycle Clubs` is not the exact
  string `LetsRide.`. Expect the record to be creatable. Where another developer holds a name and
  you hold the mark, Apple's route is a legal claim, not the console.
- **Brand search is the problem, and it is the argument the name was built on.**
  `positioning.md` §Three fields, three jobs puts `LetsRide` in the name because brand search is
  the highest-converting term any app has. A rider told *"get LetsRide"* who searches `letsride`
  today lands on someone else's app — a taxi firm on the App Store, and on Play an app **in this
  category, using this brand**. Ten of the thirty characters are being spent on a term the project
  does not own.

**This is above a copy pass and is not settled here.** The brand is fixed in the domain, the OG
`siteName`, the icon and the logo alt text, so moving it is a product decision with a cost this
file cannot price — and keeping it is equally a decision, to compete for a term two other apps
already answer. What this file owes is the finding plus the two checks only the owner can run: the
App Store search, and whether the Play app holds a registered mark in the EU.

**If the brand stays, differentiate inside the 30 characters rather than outside them.** Measured:

| Candidate | Chars | Note |
|---|---|---|
| `LetsRide: Motorcycle Clubs` | 26 | The standing recommendation, unchanged by this finding |
| `LetsRide Social: Moto Clubs` | 27 | A second distinguishing word sits next to the brand |
| `LetsRide Moto: Clubs & Rides` | 28 | The clearest separation from the taxi app; spends a slot on `Rides`, which the census calls contested |

**Neither alternate is a recommendation.** Both are worse on every argument in `positioning.md`
§Choosing the second half of the name; they exist because that section was written without knowing
the brand was contested.

**One useful thing falls out of the Play collision.** That app advertises routes and turn-by-turn
navigation; this one deliberately does neither (decision #3). The Description's line *"It does not
record your route or navigate for you"* is therefore doing more work than when it was written — it
separates this app from the nearest same-brand product as well as from REVER.

## Subtitle — 27 of 30

```
Join rides, tell your story
```

**27 characters.** Verb-first, says what happens when the app opens, and repeats nothing from the
name. The alternates and why each loses are in `positioning.md` §The subtitle, measured.

## Keywords — 97 of 100 bytes

```
group,riders,nearby,community,social,meetup,biker,motorbike,crew,tour,bike,trip,share,photos,moto
```

**97 bytes, 15 keywords, none shorter than three characters** — checked with the loop in
§Re-measuring every field, which also refuses a comma-space.

Three rules, and the first is Apple's own words rather than folklore: *"Your app is searchable by
app name and company name, so you shouldn't duplicate these values in the keyword list"* — so
`letsride`, `motorcycle` and `clubs` are deliberately absent. **That the SUBTITLE's words are also
wasted here is inferred, not Apple's wording**, but it costs nothing to honour, so `join`,
`rides`, `tell` and `story` are out too. No spaces after the commas — a space is a byte.

This line changed from the one in `positioning.md`: **`near,me` is gone.** `me` is two characters
and Apple refuses a keyword that short, and `near` alone loses the phrase it was bought for, so
`nearby` replaces the pair. `photos` and `moto` spend the freed bytes.

**Never in this field:** `friends` (the app has no such concept — `013` dropped it), `route`,
`gps`, `navigation`, `track` (decision #3 — the app records nothing and navigates nowhere), `dm`,
`chat`, `gear`, `garage`. A keyword is a claim like any other, and these bid for the riders
guaranteed to leave a one-star review.

**Regenerate this line whenever the name or the subtitle changes.** It is derived from both.

## Promotional Text — 165 of 170

```
Share your motorcycle story, ride together. New in the Netherlands: find riders near you, join a club, and plan the next ride with a meeting point everyone can find.
```

**165 characters.** The owner's tagline (2026-09-07) leads, because this is one of the four
surfaces where it fits at its full 42 characters — `positioning.md` §Three fields, three jobs.

This field is editable without a new build, so it is the one to change first: swap the
`New in the Netherlands` clause for whatever is currently true — a second city, a club that just
formed, the day the app goes Dutch. A version-free edit is the whole point of it.

**If the Netherlands-only line is ever wrong, this is the field it is wrong in**, and it is the
cheapest one to fix. Do not put a market claim in the Name or the Description.

## Description — 1826 characters of 4000

Apple's own note: the Description *"will be used for web engine search results once you release
your app"*, which is the closest thing this product has to an SEO surface, because decision #1
means nothing else about it is public.

**Almost nobody taps `more` [unvalidated]** — so the whole pitch is in the first two paragraphs
and everything after them is for the rider already deciding.

```
Find riders near you, plan a ride together, and keep the photos.

LetsRide is where motorcycle riders organise the next ride and share the last one. Join a club, see what everyone has been riding, and turn a group chat that lost the meeting point into a ride with a map, a time and a crew list.

A HOME SCREEN MADE OF PHOTOS
LetsRide opens on postcards - a deck of photos from other riders' rides that you swipe through. Like them, comment on them, and share one with any rider.

CLUBS
Join a club and get a timeline of everything it has done: its rides, its postcards and its threads. Start a thread with a title so it is still findable next week. Invite riders by name or with a link.

RIDES
Plan a ride with a meeting point, a date and a time, and a club to ride it with. Everyone gets a static map of where to meet and a one-tap hand-off to Google Maps for the directions. The crew list shows who said Going, who said Maybe, and who cannot make it. Share the ride with a link you can expire or revoke.

NOTIFICATIONS
Find out when somebody joins your ride, comments on your postcard or posts in your club.

YOUR CALL WHO YOU RIDE WITH
Block a rider and you disappear from each other. Hide a postcard you would rather not see. Report a postcard or a club thread. Delete your account from inside the app, and everything goes with it.

A FEW HONEST NOTES
LetsRide is not a public feed: you need an account, and nothing you post is browsable or searchable on the open web. The one thing anyone can open without an account is a ride invite link you chose to send them. It does not record your route or navigate for you - Google Maps already does that, and we hand off to it. New riders are put into a club on day one, so the app is not empty while you find your own.

Built for riders in the Netherlands first. English for now.
```

**1826 characters, 1826 bytes** — deliberately ASCII-only, hyphens rather than em dashes, because
a description that is byte-clean survives a copy-paste through any editor. There are 2174
characters of headroom; do not spend them on a feature that is not in
`positioning.md` §What we may honestly claim.

**Re-measure this block rather than trusting the number, and use the extractor in
§Re-measuring every field.** It is now enforced — `description-chars-listing` in
`scripts/docs/registry.mjs` extracts the fenced block and compares it, so a wrong number here reds
`docs:check` rather than sitting. That entry exists because this file carried `1837` against a block
that has always measured `1826`: **the text never drifted, the count was simply wrong from the day
it was typed**, and by eye the two are indistinguishable.

**Five sentences in there are load-bearing and must not be tidied:**

1. **"turn a group chat that lost the meeting point"** names the thing riders leave behind —
   WhatsApp — and is not a claim that LetsRide has a chat. A copy pass that shortens it to
   *"turn your group chat into a ride"* is fine; one that adds *"chat with your crew"* anywhere
   else is Guideline 2.3 on **both** branches — `108`/`109` replaced the ride's Chat with titled
   threads and are on `main`, applied to PROD (`git ls-tree origin/main supabase/migrations/ |
   grep -E "10[89]_"`). **The ride's threads are deliberately not mentioned above**, so this text
   is true as it stands; the RIDES paragraph may now gain *"Every ride gets titled threads, so
   the plan does not scroll away"* whenever a copy pass wants it.
2. **"Report a postcard or a club thread"**, exactly that — never *"report any post"*. It is
   written to the **promoted** build: `122` and `123` added ride-thread and comment reporting on
   `development` and neither is applied to PROD, so this sentence under-claims a DEV build and
   describes a `main` build exactly. **Widen it only after establishing which build is being
   uploaded** — §The Guideline 1.2 gap has the check. Guideline 1.2 is the one that punishes the
   other direction.
3. **"you need an account, and nothing you post is browsable or searchable on the open web"** is
   decision #1 stated out loud. It costs some installs and it prevents the one-star review that
   says *"you can't even look without signing up"*, which is the review this app would otherwise
   get.
4. **"It does not record your route or navigate for you"** pre-empts the single most likely
   wrong expectation in this category, given that REVER's own name carries `GPS` — and, since
   2026-09-19, that the Play app trading under this brand advertises turn-by-turn navigation
   (§Two apps already trade under this brand).
5. **"New riders are put into a club on day one"** is true of the build — `complete_onboarding`
   joins the club carrying `clubs.is_default` — **and honest only if that club has something in
   it.** It is a precondition on the owner, not on the copy. See §Before this listing goes up.

## The five text fields, side by side

| Field | Text | Count | Cap |
|---|---|---|---|
| Name | `LetsRide: Motorcycle Clubs` — **check §Two apps already trade under this brand first** | 26 chars | 30 |
| Subtitle | `Join rides, tell your story` | 27 chars | 30 |
| Keywords | `group,riders,nearby,…,moto` | 97 bytes | 100 bytes |
| Promotional Text | `Share your motorcycle story, …` | 165 chars | 170 |
| Description | see above | 1826 chars | 4000 |

## Categories — Social Networking, then Travel

Apple's category definitions, fetched from `developer.apple.com/app-store/categories/` on
2026-09-19, decide this more cleanly than the pitch does:

- **Social Networking** — *"Apps that connect people by means of text, voice, photo, or video.
  Apps that contribute to community development. For example: interpersonal connections … photo
  & video sharing … special interest communities."*
- **Travel** — *"Apps that assist the user with any aspect of travel, such as planning,
  purchasing, or tracking. For example: … city guides … vacation planning."*
- **Sports** — *"professional, amateur, collegiate, or recreational sporting activities. For
  example: fantasy sports companions, college teams/conference … score trackers … sports news."*
- **Navigation** — *"Apps that provide information to help a user travel to a physical location.
  For example: driving assistance, walking assistance, topographical maps …"*

**Primary: Social Networking.** The home screen is a photo deck with likes and comments, and the
social graph is clubs — *photo sharing* plus *special interest communities*, which is two thirds
of Apple's own sentence. Apple's guidance is that the primary category should be *"the one that
best describes the main function"*; the main function on first launch is a feed of other riders'
photos, not a planner.

**Secondary: Travel.** A ride is a meeting point, a date and a hand-off to directions — *planning*
travel, in Apple's words. It also puts the app beside city guides and trip planners rather than
beside score trackers.

**Sports is the runner-up and is rejected on Apple's examples, not on the subject.** Motorcycling
is a recreational activity, but every example under Sports is spectator-side — teams, leagues,
scores, fantasy, news — and none of it is what this app does. If a later pass finds that the
motorcycle apps actually sit in Sports, that is a reason to revisit; nothing in this container
could read their listings to find out. **[unvalidated]**

**Navigation is disqualified, and not as a close call.** Decision #3 is a static thumbnail plus a
Google Maps deeplink; the app provides no assistance in getting anywhere. Choosing Navigation
would put the app in front of exactly the rider whose first review is *"it doesn't navigate"*, and
it is the category most likely to draw a Guideline 2.3 question about the description.

**The cost of Social Networking, stated honestly:** it is one of the most contested categories on
the store and a new app with no ratings will not chart in it. The answer to that is the keyword
field and the invite links, not a quieter category that describes the app less well.

## Age rating — calculated 13+, and it must be overridden to 16+

Apple rebuilt this questionnaire; the current values and definitions were fetched from
`.../reference/app-information/age-ratings-values-and-definitions` on 2026-09-19. Answers below
are honest rather than flattering — the app carries user-generated content with no pre-publication
filter (owner decision, recorded on the moderation story).

**In-App Controls** — select the ones the app has:

| Question | Answer | Why |
|---|---|---|
| Parental Controls | **No** | None exist |
| Age Assurance | **No** | Nothing in the app collects or checks a date of birth. The terms *assert* a minimum age of 16; no code enforces it |

**Capabilities:**

| Question | Answer | Why |
|---|---|---|
| Unrestricted Web Access | **No** | No embedded browser and no browser plugin in the shell — the four Capacitor packages are core, secure storage, push and app |
| User-Generated Content | **Yes** | Postcards, captions, comments, club threads, profile and club images, all published without pre-moderation |
| **Social Media** | **Yes** | Apple's definition is *"feeds that allow users to engage with and amplify user-generated content through features such as views, likes, comments, and shares"*. That is the postcards deck exactly. **This is the answer that sets the rating** |
| Social Media Disabled for Users Under 13 | **No** | Would require calling the Declared Age Range API; nothing does |
| Messaging and Chat | **Yes** | Apple's definition includes *"public posting"*, which club and ride threads and postcard comments are. **There are still no direct messages** — the questionnaire's category is broader than the marketing word, and answering Yes here does not license writing "chat" or "DMs" in any listing field |
| Advertising | **No** | The app shows none |

**Everything else is None or No** — Mature Themes (profanity, horror, alcohol/tobacco/drugs),
Medical or Wellness, Sexuality or Nudity, Violence (including Guns or Other Weapons) and all four
Chance-Based Activities. These describe the app's *own* content; UGC is declared by the capability
above, which is how Apple's form is built.

**Calculated rating: 13+** — `Social media` sits in the 13+ band and nothing above it is selected.
**Australia returns 16+ automatically** for `Social media`, which is a regional value rather than
something to answer.

**Then override to 16+, globally, and this is not optional.** Apple's own instruction on
`.../manage-app-information/set-an-app-age-rating`: *"If your app has a EULA with minimum age
requirements that exceed the rating that Apple calculated, you must override to a rating that
adheres to the requirements."* `/legal/terms` says *"You must be at least 16 years old"*
(`src/app/legal/terms/page.tsx`), so the calculated 13+ is below the terms and the override is
required. Choose **Override to Higher Age Rating → 16+**; the content descriptors still show the
questionnaire's answers.

**The alternative is to change the terms, and that is a legal decision, not a copy one.** Dropping
the minimum to 13 would let the app ship at 13+ and reach more riders; it also puts the product in
scope of a different set of child-protection expectations. Leave it at 16 unless the owner says
otherwise — the override costs nothing but audience.

An optional **Age Suitability URL** field exists. Leave it blank; there is no such page.

## App Privacy — transcribed from the manifest, not re-derived

**`ios/App/App/PrivacyInfo.xcprivacy` is the source of truth and this is a transcription of it.**
The two disagreeing is a rejection now and a correction later. Verify the count before pasting:

```bash
grep -c "<key>NSPrivacyCollectedDataType</key>" ios/App/App/PrivacyInfo.xcprivacy   # 11
```

**Eleven — confirmed 2026-09-19.** Every one is **Linked to the user**, **none is used for
tracking**, and the answer to *"Does this app collect data?"* is **Yes**.

| ASC category | ASC data type | Linked | Tracking | Purposes | Manifest key |
|---|---|---|---|---|---|
| Contact Info | **Email Address** | Yes | No | App Functionality | `…TypeEmailAddress` |
| Location | **Precise Location** | Yes | No | App Functionality | `…TypePreciseLocation` |
| Location | **Coarse Location** | Yes | No | App Functionality | `…TypeCoarseLocation` |
| User Content | **Photos or Videos** | Yes | No | App Functionality | `…TypePhotosorVideos` |
| User Content | **Other User Content** | Yes | No | App Functionality | `…TypeOtherUserContent` |
| Identifiers | **User ID** | Yes | No | App Functionality, **Analytics** | `…TypeUserID` |
| Identifiers | **Device ID** | Yes | No | App Functionality | `…TypeDeviceID` |
| Usage Data | **Product Interaction** | Yes | No | **Analytics** | `…TypeProductInteraction` |
| Diagnostics | **Performance Data** | Yes | No | **Analytics** | `…TypePerformanceData` |
| Diagnostics | **Crash Data** | Yes | No | App Functionality | `…TypeCrashData` |
| Diagnostics | **Other Diagnostic Data** | Yes | No | App Functionality | `…TypeOtherDiagnosticData` |

**Four things a session filling this form must not get wrong:**

- **Precise Location is declared as well as Coarse, and it is the one that looks like a mistake.**
  The device fix is rounded to ~1km before it is used or stored, but the postcard composer's
  **Precise** mode writes the photo's raw EXIF coordinate into `postcards.taken_latitude/longitude`
  — `064` enforces rounding for `'region'` rows only, by design. Declaring coarse alone
  under-reports.
- **The rider's `auth.uid()` does go to both processors, and their email and username never do.**
  `docs/reference/observability.md` §What is sent, what is never sent has the per-field table.
  That is what makes every row *Linked* and none of them *Tracking*.
- **There is no screen-recording row and that is current rather than an omission** — session
  replay was turned off on 2026-09-18. If it ever returns, masked or not, it is a new answer here,
  in the manifest and on Play's Data safety form *before* it ships.
- **`NSPrivacyTracking` is false and there is no ATT prompt**, so App Privacy's "Data Used to
  Track You" section stays empty and `NSUserTrackingUsageDescription` stays out of `Info.plist`.

**Play's Data safety form is a different form from the same list.** It is not written here yet;
when it is, fill it from the manifest too, never from this table's wording.

## The three URLs

| Field | Value | State |
|---|---|---|
| **Privacy Policy URL** (required) | `https://app.letsride.social/legal/privacy` | Live |
| **Support URL** (required) | `https://app.letsride.social/legal/support` | **Live on DEV (`app-dev.letsride.social/legal/support`); live on this host at the next promotion to `main`** — the page merged to `development`, and that host is served from `main` |
| **Marketing URL** (optional) | *leave blank* | The apex is unattached (`PD-34`, `docs/ENVIRONMENTS.md` §Domains). A blank optional field is better than one pointing at a page that is not a marketing page |

**A fourth URL lives under App Privacy rather than version information, and it has a good answer
already.** Apple's optional **User Privacy Choices URL** wants *"a publicly accessible URL where
users can learn more about their privacy choices … For example, a webpage where users can access
their data, request deletion, or make changes."* That is `/legal/account-deletion`, which is live:
`https://app.letsride.social/legal/account-deletion`. Fill it in — it is free, it is true, and it
is the page Play's User Data policy wants for the same reason.

### The Support URL

Apple's requirement, from `.../platform-version-information`: *"This URL must lead to actual
contact information (legal address, email address, telephone number), as may be required by local
law, so that users can reach you regarding app issues, general feedback, and feature enhancement
requests."* A `mailto:` is not a URL that satisfies it.

**`/legal/support` is that page** — `src/app/legal/support/page.tsx`, PD-467, public with no
guard change because protection is a denylist of public paths and `/legal/*` is on it. Five
public pages now, not four: `ls src/app/legal/`.

**It is live on DEV and not yet on the host this table names.** `app.letsride.social` is served
from `main` and the page merged to `development`, so the URL 404s until the promotion — check
rather than paste: `git cat-file -e origin/main:src/app/legal/support/page.tsx`. Do not fill the
Support URL field from this table before that command succeeds.

**The address is rendered as readable TEXT as well as inside the `mailto:`, and that is the half
Apple's wording is about.** A tidy-up that turns the visible address into the words "contact us"
leaves the link working, reads better, and stops being contact information a reviewer can read.
`src/app/legal/support/__tests__/page.test.tsx` asserts both halves and strips every `href`
before checking the visible one, so the anchor cannot satisfy it.

**Three things on the page are published elsewhere and must not drift**: the 24 hours for reports
(`/legal/terms` §7 and `/legal/privacy`), the address itself (`SUPPORT_EMAIL` in
`src/lib/support.ts`, one literal, enforced by `src/__tests__/support-email.test.ts`) and who runs
the app (§1 of the terms, where the operator's name is still owed — PD-459, so the page points at
that clause rather than restating it).

**It must never grow a form, and it must never move to a third-party host** — Notion, a Google
Form, a GitHub Pages file. A form is a mail sender, an abuse surface and a personal-data sink; a
borrowed host puts the app's one published support route on a domain the project does not
control, which is precisely the failure `src/lib/support.ts` already recorded once, when the
published address pointed at a domain nobody here owned.

## Screenshots — not this file's to produce, but this file's to order

They need a Mac, a simulator and a build, so they are the owner's. What belongs here is **what to
capture and in what order**, because the ordering is a marketing decision and the first two
screenshots are most of the conversion **[unvalidated]**.

**Do not lead with what a new rider actually meets first.** Onboarding is three screens — terms,
username, home town (`ls src/app/onboarding/`) — and a consent form is the worst possible opening
frame. Screenshots sell the destination, not the corridor.

Up to 10 may be uploaded; six is plenty. The bundle is iPhone-only and portrait-only, so one size
carries everything: **1320 × 2868 px (6.9" display)**, portrait, `.png`, no alpha channel
(`.../reference/app-information/screenshot-specifications`, fetched 2026-09-19). Anything smaller
is scaled down by the store for the larger devices.

| # | Screen | Caption |
|---|---|---|
| 1 | **Home** — the postcards deck, with a good photo in frame | Every ride, from the people who rode it |
| 2 | **Ride detail** — map thumbnail, time, crew list with a Going row | A meeting point everybody can find |
| 3 | **Rides** — the list with two or three upcoming rides | Somewhere to be this Sunday |
| 4 | **Club detail** — the timeline with rides and postcards on it | Join a club. Ride with people, not strangers |
| 5 | **Postcard detail** — a photo with two or three comments | Tell the story afterwards |
| 6 | **New ride** — the compose screen part-filled | Plan one in about a minute |

**Captions are burned into the image**, so they have no character cap of their own — which is why
they get the tagline's job, not the subtitle's. Keep each under about six words anyway; they are
read at thumbnail size.

**Two rules for the screens themselves.** Every screenshot must show real-looking content, because
an empty state in a screenshot reads as an empty app — and the fixture rider must not be the
owner's own account. And **no screenshot may show a screen the build does not have**: a mocked-up
frame in a store listing is Guideline 2.3 in picture form.

## The Guideline 1.2 gap — flagged here because a listing is where it surfaces

Guideline 1.2 applies to every app with user-generated content and asks for four things: a way to
filter objectionable material, a way to **report** it, a way to block abusive users, and published
contact information. Three of the four were never in doubt — hide a postcard, block a rider
(enforced in RLS, not the UI), and `SUPPORT_EMAIL` on two public pages.

**Reporting was the fourth, and it is now uniform on `development`.** This file used to say a ride
thread had no report affordance; it has one. Re-derive rather than trusting either version:

```bash
grep -rn "export async function report" src/lib/actions/    # 4
```

`reportPostcard`, `reportPostcardComment` (`123`), `reportRideThread` (`122`, PD-454) and
`reportClubThread` (`094`), each with a UI caller — `PostcardMenu.tsx`, `CommentItem.tsx`,
`RideThreadOptions.tsx`, `ThreadOptions.tsx`.

**A listing describes the PROMOTED build, and that is where this stops being tidy.** `122` and
`123` are files in this tree and are **not applied to PROD**: `124`'s own header records
`list_migrations` against the production ref topping out at `a_completion_carries_a_country`. So a
binary cut from `main` today still reports postcards and club threads only — exactly what
§Description says — and that sentence turns into an *under*-claim, not an over-claim, on the day
the promotion lands.

**So neither wording is safe to write ahead of the build it describes.** Establish which side of
the promotion the uploaded binary sits on before touching §Description point 2 — `npm run db:drift`,
or `list_migrations` against both refs. The over-claiming direction is the one Guideline 1.2
punishes; the under-claiming direction costs nothing but a sentence.

**`124` is a different thing and does not answer this guideline.** It mails a digest so reports
reach a human; the guideline asks for the affordance, not for the triage behind it.

## Before this listing goes up

Owner actions, each blocking in its own way:

1. **Check the name is free** in App Store Connect, and read §Two apps already trade under this
   brand before you do — an App Store app already holds the exact string `LetsRide.`, and a
   **motorcycle** app on Play trades under the brand. Availability is the small half of that; the
   brand-search half is a decision only the owner can take.
2. **Supabase Pro.** The free tier auto-pauses after ~7 days idle and serves nothing — a reviewer
   opening a paused app sees a blank screen. `docs/reference/native-shell.md` §Store readiness
   row 6.
3. **The default club must have content in it**, or the description's day-one promise is false on
   the day a reviewer installs.
4. **EU trader status under the Digital Services Act — `[unvalidated]`, and the only claim in
   this file with no fetched source.** The launch market is the Netherlands, so the app is
   distributed in the EU, and App Store Connect asks for a trader self-assessment before a new
   app can be submitted. If the answer is *trader*, an individual developer is understood to
   enter an address, a phone number and an email address, verify both by two-factor, and upload a
   document proving the address — **and all three are then displayed publicly on the product
   page**. If the answer is *not a trader*, EU consumers are told consumer-protection rights do
   not apply to the contract.

   **Read the mechanics off App Store Connect rather than off this paragraph.** Unlike every
   other Apple claim here, no help page backing it could be fetched from this container — four
   candidate URLs returned Apple's "Page Not Found" body under HTTP 200 — so the substance is
   plausible and the specifics are not verified. What is certain is that the assessment exists,
   gates submission, and is a legal self-assessment the owner alone can make. PD-468 holds it.

## Re-measuring every field

Paste-and-run. **`LC_ALL=C.UTF-8` is not optional** — without it `wc -m` counts bytes, and the
first line carrying an em dash, a curly apostrophe or an ellipsis is silently over its cap while
every ASCII line around it measures correctly.

```bash
name='LetsRide: Motorcycle Clubs'
sub='Join rides, tell your story'
kw='group,riders,nearby,community,social,meetup,biker,motorbike,crew,tour,bike,trip,share,photos,moto'
promo='Share your motorcycle story, ride together. New in the Netherlands: find riders near you, join a club, and plan the next ride with a meeting point everyone can find.'

printf '%s' "$name"  | LC_ALL=C.UTF-8 wc -m   # 26  of 30
printf '%s' "$sub"   | LC_ALL=C.UTF-8 wc -m   # 27  of 30
printf '%s' "$kw"    | wc -c                  # 97  of 100 BYTES — wc -c, not -m
printf '%s' "$promo" | LC_ALL=C.UTF-8 wc -m   # 165 of 170

tr ',' '\n' <<<"$kw" | awk 'length($0)<3 {print "TOO SHORT: "$0}'   # prints nothing
grep -c ', ' <<<"$kw"                                                # 0
```

The last two lines are the keyword field's own two traps: no keyword of two characters or fewer,
and no space after a comma. **Keep them out of a `#` comment inside the fence** —
`scripts/docs/crossrefs.mjs` reads every line starting with `#` as a markdown heading, fenced or
not, so a shell comment there becomes a phantom section that other files' `§` pointers can
resolve against.

The description is the fenced block in §Description. **Count it with the extractor below rather
than by hand** — a hand count is what put `1837` in this file against a block that measures
`1826`:

```bash
python3 - <<'PY'
lines = open('docs/reference/app-store-listing.md', encoding='utf-8').read().split('\n')
start = next(i for i, l in enumerate(lines) if l.startswith('## Description'))
a, b = [i for i, l in enumerate(lines) if l.strip() == '```' and i > start][:2]
body = '\n'.join(lines[a + 1:b])
print(len(body), 'chars', len(body.encode('utf-8')), 'bytes')   # 1826 chars 1826 bytes
PY
```

The two are equal because the block is deliberately ASCII; if they ever differ, a copy pass has
introduced an em dash or a curly apostrophe and the cap is now being measured in the wrong unit.
