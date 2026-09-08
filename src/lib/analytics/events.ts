/**
 * Every analytics event this app can send, in one place — PD-353.
 *
 * A closed union rather than a `capture(name: string, props: object)` seam, and
 * the reason is the failure this replaces: an event name typed at a call site
 * is a string, so a rename, a typo or a second spelling produces a **new**
 * event in PostHog rather than an error anywhere. Nothing is red, the funnel
 * simply stops counting, and the first anyone knows is a number that looks
 * plausible and is wrong. The union makes both halves — the name and its
 * properties — a compile error instead.
 *
 * ## What is here, and the two things deliberately not here
 *
 * The Notion page's four moments, plus the onboarding step. PD-353 is explicit
 * that this is the whole list to start with and that the funnel questions get
 * answered before anything is added: **eight of the ten questions worth asking
 * are SQL today** (`docs/reference/analytics.md`), because `profiles` already
 * carries `created_at`, `terms_accepted_at`, `username` and
 * `onboarding_completed_at`. Do not instrument what is already a `select`.
 *
 * `onboarding_step` is the fifth because it is the one question SQL
 * structurally cannot reach — PD-353's question 3, *which* step turns a rider
 * away. A rider who tries three usernames, finds all three taken and closes the
 * tab has written **nothing**: `profiles` shows them at "consented, no
 * username", identical to a rider who never tried. The stage is visible in SQL
 * and the cause is not.
 *
 * ## Properties are booleans and enums. Never an id, never free text.
 *
 * This is the same discipline as `place_search_attempts`, which records that a
 * search happened and holds no column that could store the term, and as
 * `feedback.route`, which holds a pathname and never the `?id=` after it. A
 * PostHog property lands in a third-party store with its own retention and its
 * own audience; the database is where content belongs, and it already has it.
 *
 * It also keeps this honest under the pilot's replay posture: a rider can opt
 * out, and a rider who does must leave no trail — which is far easier to
 * guarantee when the trail was never richer than a handful of booleans.
 *
 * **`onboarding_step` never carries the username that was rejected**, only
 * that one was. That is the same rule and the one most tempting to break, since
 * the rejected name looks like the interesting part; it is the rider's chosen
 * identity, and `reason: 'taken'` answers the question without it.
 */

/** `via` on a join says which door the rider came through — the one thing SQL
 * cannot recover afterwards, since `club_members` records the membership and
 * not its origin. It is an enum, so it is not content. */
export type JoinRoute = 'browse' | 'invite' | 'link'

export type AnalyticsEvent =
  | {
      name: 'ride_created'
      properties: {
        is_public: boolean
        in_club: boolean
        /** Whether the organizer set a meeting point at all — never the place. */
        has_meeting_point: boolean
      }
    }
  | { name: 'ride_joined'; properties: { via: 'rsvp' | 'invite' | 'link' } }
  | { name: 'club_joined'; properties: { via: JoinRoute } }
  | { name: 'postcard_posted'; properties: { has_photo: boolean; from_ride: boolean } }
  | {
      name: 'onboarding_step'
      properties: {
        /**
         * The wizard as it stands: `075`/PD-286 dropped the location step,
         * PD-428 added the home-country one, and PD-445 turned that into the
         * TOWN step — which is the terminal one, so `town`, not `username`, is
         * where `status: 'completed'` means onboarding actually finished.
         *
         * **Renaming a step key was free exactly once, and this was it.**
         * `'country'` shipped hours before `'town'` replaced it, to a
         * population carrying no funnel history — measured 2026-09-08, PROD had
         * 5 riders and none had ever reached that step with a country stored.
         * So no series was split.
         *
         * **The general rule is the opposite and it applies from here on.**
         * Once a step key has real history behind it, the key is a *position in
         * a funnel* rather than a description of a screen, and renaming it
         * silently ends one series and starts another — the two then look like
         * a cliff in conversion that nothing in the product explains. Rename a
         * screen, keep the key, and put the description in a comment.
         */
        step: 'terms' | 'username' | 'town'
        status: 'submitted' | 'rejected' | 'completed'
        /**
         * Only on `rejected`, and only ever one of these — never the value.
         * `incomplete` is the town step being refused by
         * `complete_onboarding`'s own guards (consent, username or — since
         * `114` — a stored country missing),
         * which is distinct from `invalid` — a code the CHECK constraints
         * refused — because they turn a rider away for different reasons and
         * the funnel question is *which*.
         *
         * **`no_town` is not a rejection and rides on `completed`** (PD-445):
         * the rider finished, through the escape the town step opens when the
         * geocoder is unavailable, so they carry a country and **no town**. It
         * is the only way to ask *how often is onboarding completing without a
         * town, and is the lookup the reason* — which matters because
         * `search-places` has an application-wide ceiling, so the failure is
         * correlated across riders rather than personal to one.
         *
         * **`no_town`, not `no_country`.** Completing without a country is
         * impossible — `114` refuses the stamp — so that name would describe an
         * unreachable state, and every consumer reads the identifier rather
         * than this comment.
         */
        reason?: 'taken' | 'invalid' | 'failed' | 'incomplete' | 'no_town'
      }
    }

export type AnalyticsEventName = AnalyticsEvent['name']
