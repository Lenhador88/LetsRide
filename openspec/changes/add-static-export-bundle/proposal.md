# A static bundle the native shell can actually load

> Linear **PD-142**, Medium, milestone **Store submission**. This file is the specification; the
> issue points at it and must not restate it. `CLAUDE.md` §The roadmap lives in Linear: *"A Linear
> issue that grows a specification is a bug."*
>
> **Everything measured here was measured on 2026-08-10 against `9b9daa4`**, in a throwaway
> `git worktree`, with `next` at the pinned `16.2.9`. Nothing in the working tree was changed to
> get these numbers. Where a claim comes from reading a platform's source rather than running it,
> the file and symbol are named; where it is neither, it is labelled **unmeasured**.

## Why

`capacitor.config.ts` names `webDir: 'out'` and nothing produces `out/`, so `npx cap sync` has
nothing to copy. That is the whole gate on the native shell, and it is one build flag away from
opening — except that the flag does not build:

```
$ CAPACITOR_BUILD=1 npx next build          # output: 'export'
Error: Page "/rides/[id]/chat" is missing "generateStaticParams()"
so it cannot be used with "output: export" config.
```

**The route count in the issue is stale and the shape of the problem is not.** The issue says
seven, measured 2026-08-07. It is **ten** pages across **three** dynamic segments, and the build
error now names `/rides/[id]/chat`, a route that did not exist when the issue was written:

```bash
git ls-files 'src/app/**/page.tsx' | grep '\['     # 10
```

| Segment | Pages under it |
|---|---|
| `clubs/[id]` | `page`, `about`, `members`, `rides`, `edit` |
| `rides/[id]` | `page`, `crew`, `chat`, `edit` |
| `postcards/[id]` | `page` |

`/rides/[id]/chat` arrived with PD-115 and `/rides/[id]/edit` + `/clubs/[id]/edit` with PD-101
(`5fd6a17`). The **segment** count did not move, and that is what matters: a fix keyed on segments
absorbed a 43% growth in pages without changing shape. Measured — the unmerged draft on
`origin/claude/store-submission-prep-6o1q3d` puts `generateStaticParams` on three `[id]` layouts,
and applying it unchanged to today's tree produces a successful export covering all ten pages.

None of the ten can supply a real parameter list. The ids are per-rider, RLS-scoped rows that do
not exist on the build machine, the bundle is built once and installed on thousands of devices,
and baking real ids into an IPA would disclose which rows existed on build day to anyone who
unzips it. Returning `[]` does not rescue it either: `output: 'export'` forces
`dynamicParams: false`, so an unknown id has nowhere to go.

### The finding that reframes the issue

**`next build` succeeding is not the same as the bundle working, and the gap is larger than the
draft's own caveat says.** The draft flags one unsolved case — a cold start at a real deep link —
and labels it unmeasured. Measured, there are three, and the first is not a deep-link edge case at
all:

1. **Ordinary in-app navigation into any detail screen hard-navigates out of the app's own
   document.** Clicking a `<Link href="/rides/<a real uuid>">` inside the exported bundle
   requests the route's RSC payload, gets a 404 because only `/rides/placeholder` was
   prerendered, and **falls back to a full document navigation** to a URL with no document
   behind it. Measured in Chromium against the export, with a temporary probe page:

   ```
   404 /rides/8d6e4c1a-…-000000000001.txt     <- RSC payload for the target route
   404 /rides/8d6e4c1a-…-000000000001         <- then a hard document load
   ```

   Every tap from the rides list into a ride, from the clubs list into a club, and from the deck
   into a postcard is this. It is not reachable on Vercel, where a server answers the unknown id,
   which is exactly why nothing has caught it.

2. **Capacitor answers every extensionless path with the *root* `index.html`, on both platforms.**
   Not `<path>/index.html`, not `<path>.html` — the root document, whatever was asked for. Read
   from the shipped platform sources in `node_modules`, at the pinned `8.5.0`:

   - iOS — `ios/Capacitor/Capacitor/Router.swift`, `CapacitorRouter.route(for:)`:
     `if pathUrl.pathExtension.isEmpty { return basePath + "/index.html" }`
   - Android — `android/…/WebViewLocalServer.java`, `handleLocalRequest()`:
     `if (path.equals("/") || (!lastPathSegment.contains(".") && html5mode))` →
     `basePath + "/index.html"`

   So the per-route HTML files the export exists to produce are **never served by Capacitor at
   all**. A launch loads `/`, and everything after it is client-side routing — which is ordinary
   SPA behaviour and fine, until finding 1 turns a tap into a document load. That document load
   gets the root document back, Next boots `/`'s route tree at a `/rides/<uuid>` URL, and `/`'s
   page component `return null`s.

