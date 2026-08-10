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

Three groups, ordered — **as they stand under the chosen answer, B.** The first revision of this
section described them under both answers, which is now history rather than guidance.

1. **The export builds.** Export options gated on `CAPACITOR_BUILD === '1'`, as a whole
   alternative config object rather than fields spliced onto a shared one, with **no
   `trailingSlash`** and **no `distDir`**, so the export lands in `out/` and
   `capacitor.config.ts`'s body needs no edit. No `generateStaticParams` and no placeholder id —
   the routing decision removed the need for both.
2. **The route shape stops requiring a document per id.** The ids move into `?id=`, ten pages move
   from `useParams()` to `useSearchParams()`, every `href` goes through one module, and the old
   shape survives on the web as a redirect the bundle never loads.
3. **A cold start at a non-root URL lands on the right screen.** Deep links, and a webview process
   restore. Under B this is a boot-time `router.replace` from `/`'s tree — `src/` only, and
   testable in this container.

## The routing decision — **decided: B, by the product owner, 2026-08-10**

Recorded on Linear PD-142 and in `design.md` §D3, which carries the URL family that was settled
with it. **This section is the record of a closed decision, not an open question** — a decision
written down as a recommendation is one that gets re-argued.

The issue was right that it "must not be settled by import". Two shapes reached a working bundle
and cost different things; the pricing is kept below because it is why the answer is what it is.

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

**Chosen: B.** A was first recommended on the grounds that it kept every URL as it is and confined
the change to two small files. Half of that premise is false: on Android it is not a small file,
and under Capacitor's defaults it is not possible. B needs **no native code on either platform**,
runs on both vendors' default configuration, and reduces the deep-link half to a boot-time client
navigation that is ordinary TypeScript and testable here.

**What the choice costs, paid knowingly:** `/postcards/<uuid>` is no longer the canonical shared
URL. It still resolves **on the web** — `next.config.ts` keeps ten `redirects()` entries, 307,
each `source` constrained to a UUID so it cannot swallow `/rides/new`, `/clubs/explore` or
`/rides/detail` itself — so links already in people's messages keep working. Inside the bundle
they do not resolve, because a static export has no server to run a redirect and a redirect
*page* would be a dynamic segment again.

**What the choice deletes:** with no dynamic segment left, `generateStaticParams` is not needed
anywhere, and neither is a placeholder id. `tasks.md` 1.1, 1.2, 1.3 and 1.9 are struck; there is
no `src/lib/native/static-params.ts` in the repo and never was.

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
- **A prerendered document grants no read.** Shipping `/clubs/detail/edit` to a device does
  not make a non-owner able to edit a club — the edit screen renders nothing without RLS, and
  `clubs`' UPDATE policy is `auth.uid() = owner_id`. This is stated because "the edit page is in
  the bundle" is exactly the sentence that gets misread as an escalation. It is not one, and there
  is no policy change in this proposal.

**There is no placeholder id, and that is how these are satisfied.**

The three bullets this heading carried were written for option A, where the export prerendered
`out/rides/placeholder/…` and a build flag decided whether that path also reached Vercel. **Option
B removes the mechanism rather than guarding it**: nothing enumerates ids, so there is no flag to
invert, no params function to return the wrong thing, and no `placeholder` document to keep out of
a deployment. What survives is the property those bullets protected, asserted directly:

- **"Emitted files" means every emitted file, not one extension.** The export writes 274
  `__next.*.txt` RSC segment payloads beside its 33 documents, and those are what the client
  router actually fetches on a navigation. A check scoped to a single extension passes while
  leaving them unread, which is the shape of a guard that cannot fail.
  `scripts/native/check-export.mjs` walks the whole tree and refuses a run that saw no payloads.
- **A regression is still caught, in the direction that is now possible.** The failure that
  remains is `CAPACITOR_BUILD` leaking into a Vercel target, which turns the deployment into a
  static export with no server — a green deploy of a broken app.
  `scripts/native/assert-web-build.mjs` asserts on the built output, in CI.
- **`/clubs/<bad id>` behaved differently from the other two and this change closes it.** `getRide`
  validates its id and returns `null`, which reaches `notFound()`; `getClub` passed the segment
  straight to `.eq('id', …)`, PostgREST answered `22P02`, `unwrap` threw, and the rider got the
  error boundary. Pre-existing, and this change is what makes the id a thing someone hand-edits,
  because it is now visible in a query string. `clubIdSchema` closes it in `getClub` and in
  `getClubForEdit`; `getPostcard` is deliberately left alone (§tasks 2.4a).

