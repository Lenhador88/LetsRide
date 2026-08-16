# `resources/` — the native app's source artwork

Capacitor's conventional home for the artwork platform icon sets are **generated from**, not
the generated sets themselves. Two files live here and neither is consumed by the web app:
`public/` is copied into the web bundle and the static export, so a 1024px launcher icon put
there would ship to every browser for nothing.

| File | What it is |
|---|---|
| `icon-only.png` | The app icon master. **1024×1024, RGB, no alpha channel.** |
| `logo-mark.png` | The bike mark alone, white on transparency, 296×455 RGBA. The source `icon-only.png` was composed from. |

## The filename is `icon-only.png`, and calling it `icon.png` silently breaks the splash

**This is the trap in this directory.** `@capacitor/assets` matches on exact basename, and
`icon.png` is *not* one of the names it loads as an icon. It is reached only by the fallback in
`loadLogoInputAsset()`, which loads it as **`AssetKind.Logo`** — and both platform generators
branch on `Logo` to produce **splash screens**, scaling the artwork to 20% and centring it on
`splashBackgroundColor ?? '#ffffff'` light and `'#111111'` dark. Read out of `@capacitor/assets@3.0.5`,
`dist/project.js` and `dist/platforms/*/index.js`.

So a master named `icon.png` generates a **white** iOS launch screen, wired into
`LaunchScreen.storyboard` by default — which is exactly the flash `capacitor.config.ts`'s
`backgroundColor` comment exists to prevent: *"anything else shows as a flash between the native
splash and the app."* Nothing errors, and the artwork looks right in the icon slots.

`icon-only.png` is loaded as the icon. `logo-mark.png` matches neither `logo` nor `logo-dark`,
so the generator ignores it, which is intended — it is a source file, not an input.

## `icon-only.png` — the three constraints that are rejections, not preferences

- **No alpha channel.** App Store Connect refuses an icon that carries one, and the refusal
  arrives at upload rather than at review. Check rather than assume — a screenshot or an export
  from most tools carries alpha even when every pixel is opaque:

  ```bash
  python3 -c "d=open('resources/icon-only.png','rb').read();print('colour type',d[25],'(2 = RGB, 6 = RGBA)')"
  ```

- **No rounded corners and no padding for them.** Both platforms apply their own mask. Artwork
  that arrives pre-rounded is rounded twice and reads as inset.
- **No text.** It is viewed at about 60px on a home screen, and the wordmark in
  `public/brand/logo-splash.png` is illegible well before that — which is why the mark was
  lifted out of the lockup rather than the lockup being squared up.

## Where it came from

The mark is **the existing logo's own motorcycle**, not a redraw. `public/brand/logo-splash.png`
is a 1479×984 landscape lockup — bike, `LET'S RIDE` wordmark, and a rule under both. Measured by
decoding the file rather than eyeballing a crop:

| Element | Location |
|---|---|
| the green card | x 16–1457, y 14–964 |
| the motorcycle | x 331–614, y 265–707 |
| the rule beneath | y 735–744, x 331–1142 |
| the wordmark's first pixel | x 660 |

That 45px gutter between the mark and the wordmark is what makes the separation clean.

`logo-mark.png` is the bike region with the background removed by mapping the red channel to
alpha (the mint background reads ~104–126 there, the white mark 255), which preserves the
original antialiasing instead of producing a hard-edged cutout — 6,359 pixels carry partial
alpha. `icon-only.png` places that file at 62% of the canvas height on flat `Accent Brand/100`
`#3D996B`.

**Measure that 62% against the file, not the ink.** `logo-mark.png` carries ~6px of transparent
margin, so the visible mark is 60.45% of the canvas (bbox y 203–821). A reader re-deriving the
number from the artwork gets 60.5% and concludes the 62% is wrong; both are right about
different things.

**It also does not survive Android generation**, so do not treat it as the final framing:
`_generateAdaptiveIconForeground` writes an `adaptive-icon` XML with `android:inset="16.7%"` on
both layers, so Android's result is set by that inset plus the launcher mask. iOS is exact — its
`_generateIcons` resizes to 1024 and flattens, both no-ops on a full-bleed opaque square.

## Why the background is not the logo's own mint

`logo-splash.png` sits on a mint gradient running **`#62D2A2` → `#88DDB8`** across the card
interior. That colour is in no token source — checked against `design/TOKENS.md`, `tokens.json`,
`index.json`, `manifest.json` and the CSS by nearest-colour distance rather than string match;
the closest token is `#29CC96` (`Accent (OLD)/90`) and it is not close.

White on it fails badly, computed rather than eyeballed:

| White on | Contrast |
|---|---|
| `#62D2A2` (mint, darkest) | 1.87:1 |
| `#88DDB8` (mint, lightest) | 1.61:1 |
| `#3D996B` (`Accent Brand/100`) | **3.52:1** |

The 3:1 threshold for non-text contrast is the line; the mint is nowhere near it and `#3D996B`
clears it. `capacitor.config.ts` also already paints `#3D996B` behind the webview, so the mint
disagrees with the colour the native splash shows a moment earlier.

**That disagreement is still there in the splash itself**, and this change does not fix it:
`logo-splash.png` is unchanged and still mint-on-`#3D996B`. Fixing it belongs with
`resources/splash.png`, which does not exist yet.

## Generating the platform sets

Deliberately not committed and not generated in this container. `ios/` and `android/` are absent
because **nothing here can produce them** — no Android SDK, no Xcode, no CocoaPods
(`capacitor.config.ts`'s header) — rather than because a decision was taken to exclude them;
Capacitor's own convention is to commit platform projects, and that choice is still open.

```bash
npx @capacitor/assets generate \
  --iconBackgroundColor '#3D996B' --iconBackgroundColorDark '#3D996B'
```

Run it **after** `npx cap add ios` / `npx cap add android`. Before that,
`verifyPlatformFolders` drops each missing platform with a warning and exits with "No platforms
found" — nowhere to write, and no error to notice.

Two things to check on the Mac rather than assume, since neither can be verified here:

- **What it actually emitted.** With only `icon-only.png` present it generates icons and no
  splash, which is intended — splashes want a `splash.png` that does not exist yet.
- **Android's adaptive icon.** Full adaptive support wants `icon-foreground.png` and
  `icon-background.png`; with a single master, check what Android got before shipping it.

It stays `npx`-only on purpose — `@capacitor/assets` is a generator, not a runtime dependency,
and `CLAUDE.md` §Technology Decisions asks that each added package justify itself.

## The Figma file has no launcher icon, and four nodes look like it does

`npm run figma -- ls` shows only the `Element / Icon / *` UI stroke set. Four nodes on the
**Archive** page are the near-misses a search will surface — `Logo2`, `logo1`,
`LogoColorsRound`, `LogoColorsRoundSmall`. All four are `RECTANGLE` nodes with `IMAGE` fills, and
the offline snapshot in `design/` holds no bitmap and no bounding box for any of them, so nothing
here can say what they contain; reading them needs the Figma API, which `design/README.md`
forbids for design questions. They are named so the next session does not rediscover them and
re-open a settled question.