3. **`trailingSlash: true` locks every rider out of the app, and it is not needed for the export
   to build.** The draft sets it, reasoning that Capacitor resolves `/clubs` against the
   filesystem and needs a directory. Finding 2 says it does not resolve against the filesystem at
   all. What `trailingSlash: true` *does* do is break `src/lib/auth/guard.ts`, whose public-path
   denylist is exact-string matching:

   ```ts
   PUBLIC_PATHS.includes(pathname)   // '/auth/login/' is not '/auth/login'
   ```

   Measured in Chromium against the export: a cold start at `/`, at `/auth/login/` or at
   `/onboarding/terms/` ends on the green splash **permanently**, with an empty body and no login
   form. The same export built without `trailingSlash` boots, redirects, and renders
   `"Login Email Password Login Forgot password? Sign up"`. The mechanism, from Next 16.2.9's
   source rather than inference: `usePathname()` returns `url.pathname` with no normalisation
   (`dist/client/components/app-router.js`), while `router.replace()` normalises *towards* the
   slash (`dist/client/add-base-path.js` → `normalizePathTrailingSlash`). So the guard asks for
   `/auth/login`, the router delivers `/auth/login/`, the guard asks again, and `RouteGuard`
   renders the splash rather than children for as long as it has a destination. All 36 guard tests
   pass, because every one of them feeds a slashless path.

**None of this makes the draft wrong about the thing it set out to do.** Its mechanism is the
right one and it survives intact; what it does not do is deliver a loadable app, and its config
carries one option that must not ship.

## What Changes

Three groups, ordered. **How independently they merge depends on the answer to the routing
decision below, and the first revision of this proposal overstated it.** Under option A, group 2
*is* group 3 — both are native code in directories that do not exist — so only group 1 merges
alone. Under option B, group 1 largely disappears, because a route with no dynamic segment needs
no `generateStaticParams` at all. **Only group 1 is independently mergeable under both answers,
and under B it is work the answer partly deletes.** `tasks.md` states which groups survive each
answer.

1. **The export builds.** `generateStaticParams` on the three `[id]` segment layouts, returning a
   single placeholder param when a build flag is set and `[]` otherwise. Export options gated on
   the same flag, with **no `trailingSlash`** and **no `distDir`**, so the export lands in `out/`
   and `capacitor.config.ts` needs no edit.
2. **The route shape stops requiring a document per id.** This is a decision, not a task, and it
   is set out below. Group 1 alone ships a bundle in which ten routes are unreachable.
3. **A cold start at a non-root URL lands on the right screen.** Deep links, and a webview process
   restore.

## The routing decision — the owner's, and the reason this is a proposal

The issue is right that this "must not be settled by import". Two shapes reach a working bundle
and they cost different things. `design.md` §D3 carries the full working; the short version:

**A) Keep `/rides/[id]` and teach the shell to resolve it.** Map any id in a dynamic segment onto
that segment's placeholder document, inside the shell. **The cost of this was priced wrong in the
first revision of this proposal and the correction is large enough to move the recommendation:**

- **iOS is what it looked like.** `CAPBridgeViewController.router()` is an `open` method returning
  `CapacitorRouter()`, and `WebViewAssetHandler.swift:41` hands the router the real `url.path`. One
  Swift subclass, one rule.
- **Android cannot do it at all under Capacitor's defaults.** An extensionless path takes
  `WebViewLocalServer.handleLocalRequest()`'s html5mode branch, and that branch calls
  `bridge.getRouteProcessor().process(this.basePath, "/index.html")` — **a hardcoded literal. The
  requested path is discarded before any processor sees it.** The one call site that does receive
  the real path (`process("", path)`, in the `PathHandler`) sits past a `return` that the html5mode
  branch has already taken. Read from the same vendor file as the rest of this proposal's
  Capacitor claims.
