# The native shell

> Position notes for the Capacitor shell and the store submission. Every dated line is a
> measurement; re-run the command beside it rather than trusting the date.

## The next epic: the native shell, and store submission

This is now the whole roadmap, and it belongs to the **`native` agent**. **Two seams were built
and waiting**, which is why this is an epic and not a rewrite, and one is now filled in:

- ~~`window.__letsrideSecureStore`~~ — **implemented 2026-08-07**,
  `src/lib/native/secure-store.ts`. See §The shell below for what that does and does not prove.
- `src/lib/auth/guard.ts` is a pure function, so routing survives a webview unchanged.

**One piece of the server render is still standing.** Next server-renders client components on
first load; a bundled app has no Node process, so the *runtime* half goes — but `output: 'export'`
still runs the same prerender **at build time**, so a component body still executes in a pass with
no `localStorage` and no session. **The *read in an effect, never during render* rule therefore
stays load-bearing permanently**, and `resolve.browser.ts`'s tripwire keeps earning its place.
`CLAUDE.md` and `.claude/agents/native.md` say the same; they must not drift apart.

### The shell — started 2026-08-07

**What landed.** These were *written-and-unverified-on-device* until 2026-09-08; the first
simulator build settled several of them and left the device-only ones untouched, so read
§What the first build settled for which is which rather than applying one label to the list
(`.claude/agents/native.md` §Before you report done):

- **`capacitor.config.ts`** — `appId`, `appName`, `webDir: 'out'`, `androidScheme: 'https'`,
  splash background `#3D996B`. **`appId` is `social.letsride.app` — CONFIRMED by the product
  owner 2026-08-11 and settled.** This line said `com.letsride.app` and called it a placeholder
  for four days after the file stopped carrying that value; read the file rather than this line
  — `grep appId capacitor.config.ts`. A bundle id cannot be changed after the first submission;
  a new one is a new listing with no reviews or installs.
- **`src/lib/native/secure-store.ts`** — the keychain/keystore behind the seam, installed from
  `createClient()` immediately before the store resolves. That call site is deliberate and is
  the only race-free one: `resolveSessionStore()` resolves **once per page load**, so anything
  installing later (a layout effect, a plugin `load` event) loses to the first client
  constructed, silently, with the token in `localStorage`.
- **`resources/` — the app icon master**, added 2026-08-16. `icon-only.png` is 1024×1024 RGB
  with no alpha (App Store Connect refuses alpha, at upload rather than at review), built from
  the motorcycle already inside `public/brand/logo-splash.png` on `Accent Brand/100` `#3D996B`.
  **The filename is load-bearing**: `@capacitor/assets` matches exact basenames and treats
  `icon.png` as a *Logo*, which generates white and `#111111` splash screens instead of icons —
  `resources/README.md` carries that and the rest. **The iOS set IS now committed**, generated in
  this container on 2026-08-25 by `npx --yes @capacitor/assets generate --ios --assetPath
  resources`; a Mac is not needed for it. Both master and output measure 1024×1024, 8-bit, colour
  type 2 (RGB) — **no alpha**, which is the property App Store Connect refuses at upload rather
  than at review, so it is worth reading off the file rather than trusting this line:
  `python3 -c "import struct;b=open('resources/icon-only.png','rb').read();print(struct.unpack('>II',b[16:24]), b[25])"` — colour type 4 or 6 means alpha.
  The splash PNG is untouched and still mint-on-`#3D996B`.
- **The location permission strings — written 2026-08-24 (PD-170). The iOS one is IN
  `ios/App/App/Info.plist` as of 2026-08-25** and no longer parked; the Android one still is,
  because `android/` is not generated. Apple shows the iOS string *inside its own dialog*, so a
  vague one is a routine rejection — check it survived rather than trusting this line:
  `python3 -c "import plistlib;print(plistlib.load(open('ios/App/App/Info.plist','rb'))['NSLocationWhenInUseUsageDescription'])"`. Both are **when-in-use only**; background location is a separate and much heavier
  review conversation, and nothing in `src/` uses `watchPosition` or asks for `always`:

  ```
  <!-- ios/App/App/Info.plist -->
  <key>NSLocationWhenInUseUsageDescription</key>
  <string>LetsRide uses your location to sort rides and clubs by how far they are from you.
  It is only used while the app is open.</string>
  ```
  ```xml
  <!-- android/app/src/main/AndroidManifest.xml -->
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
  ```

  Do **not** add `NSLocationAlwaysAndWhenInUseUsageDescription`, `ACCESS_BACKGROUND_LOCATION`
  or a `UIBackgroundModes` location entry: asking for what the app does not use is the
  rejection this pair exists to avoid. The in-app rationale that has to agree with the iOS
  string is `LocationPrimingSheet`'s copy, and that component's header names the two claims
  ("only while the app is open", "never shown to other riders") that must stay true of the
  code for either string to be honest.

  **No Capacitor geolocation plugin is installed and none is needed.** The webview's own
  `navigator.geolocation` works under both platforms' permission systems — the manifest entries
  above are what the WebView's own permission request reads — so this stays on the web API and
  the runtime dependency count stays at nine. Revisit only if a feature needs background
  tracking, which the plugin would not give either.
- Two plugin defaults overridden, both security-relevant: keychain access
  `afterFirstUnlockThisDeviceOnly` (the default `whenUnlocked` blocks background token refresh
  after a reboot **and** migrates the token to a replacement device through an encrypted
  backup), and iCloud sync explicitly off (already the default — stated so a minor version
  cannot change it quietly).

