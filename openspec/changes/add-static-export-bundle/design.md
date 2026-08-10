# Design — PD-142

Every number below was produced on 2026-08-10 against `9b9daa4` in a throwaway `git worktree`
with a hardlinked `node_modules`, `next@16.2.9`. The main working tree was never modified. Where a
claim comes from reading a vendor's source, the file and symbol are named. Where it is neither run
nor read, it says **unmeasured**.

## D0 — What was measured, and what was taken on trust

| Claim | How |
|---|---|
| 10 dynamic pages over 3 segments | `git ls-files` + a baseline `next build`: 22 `○`, **10 `ƒ`** |
| `output: 'export'` fails, naming `/rides/[id]/chat` | build |
| Draft's 3 layouts + placeholder → export succeeds; 33 HTML documents; 10 `●`, one path each | build |
| Flag unset → 10 `●` with **zero** paths; no `placeholder` document emitted | build |
| `distDir` set → export lands there and `out/` is never created; `distDir` unset → `out/` | two builds |
| `trailingSlash` is **not** required for the export to build | control build |
| `trailingSlash: true` → permanent splash at `/`, `/auth/login/`, `/onboarding/terms/` | Chromium, against the export |
| Without it → `/` boots and the login form renders | Chromium |
| Client nav to an unprerendered id → `404 <path>.txt`, then a hard document load of `<path>` | Chromium, temporary probe route |
| Capacitor serves the **root** `index.html` for every extensionless path, both platforms | vendor source (below) |
| `usePathname()` does not normalise; `router.replace` does | `next` source (below) |
| A route override exists on both platforms, is **native-only**, and **on Android is not reachable for the paths that need it** under Capacitor's defaults | vendor source (§D3) |
| **Whether the Android `html5mode: false` shape works on a device** | **unmeasured** — no platform project exists |
| **Whether `images: { unoptimized: true }` is required** | **taken from the draft**, not re-measured here |

Chromium was driven against a local server replicating each platform's documented routing rule.
That is a faithful model of the *routing*, and it is **not** a device: it says nothing about
WKWebView quirks, the `capacitor://` scheme, or Android's `html5mode` default.

## D1 — Why the params go on the layout, not the page

Not a preference. Every one of the ten pages is `'use client'` and reads its id from
`useParams()`, and Next refuses both in one module:

```
App pages cannot use both "use client" and export function "generateStaticParams()".
```

A layout is a server module even when every page beneath it is a client one, and
`generateStaticParams` answers for the **segment**, so one layout covers everything nested under
it. That is why 7 pages and 10 pages cost the same three files:

| Layout | Covers | Status |
|---|---|---|
| `clubs/[id]/layout.tsx` | 5 pages | **exists** — carries `pt-header-sub-extra pb-8`, which must survive the edit |
| `rides/[id]/layout.tsx` | 4 pages | new, renders bare `children` |
| `postcards/[id]/layout.tsx` | 1 page | new, renders bare `children` |

**The one thing to be careful about is the club layout.** It is not a pass-through — it wraps
children in a spacing div, and an intermediate revision of the draft replaced its body with
`return children` while adding the export, silently regressing four screens. Add the export;
do not touch the body.

## D2 — Why not `trailingSlash`, and the exact mechanism

`trailingSlash: true` is in the draft with a stated justification that is wrong:

> makes `/clubs` an `out/clubs/index.html` directory instead of an `out/clubs.html` sibling file.
> Capacitor's asset handler resolves a URL path against the filesystem…

It does not. Both routers short-circuit on the extension:

```swift
// ios/Capacitor/Capacitor/Router.swift — CapacitorRouter.route(for:)
if pathUrl.pathExtension.isEmpty { return basePath + "/index.html" }
return basePath + path
```

```java
// android/…/WebViewLocalServer.java — handleLocalRequest()
if (path.equals("/") || (!request.getUrl().getLastPathSegment().contains(".") && html5mode)) {
    String startPath = this.basePath + "/index.html";
```

Neither ever tries `<path>/index.html` and neither ever tries `<path>.html`. So the directory
layout `trailingSlash` produces buys nothing under Capacitor, and it costs the guard.

**The guard mechanism, from Next 16.2.9's own source.** `usePathname()` reads `PathnameContext`,
which `app-router.js` fills from the canonical URL with no trailing-slash handling at all:

```js
pathname: hasBasePath(url.pathname) ? removeBasePath(url.pathname) : url.pathname
```