- **The Android shape that does work is bigger than A was sold as.** `server.html5mode: false`
  (default `true`, `CapConfig.java:36`, settable from `capacitor.config.ts`) skips that branch — but
  it also removes the blanket root-`index.html` fallback for *every* extensionless path. The
  processor then has to resolve all of them: `/postcards`, `/rides`, `/clubs`, `/profile`,
  `/notifications`, every onboarding step, every auth and legal page. That is a from-scratch static
  file resolver in Java, not a placeholder mapping, and it has no fallback left when it is wrong.

So A is **two different native implementations**, one trivial and one substantial, in a language
neither is written in today, in directories that do not exist (PD-95), and **none of it can be run
in this container.**

**B) Take the id out of the path.** `/rides/detail?id=<uuid>`. A query string is not part of the
path, so one prerendered document serves every ride, `generateStaticParams` is not needed at all,
and no navigation ever hard-navigates. **Cost:** every `href` in `src/` changes, `useParams()`
becomes `useSearchParams()`, and the URL shape a rider *shares* changes — links already in people's
messages have to keep resolving, which means the old path survives on the web as a redirect the
bundle never loads.

**Recommended default: B — this reverses the first revision's recommendation, and the reason is
finding 1 above.** A was recommended on the grounds that it kept every URL as it is and confined
the change to two small files. Half of that premise is false: on Android it is not a small file,
and under Capacitor's defaults it is not possible. B needs **no native code on either platform**,
runs on both vendors' default configuration, and reduces the deep-link half to a boot-time client
navigation that is ordinary TypeScript and testable here.

**What would still make A right:** a hard product requirement that `/postcards/<uuid>` remain the
canonical shared URL, in the bundle as well as on the web. That is a real requirement if it is one,
and it is the owner's to state — but it should be paid for knowingly rather than inherited from a
cost estimate that was wrong.

## The negative cases

Stated as `openspec/config.yaml` requires — who must **not** see or do this. Most of this change
grants nobody anything new, and saying so explicitly is the point: an unstated negative silently
becomes whatever the implementer assumed.

**The bundle is a file every installer can unzip. Nothing rider-specific may be in it.**

- **Every role — owner, admin, member, non-member, blocked rider, signed-out visitor — SHALL
  receive byte-identical HTML.** The prerendered document for `/clubs/placeholder` is the same
  document as for every other club, because every one of these pages is `'use client'` and fetches
  in an effect. No club name, ride title, postcard caption, username, avatar URL or signed Storage
  URL may appear in the export. This is a property to assert in a test, not to assume from the
  render model.
- **No real id may be prerendered, ever, on any build.** Not as a fixture, not as a convenience,
  not "just the public clubs". A real id in the export is a disclosure that a row existed on build
  day, to anyone with the IPA, and it is not revocable.
- **A prerendered document grants no read.** Shipping `/clubs/placeholder/edit` to a device does
  not make a non-owner able to edit a club — the edit screen renders nothing without RLS, and
  `clubs`' UPDATE policy is `auth.uid() = owner_id`. This is stated because "the edit page is in
  the bundle" is exactly the sentence that gets misread as an escalation. It is not one, and there
  is no policy change in this proposal.

**The placeholder id must be unreachable on the web build, and detectably so.**

- **A signed-out visitor SHALL NOT be able to load `/postcards/placeholder`, `/rides/placeholder`
  or `/clubs/placeholder` on `app.letsride.social` or `app-dev.letsride.social` as a real page.**
  Measured: with the flag unset the params function returns `[]` and the web build prerenders zero
  placeholder paths, on all ten routes. What still resolves is the *route*, on demand, and it
  resolves the way any bad id does — through the guard to `/auth/login` for a visitor, and to
  not-found for a signed-in rider.
- **A regression here is silent, so it needs a tripwire.** The failure is a build that emits
  `placeholder` into `out/` on Vercel because someone inverted the flag or dropped the guard. The
  detection is a unit assertion that the params function returns `[]` with the flag unset, plus a
  grep of the production build output. Neither exists today.
- **"Emitted files" means every emitted file, not every `.html`.** The export also writes a set of
  `__next.*.txt` RSC segment payloads per route, and those are the files the client router actually
  fetches on a navigation. A check that globs `**/*.html` passes while leaving them uninspected,
  which is the shape of a guard that cannot fail. Both the no-rider-data assertion and the
  no-placeholder assertion apply to the whole output tree.