**Three invariants this module has already broken once, so do not undo them:**

- **`clearSessionStore` sweeps any store that can enumerate itself**, via an optional `keys()` on
  `SessionStore` — not just `kind === 'local'`. The narrower version leaves *yesterday's*
  keychain entry behind on sign-out, in the store where a leftover credential matters most. Note
  `keys` is feature-detected by *type*, not truthiness: `Storage`'s named-property getter can
  make it a string. The sweep also covers webview `localStorage` regardless of which store
  resolved, so a token left by an earlier build does not survive sign-out on a device.
- **`getItem` resolves to `null` on a storage failure.** `auth-js`'s `__loadSession` is
  `try/finally` with **no** `catch`, so a *rejecting* read propagates straight out of
  `getSession()`. **The hang that used to be on the other end of that is fixed** — PD-122,
  2026-08-17: `guard-cache.ts`'s `read()` catches, sets a `failed` flag on the snapshot, and
  `RouteGuard` draws `GuardError` (message plus a Try again button) instead of a splash with
  nothing to tap. This invariant is still worth keeping: the catch turns a total failure into a
  recoverable one, and resolving to `null` is what stops the ordinary storage miss from becoming
  one at all.

  ```bash
  grep -c "} catch (" src/lib/auth/guard-cache.ts   # 1 — read()'s own
  ```
- **The `applyPluginDefaults()` promise slot is cleared on failure.** `configured ??= …` caches
  a *rejected* promise, so one transient plugin error breaks every read and write for the rest of
  the app session with no retry.

**What none of it proves:** nothing here has touched a keychain. The tests mock the plugin, so
they assert the ordering, the overridden defaults, the failure modes and the forwarding —
everything *around* the plugin call, which is where this module can be wrong — and nothing about
iOS or Android behaviour. That needs a device.

**The static export builds, and `webDir` now has something in it — PD-142, 2026-08-10.**

```bash
NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native
ls out/index.html             # exists; .next-capacitor/ does not
```

34 documents and 281 `__next.*.txt` RSC segment payloads, plus the static assets — 393 files in
all, measured 2026-08-26 off `check-export.mjs`'s own closing line rather than counted by hand.
**Documents, route rows and the `Generating static pages (N/N)` line are three different
quantities that read within one of each other**, which is exactly the near-miss to get wrong. Reconcile them
from the 36 `page.tsx` files (`git ls-files src/app | grep -c 'page\.tsx$'`) rather than from each
other. **Re-derive the page count every time — the three rows below were stale by three before
`/rides/explore` was ever added**, because a table of totals goes stale on any commit that adds a
route while nothing here fails:

| Quantity | Today | = |
|---|---|---|
| Route rows in `next build`'s table | 38 | 36 pages + `/_not-found` + `/icon.png` |
| `Generating static pages (N/N)` | 39 | those 38, plus the second file `/_not-found` emits |
| `.html` in `out/`, which is what `check-export.mjs` counts | 38 | 36 pages + `_not-found.html` + `404.html` |

**The route table does list `/_not-found`** — it is the second row — so the older reading of this
paragraph, that documents exceed the route count because the table omits it, was wrong twice over.
What actually makes the two differ is that `output: 'export'` writes `/_not-found` **twice**, as
`_not-found.html` and `404.html`, while `/icon.png` is a route row that emits an asset and no
document at all. Those cancel today at 34 apiece, and nothing holds them together: add a page and
all three move, add an icon convention and only the route row does. **Do not pin the total file
count**: two builds of the same commit came back 384 and 383 at an unchanged document count,
because the JS chunk count moves by one or two. The two counts that are
stable are the documents and the payloads, which is why `check-export.mjs` asserts a floor and
those two being non-zero rather than
an exact number.
**Every document's rendered text is the empty string** — `RouteGuard` renders the splash instead
of children during the prerender pass, and every detail screen reads in an effect anyway — which
is the property `scripts/native/check-export.mjs` asserts rather than infers.

**The ids left the path** (`/rides/detail?id=…`, `src/lib/routes.ts`), which is what made the
export possible: `output: 'export'` refuses a dynamic segment without `generateStaticParams()`,
none of these ids exists on the build machine, and `[]` does not rescue it because export forces
`dynamicParams: false`. Product owner's decision, 2026-08-10, over the alternative of teaching
each shell's native router to resolve the old paths — which is impossible on Android under
Capacitor's defaults (`WebViewLocalServer.handleLocalRequest()` hands the route processor a
hardcoded `"/index.html"` and discards the requested path). The old shape survives on the **web**
as a `redirects()` entry, absent from the export by construction.

**Two build shapes now exist and exactly one may deploy.** `scripts/native/assert-web-build.mjs`
runs in CI after the Build step, because a leaked `CAPACITOR_BUILD` produces a **green** deploy
of an app with no server. `CAPACITOR_BUILD` is set in no Vercel target — docs/ENVIRONMENTS.md
§The native build flag.

**A bundle bakes in its backend and its origin, and neither can be changed after submission —
PD-188, 2026-08-12.** Two things landed:

- **`canonicalOrigin()` (`src/lib/origin.ts`) is what URLs that leave the app are built from** —
  the shared postcard link and both GoTrue redirects. It returns `NEXT_PUBLIC_CANONICAL_ORIGIN`
  when set and `window.location.origin` otherwise, so **the web build is unchanged with the
  variable unset**. `next.config.ts` fails a `CAPACITOR_BUILD=1` build when it is missing and a
  **web** build when it is set, both asking `normaliseConfiguredOrigin()` so they cannot disagree
  with `origin.ts` about what "set" means. Why it matters, measured against PROD's auth server
  2026-08-12: docs/ENVIRONMENTS.md §The redirect allowlist. No dashboard action needed — PD-106
  allowlisted `https://app.letsride.social` already.
- **`npm run release:check` is the pre-submission gate** over the built `out/`: the PROD ref
  present, no other ref (DEV by name), the canonical origin baked in, no `localhost` one — and a
  **failure when it finds no ref at all**, so an empty `out/` cannot read as clean. Deliberately
  not in `build:native`, which runs on local and on-device builds that may point at DEV.

```bash
NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native && npm run release:check
grep -rn "window.location.origin" src/ --include=*.ts --include=*.tsx \
  | grep -vE ':[0-9]+:\s*(\*|//|/\*)'   # expect: src/lib/origin.ts only
```

Both directions were run against real builds in this container on 2026-08-12: a PROD-ref bundle
passes, a DEV-ref bundle is refused by name. **What no container can check is the store side** —
that the bundle actually submitted was built from `main` is the release procedure's job, and the
gate only helps if it is run.

**The lever that still works after a bundle ships — the minimum-version gate, 2026-08-26.**
A build with the wrong backend baked into it cannot be repaired by a deploy (PD-188 §1), so this
is the only thing that can stop one. `public/app-version.json` carries a `minimum`;
`src/lib/native/version-gate.ts` fetches the **deployed** copy from `canonicalOrigin()` once per
document load, on native only, and `UpdateGate` in the root layout replaces the whole app when
this build is below it.

**Two bounds on it, both of which read as coverage if left unstated.** It cannot stop a bundle
built against the wrong **origin** (PD-188 §2): that bundle asks the wrong host for this very
file, gets an SSO page or nothing, and fails open for ever — `assert-release-bundle.mjs` is the
only thing that catches that, before submission. And "document load" is weaker than "launch": a
Capacitor app resumed from the background does not reload its webview, so a raise reaches a rider
who never cold-starts only when the OS evicts the process. There is deliberately no `resume`
listener, because re-checking means blocking someone mid-use. **It fails open on everything** — offline, timeout,
404, malformed JSON, an unparseable `minimum` — because a rider with no signal must not be
stopped by the check. `src/lib/version.ts` holds `APP_VERSION` and the comparator, and a unit test
pins the constant to `package.json`'s `version`; **the store build's marketing version has to match
it**, which is an owner/native step at submission (`CFBundleShortVersionString`, `versionName`).
Raising the published minimum is an **owner action with no way back for the rider**, so it is for a
build known broken and nothing else — and `npm run release:check` refuses a submission whose own
version is below the published minimum, which is the gate eating its own fix: raise the minimum,
forget to bump `package.json`, and every rider installs an update that is blocked too. Android deep-links Play from the `appId`; **iOS shows
instructions and no button until PD-232 creates the listing** and yields the numeric Apple ID that
`itms-apps://` needs. Verified in this container to build and to be tested; **written and
unverified** on a device, like everything else here.

```bash
# Not `grep '"minimum"'` — that passes on "latest", on 0.2 and on "v0.2.0", each of which
# makes the gate fail open on every launch for ever. The test parses the shipped file.
npx vitest run scripts/native/__tests__/release-version.test.mjs \
  src/lib/native/__tests__/version-gate.test.ts src/lib/__tests__/version.test.ts
```

**Error boundaries now cover the tree outside `(app)` — 2026-08-26.** `src/app/error.tsx` catches
`/auth/*`, `/onboarding/*` and `/legal/*`, which had none and fell to Next's built-in page — with
no retry and none of this app's design, on the two flows every new rider must pass through.
`src/app/global-error.tsx` catches the root layout itself; it **replaces** that layout, so it
renders its own `<html>`/`<body>` and uses inline styles with the v2 token hexes, `globals.css`
being exactly what is not guaranteed in that case. Both survive `output: 'export'` — the export
still emits 34 documents and the route table still shows 34 rows, boundaries being components
rather than routes.

**What is still unverified after the first build — and the cold-start restore is the sharp one.**
The app has now run on a **simulator** — see the `ios/` COMPILES AND RUNS paragraph above — which
settles the build, the launch, the guard and the keychain **read**. It does not settle
`src/lib/native/boot-restore.ts`:
that module answers a **webview process restore**, and nothing in a hand-driven launch reproduces
one, so it stays **written and unverified**. Neither does it settle anything requiring a signed
device — a real APNs token, a universal link, or the archive.

**Its premise splits in two, and the half that matters is WRONG for deep links — measured
2026-08-25.** Read the Swift from `node_modules/@capacitor/ios`, which carries all 46 of 8.5.0's
source files offline at the version the build links; `boot-restore.ts` already quotes it, and going
to the network for a binary instead is the mistake this paragraph replaces:

```bash
cat node_modules/@capacitor/ios/Capacitor/Capacitor/Router.swift
cd node_modules/@capacitor/ios/Capacitor/Capacitor
grep -n "appStartServerURL" CAPBridgeViewController.swift && grep -rn "webView?.load" *.swift
```