`router.replace()` goes the other way — `app-router-instance.js` builds its URL through
`addBasePath`, which is `normalizePathTrailingSlash(...)`, which under `__NEXT_TRAILING_SLASH`
appends the slash. So:

1. Rider lands on `/auth/login/`.
2. `isPublicPath('/auth/login/')` → `PUBLIC_PATHS.includes` is exact → **false**.
3. `resolveDestination` returns `'/auth/login'`.
4. `RouteGuard` sees a truthy destination → renders `<GuardSplash />` **instead of** children,
   and fires `router.replace('/auth/login')`.
5. That normalises to `/auth/login/` — the URL it is already on. `destination` never changes, the
   effect's deps never change, and the splash is permanent.

Measured end to end in Chromium: `splash present: true`, `body text: ""`, at `/`, `/auth/login/`
and `/onboarding/terms/`. The same export without `trailingSlash`: `splash present: false`,
`body text: "Login Email Password Login Forgot password? Sign up"`.

`/legal/*` survives because `isPublicPath` uses `startsWith('/legal/')`, and `/postcards/` survives
for an onboarded rider because the last branch tests membership of `/`, `/onboarding*` and the two
auth entries rather than equality with a protected path. **Auth and onboarding are what break, and
they are the two a rider cannot get past.**

**Therefore: do not set `trailingSlash`.** If some later platform finding makes it genuinely
necessary, `guard.ts` must be normalised *first* and its 36 cases extended to cover both shapes —
because all 36 pass today with the app unusable.

## D3 — The routing decision

The problem, stated once: **a static export can only serve documents it prerendered, and Next's
client router hard-navigates when the RSC payload for a target route is missing.** Measured:

```
click <Link href="/rides/8d6e…0001">
  404 /rides/8d6e…0001.txt     the segment payload
  404 /rides/8d6e…0001         a full document load, i.e. the router gave up on client routing
```

Under Capacitor that second request is answered with the root `index.html` (D2), so Next boots
`/`'s tree at a `/rides/<uuid>` URL, and `src/app/page.tsx` renders `null`. The rider taps a ride
and gets a blank screen. This is not the deep-link case; it is the ordinary case.

### Option A — keep the paths, override the shell's router

Map any `/rides/*` onto `rides/placeholder/index.html` in the shell. **The first revision of this
section said "Both platforms support it" and "Either can map `/rides/<anything>`". Both sentences
were wrong about Android, and the correction is what moves the recommendation.**

**iOS — as described, and cheap.** `CAPBridgeViewController.router()` is an `open` method returning
`CapacitorRouter()` (`CAPBridgeViewController.swift:107`), `WebViewAssetHandler(router:)` takes the
protocol, and the handler passes the router the real requested path
(`WebViewAssetHandler.swift:41`, `router.route(for: stringToLoad)`). One Swift subclass in
`ios/App`, one rule.

**Android — the processor never sees the path.** An extensionless `/rides/<uuid>` takes the
html5mode branch of `WebViewLocalServer.handleLocalRequest()`, and that branch is:

```java
if (path.equals("/") || (!request.getUrl().getLastPathSegment().contains(".") && html5mode)) {
    String startPath = this.basePath + "/index.html";
    if (bridge.getRouteProcessor() != null) {
        ProcessedRoute processedRoute = bridge.getRouteProcessor().process(this.basePath, "/index.html");
```

`this.basePath` and a **hardcoded `"/index.html"`**. The requested path is discarded before any
processor is consulted, so a `RouteProcessor` cannot distinguish `/rides/<uuid>` from `/profile`
from `/clubs/<uuid>` — it is told the same thing every time. The one call site that does receive
the real path is in the `PathHandler` (`process("", path)`), and the branch above `return`s before
control ever reaches it. Same file this proposal's other Capacitor claims come from.

**The Android shape that does work, and why it is not a small change.** `html5mode` defaults to
`true` (`CapConfig.java:36`) and is settable as `server.html5mode` from `capacitor.config.ts`
(`CapConfig.java:248`). Setting it `false` makes an extensionless path skip that branch and reach
the `PathHandler`, where the processor gets the real path. But the same branch is the blanket
root-`index.html` fallback, so turning it off means the processor must now resolve **every**
extensionless path in the app — `/postcards`, `/rides`, `/clubs`, `/profile`, `/notifications`,
all three onboarding steps, all five auth paths, all three legal pages — mapping each to its own
document, plus the placeholder mapping for the three dynamic segments. That is a static file
resolver written from scratch in Java. `/` alone still works, because `path.equals("/")` is the
first disjunct and survives `html5mode: false`.

