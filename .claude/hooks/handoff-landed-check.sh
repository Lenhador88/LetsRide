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

# It did touch it. Has that edit landed? If the working tree now matches the base
# tip, the merge already happened and there is nothing to say.
#
# Working tree vs a commit, not a commit range: a range only sees commits, so an
# edited-but-uncommitted handoff would slip through.
git diff --quiet "$base" -- docs/HANDOFF.md 2>/dev/null && exit 0

jq -cn --arg b "$branch" --arg base "${base#origin/}" '{
  systemMessage: ("docs/HANDOFF.md differs from \($base) on branch \($b).\nIf you rewrote the handoff, it is not shipped until it is merged — committed and pushed is not enough. Merge it, or say why it is being left. An unmerged handoff is how a shared branch once told a new session that a finished epic was half-done.")
}'