- **`CapacitorRouter.route(for:)` maps every extensionless path to the root `index.html`** — true,
  and now verified twice: the source says so, and disassembling the shipped `Capacitor.xcframework`
  shows `pathExtension` → `isEmpty` → a literal `/index.html`.
- **A deep-link cold start never reaches it.** `loadWebView()` loads `bridge.config.appStartServerURL`
  — the server URL plus `server.appStartPath`, and `capacitor.config.ts` sets no `appStartPath` — so
  the webview boots at **`/`**, always. A universal link arriving cold is posted to
  `NotificationCenter` as `capacitorSceneOpenUniversalLink` and **nothing in Capacitor's core
  observes it to navigate**: the only `webView.load` calls in those 46 files are the root start URL,
  a reload at the root, and two error pages.

So on a deep link `bootRestoreTarget` sees `pathname === '/'`, answers `null`, and the restore does
not fire. What it *does* serve is the other case its header names — a **webview process restore**,
where WKWebView reloads at its last URL and `route(for:)` is the mechanism that answers it. That
distinction is the whole finding, and the module is correct for the case that remains.

**Deep links cannot reach the shell at all yet, independently of any of this** — there is no
Associated Domains entitlement in `project.pbxproj`, no `.entitlements` file, and nothing in `src/`
listens for an open-URL event. PD-205 is where that work lives, and it now has a second half: even
once a link opens the app, something must navigate the webview, because Capacitor will not.

**`ios/` IS generated and committed — 2026-08-25, from this container.** The passage here used
to say that was impossible, and the reason it gave was `pod install`: no CocoaPods, so `cap add
ios` could not finish. **Capacitor 8 does not use CocoaPods.** It wires plugins through Swift
Package Manager — `ios/App/CapApp-SPM/Package.swift`, which `cap sync` rewrites — so `cap add
ios` needs neither Xcode nor a `pod` binary and completed here in 37ms. The check that tells the
two apart, rather than either sentence: `ls ios/App/CapApp-SPM` exists, `ls ios/App/Pods` does
not. It is 20 tracked files, not the "hundreds of unreviewable" ones this passage feared — the
copied web bundle (`App/App/public`) and the generated config are gitignored by the template.

**`android/` is still not generated**, and now by choice rather than by obstacle: the same
`cap add` would scaffold it, but nobody has asked for the Android half and an unbuilt platform is
review surface for no current gain. **So PD-95 stays open** — it names both platforms.

**`ios/` COMPILES AND RUNS — 2026-09-08, on the product owner's Mac, Xcode 26.6 (17F113).**
`App` scheme, Debug, `iPhone 17 Pro` simulator, **491s, 0 errors**, one warning that is not ours
(`appintentsmetadataprocessor` skipping metadata for an absent `AppIntents.framework`). It
launched, the guard resolved, the webview rendered the postcard deck, and `/profile` drew the
signed-in rider.

**It is NOT the first build of this app, and the claim that it was survived a whole draft of this
section.** A build from **2026-08-25** sits on the same Mac, from a since-deleted checkout at
`…/LetsRide/ios/App/App.xcodeproj`, with an `App.app` dated Aug 25 21:47 and a matching install on
this same simulator. The sentence that used to stand here — *"nothing here has ever been built or
run"* — was scoped to the build container and was true of it; read as a claim about the project it
was already false. What is genuinely first about 2026-09-08 is the **plugin graph**: the August
bundle links Capacitor and Cordova only, this one links Sentry and push notifications too. Read the
machine rather than either sentence:

```bash
for d in ~/Library/Developer/Xcode/DerivedData/App-*/; do
  /usr/libexec/PlistBuddy -c "Print :WorkspacePath" "$d/info.plist" 2>/dev/null
  ls -ld "$d/Build/Products/Debug-iphonesimulator/App.app" 2>/dev/null; done
```

**The keychain read back a session that a PREVIOUS build wrote** — that August install — so what is
verified is `secure-store.ts`'s **read** path against a real platform keychain, over a real refresh
token, rather than the mocked plugin the unit tests use. The **write** was performed by a different
binary, so *round-tripped* is the word this section must not use. Sign-out was exercised later the
same day and settles less than it looks — §Sign-out leaves no usable session in a platform keychain
has what it does and does not prove.

**No build container can do any of this**, so the label on `ios/` now splits rather than lifting:
what a **simulator** exercises is verified, and what needs a signed device or the store is not. The
per-item state is §What the first build settled below; do not read this paragraph as clearing the
section.

```bash
xcodebuild -version                            # Xcode is present at all — a container answers nothing
xcrun simctl list devices available | grep -c iPhone
```

**The label does not mean hand-written Swift — measured 2026-08-25.** Exactly **five** files in
`ios/` differ from `@capacitor/cli`'s own `ios-spm-template`, and there are **no** extra tracked
files. Four are data edits — the display name and the location string (`Info.plist`), the bundle id
in both configurations (`project.pbxproj`), and `cap sync`'s own rewrite of `Package.swift`. The
fifth is the icon set: both `AppIcon` files, regenerated from `resources/`. `AppDelegate.swift`,
`SceneDelegate.swift` and both storyboards are untouched vendor code. Re-derive it, because the
value is knowing which files are yours to suspect:

```bash
t=$(mktemp -d) && tar xzf node_modules/@capacitor/cli/assets/ios-spm-template.tar.gz -C "$t"
(cd "$t" && find . -type f | sed 's|^\./||') | while read f; do
  cmp -s "$t/$f" "ios/$f" || echo "DIFFERS: $f"; done   # read the NAMES, not a count
```

**Do not pin the count here.** It read *"exactly 5 lines"* and was 6 within a week of being
written, because every later change to the shell adds to this list rather than replacing it —
`.gitignore` grew two entries, `Info.plist` gained a category and lost its iPad orientations, and
`project.pbxproj` gained a Team and a device family. The value is knowing **which** files are
yours to suspect, and that survives; the number does not.

Four more first-build inputs are sound, and they move with a file, so read them rather than this
line — `grep -nE "IPHONEOS_DEPLOYMENT_TARGET|CODE_SIGN_STYLE|DEVELOPMENT_TEAM|SWIFT_VERSION"
ios/App/App.xcodeproj/project.pbxproj`. `IPHONEOS_DEPLOYMENT_TARGET` is `15.0`, matching
`Package.swift`'s `.iOS(.v15)` — a mismatch there is an SPM **resolution refusal**, so it surfaces
as a dependency problem rather than a compile error. `CODE_SIGN_STYLE` is `Automatic`, and
**`DEVELOPMENT_TEAM` is now set in both configurations — `6V6M44T7KV`, committed 2026-09-08** — so
the Team is no longer a step a Mac has to perform before the first build. A Team ID is not signing
material (`.claude/agents/native.md` scopes that to certificates, profiles, keystores and API keys)
and ships in the `_CodeSignature` of every distributed binary anyway.