- **`/clubs/placeholder` behaves differently from the other two and that is a real defect this
  change should close.** `getRide` and `getPostcard` validate the segment as a UUID and return
  `null`, which reaches `notFound()`. **There is no `clubIdSchema`** — `getClub` passes
  `'placeholder'` straight to `.eq('id', …)`, PostgREST answers `22P02`, `unwrap` throws, and the
  rider gets the error boundary instead of not-found. Pre-existing, not caused here, and this
  change is what makes the string `placeholder` a name someone will type.

**Visibility is unchanged, in every direction.**

- **A non-member opening a private club by deep link SHALL reach the same "unavailable" screen
  they reach today**, and the routing mechanism MUST NOT distinguish "no such club" from "a club
  you may not see". A route processor that 404s an unknown id but serves a known one would be a
  new existence oracle; a route processor that serves the placeholder document for *every* id
  cannot be one, because it never consults the database.
- **A blocked rider SHALL reach an ordinary absence**, in both directions, exactly as
  `client-render-shell` already requires. Nothing in the bundle may tell them a block is why.
- **No `anon` grant is introduced.** Decision #1 is untouched. The shell is public and always was
  — `client-session-storage` says so — and the bundle makes it public in a second way (a file on a
  device) without making any *datum* public.

**Two things are true on the web and false in the shell. Both are permanent properties of a
shipped binary, and neither was in the first revision of this proposal.**

- **The bundle points at whichever Supabase project it was built against, for ever.** Both
  `NEXT_PUBLIC_SUPABASE_*` are inlined at build time, so a bundle built on a feature branch or
  from `development` points **every install** at `letsride-dev` — and there is no promotion, no
  redeploy and no environment variable that can move it afterwards. The only fix is a new binary
  through a store review. `CLAUDE.md` §Branching already carries the sibling rule for Vercel's
  promote; **this is that rule for something a rider installs**, and it is worse, because a wrong
  Vercel deploy is one merge away from correct and a wrong bundle is one App Store review away.
  DEV also runs `mailer_autoconfirm: true`, so a DEV-built release would let anyone sign up with
  an address they do not control. **A release bundle SHALL be built against `letsride`, from
  `main`, and the project ref it carries SHALL be asserted before submission** rather than
  inferred from which branch someone was on.
- **`window.location.origin` is the webview's origin, not the app's.** `ShareButton.tsx:28`,
  `actions/auth.ts:54` and `actions/auth.ts:152` all build URLs from it. In the bundle that is
  `https://localhost` (or `capacitor://localhost`), so a shared postcard link becomes
  `https://localhost/postcards/<uuid>` — dead in the recipient's hands — and, worse, **the signup
  confirmation and password recovery emails point at an origin GoTrue's redirect allowlist does
  not contain**. A rider who cannot confirm their signup never reaches the app at all, which is a
  larger break than any of the three routing failures above and arrives by the same door.
  `CLAUDE.md` §Branching currently cites `window.location.origin` as the reason a domain change
  costs no code; that is true on the web and false in the shell, and the line needs the
  qualification. **URLs that leave the app SHALL be built from a configured canonical origin, not
  from the runtime origin.**

**The build-time prerender pass does not go away, and a proposal implying otherwise would be
actively harmful.**

- **`output: 'export'` removes the runtime server, not the pass.** The export ran the prerender
  once and emitted 33 HTML documents. So a component body still executes with no `localStorage`
  and no session, `anon` still holds zero grants, and `resolve.browser.ts`'s read-during-render
  tripwire still fires — at build time, taking `next build` down. **The *read in an effect, never
  during render* rule is permanent and this change does not relax it.**

**`notFound()` still means something, and it is not an HTTP status.**

- Under a static export there is no server to send a 404. `notFound()` throws to the nearest
  not-found boundary in the running React tree, client-side, and renders in place — which works,
  and is what already happens on Vercel for these ten client pages.
- **There is no `not-found.tsx` anywhere in the repo** (`git ls-files 'src/app/**/not-found.tsx'`
  is empty), so what renders is Next's stock *"404 | This page could not be found"*. Acceptable in
  a browser tab; inside an app, on a phone, it is framework branding in the middle of the product,
  and it is what a rider sees when they open a ride that was deleted. Recorded here as a gap this
  change surfaces; closing it is a design question, not a routing one.

**The web build must be provably unchanged, not hopefully unchanged.**

