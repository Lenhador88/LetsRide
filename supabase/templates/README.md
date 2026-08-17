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
  scratch database; there is no GoTrue in it. `Type Check, Lint & Build` *does* read this
  directory — `src/__tests__/auth-email-templates.test.ts` opens all three files — but everything
  it can check is a property of the file, never of what a project is serving.
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

**The file half of this does have a gate**, and it is the half that goes wrong silently:
`src/__tests__/auth-email-templates.test.ts` holds every link in a template identical to every
other, the URL repeated as visible text, and the no-`<style>`/no-image constraints below. It says
nothing about what is deployed — nothing can — but a button and a fallback that have drifted apart
now fail CI instead of reaching an inbox.

## The GoTrue variables — keep them exactly as written

`{{ .SiteURL }}`, `{{ .TokenHash }}` and `{{ .ConfirmationURL }}` are substituted by GoTrue.
**Each file carries the same URL four times**, and every one of them has to move together:

1. the Outlook `<v:roundrect href>` — all three files have one, not just `confirm-signup.html`;
2. the ordinary `<a href>` button, which is what every non-Outlook client follows;
3. the copy-this-link fallback's `href`;
4. **that fallback's visible text**, which is the one a `grep` for `href` does not find.

**Change all four, or none** — a button and a fallback pointing at different URLs breaks for
whichever half of the recipients get the other button, and it looks perfectly correct in a diff.

**Changing all four is not enough on its own: the fifth copy is in the test.**
`auth-email-templates.test.ts` holds the three *hrefs* identical to each other *and* to a
hardcoded `LINKS` constant, and checks the visible text repeats it. That is deliberate — it makes
a link change something a reviewer has to see twice — but it means a correct edit to a template
turns CI red until the constant moves with it. Editing the file and not the test is a failure the
suite reports plainly; the reverse, a consistent-but-wrong edit, is what the constant catches.

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
paste, this paste closes it — so prove the link on the project you paste into before considering
either issue done.

**Proving it on DEV takes one temporary setting change and one access condition, and the polarity
is the trap.** DEV runs autoconfirm **on**, which means GoTrue sends **no confirmation mail at
all** and there is no `{{ .TokenHash }}` to click. Read the setting rather than trusting this
sentence — it is a dashboard value, this paragraph tells you to flip it, and `false` reads like
"confirmation off" and means the opposite; `docs/ENVIRONMENTS.md` §Auth configuration carries the
credential-free `curl` and the polarity warning. The access condition does not revert: DEV's
`{{ .SiteURL }}` points at `app-dev.letsride.social`, which sits behind Vercel SSO, so the link
needs a Vercel-authenticated browser however the setting is left. PD-233's own conclusion is that
a throwaway PROD account on a real inbox is the honest alternative.

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
  underlined text. **The `<td>` around both branches carries no fill**, which looks like an
  omission and is not: Word ignores `border-radius` on a table cell too, so a filled cell paints
  the corner areas outside the VML arc and squares off the very button the `<v:roundrect>` was
  added to round. Each branch paints itself.
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
| `Accent Brand/100` | `#3D996B` | the rule above the heading. Once per mail, and nothing else |

**The button is near-black, not green**, which is `CLAUDE.md` §Design System's most-repeated
correction. Green appears once per mail, on a 4px rule where it is decoration rather than text.

**The copy-this-link URL is `Grey/100`, not the accent**, and that is a contrast decision rather
than a stylistic one: `#3D996B` on white is 3.52:1, under the 4.5:1 bar for 12px regular text, and
this line *is* the text alternative — the thing a rider reads when the button has already failed
them. It is underlined, which is what carries its linkness. `#1A1A1A` gives 17.40:1.

**The wordmark is set as text**, not as artwork. The design's logo is a raster
(`Login / Splash screen` → `RECTANGLE · Logo2`) and an image in an email means an external image,
which the constraint above rules out; a data URI is blocked by Gmail. The string is `LetsRide`,
matching `openGraph.siteName` in `src/app/layout.tsx` — the bare brand name as the product already
unfurls it, without the `— Ride Together` that `TITLE` carries for a page title.

## Previewing a change

These are plain files; open one in a browser and the `{{ … }}` render as literal text, which is
what you want to see. That checks the layout and nothing about how a mail client will treat it —
for that, paste into the dashboard's preview, or send yourself one from DEV.
