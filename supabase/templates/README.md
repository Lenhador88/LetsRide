# Auth email templates

The three GoTrue mails a rider can receive, branded. **These files are bodies only** — GoTrue
never reads them. They are pasted into the Supabase dashboard by hand, on **both** projects.

| File | Dashboard field | Suggested subject |
|---|---|---|
| `confirm-signup.html` | Authentication → Emails → **Confirm signup** | `Confirm your email — LetsRide` |
| `reset-password.html` | Authentication → Emails → **Reset password** | `Reset your LetsRide password` |
| `magic-link.html` | Authentication → Emails → **Magic Link** | `Your LetsRide sign-in link` |

The subject is a **separate field beside the body**, and it is the half a rider reads first. An
unbranded subject on a branded body undoes most of the work, so set both.

Both projects: `letsride` (`zwprydcyryvudhurbnye`, PROD) and `letsride-dev`
(`fpmrimzxadewsaiwpsel`, DEV). `docs/ENVIRONMENTS.md` §Auth configuration is the contract for
everything else behind that door.

## This directory is the source of truth by convention only

**Nothing enforces it, and committing these files does not make the drift detectable.** There is
no `supabase/config.toml` — this repo has never used the Supabase CLI — so an email template is a
dashboard setting with no file behind it, exactly like the Site URL and the redirect allowlist:

- **CI cannot see a dashboard template.** The `RLS Policy Tests` job applies migrations to a
  scratch database; there is no GoTrue in it. The `Type Check, Lint & Build` job never opens this
  directory.
- **`docs:check` cannot either.** Every claim it runs measures a file, a `jq` read or a contrast
  ratio in this repo. A claim about what a hosted project is serving has no ground truth it can
  reach.
- **No session can read a template back.** The Supabase MCP server exposes no template read, the
  Management API's `GET /v1/projects/{ref}/config/auth` needs a personal access token this
  environment does not hold, and `/auth/v1/settings` — the credential-free probe that answers
  `mailer_autoconfirm` — does not return template bodies.

So a template edited in the dashboard and not mirrored here, or mirrored here and never pasted,
is **invisible**. What these files buy is a diff you can run by hand, and a reviewable history of
what the wording was meant to be:

```bash
# paste the dashboard's current body into a scratch file, then:
diff -u supabase/templates/confirm-signup.html /tmp/dashboard-confirm.html
```

Treat that as the check, and re-run it whenever either project's auth config is touched.

## The GoTrue variables — keep them exactly as written

`{{ .SiteURL }}`, `{{ .TokenHash }}` and `{{ .ConfirmationURL }}` are substituted by GoTrue. They
appear twice in each file: once in the button's `href` (three times in `confirm-signup.html`,
which also carries the Outlook `<v:roundrect>` fallback) and once in the copy-this-link fallback,
where the URL is both the link and its own visible text. **Change all of them or none** — a
button and a fallback pointing at different URLs is the kind of defect nothing here can catch.

**`confirm-signup.html`'s link is PD-233's form, verbatim:**

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/postcards
```

`{{ .SiteURL }}` rather than `{{ .RedirectTo }}` because each project's Site URL already points at
its own host (PD-106), and `.RedirectTo` would need the query concatenated onto a value that
already carries one. The `&` is written bare rather than as `&amp;` so the file matches PD-233
byte for byte and a hand-diff stays exact; every HTML5 parser, and Word's engine, leaves an
ampersand literal when what follows is not a named entity.

**Pasting `confirm-signup.html` performs PD-233.** They are the same dashboard field, and PD-235
asks for this template to land *after* PD-233 is proven working. If PD-233 is still open when you
paste, this paste closes it — so prove the link on the project you paste into (PD-233 carries the
DEV caveats: autoconfirm is off there, and `app-dev.letsride.social` sits behind Vercel SSO)
before considering either issue done.

`reset-password.html` keeps `{{ .ConfirmationURL }}` and therefore stays on `/auth/callback` and
stays PKCE. That is deliberate and PD-233 says so explicitly: `confirmableOtpType` refuses
`recovery`, and `026` §3 measured why a token-hash reset would fail 100% of the time. The copy
says *"the same browser you asked from"* for the same reason — `resetPasswordForEmail` stores the
`code_verifier` in the requesting browser's storage, so a reset link opened elsewhere cannot
succeed.

`magic-link.html` is **branded pre-emptively: nothing in the app sends it today.** There is no
`signInWithOtp` call in `src/` — `grep -rn "signInWithOtp" src/` is 0. It is here so the template
is not the unbranded default on the day someone enables passwordless sign-in, and its copy
deliberately makes no claim about which device to open it on, because no flow exists yet to
measure that against.

## Why the markup looks like 2004

**Email clients are not browsers, and Outlook renders with Word's engine.** Every one of these is
a constraint rather than a preference:

- **Table-based layout, inline CSS.** No flexbox, no grid, no `<style>` block at all — Gmail
  strips or rewrites `<style>` in several contexts, so anything load-bearing there is a coin
  flip. There is no `<style>` element in these files; check with
  `grep -c "<style" supabase/templates/*.html` (0 each).
- **No external images, no web fonts.** Poppins cannot travel, so the font stack falls back
  through the system UI faces to Arial, which is what Word will use. There is no `<img>` in these
  files either, so an images-off client renders them complete — which also means there is no
  tracking pixel, deliberately.
- **~600px maximum**, on a table that is `width="100%"` with a `max-width`, so it is fluid below
  that without a media query.
- **A text alternative lives inside the HTML.** The dashboard exposes one body field and no
  `text/plain` part, so the fallback is the copy-this-link paragraph: the full URL as visible
  text under the button. Strip every style from these files and they still read as a sentence, a
  link and a footer.
- **Outlook's rounded button** is a `<v:roundrect>` inside `<!--[if mso]>`, with the ordinary
  `<a>` inside the downlevel-revealed `<!--[if !mso]><!-- --> … <!--<![endif]-->` pair. Without
  it Word ignores `border-radius` and `padding` on an inline anchor, and the button collapses to
  underlined text.
- **`color-scheme: light only`** stops iOS Mail and Outlook.com inverting the palette into
  something that is not the brand.

## The palette, and where it comes from

`design/TOKENS.md`, which is generated from the committed Figma snapshot. Read that file, never
the Figma API.

| Token | Value | Used for |
|---|---|---|
| `Grey/100` | `#1A1A1A` | headings, the button fill, the wordmark |
| `Grey/80` | `#666666` | body copy, footer |
| `Grey/5` | `#F2ECE6` | the page behind the card |
| `Grey/10` | `#E5DACF` | the card's border |
| `White/100` | `#FFFFFF` | the card, and the button's label |
| `Accent Brand/100` | `#3D996B` | the rule above the heading, and link text — once each |

**The button is near-black, not green**, which is `CLAUDE.md` §Design System's most-repeated
correction. Green appears twice per mail on purpose.

**The wordmark is set as text**, not as artwork. The design's logo is a raster
(`Login / Splash screen` → `RECTANGLE · Logo2`) and an image in an email means an external image,
which the constraint above rules out; a data URI is blocked by Gmail. The string is `LetsRide`,
matching `TITLE` in `src/app/layout.tsx` — the one place in the shipped product that names the
brand to a rider.

## Previewing a change

These are plain files; open one in a browser and the `{{ … }}` render as literal text, which is
what you want to see. That checks the layout and nothing about how a mail client will treat it —
for that, paste into the dashboard's preview, or send yourself one from DEV.