**What the 2026-09-08 build demonstrates about signing is narrower than it looks**: it ran as a
member of that team, so it says a simulator build needs no provisioning profile *for someone in the
team* and nothing about anyone else. **A contributor outside `6V6M44T7KV` inheriting this hardcoded
value is untested** — that is the case the deleted sentence (*"which is why setting the Team is a
step and not a merge conflict"*) used to cover, and `ios/debug.xcconfig` is already tracked if it
ever needs a per-Mac override. A **device** build additionally needs the UDID registered against
the team, also unexercised. `SWIFT_VERSION`
is `5.0`, so the template's `@UIApplicationMain` is a deprecation **warning** — under Swift 6 it is
an error, worth knowing before anyone raises that setting. And the plugin resolves:
`@aparajita/capacitor-secure-storage@8.0.0` ships its `ios/Sources/SecureStoragePlugin` in the npm
tarball, and its `from: "8.0.0"` on `capacitor-swift-pm` is satisfied by CapApp-SPM's `exact:
"8.5.0"`. **The first open resolves more than one remote package** — the secure-storage plugin also pulls
`keychain-swift from: "21.0.0"` — so Xcode needs network on that first build. **Read the list off `package.json`'s `@capacitor/*` and `@aparajita/*` entries rather than from
here**: PD-431 added `@capacitor/push-notifications`, and a plugin count written down goes stale
the next time one is added.

**Both `Package.resolved` and `Package.swift` now answer it, and both were wrong or absent until
2026-09-08.** `Package.swift` IS committed and looks authoritative, but `cap sync` rewrites it, and
the committed copy had gone **pre-sync**: its `dependencies:` array listed only `capacitor-swift-pm`
and the secure-storage plugin, so a session reading it concluded the push plugin was not wired when
it was. `Package.resolved` was not in the repo at all. The first Mac build committed both — the
synced manifest naming all three plugins, and the resolution pinning `sentry-cocoa 9.27.0`,
`keychain-swift 21.0.0` and `capacitor-swift-pm 8.5.0`.

**`Package.swift` still goes stale the next time a plugin is added**, because `cap sync` is what
writes it and no CI job runs `cap sync`. So the check survives its own fix — compare it against
`package.json` rather than trusting either:

**`@capacitor/core` is the runtime, not a plugin, and it never appears in `Package.swift`** — so
the obvious filter reports 3-against-4 on a correct tree and sends the next session to run a
needless `cap sync` or file a phantom finding. Exclude it, and check the filter both ways:

```bash
grep -c '\.package(name:' ios/App/CapApp-SPM/Package.swift        # one per plugin — 3
node -p "Object.keys(require('./package.json').dependencies).filter(d=>/^@capacitor\/|^@aparajita\/|^@sentry\/capacitor/.test(d) && d !== '@capacitor/core').join('\n')"
```

What a session CAN now do, all of it exercised on 2026-08-25:

```bash
npx cap add ios                                    # 37ms, no CocoaPods, no Xcode
npx --yes @capacitor/assets generate --ios --assetPath resources
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native
npx cap sync ios                                   # copies out/, rewrites Package.swift
```

**What is left for a Mac needs those three commands FIRST, and then four things.** Do not read the
four as a standalone list: `App/App/public`, `App/App/capacitor.config.json` **and
`App/App/config.xml`** are all three Copy Bundle Resources entries (`project.pbxproj`) and all
three are **gitignored**, and `Package.swift` resolves the secure-storage plugin out of
`../../../node_modules`. So a fresh clone opened straight in Xcode builds against **three** missing
inputs and an unresolvable dependency, and a missing Copy Bundle Resources entry is a hard
`Build input file cannot be found`, not a warning. `npm ci`, then the
`build:native` above, then `cap sync ios` — *then* open the project, set the signing Team, build,
and archive to TestFlight.

**All three were re-run from a clean tree on 2026-08-25 and all three pass here**, so a failure on
the Mac is a Mac-side difference rather than a repo one — which is the whole reason to run them in
this container first. **All three then ran on the Mac on 2026-09-08 and the sequence held**:
`cap sync ios` reported `Found 3 Capacitor plugins for ios` — secure storage, push notifications
and Sentry — and the build that followed succeeded. It reports one more per plugin added since, and
`Package.swift` is CLI-managed, so **a `cap sync ios` is owed whenever `package.json` gains a
plugin**. It writes both gitignored inputs; confirm by their absence from `git status`, not by
their presence on disk.
**`cap sync` logs only `capacitor.config.json` and silently writes `config.xml` too**, so read the
directory rather than the log — deleting all three and re-syncing restores all three:

```bash
ls ios/App/App/public/index.html ios/App/App/capacitor.config.json ios/App/App/config.xml
git status --short          # all three exist, and all three stay invisible
```

**Pick a simulator, not a device, unless a device is registered.** The framework carries the
simulator slice — `unzip -l` the xcframework for `ios-arm64_x86_64-simulator`, it is there — so
nothing about the shell requires a device. **The simulator half is now measured rather than
inferred**: automatic signing did provision the 2026-09-08 build with no profile, exactly as this
paragraph guessed. The device half is still **written and unverified** — that a device build
without a registered UDID fails with a provisioning error reading like a signing misconfiguration.

### What the first build settled, and what it did not

Measured 2026-09-08 on the simulator, so that each row can be believed or challenged on its own
rather than through a single label on the whole section.

| | Settled |
|---|---|
| The project compiles | 491s, 0 errors, `App` scheme, Debug |
| SPM resolves every plugin from a clean `DerivedData` | 3 plugins, 3 remote packages |
| Automatic signing provisions a simulator build | no profile, no device registration |
| The app launches and the webview loads the export | postcard deck rendered from `App/App/public` |
| `RouteGuard` resolves inside a webview | reached `/postcards`, then `/profile`, no splash lock |
| The keychain **read** returns a real session | written by the Aug 25 install; the **write** path is still unexercised |
| Sign-out leaves no **usable** session | sign out, force-quit, cold launch → Login. Run twice. This is NOT the same as `clearSessionStore`'s sweep working — see its section for why |
| The app icon renders, correctly masked | white motorcycle on `#3D996B` — generated headlessly in August and never once looked at until now |
| `LSApplicationCategoryType` reaches the bundle | only after this change: the `INFOPLIST_KEY_*` form was inert |
| Supabase reads work from the bundle | DEV data, avatars and covers from Storage |
| The shipped `Info.plist` carries what was written | bundle id, display name, `15.0`, the location string |

| | Not settled, and why |
|---|---|
| `boot-restore.ts` | answers a webview **process restore**; a hand launch does not reproduce one |
| Push registration | needs a signed device — a simulator gets no APNs token |
| Universal links | no Associated Domains entitlement exists yet (PD-205) |
| The location prompt | not exercised; the string is verified in the bundle, the dialog is not |
| `clearSessionStore`'s sweep | **still unexercised.** Sign-out was run, but auth-js removes the `sb-` keys by name first, so the sweep had nothing to find |
| A device build, the archive, TestFlight | none attempted |

### Sign-out leaves no usable session in a platform keychain — 2026-09-08

**Read the claim as written, because the obvious stronger one is what this test CANNOT support.**

What was run: sign out in the app, then

```
xcrun simctl terminate <udid> social.letsride.app  →  xcrun simctl launch …
```

Login, both times — the second in one uninterrupted pass, because the first cycle was followed
minutes later by a signed-in screen and the honest reading of that was *someone signed back in*,
not *the sweep failed*. **Re-run it rather than reasoning about it**: an interrupted observation
of a shared simulator is not evidence.

**The cold relaunch is load-bearing and sign-out landing on Login is not.** An app that merely
forgot the session in memory draws the same screen, and this simulator had already proved a
keychain entry survives a full app *reinstall* — which is how the first launch of the day came up
signed in from an August build. There is no in-memory confounder to fall back on either:
`guard-cache.ts` holds module state that dies with the process, no "signed out" flag is consulted
ahead of the store, and `RouteGuard` reads the store for real on a cold launch.

**What it does NOT settle is `clearSessionStore`'s sweep**, which is the invariant §The shell
calls out as already broken once. `signOut()` calls `supabase.auth.signOut()` *before*
`clearSessionStore()`, and auth-js's `_removeSession` deletes `sb-<ref>-auth-token`, the PKCE
verifiers and the `-user` key **by name** out of whatever storage it was handed — here the secure
store itself. So by the time the sweep enumerates, there is no `sb-`-prefixed key left for it to
find: in this run the sweep was provably a no-op, and an implementation that had regressed to
`kind === 'local'` would have passed identically.

**Nor does it distinguish *absent* from *present but expired*.** `signOut()` defaults to
`scope: 'global'`, so a surviving token would have been revoked server-side; on relaunch auth-js
would refresh it, be refused, and draw the same Login. What the run *does* rule out is a live
stored session, since an unexpired one is returned with no network call at all.

So, precisely:

> **Sign-out followed by a cold relaunch recovers no usable session from the platform keychain.**
> `clearSessionStore`'s own sweep and the write path both remain unexercised against a real one.

**The measurement that would settle the real claim needs no relaunch**: after sign-out and before
`terminate`, read `SecureStorage.keys()` — or seed a `sb-probe-auth-token` that auth-js knows
nothing about and read it back. Note the expected result is **not** an empty keychain: the
installation id is meant to survive, and PD-443 is a live defect in exactly that.

### The bundle is iPhone-only and portrait-only — decided 2026-09-08

Product owner's call, in response to it finally being *observed* in a shipped bundle rather than
inferred from the Capacitor template: **pause iPad.** `TARGETED_DEVICE_FAMILY` is `1`, and
`UISupportedInterfaceOrientations` is portrait alone, with the `~ipad` key deleted.

Both were stock defaults nobody had chosen — iPhone **and** iPad, three orientations — against a
`design/` that is phone-portrait throughout.

**"Pause iPad" does NOT mean the app stops running on one, and reading it that way is the mistake
this paragraph exists to prevent.** An iPhone-only binary still installs and runs on iPad, in
iPhone compatibility mode, and guideline 2.4.1 expects exactly that — so App Review still opens it
on an iPad. What changes is *what they see*: a scaled portrait iPhone window instead of a
full-size iPad layout that nothing in `design/` describes. **The pause is the native bundle only**;
the web app at `app.letsride.social` is untouched and still renders on iPad Safari, which is how
the product owner uses it.

Read the built bundle rather than the project file, because the previous commit shipped a category
setting that was inert exactly because the project file said otherwise:

```bash
python3 -c "import plistlib;p=plistlib.load(open('<built>/App.app/Info.plist','rb'));\
print(p['UIDeviceFamily'], p['UISupportedInterfaceOrientations'])"   # [1] ['UIInterfaceOrientationPortrait']
```

**Reversing it is one build setting and one plist array**, so this is a pause rather than a
door closing. What it costs today is nothing: no iPad layout exists to lose.

### Store readiness — assessed 2026-08-06

Ordered by what actually blocks a submission. **Read each row's own state rather than the shape
of the table** — four of the seven are struck through, most of the rest are started, and row 6 is
the only one still labelled the owner's. Do not count that label with a bare grep: row 7 contains
the words *"stopped being **Owner**"*, so the obvious command counts its own obituary, which is
`CLAUDE.md`'s comment trap arriving in a table.

| | Blocker | Why it blocks |
|---|---|---|
| 1 | **The shell itself** | **`ios/` is generated and committed — 2026-08-25, from this container** (§The shell has the detail and the reason the old "needs a Mac" answer was wrong: Capacitor 8 uses Swift Package Manager, not CocoaPods). `capacitor.config.ts`, the secure store, a building `out/`, the iOS icon set and the location permission string are all in. **`android/` is still absent**, by choice rather than obstacle. **`ios/` COMPILED AND RAN on 2026-09-08** — the owner's Mac, Xcode 26.6, `iPhone 17 Pro` simulator, 491s and 0 errors, launching into a session read back from the platform keychain. **Not the project's first build** — one from 2026-08-25 sits in DerivedData from a since-deleted checkout — but the first recorded in this repo and the first to link the three-plugin graph. The signing Team (`6V6M44T7KV`), the synced `Package.swift` and `Package.resolved` are committed, so the next build starts from a resolved graph. **What is left needs a signed DEVICE rather than a compiler**: a device run, push registration, universal links, and the archive to TestFlight — §What the first build settled has the row-by-row split, and it is the thing to read rather than this cell |
| 2 | **Account deletion — built, deployed, exercised against that build 2026-08-19, and UNGATED the same day. The row is live on `/profile`** | App Store 5.1.1(v) — hard rejection for any app with account creation. `029`–`032` applied, `/legal/account-deletion` live, groups 3/4/7 and 6.1 landed 2026-08-16 (`PD-102`): `ProfileMenu`'s Delete account row, the `DeleteAccountSheet` confirmation (a second bottom sheet over `/profile`, not a route — the Figma tree says so, `tasks.md` 3.3 used to assume otherwise), `deleteAccount` in `lib/actions/auth.ts`, one shared `not-found.tsx` for the four "content is unavailable" screens, and the route guard's `gone` state destroying local session data the moment a device discovers its own account is gone (`client-session-storage`'s ADDED requirement). **The re-authentication proof (D6/Q7) is deployed** — by hand on 2026-08-17T14:32Z (PROD v9 / DEV v5, `ezbr_sha256` `9793933d…`), and redeployed by the 2026-09-06 catch-up dispatch from `771f650` (**PROD v10 / DEV v6, `11600c52…` on both**). The digest moved and the behaviour did not: every commit under that directory between the two is comment-only, which is the case the currency check cannot distinguish on its own (`list_edge_functions`, against `TZ=UTC git log -1 --format=%cd --date=iso-strict-local -- supabase/functions/delete-account/` — and read what that range *contains*, because a comment-only commit lands in it too and reads as stale). That closes the redeploy window three tasks shared (2.2, 2.3a, `add-ride-map-tiles` 8.3), **none of whose boxes reflect it yet** — see PD-249, which also covers `resolve-ride-location` being deployed while four places including the public privacy page say it is not. **The behaviour is now verified too, not just the digest — 2026-08-19, seven cases against DEV, all passing** (`openspec/changes/add-account-deletion/tasks.md` §2.6 carries the table). Both free probes ran: a request with **no** `password` and separately a **wrong non-empty** one both answer `reauth_required` — the second being the one that matters, since an empty password never reaches `signInWithPassword` and so never exercises `classifyAuthError`. Replaying a real token against a deleted account answers `unauthorized`, which was reasoned from GoTrue's docs until this run. DEV's and PROD's digests are equal, which is no currency check but does make the two builds byte-identical, so the run describes PROD's function; PROD's own `SERVICE_ROLE_KEY` is separately proven by PD-86. **Nothing now stands between a rider and this flow.** `NEXT_PUBLIC_ACCOUNT_DELETION_ENABLED` and `src/lib/flags.ts` were deleted on 2026-08-19 at the product owner's instruction, once the redeploy they were waiting for had been verified by content — so the row renders on every build, and the promotion to `main` is what puts it in front of real riders. No session can redeploy — there is no `supabase` CLI here, and the MCP server's `deploy_edge_function` is one of the four Supabase operations on `.claude/settings.json`'s `deny` list. Count what is still open rather than enumerating it — `grep -c '^- \[ \]' openspec/changes/add-account-deletion/tasks.md` — because **`1.6b` is still a live, undecided defect** (a club's last member leaving can destroy third-party postcards — PO decision, not built) and **Q4 is still open** (legal, blocking before launch not before build); `2.4` (idempotency under concurrency) and `6.3` (the live walk) are also open — `6.3` doubly so, because every one of 2.6's seven cases is `curl`, which needs no preflight, so the browser path is the untested half — **and the flag removal is what unblocked it**, so walking the sheet on DEV is now the thing owed before the promotion to `main`. `2.6` itself is closed |
| 3 | ~~**Inbox is a disabled stub**~~ — **resolved 2026-08-07** | The tab is **gone**, not fixed: the owner chose to drop it rather than build the epic before submission (PD-100). `Navbar.tsx` draws four tabs and the `UNBUILT` machinery is deleted — `sed -n '/const navItems/,/] as const/p' src/components/layout/Navbar.tsx \| grep -c "href:"` is 4. The Inbox *domain* is still unbuilt; it stopped being a **store** blocker when nothing pointed at it |
| 4 | ~~**No edit or delete UI for rides or clubs**~~ — **resolved, `PD-101` is in production** | `updateRide`/`deleteRide`/`updateClub`/`deleteClub` are in `src/lib/actions/`, `/rides/detail/edit` and `/clubs/detail/edit` exist, and both delete confirmations enumerate the blast radius. Club delete goes through `delete_owned_club` (`043`), never a bare `.delete()` |
| 5 | ~~**Email confirmation is off**~~ — **it is ON for PROD** | Not a store blocker. It *was* an app blocker: `signUp` assumed a live session that confirmation-on does not give it. Fixed — see `docs/reference/signup.md` §Signup |
| 6 | **Supabase free tier auto-pauses** | ~7 days idle, serves nothing, no alert. Needs Pro. **Owner** |
| 7 | ~~**Signup never exercised end to end**~~ — **the app's confirmation-on arm has now RUN, 2026-08-27/28 (`PD-252`); the AUTH SERVER was proven 2026-08-16 (`PD-91`)** | **Not "proven" without its two boundaries, and both matter.** (1) **The DEPLOYED BUNDLE is still unexercised and cannot be from a session** — `app.letsride.social:443` is refused by the agent proxy (`403` to `CONNECT`), so what ran is the app's own code on a local dev server pointed at PROD through the relay. (2) **A delayed click is unmeasured**: four `confirm` runs within ~1–2.5 minutes of the mail were green, one at ~5 minutes failed inside `exchangeCodeForSession` with GoTrue clean, and the experiment that would settle it could not be completed here — `PD-337` holds it. What *is* established: `PD-91` used six raw HTTP calls to GoTrue, so `signUp` itself never ran; `scripts/probes/signup-confirmation.mjs` closed that at **11/11, 0 residue**. The `!data.session` arm (`src/lib/actions/auth.ts`) and its "Check your email" screen (`src/app/auth/signup/page.tsx`) have executed, and the emailed link lands the rider signed in on `/onboarding/terms`. **DEV structurally cannot cover them, measured rather than read off decision #6** — `/auth/v1/settings` reports `mailer_autoconfirm` **True** on `fpmrimzxadewsaiwpsel` and **False** on `zwprydcyryvudhurbnye`. The *automated* check is `PD-334`'s decision; `docs/reference/signup.md` §Signup has the mechanism |

| 8 | **The App Privacy label is now wrong, and this row is new — 2026-09-01, PD-315 and PD-353** | Nothing was declared for a third-party SDK because there were none. There are three now, and one of them records **video of the rider's screen, unmasked**. Apple's *Data Collection* questionnaire and Play's *Data safety* form both want it declared, and replay is the answer that moves the label furthest: it is not "diagnostics", it captures screen content including other riders' names and photos. What is sent is not a guess — `src/lib/observability/scrub.ts` and `src/lib/analytics/events.ts` are the two files that answer it exhaustively, and `docs/reference/observability.md` has the table. Two things a submission must get right rather than infer: the rider's `auth.uid()` IS sent to both processors (deliberately — see the scrub's header for why the reporter's own id survives when content ids do not), and PostHog is **linked to identity** rather than anonymous. **`native` owns this**, and it cannot be answered until the pilot posture is settled at submission time rather than at build time — PD-353's retirement condition is what decides whether the label describes masked or unmasked replay |

Check each guideline against the live text before building to it — they move, and this table
will not.
