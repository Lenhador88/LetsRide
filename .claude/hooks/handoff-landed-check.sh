#!/usr/bin/env bash
# Stop hook — warn when docs/HANDOFF.md on this branch has not reached the
# branch a session's PR lands on.
#
# Why this exists: a session rewrote the handoff, opened a PR, said it would
# merge once CI went green, and then wrapped up without merging. Everything was
# committed and pushed, so the existing git-check hook was satisfied — but the
# shared branch kept telling the next session that a shipped epic was half-done.
#
# The handoff is the one file whose staleness actively misleads, and it is
# almost always edited at wrap-up. So "you changed the handoff and it is not on
# the shared branch" is a precise signal for this failure with very little
# noise: it stays silent through normal feature work that does not touch it.
#
# It measures against `development`, not `main`, since 2026-08-06. A feature PR
# targets `development` (CLAUDE.md §Branching & CI), so `main` was the wrong
# ruler the day the environment split landed: a session that correctly merged
# its handoff into `development` would still be told it had not shipped, and a
# warning that fires when the rule was followed is one nobody reads twice.
#
# THERE IS NO `main` FALLBACK, for the same reason session-wrapup-check.sh lost
# its one on 2026-08-11. `docs/HANDOFF.md` genuinely differs between `main` and
# `development` most of the time — unreleased work — so falling back to `main`
# warns that a handoff has not landed when it landed perfectly well. Silence is
# this hook's designed failure mode; a wrong warning is not.
#
# It deliberately does NOT check PR state. The GitHub REST API is unreachable
# from the shell in this environment (the proxy returns "GitHub access is not
# enabled for this session"); GitHub is only available through the MCP tools,
# which a hook cannot call. Anything curl-based here fails silently and is
# worse than nothing.
#
# Warns only, never blocks — leaving work for human review is legitimate, and a
# Stop hook the agent cannot satisfy would loop. Every failure path exits 0.
#
# It speaks ONCE per branch's unit of work, keyed the same way
# session-wrapup-check.sh keys its own marker. See the marker near the bottom;
# the condition here stays true from the handoff edit until the merge, which is
# most of a session, and a Stop hook runs at the end of every turn.
#
# The marker alone was not enough, and the near-miss is worth carrying: the
# condition goes true at the EDIT, so a bare marker spent the single warning on
# the turn before the PR was even opened and then went quiet through the wrap-up
# this file was written for. The wrap-up gates further down are what put the one
# firing where it is worth reading.
set -uo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" 2>/dev/null || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$branch" in ''|main|master|development|HEAD) exit 0 ;; esac

# Resolve the base, fetching once if this clone has never seen it. The old
# comment here claimed no network call was needed because "a stale ref only
# costs a false negative" — both halves were wrong: it fell back to `main`, and
# that costs a false *positive*, which is the expensive kind.
#
# Bounded and failure-tolerant, because a Stop hook must not hang the session.
# The marker is shared with session-wrapup-check.sh on purpose: the two run in
# the same Stop event against the same clone, so an unreachable remote should
# cost one timeout between them, not one each. The explicit refspec is required
# on a --single-branch clone, where the short form writes only FETCH_HEAD.
base=origin/development
if ! git rev-parse --verify -q "$base" >/dev/null 2>&1; then
  gitdir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
  if [[ ! -f "$gitdir/wrapup-fetch-unreachable" ]]; then
    timeout --kill-after=2 5 git fetch --quiet origin \
      "+refs/heads/development:refs/remotes/origin/development" >/dev/null 2>&1 \
      || : >"$gitdir/wrapup-fetch-unreachable" 2>/dev/null
  fi
fi
git rev-parse --verify -q "$base" >/dev/null 2>&1 || exit 0

# Two comparisons, and the first one is what keeps this quiet.
#
# Did THIS branch touch the handoff at all? Measured against the point the branch
# diverged, never against the base tip — the tip moves on its own, and "someone
# merged three PRs into development while you worked" is not "you rewrote the
# handoff". A bare `git diff $base` cannot tell those apart, and it read as a
# false positive the moment the ruler became `development`, which is ahead of
# `main` by design. It was latent in the `main`-only version too: any branch cut
# before a handoff edit landed would have been warned about someone else's work.
mergebase=$(git merge-base "$base" HEAD 2>/dev/null) || exit 0
git diff --quiet "$mergebase" -- docs/HANDOFF.md 2>/dev/null && exit 0

# It did touch it. Has that edit landed?
#
# ** Ask "is this branch's content already contained in the base", NOT "does this
# branch match the base tip". ** Those two diverge the moment ANOTHER session
# lands a handoff change while this branch sits — the normal case here rather
# than bad luck, since docs/HANDOFF.md is touched by roughly two-thirds of
# commits and several sessions run at once. A branch whose own handoff edit
# merged perfectly well then gets warned about somebody else's, which is exactly
# the wrong warning this file's header promises not to issue.
#
# Measured 2026-08-11 against the real case: branch tip 2a0bc68, whose handoff
# edits had merged in #168 and #177, warned every Stop because `development` had
# moved ahead by one unrelated handoff change (#176, PD-196's walk phase). Merge
# base c2679fb, so guard 1 passed and the tip comparison then compared against
# work that was never this branch's. The session's fix was to reset the branch
# onto the base — correct, and CLAUDE.md prescribes it — but a warning that fires
# when the rule was followed is one nobody reads twice.
#
# `merge-tree --write-tree` answers containment with no merge-base gymnastics: if
# merging this branch into the base would produce the base's OWN tree, nothing
# here is unlanded. Same instrument, and same reason, as CLAUDE.md §Branch
# cleanup — an ahead-count reports every commit of a squash-merged branch as
# unlanded for ever, so it cannot tell a merged branch from an unmerged one, and
# every branch in this repo is squash-merged.
#
# COMMITTED CONTENT ONLY, which is why the tip comparison below survives rather
# than being replaced: merge-tree reads commits, so a handoff edited but not yet
# committed is invisible to it and must still reach that check.
#
# On any failure — git older than 2.38, no merge base, unreadable ref — fall
# THROUGH to the tip comparison rather than exiting. That preserves this file's
# previous behaviour exactly, so a failure here can only ever be as noisy as it
# was before, never quieter.
if git diff --quiet HEAD -- docs/HANDOFF.md 2>/dev/null; then
  basetree=$(git rev-parse -q --verify "$base^{tree}" 2>/dev/null || true)
  merged=$(git merge-tree --write-tree "$base" HEAD 2>/dev/null | head -1 || true)
  if [[ -n "$basetree" && -n "$merged" && "$merged" == "$basetree" ]]; then exit 0; fi