It also removes the safety net: today a mapping bug falls back to the root document and the app
at least boots. With `html5mode: false` a mapping bug is a hard failure on a route.

**What it fixes:** findings 1, 2 and 3 together, because the correct document is served for the
real URL, so both a hard navigation and a cold start land on the right tree.

**What it costs, corrected:** **two different native implementations** — one trivial subclass on
iOS, one from-scratch resolver plus a config change on Android — in a language neither is written
in today, in directories that do not exist (PD-95), none of it runnable here. It also puts a
routing rule in four places: `guard.ts`, the app router, and each shell.

**One property to preserve deliberately, under either platform:** the mapping must send *every* id
to the placeholder document, never only known ones. A processor that 404s an unknown id and serves
a known one is an existence oracle, and it would defeat the "a private club is not described as an
empty one" requirement from the other side. It never consults the database, so it cannot be one —
but only if it is written that way.

### Option B — take the id out of the path

`/rides/detail?id=<uuid>`. No dynamic segments, so `generateStaticParams` is not needed at all,
group 1 disappears, and no navigation can hard-navigate because the document never changes.

**What it costs:** every `href` in `src/`, `useParams()` → `useSearchParams()` on ten pages,
`keys.ts` unchanged but every link site touched, and — the one that is not mechanical — the URL a
rider **shares**. `ShareButton` builds `${origin}/postcards/${id}`, and a link already sitting in
somebody's messages has to keep resolving, so the old shape survives on the web as a redirect that
the bundle never loads. That redirect is a page the export must not carry, which is the one place
B leaves two route shapes in the tree rather than one.

**It still needs group 3, and its version is much smaller.** A cold start at `/rides/detail?id=x`
is an extensionless path, so Capacitor serves the root document and Next renders `/`'s tree — the
same failure. But `/rides/detail` is a **static** route, so a boot-time
`router.replace(location.pathname + location.search)` from `/`'s tree reaches it client-side, in
TypeScript, testable in this container. The same trick under option A hard-navigates and loops,
because the target is a dynamic segment with no prerendered payload.

### Recommendation, and who decides

**B, with A as the fallback. This reverses the first revision, and the reason is the Android
finding above, not a change of taste.** A was recommended on the grounds that it kept every URL as
it is and confined the change to two small files. That premise is half false: on Android it is not
a small file, and under Capacitor's defaults it is not possible at all. Re-priced:

| | A (paths + native routing) | B (`?id=`) |
|---|---|---|
| Native code | iOS subclass **and** an Android resolver | none |
| Works on vendor defaults | no — needs `server.html5mode: false` | yes |
| Verifiable in this container | no | yes |
| Deep-link fix (group 3) | native, unverifiable | client `router.replace`, testable |
| `src/` churn | none | ten pages, every `href` |
| Shared URL shape | unchanged | changes; old shape survives as a web redirect |
| Failure mode when wrong | a route hard-fails on device | a link 404s on the web |

**What would still make A right** is a hard product requirement that `/postcards/<uuid>` stay the
canonical shared URL inside the bundle as well as on the web. That is a legitimate requirement if
it is one — but it should now be bought knowingly, at the corrected price, rather than accepted
because A looked cheap. The trade is the product owner's, not a session's.

## D4 — `distDir`, `webDir`, and the white screen

The draft sets `distDir: '.next-capacitor'` to keep the export's build cache away from `.next`.
Measured, that changes where the site lands:

| Config | Export lands in | `out/` created |
|---|---|---|
| `output: 'export'`, `distDir: '.next-capacitor'` | `.next-capacitor/` | **no** |
| `output: 'export'`, no `distDir` | `out/` | yes |

`capacitor.config.ts` already carries the reasoning, read out of Next's own
`hasCustomExportOutput()`: under `output: 'export'` a custom `distDir` *becomes* the out dir. Its
committed `webDir` is `'out'`.

**So do not set `distDir`.** The cache-separation benefit is real but small, and the cost of
getting it wrong is an empty `webDir`, which `cap sync` copies without complaint and which fails at
*launch on a device* as a white screen — the most expensive place in this epic to find a one-word
mistake. Dropping `distDir` makes the committed `webDir: 'out'` correct with no edit, and removes
the only way this can go wrong silently. If cache separation is wanted later, it is one line in
each of two files and the rule is already written down: **`webDir` must equal `distDir` whenever
one is set, and `'out'` only when one is not.**

