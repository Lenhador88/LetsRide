<!-- Moved out of CLAUDE.md so it is not auto-loaded into every session.
     CLAUDE.md keeps the heading as a signpost; this file is the content. -->

## Product Scope (from Figma)

The built app covers a fraction of the design. **Four nav tabs — Home, Rides, Clubs,
Profile** — against the design's five: **Inbox was removed on 2026-08-07** (PD-100) rather than
shipped as the disabled stub it had been, because a tab that goes nowhere is an App Store
guideline 4.2 question and a disabled one still reads as broken. It returns with the Inbox epic.
**The design is not the code here, deliberately** — check the code first and Figma second:

```bash
sed -n '/const navItems/,/] as const/p' src/components/layout/Navbar.tsx | grep -c "href:"
```

**Scope the range before counting.** A bare `grep -c "href:"` on that file reads **9**: the four
nav rows, four `STICKY_ACTIONS` entries, and — the one that catches people twice — the `href:
string` in the `Record` type annotation declaring the map. Counting `Icon: ` instead returns the
right 4 today but is unguarded, because the file's own docstring already writes `MailboxIcon`
twice; scoping to the array cannot over-match from prose at all.

There is no "Friends" tab either, for a different reason: `013` dropped the `friendships`
table on 2026-08-04, and the route and components went earlier. The social graph is clubs
plus blocking.

| Domain | Status in code |
|---|---|
| **Postcards** — photo feed, likes/comments/shares, club-scoped, is the *home screen* | **Built and verified against the design** as of 2026-08-04: the swipeable card deck and filter bar at `/postcards`, the composer at `/postcards/new`, one card plus its thread at `/postcards/detail`. The home screen is a **card stack you swipe**, not a scrolling feed. **Share is a link share** (Web Share API, clipboard fallback) — the reading that needs no schema; a repost is still an open product question. Two design elements are blocked on schema, not design: unread badges and photo location. The hide/block/report menu shipped 2026-08-05 over the RLS `009` and `011` already had. See `docs/FIGMA-FIDELITY-TODO.md` |
| **Inbox** — DMs, per-ride group chat, notifications | **Notifications shipped 2026-08-07 (PD-118) and the other two have not.** The tab is still gone (PD-100), so notifications live at their own route, `/notifications`, reached from a `MailboxIcon` + unread dot in the header of the four tab-root screens. `036` adds the `notifications` table, written **only** by six `private` fan-out triggers — `authenticated` holds no INSERT and no DELETE grant. Per-ride group chat shipped separately as `034`. What is left of this epic is **DMs**, and the tab itself: when it returns, `/notifications` becomes `/inbox/notifications` and the header icon becomes the tab. See `.claude/agents/realtime.md` |
| **Garage** — user's motorcycles, gear, badges, countries ridden | Not built |
| **Trust & safety** — block account, report post, hide postcard, delete account | **Partially built 2026-08-05.** Block, report and hide ship in the postcard overflow menu, over the RLS that `009`/`011` already had. `unhidePostcard` and `unblockRider` still have no caller, so both are **one-way from the UI** — the design has no "blocked accounts" or "hidden postcards" screen to undo them from. **Account deletion has its database half, a deployed function, and no flow** (2026-08-11): `029`–`032` are applied and `supabase/functions/delete-account/` is **deployed to both projects and `ACTIVE`**, but nothing in `src/` points at it. `/legal/account-deletion` is public and live. What remains is `openspec/changes/add-account-deletion/` groups 3 and 4 |
| **Rides** — cover image, static map + Google Maps deeplink, Ride plan / Journal / Crew / Chat, Going/Maybe/No, per-ride chat | Partially built. **`/rides` and `/rides/detail` are v2 and built from the measured design** (2026-08-04). The detail is **four sub-pages behind a dropdown page switcher, not tabs**: Ride plan, Crew and Chat are built. **Journal has its column as of `041` and no screen yet** — the schema half of `PD-123` landed, nothing writes `ride_id`, and every row is NULL until the compose affordance ships. Chat shipped 2026-08-07 (`034`, Linear PD-115) and did **not** need the Inbox epic — a per-ride chat needs a ride and a crew, both of which existed. Inbox owns DMs and notifications and is still parked. **Chat is reached from the switcher *and* the header's chat-bubble icon; the switcher row is a deliberate deviation and both entry points are crew-only** — see `docs/FIGMA-FIDELITY-TODO.md` §Ride detail for the measurement that added it, and `034` for what "crew" means, which is narrower than a `ride_members` row and must be read there rather than restated here. The chat is the app's only Realtime subscription, so `.claude/agents/realtime.md`'s rules have a worked example now rather than only a brief. `/rides/new` is v2 as of 2026-08-05 and now offers `club_id`, which no screen had ever set. Cover images are blocked on schema (no image column), not on design; **map thumbnails no longer are** — `051` added `latitude`, `longitude` and the tile paths, and `resolve-ride-location` is ACTIVE on both projects (2026-08-17), so a ride created since carries them — see `docs/FIGMA-FIDELITY-TODO.md` §Rides list and §Ride detail. **Edit and delete shipped `PD-101`**: `/rides/detail/edit`, reached from the header's Edit affordance (organizer-only), composition ours per no v2 frame existing — see `openspec/changes/add-ride-club-edit-delete/design.md` §D5 |
| **Clubs** — public/private, Overview/Rides/Members/Posts tabs | **Built 2026-08-05**, all of it v2. `/clubs` and `/clubs/explore` are two sub-pages behind the header's dropdown, with `List / Club` rows carrying the type chip, the rider collage, the club images and the unread counter. `/clubs/detail` is four sub-pages — Timeline, Rides, Members, About — built from the **private club** frames, which are the ones marked Done; both public-club epics are On hold. `/clubs/new` is a client page with an image upload (`016`). Two things remain unbuilt and both are logged: the Timeline's **activity feed** (no table behind joins/leaves) and **member invitations with an Admin role** (drawn on the v1 create frame; `club_members.role` has had `admin` since `001` and nothing writes it). Note the flow has two Explore designs — the row list is `Explore clubs — Done`, the 2-up grid is `Explore clubs v2 — On hold`. **Create club has no v2 design** — that epic reads To do, so its composition is ours. **Edit and delete shipped `PD-101`**: `/clubs/detail/edit`, owner-only, reached from the header; delete goes through `delete_owned_club` (`043`) with a blast-radius confirmation, never a bare `.delete()` |

**Blocking is a schema concern, not a feature.** A blocked user must disappear from feeds,
chat, search, and ride crews simultaneously. It belongs in RLS policies, and every review
must check it.

Maps are a **static thumbnail plus a Google Maps deeplink** — no Mapbox, no turn-by-turn,
no route rendering. Do not add a mapping SDK.