fi

# So either the handoff is edited and uncommitted, or this branch genuinely
# carries something the base does not.
#
# Working tree vs a commit, not a commit range: a range only sees commits, so an
# edited-but-uncommitted handoff would slip through.
git diff --quiet "$base" -- docs/HANDOFF.md 2>/dev/null && exit 0

# WAIT FOR A WRAP-UP STATE, and this is what makes the single warning below land
# where it is worth reading rather than where it is merely first true.
#
# The condition above goes true the instant `docs/HANDOFF.md` is edited — the
# check is against the working tree, deliberately. Speaking then spends the one
# warning on the turn whose honest answer is "I am about to open the PR", and
# leaves the session silent through the exact state this file exists for: header
# §Why this exists — committed, pushed, PR open, wrapped up without merging.
#
# So require what `session-wrapup-check.sh` requires before it speaks: nothing
# uncommitted, nothing untracked, and HEAD already pushed. Its single firing is
# correct because those three conditions ARE the wrap-up; copying the marker
# without them was copying half the mechanism.
#
# Nothing is lost by staying quiet before that, and the cover is ONE file rather
# than two: `~/.claude/stop-hook-git-check.sh` handles all three gated states —
# uncommitted, untracked, and pushed-behind — and it `exit 2`s, so unlike this
# warning it reaches the model rather than only the user.
#
# **Do not credit the sibling with the unpushed half.** `session-wrapup-check.sh`
# runs this same `[[ "$head" == "$pushed" ]] || exit 0` and is therefore silent
# on unpushed for exactly the reason this hook now is — an audit that follows
# the wrong attribution lands on the one file that disproves it, and concludes
# there is a gap here worth reopening. There is not.
#
# This hook's unique claim is the *landed* check, which cannot even be answered
# until there is something pushed to land.
git diff --quiet 2>/dev/null || exit 0
git diff --cached --quiet 2>/dev/null || exit 0
[[ -z "$(git ls-files --others --exclude-standard 2>/dev/null)" ]] || exit 0
head=$(git rev-parse HEAD 2>/dev/null) || exit 0
pushed=$(git rev-parse --verify -q "origin/$branch" 2>/dev/null) || exit 0
[[ "$head" == "$pushed" ]] || exit 0

# ONCE PER UNIT OF WORK, keyed exactly as session-wrapup-check.sh keys its own —
# `<branch>@<merge-base with the base>`. Product owner, 2026-08-13: *"I also keep
# seeing the example below here"*, about this hook's paragraph.
#
# The condition here is true for the WHOLE stretch between editing the handoff
# and merging it — normally the rest of the session — and a Stop hook runs at the
# end of every assistant turn, so without this the same paragraph arrives five or
# six times for one edit. That is the failure this file's own header warns about,
# arriving through the marker rather than through the conditions: a warning that
# repeats is one that gets scrolled past, and this one is worth reading.
#
# ITS OWN FILE, not the wrap-up hook's marker. The two run in the same Stop event
# and share `wrapup-fetch-unreachable` on purpose — one timeout between them —
# but sharing the *reminder* marker would let whichever spoke first silence the
# other, and they are different messages about different failures.
#
# The re-arm behaviour is the sibling's, for the sibling's reasons: a different
# branch is a different key, and a branch restarted onto a new base after its PR
# merged (CLAUDE.md's `checkout -B <branch> origin/development`) gets a new fork
# point and therefore a new key. More commits on the same branch do not.
#
# What this trades away, stated because it is a real loss rather than a
# rounding error: a session that edits the handoff, merges it, and then edits it
# AGAIN on the same branch is not warned the second time. That is the sibling's
# trade too, and it is the right side of this one — the alternative is the
# repetition the owner asked to stop.
# `$mergebase` is the one computed for guard 1 above, deliberately reused: the
# fork point is what makes this key stable while other sessions merge into the
# base, and computing it twice invites the two copies to drift apart.
gitdir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
key="$branch@$mergebase"
marker="$gitdir/handoff-reminded"
[[ -f "$marker" && "$(cat "$marker" 2>/dev/null)" == "$key" ]] && exit 0
printf '%s' "$key" >"$marker" 2>/dev/null

jq -cn --arg b "$branch" --arg base "${base#origin/}" '{
  systemMessage: ("docs/HANDOFF.md differs from \($base) on branch \($b).\nIf you rewrote the handoff, it is not shipped until it is merged — committed and pushed is not enough. Merge it, or say why it is being left. An unmerged handoff is how a shared branch once told a new session that a finished epic was half-done.\n\nThis fires ONCE for the whole unit of work on this branch, so a later commit will NOT re-arm it. Declining now means nothing asks again before the session ends.")
}'
