<!-- Moved out of CLAUDE.md so it is not auto-loaded into every session.
     CLAUDE.md keeps the heading as a signpost; this file is the content. -->

## Repo Layout

```
src/
├── app/                    # Next.js App Router pages
│   ├── (app)/              # Authenticated route group — has Navbar
│   │   ├── layout.tsx      # Renders <Navbar /> (fixed bottom tabs); each page renders its own <Header>
│   │   ├── error.tsx       # The app's only error boundary
│   │   ├── postcards/      # /postcards (the home screen), /postcards/new, /postcards/detail (one card + its comment thread)
│   │   ├── rides/          # /rides (From clubs), /rides/explore, /rides/new, /rides/detail (Ride plan), /rides/detail/crew, /rides/detail/chat, /rides/detail/edit (PD-101)
│   │   ├── clubs/          # /clubs (Your clubs), /clubs/explore, /clubs/new, /clubs/detail (merged 2026-08-18) + /rides, /members, /edit (PD-101), /threads, /threads/new, /thread (PD-307)
│   │   ├── notifications/  # /notifications — PD-118. Becomes /inbox/notifications when the tab returns
│   │   └── profile/        # /profile (your own), /profile/detail (another rider's — view-rider-profile)
│   ├── auth/               # /auth/login, /auth/signup, /auth/callback (public)
│   ├── onboarding/         # /onboarding/terms, /onboarding/username — see decision #5. `location/` went with 075 (PD-286)
│   ├── legal/              # /legal/terms, /legal/privacy, /legal/account-deletion — public, decision #1
│   ├── layout.tsx          # Root layout (Poppins, v2 light theme) — mounts <RouteGuard>
│   ├── page.tsx            # / — splash resolver: redirects by session (see decision #7)
│   └── globals.css         # Tailwind import + CSS vars + the safe-area / fixed-bar spacing utilities
├── components/
│   ├── ui/                 # AppBackground, Avatar, Banner, Button, ButtonGroup, Card, Checkbox, ContextMenu, ErrorState, ExpandableText, FilterTile, Input, ListUser, NotificationDot, NotificationRow, OfflineState, Pagination, PlaceSearchField, SectionHeader, Skeleton, Textarea
│   ├── icons/              # generated.tsx — the 53 Figma icons. GENERATED, don't edit
│   ├── layout/             # Navbar (bottom tabs + sticky action), Header (per screen)
│   ├── auth/               # AuthScreen, FormError, ResetPasswordForm, RouteGuard (mounted in the ROOT layout) — plus username-verdict.ts, pure + tested, the postcards/deck.ts shape rather than a fifth component
│   ├── chat/              # ChatComposer, ChatThread, MarkChatSeen — shared by the ride chat and club threads since 081
│   ├── rides/              # CreateRideForm, DeleteRideControl, EditRideForm, RideAttendanceBar, RideCard, RideChatButton, RideChatRow, RideChip, RideCrewRail, RideFilterBar, RideHeader, RideJournal, RideMap, RideOptionsMenu, ExploreRidesList, ExploreRidesStrip, recentStarts
│   ├── clubs/              # ClubCard, ClubCreateRideRow, ClubDetailHeader, ClubThreadRow, ClubThreadsSection, ClubMemberRail, ClubMembershipButton, ClubOptionsMenu, ClubPostcardCarousel, CreateClubForm, CreateThreadForm, DeleteClubControl, EditClubForm, ExploreClubsList, ExploreClubsStrip, JoinClubButton, MarkClubSeen, clubTimeline
│   ├── postcards/          # CommentForm, CommentItem, CommentList, CommentsLink, CreatePostcardForm, LikeButton, MarkFeedSeen, PostcardAction, PostcardCard, PostcardDeck, PostcardFilterBar, PostcardMenu, ShareButton
│   ├── notifications/      # MarkNotificationsRead, NotificationsHeaderControl, NotificationsListItem, NotificationsPanel
│   └── profile/            # CountryFlags, EditProfileForm, ProfileCountries, ProfileDetailMenu, ProfileImageUpload, ProfileMenu
├── lib/
│   ├── supabase/
│   │   ├── resolve.ts      # THE doorway for lib/data and lib/actions. Read its header
│   │   ├── resolve.browser.ts # the one half left, with the read-during-render tripwire
│   │   ├── client.ts       # the memoised supabase-js client, on the session store
│   │   └── session-store.ts # where the session lives: secure store, else localStorage
│   ├── data/               # Read functions — the only place that queries Supabase
│   ├── actions/            # Write functions — the only place that mutates
│   ├── validation/         # Zod schemas, shared by client and server
│   ├── media/              # Image compression + EXIF stripping, browser-only
│   ├── auth/               # guard.ts (route rules, pure + tested), guard-cache.ts (what it reads, held per page load), recovery.ts (grant + safeNext)
│   ├── native/             # secure-store.ts — the keychain behind window.__letsrideSecureStore; boot-restore.ts — the shell's cold start (PD-142)
│   ├── query/              # useQuery, invalidate, keys.ts — the cache contract
│   ├── routes.ts           # every href that names a resource id — /rides/detail?id= and its nine siblings (PD-142)
│   ├── back-navigation.ts  # where a back control goes on a screen with several entry points — /notifications carries its origin in ?from= (PD-209)
│   ├── realtime/           # useRideMessageStream, useClubThreadStream — the app's two Supabase Realtime subscriptions (081)
│   ├── location/           # rider-location.ts (where the rider is — device, then profile city; never prompts), distance.ts (haversine + NEARBY_RADIUS_KM, PD-259), near-label.ts (what to CALL that place — never the profile city beside a device fix)
│   ├── rides/              # seed-ride-id.ts. `nearby.ts` went with the near-you filter on 2026-08-27 — `/rides/explore` sections on `isNearby(distance_km)` from `lib/location/distance`, which is where that predicate now lives for both tabs
│   ├── clubs/              # seed-club-id.ts — the default club every rider joins on completing onboarding (058)
│   ├── countries.ts        # ISO 3166-1 list; names via Intl.DisplayNames, flags via regional indicators
│   └── utils.ts            # cn(), APP_TIME_ZONE, wallClockToUtc(), googleMapsDirectionsUrl(), formatPostcardDate(), formatRideDate/DateLong/Time(), formatChatMessageDay(), rideZoneDayKey(), formatRelativeTime(), formatNotificationStamp(), notificationSection(), getInitials()
└── types/
    └── index.ts            # All shared domain types (Profile, Club, Ride, etc.)
capacitor.config.ts         # The native shell's config. See docs/HANDOFF.md §The shell
ios/                        # The generated Xcode project, committed 2026-08-25. SPM, not CocoaPods.
                            #   App/App/public and the generated config are gitignored by the template.
                            #   android/ is NOT generated — nobody has asked for it yet (PD-95)
resources/                  # Native SOURCE artwork the icon sets are generated FROM — the iOS set is
                            #   committed under ios/, generated headlessly by @capacitor/assets
├── icon-only.png           # The 1024 app icon master. RGB, no alpha. The name matters — README.md says why
├── logo-mark.png           # The bike mark alone, white on transparency; what icon-only.png was composed from
└── README.md               # The naming trap, the three store constraints, and the generate command
supabase/
├── migrations/             # SQL migrations — append-only, see Supabase Rules
├── functions/              # Edge Functions. ONE, and read the rule below before adding another
└── tests/                  # RLS policy suite (npm test); README covers its scope
docs/
├── HANDOFF.md              # Current position — read at session start
├── ENVIRONMENTS.md         # DEV vs PROD — branches, targets, apply order, what drifts
├── FIGMA-FIDELITY-TODO.md  # Values inferred, not read — verify before trusting the UI
├── reference/              # Split out of the two files every session loads — CLAUDE.md and
│                           # HANDOFF.md — so neither carries it. Look-up material, reached from
│                           # the signpost heading the source file keeps for each:
│   ├── schema.md           #   the per-table contract — grants, cascades, audience predicates
│   ├── linear.md           #   the board: statuses, sequencing, the queue Routine
│   ├── design-system.md    #   v2 tokens, type scale, geometry, the icon set
│   ├── migrations.md       #   the ordering chain, the rollback SQL, what reads as drift
│   ├── repo-layout.md      #   this file
│   ├── product-scope.md    #   what is built per domain, against the Figma
│   ├── analytics.md        #   the product questions, and which are already SQL
│   └── observability.md    #   what we see when it breaks, and the 24h expiry on it
└── specs/                  # Implementation specs (login-onboarding.md)
design/                     # Committed Figma snapshot — READ THIS, don't call the API
├── README.md               # Why it exists, how to refresh it, how to query it
├── manifest.json           # Provenance + counts; `figma:check` compares against it
├── index.json              # Name -> file map for every frame and component
├── tokens.json, TOKENS.md  # Colour + type tokens, geometry census
├── frames/*.json           # One pruned tree per screen
├── components/*.json       # One pruned tree per component set
└── icons/                  # index.json + exported SVGs
scripts/figma/              # The snapshot pipeline (pull -> extract -> query)
scripts/docs/               # docs:check — the numeric doc-claims registry + runner (PD-155)
scripts/db/                 # drift + seed checks, the analytics queries, the error-log reader
scripts/native/             # the two build-shape guards — the bundle carries no rider data, the web build is not an export (PD-142)
scripts/probes/             # hand-run probes — the confirmation-on signup arm, which no automated gate may reach (PD-252)
scripts/brand/              # favicon + OG card generation
scripts/storage/            # sweep-orphans — Storage objects with no row pointing at them
openspec/                   # config.yaml, plus:
├── specs/                  # Standing capability specs — the current contract
└── changes/                # Active proposals; archive/ holds shipped ones
.claude/
├── agents/                 # The specialist squad (see The Agent Squad)
├── commands/               # Slash commands (opsx/*)
├── skills/                 # Project skills
├── hooks/                  # two Stop hooks — handoff-landed-check.sh, session-wrapup-check.sh
└── settings.json           # Hooks, permissions, and the autoMode classifier rules
```

**The per-directory contents above are a hand-copied `ls` and go stale silently** — a
freshly-touched line looks verified and is not. Check it rather than trust it:

```bash
for d in src/components/*/; do echo "$d: $(ls "$d" | sed 's/\.tsx\?$//' | tr '\n' ' ')"; done
```

**Nothing under `app/(app)/*` is v1 any more** — check rather than read it:
`grep -rn "text-white\|zinc-\|orange-500" src/app/ | wc -l`.