## D5 — What the export actually contains

33 HTML documents, plus a set of `__next.*.txt` RSC segment payloads per route. The dynamic
segments each get exactly one directory:

```
out/rides/placeholder/{index.html, chat/, crew/, edit/, __next.*.txt}
out/clubs/placeholder/{index.html, about/, members/, rides/, edit/}
out/postcards/placeholder/index.html
out/404.html            <- Next's stock 404, no not-found.tsx exists in this repo
```

Every one of those documents is the same client shell. That is the property the negative cases
lean on and the property a test should assert rather than assume.

## D7 — Two things that are true on the web and false in the shell

Neither is about routing, both are permanent properties of a shipped binary, and neither was in the
first revision of this proposal. They belong here because this capability owns *the artifact*, and
these are the two most durable things baked into it.

### The backend the bundle points at cannot be changed after it ships

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are inlined at build time. On Vercel
that already means a build permanently carries whichever database it was built against, which is
why `CLAUDE.md` forbids promoting a preview to production. **A bundle is the same rule with no
escape hatch**: a `.ipa` or `.aab` built from a feature branch or from `development` points every
install at `letsride-dev` for ever. There is no promote, no redeploy, no dashboard toggle — the
fix is a new binary through a store review, which is days.

Two consequences worth naming rather than leaving implied:

- DEV runs `mailer_autoconfirm: true` (decision #6), so a DEV-built release would let anyone sign
  up with an address they do not control — a store-review failure and a real one.
- The project ref is *visible* in the bundle, which is fine and always was, but it means the check
  is cheap: grep the built output for the ref and compare it to `zwprydcyryvudhurbnye` before
  submission. That is an assertion, not a convention.

**A release bundle SHALL be built from `main`, against `letsride`, and the ref it carries SHALL be
asserted before submission.** Everything else — a local build, a test bundle on a device — may
point wherever it likes, as long as it never reaches a store.

### `window.location.origin` is the webview's origin

Three call sites build URLs from it, and all three are correct on the web:

```
src/components/postcards/ShareButton.tsx:28   `${window.location.origin}/postcards/${postcardId}`
src/lib/actions/auth.ts:54                    signup confirmation redirect
src/lib/actions/auth.ts:152                   password recovery redirect
```

In the bundle that origin is `https://localhost` (the `androidScheme: 'https'` already set in
`capacitor.config.ts`) or `capacitor://localhost`. So:

- A shared postcard link becomes `https://localhost/postcards/<uuid>` — dead the moment it leaves
  the device.
- **Signup confirmation and password recovery emails point at an origin GoTrue's redirect allowlist
  does not contain.** A rider who installs the app and cannot confirm their signup never reaches
  the product at all. That is a larger break than any of §D3's three routing failures, it arrives
  through the same door, and it is invisible until someone signs up on a real device.

`CLAUDE.md` §Branching currently reads the other way — it cites `window.location.origin` as the
reason a domain change costs no code, and offers
`grep -rn "letsrideapp\|vercel\.app\|localhost:3000" src/` as the check. That is true on the web
and false in the shell, and the check would not catch this because the origin is computed rather
than written. **URLs that leave the app SHALL be built from a configured canonical origin**, with
the runtime origin used only where the URL never leaves the process.

## D6 — Open questions, each with a default

Each is marked blocking or not, and says who can answer it. A question with no default stalls the
build; a default lets work continue and be corrected.

**Q1 — Option A or option B? (D3)**
**Blocking for groups 2 and 3. Not blocking for group 1, but see the tension below.** Product
owner. **Default: B**, on the corrected pricing in D3 — this reverses the first revision's default
of A, because A is not possible on Android under Capacitor's defaults and the shape that is
possible is a from-scratch static resolver in Java.

*The tension, named rather than buried:* group 1 is safe to merge under A and is work that B partly
deletes, because a route with no dynamic segment needs no `generateStaticParams`. It is cheap
enough (one small module, three layout exports) that merging it first is defensible either way —
but it should be merged knowing that, not discovered later.

**Q2 — Does a native route override actually resolve the deep link?**
**Blocking for group 3 under option A only. Half of it is now answered, in this container, from
source, and the answer is no.** Android's `RouteProcessor` is handed a hardcoded `"/index.html"`
in the branch that extensionless paths take, so under Capacitor's defaults the answer is a
definite **no** rather than an unknown. What remains genuinely unmeasurable here is whether the
`server.html5mode: false` shape works on a device, and whether the iOS `Router` subclass does.
Needs a human with a Mac, after PD-95. **Default: choose B and the question does not arise.** If
A is chosen anyway, implement it and label the whole of group 3 *written and unverified* in the PR
body — per `.claude/agents/native.md` that is a legitimate deliverable as long as it is labelled.

**Q3 — What should a rider see when a ride is gone?** There is no `not-found.tsx`, so it is Next's
stock *"404 | This page could not be found"* — inside the app, on a phone. **Non-blocking.**
Product owner for the copy, design for the frame; `npm run figma -- ls` returned zero `error` or
`offline` frames when `client-render-shell` was written, so there may be nothing drawn.
**Default: ship as is in this change and file nothing** — it is pre-existing on the web today and
this change does not worsen it.

**Q4 — Should `clubIdSchema` be added, and on which of the two existing precedents?** `getClub`
does not validate its segment, so `/clubs/placeholder` throws `22P02` into the error boundary where
`/rides/placeholder` and `/postcards/placeholder` reach not-found. **Non-blocking.** A session's
call under the owner's "if it is within the context of the build and recommended, just do it".

**The repo has two precedents and they are not interchangeable**, which the first revision missed
by attributing the postcards behaviour to the data layer:

- **`getRide`** validates *in `lib/data/`* — `if (!rideIdSchema.safeParse(id).success) return null`,
  placed **before** `resolveSupabase()`, so no round trip is issued. `getRideMessages` does the
  same.
- **`/postcards/[id]/page.tsx`** validates *in the page* — `postcardIdSchema` gates the query key
  to `null` so `useQuery` issues nothing, then `notFound()` past every hook. **`getPostcard` itself
  does no validation at all** (`src/lib/data/postcards.ts:324` passes the segment straight to
  `.eq()`), so that page is the only thing standing between a bad id and a `22P02`.

**Default: the `getRide` precedent — validate inside `getClub`.** Three reasons: the doorway rule
says `lib/data/` owns the query shape; five club pages would otherwise each need their own copy of
the page-level guard; and the postcards shape exists for a reason that does not apply here — that
page fans out three queries and needed the disabled-key trick to keep hook order stable. Worth
noting that this leaves `getPostcard` as the one read whose guard lives outside it, which is a
pre-existing inconsistency this change should name rather than silently even out.

**Q5 — Is `images: { unoptimized: true }` still required?** The draft measured it on 2026-08-06;
this proposal did not re-measure it in isolation. **Non-blocking**, and answered by the
implementing build. **Default: keep it** — `next/image`'s default loader is a server route and
there is no server in a bundle.

**Q6 — What stops `CAPACITOR_BUILD` reaching a Vercel target?** Nothing today except nobody having
set it. **Non-blocking now, blocking before the first native release**, because from then on two
build shapes exist and one of them must never deploy. Owner action on the Vercel side; a session
can add the CI assertion. **Default: assert it in CI** (`next build` output contains no
`placeholder`) and leave the Vercel-side environment hygiene to the owner.

**Q7 — Should the bundle carry a build stamp so a white screen can be diagnosed?** An empty
`webDir` and a broken route look identical on a device. **Non-blocking.** Session's call.
**Default: no** — it is speculative until a device has run once.

**Q8 — Which Supabase project does the first release bundle point at, and who asserts it? (D7)**
**Not blocking this change; blocking the first submission**, and the failure is unfixable without a
store review. Owner action for the release procedure; a session can write the assertion.
**Default: `letsride`, built from `main`, with a grep of the built output for the production ref
as a release-checklist step** — never "we were on the right branch".

**Q9 — Where does the canonical origin come from? (D7)** Three call sites build URLs from
`window.location.origin`, which in the shell is `https://localhost`, breaking shared links and —
worse — every signup-confirmation and password-recovery email. **Non-blocking for the bundle to
build; blocking before any rider installs it.** The choice between a build-time constant and a
runtime capability check is a session's; whether the shell should use `app.letsride.social` at all
is the owner's, since it depends on the domain being attached (`docs/ENVIRONMENTS.md` §Domains).
**Default: a build-time constant defaulting to `window.location.origin`**, so the web build is
unchanged and the bundle overrides it — and file the GoTrue redirect-allowlist entry as an
`Owner only` item, because no session can add one.