- **A flag leaking into a Vercel build SHALL be caught by CI, not by a rider.** `CAPACITOR_BUILD`
  is set in no Vercel target today, and "we did not set it" is not a verification. Measured
  consequence if it leaked: the deployment becomes a static export with no server, so every
  unknown id 404s and `next/image` stops being optimised — a green deploy of a broken app, which
  §Working Principles names as the worst available failure.
- **One effect on the web build is unavoidable and must be recorded rather than discovered.**
  Declaring `generateStaticParams` reclassifies a segment *whatever it returns*. Measured on the
  current ten, with the flag unset: `ƒ (Dynamic)` **10 → 0**, `● (SSG)` **0 → 10**, each with zero
  prerendered paths. `dynamicParams` defaults to `true` off the export path, so every real id is
  still rendered on demand and no rider sees a difference — but `docs/HANDOFF.md`'s
  `grep -cE '^[┌├└│ ]*ƒ /'` one-liner, the documented check that the client-render migration is
  intact, **now reads 0 and must not be read as a regression**. That doc line has to move with this
  change or it becomes a trap on the day someone runs it.
- **The reclassification is a change to how Vercel *caches* those ten routes, not only to the
  symbol in the route table**, and the shorter phrasing loses the half that could bite. An SSG
  route with `dynamicParams` is rendered on demand and then eligible to be held, where a `ƒ` route
  was not. It is safe here for a specific reason and the reason has to be asserted rather than
  assumed: all ten pages are `'use client'` and fetch in an effect, so the document Vercel might
  hold contains no rider data and no per-viewer decision — every viewer gets the same shell and
  every read still runs under their own session. **An implementer SHALL confirm that property
  still holds rather than inheriting this sentence**, because it stops being true the moment any
  one of these pages reads during render.

## Out of scope — named, so nobody folds them in

- **Generating `ios/` and `android/` — PD-95.** This change may write native *source* only if
  option A is chosen, and even then it cannot run `cap add`.
- **Anything needing a deployed Edge Function or a store account.** No account deletion work, no
  submission, no signing.
- **PD-100's Inbox removal must not be undone.** The draft branch this change borrows from carries
  a second commit (`d2bc324`) that removes the Inbox tab in a way PD-100 has since superseded.
  Merging that branch would rewrite `Navbar.tsx` over the PD-100 comment and delete the ride-chat
  `BAR_REPLACED_BY` block that shipped with `034`. **Take `9ecccc6`'s files individually; never
  merge the branch.**
- **Retiring the SSR pass.** It does not retire — see the negative case above. `output: 'export'`
  removes the runtime server and keeps the pass.
- **Offline behaviour, secure storage, push, permission strings.** `client-session-storage` and
  `rider-ux` own those and none of them block a `webDir`.

## Impact

- **Affected specs:** `native-static-bundle` (new capability), `client-render-shell` (modified —
  the route guard's path matching becomes a stated contract rather than an implementation detail).
- **Affected code:** `next.config.ts`; three `[id]/layout.tsx` files, two of which are new;
  `src/lib/native/static-params.ts` (new); `src/lib/auth/guard.ts` and its tests if and only if a
  trailing-slash shape is ever adopted; `src/lib/validation/clubs.ts` for the missing
  `clubIdSchema`; `src/components/postcards/ShareButton.tsx` and `src/lib/actions/auth.ts` for the
  canonical origin; `docs/HANDOFF.md`'s dynamic-route one-liner; `CLAUDE.md` §Branching's
  `window.location.origin` line.
- **`capacitor.config.ts`'s header is falsified by group 1 and must move with it.** It states
  *"Seven routes hit it"*, enumerates the pre-PD-115/PD-101 route set, and says
  *"Until then `npx cap sync` has nothing to copy"*. All three stop being true the moment the
  export builds. Its `webDir: 'out'` and its `distDir` reasoning are correct and stay; only the
  blocked-gate narrative changes. The body needs no edit at all if `distDir` is left unset, which
  is this proposal's recommendation.
- **No migration, no policy change, no new grant.** The RLS suite is untouched by this change, and
  that is a statement about scope rather than an oversight — nothing here reaches the database.
- **CI:** a diff confined to `openspec/` runs zero jobs. The implementing diff touches `src/` and
  runs the full Type Check, Lint & Build job.
