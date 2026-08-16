# `resources/` — the native app's source artwork

Capacitor's conventional home for the artwork platform icon sets are **generated from**, not
the generated sets themselves. Two files live here and neither is consumed by the web app:
`public/` is copied into the web bundle, so a 1024px launcher icon put there would ship to
every browser for nothing.

| File | What it is |
|---|---|
| `icon.png` | The app icon master. **1024×1024, RGB, no alpha channel.** |
| `logo-mark.png` | The bike mark alone, white on transparency, 296×455 RGBA. The source `icon.png` was composed from. |

## `icon.png` — the three constraints that are rejections, not preferences

- **No alpha channel.** App Store Connect refuses an icon that carries one, and the refusal
  arrives at upload rather than at review. Check rather than assume — a screenshot or an export
  from most tools carries alpha even when every pixel is opaque:

  ```bash
  python3 -c "import struct;d=open('resources/icon.png','rb').read();print('colour type',d[25],'(2 = RGB, 6 = RGBA)')"
  ```

- **No rounded corners and no padding for them.** Both platforms apply their own mask. Artwork
  that arrives pre-rounded is rounded twice and reads as inset.
- **No text.** It is viewed at about 60px on a home screen, and the wordmark in
  `public/brand/logo-splash.png` is illegible well before that — which is why the mark was
  lifted out of the lockup rather than the lockup being squared up.

## Where it came from

The mark is **the existing logo's own motorcycle**, not a redraw. `public/brand/logo-splash.png`
is a 1479×984 landscape lockup — bike, `LET'S RIDE` wordmark, and a rule under both. The bike
occupies x 331–614, y 265–707 in that file; the rule sits at y 735–744 and the wordmark starts
around x 650, so the mark separates cleanly.

`logo-mark.png` is that region with the background removed by mapping the red channel to alpha
(the mint background reads ~104–126 there, the white mark 255), which preserves the original
antialiasing instead of producing a hard-edged cutout. `icon.png` is that mark at 62% of the
canvas height on flat `Accent Brand/100` `#3D996B`.

**The background colour is deliberately NOT the logo's own.** `logo-splash.png` sits on a mint
gradient sampling `#68D4A5`→`#7EDAB3`, which is not a token in `design/TOKENS.md` and is much
lighter than `Accent Brand/100`. White on that mint has weak contrast — visibly poor at 60px and
worse in greyscale — and `capacitor.config.ts` already paints `#3D996B` behind the webview, so
the mint version disagrees with the colour the native splash shows a moment earlier.

**That disagreement is still there in the splash itself**, and this change does not fix it:
`logo-splash.png` is unchanged and still mint-on-`#3D996B`. Regenerating it belongs with the
native splash asset (`resources/splash.png`, which does not exist yet) rather than here.

## Generating the platform sets

Deliberately not committed, and deliberately not generated in this container — the same reasoning
that keeps `ios/` and `android/` out of the repo (`docs/HANDOFF.md` §The shell). The platform
sets are hundreds of derived files that a Mac regenerates from `icon.png` in one command:

```bash
npx @capacitor/assets generate --iconBackgroundColor '#3D996B' --iconBackgroundColorDark '#3D996B'
```

Run it **after** `npx cap add ios` / `npx cap add android`, or it has nowhere to write. It is
`npx`-only on purpose — `@capacitor/assets` is a generator, not a runtime dependency, and
`CLAUDE.md` §Technology Decisions asks that each added package justify itself.