**Visibility is unchanged, in every direction.**

- **A non-member opening a private club by deep link SHALL reach the same "unavailable" screen
  they reach today**, and the routing mechanism MUST NOT distinguish "no such club" from "a club
  you may not see". Under B nothing in the routing layer can: one document serves every id, the
  web redirect matches on the *shape* of a uuid rather than on any list of them — the nil uuid
  redirects exactly like a real one and 404s on the screen, which is asserted — and
  `bootRestoreTarget` consults no id list, no route list and no database.
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
  consequence if it leaked: the deployment becomes a static export with no server, so every legacy
  `/postcards/<uuid>` link 404s — the redirects live in the web config and an export cannot run
  one — and `next/image` stops being optimised. A green deploy of a broken app, which §Working
  Principles names as the worst available failure. `scripts/native/assert-web-build.mjs` runs in
  CI after the Build step and reads the output rather than the config.
- **One effect on the web build is unavoidable and must be recorded rather than discovered.**
  Under B the ten routes lose their dynamic segment entirely: measured, `ƒ (Dynamic)` **10 → 0**
  and `○ (Static)` **22 → 32**, with no `●` at all. Every id is a query parameter, which the
  router hands to the same prerendered document, so no rider sees a difference — but
  `docs/HANDOFF.md`'s `grep -cE '^[┌├└│ ]*ƒ /'` one-liner **now reads 0 and must not be read as
  a regression.** Worse, it would read 0 just as happily if somebody resurrected an `[id]` segment
  and gave it a `generateStaticParams()`, because declaring one reclassifies the route to `●`
  without removing the segment. So the doc line becomes a `[ƒ●]` count with a sentence saying why,
  which is exactly the case `CLAUDE.md` says to keep a correction for: the obvious command returns
  a plausible wrong answer.
- **The ten routes are now statically prerendered and served as files, and the property that makes
  that safe has to be asserted rather than assumed.** All ten are `'use client'` and read in an
  effect, and `RouteGuard` renders the splash instead of children during the prerender pass — so
  the document that gets cached and served contains no rider data and no per-viewer decision.
  Measured on the built output: the rendered text of every document in `out/` is the empty string,
  and `scripts/native/check-export.mjs` walks every emitted file — around 380 of them — for a v4
  uuid, a signed Storage URL or a JWT and finds none. It stops being true the moment one of these pages reads during render,
  which is why it is a check and not a sentence.

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
- **Affected code, as built:** `next.config.ts`; the ten pages, moved from `[id]` to `detail` and
  from `useParams()` to `useSearchParams()`; `src/lib/routes.ts` (new — every href that names an
  id); `src/lib/native/boot-restore.ts` (new); `src/lib/validation/clubs.ts` and
  `src/lib/data/clubs.ts` for `clubIdSchema`; eighteen link sites across `components/` and
  `lib/actions/`; `scripts/native/` (new — the two guards); `scripts/walk.mjs`, whose detail-route
  discovery matched a whole pathname; `.github/workflows/ci.yml`; `docs/HANDOFF.md`'s
  dynamic-route one-liner and `scripts/docs/registry.mjs` behind it; `docs/ENVIRONMENTS.md`.
  **Not** `src/lib/auth/guard.ts` — no trailing-slash shape was adopted — and **not**
  `src/lib/native/static-params.ts`, which the decision deleted.
- **`capacitor.config.ts`'s header was falsified and moved with it.** It stated *"Seven routes hit
  it"*, enumerated the pre-PD-115/PD-101 route set, and said *"Until then `npx cap sync` has
  nothing to copy"*. Its `webDir: 'out'` and its `distDir` reasoning are correct, stay, and are now
  confirmed by a run rather than only by reading Next's source. The body needed no edit, because
  `distDir` was left unset.
- **The canonical origin is NOT in this change.** `ShareButton` builds the new path and keeps
  `window.location.origin` exactly as it was; `src/lib/actions/auth.ts` is untouched. §D7's
  problem — that the runtime origin in the shell is `https://localhost`, so shared links are dead
  and auth emails point at an origin GoTrue's allowlist does not contain — is real, blocks the
  first install, and is its own story. Splitting it out keeps a routing change from carrying an
  auth-email change.
- **No migration, no policy change, no new grant.** The RLS suite is untouched by this change, and
  that is a statement about scope rather than an oversight — nothing here reaches the database.
- **CI:** a diff confined to `openspec/` runs zero jobs. The implementing diff touches `src/` and
  runs the full Type Check, Lint & Build job.
