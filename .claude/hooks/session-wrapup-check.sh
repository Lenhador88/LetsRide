#!/usr/bin/env bash
# Stop hook — the session wrap-up: a PR to `development`, then the notification.
#
# Standing instruction from the product owner, 2026-08-06: wrapping up a session
# means opening a PR to `development` if the session changed anything, and then
# sending a push notification `Done ; ) <session name>` in case they are not
# watching. Both were already written in CLAUDE.md and both are exactly the kind
# of thing that gets dropped at the end of a long session, when every other
# signal — clean tree, pushed branch, green CI — already looks finished. That is
# the failure this file exists to catch; see CLAUDE.md §Working Principles,
# "Committed and pushed is not shipped".
#
# WHEN IT SPEAKS, and why the conditions are this narrow: a Stop hook runs at the
# end of EVERY assistant turn, so anything less specific than "this looks like a
# wrap-up" becomes noise that gets ignored — and a reminder that fires on every
# turn would also contradict CLAUDE.md's "open the PR at the wrap-up, not per
# milestone". So it stays silent unless ALL of these hold:
#
#   - not on main / master / development (those take PRs, they do not open them)
#   - nothing uncommitted, nothing untracked  -> the work is committed
#   - HEAD == origin/<branch>                 -> the work is pushed
#   - HEAD is ahead of origin/development     -> there is something to PR
#   - it has not already fired for this branch's current unit of work
#
# The last one is what bounds it. The marker lives in .git/ (per-clone, never
# committed) and holds `<branch>@<merge-base with the base>`, so one branch's
# worth of work is announced once however many commits it takes. See the comment
# at the marker for why this is NOT keyed on the HEAD sha — that version fired
# once per commit, which on a multi-agent build meant once per pipeline stage.
#
# WHY IT BLOCKS where handoff-landed-check.sh only warns. A `systemMessage` goes
# to the user, not to the model — which is right for "here is something to look
# at", and useless for "you still have two things to do". The only Stop output
# the model actually reads is `decision: block` + `reason`. The looping risk that
# argument usually carries is closed twice over here: `stop_hook_active` catches
# immediate re-entry, and the sha marker means it cannot fire twice for the same
# state even across turns. Worst case is one extra turn.
#
# It deliberately does NOT check whether the PR already exists. The GitHub REST
# API is unreachable from the shell in this environment (the proxy returns
# "GitHub access is not enabled for this session"); GitHub is only available
# through the MCP tools, which a hook cannot call. So the reason below is phrased
# as a checklist to confirm, not an accusation — "already open and merged" is a
# perfectly good answer to it. Anything curl-based here fails silently and is
# worse than nothing.
#
# Every failure path exits 0. A wrap-up reminder that breaks the session is worse
# than one that misses a wrap-up.
set -uo pipefail

input=$(cat 2>/dev/null)
if [[ -n "$input" ]]; then
  active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)
  [[ "$active" == "true" ]] && exit 0
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" 2>/dev/null || exit 0
[[ -n "$(git remote 2>/dev/null)" ]] || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$branch" in ''|main|master|development|HEAD) exit 0 ;; esac

# Committed and pushed, or there is nothing to wrap up yet. The global
# stop-hook-git-check.sh already nags about uncommitted work; this hook is the
# stage after that one is satisfied, so it stays quiet rather than duplicating it.
git diff --quiet 2>/dev/null || exit 0
git diff --cached --quiet 2>/dev/null || exit 0
[[ -z "$(git ls-files --others --exclude-standard 2>/dev/null)" ]] || exit 0

head=$(git rev-parse HEAD 2>/dev/null) || exit 0
pushed=$(git rev-parse --verify -q "origin/$branch" 2>/dev/null) || exit 0
[[ "$head" == "$pushed" ]] || exit 0

gitdir=$(git rev-parse --git-dir 2>/dev/null) || exit 0

# `development` is the base a feature PR targets — CLAUDE.md §Branching & CI.
#
# NEVER FALL BACK TO `main`. A cloud session clones the repo's default branch,
# which is still `main` (docs/ENVIRONMENTS.md §The last piece — a step the owner
# has not taken yet, so this path goes dormant rather than wrong when they do),
# so `origin/development` does not exist until something fetches it. Measuring
# against `main` compares a feature branch to *production*, where every
# unreleased commit counts, so an already-merged branch reads as a wrap-up
# waiting to happen — and the base is interpolated into a sentence asserting
# main is the wrong answer, rendering "Open a PR against `main` (NOT main)".
#
# DO NOT TRUST `git rev-list --count` HERE TO SANITY-CHECK ANY OF THIS. The clone
# is shallow (`.git/shallow`), so history shared with the base is truncated and
# the count is wrong in whichever direction the truncation falls — it read 128
# against a true 8 in the container, and under-counts just as readily in a
# fixture. It looks authoritative and is not. The tree compare below is the real
# decision; the count is only ever a number in a sentence.
#
# The refspec is explicit because `git fetch origin development` writes only
# FETCH_HEAD on a --single-branch clone: the ref stays missing and the fetch
# looks like it worked.
#
# One failure is silent by design: an offline clone never resolves a base and
# this check simply does not run. "Exits 0" and "everything is fine" look
# identical from outside.
base=origin/development
fetchfail="$gitdir/wrapup-fetch-unreachable"
refresh_base () {
  [[ -f "$fetchfail" ]] && return 1          # a hanging remote costs 5s once per clone, not per turn
  timeout --kill-after=2 5 git fetch --quiet origin \
    "+refs/heads/development:refs/remotes/origin/development" >/dev/null 2>&1 && return 0
  : >"$fetchfail" 2>/dev/null
  return 1
}

git rev-parse --verify -q "$base" >/dev/null 2>&1 || refresh_base
git rev-parse --verify -q "$base" >/dev/null 2>&1 || exit 0

# ANCESTRY IS NOT CONTENT, and this repo squash-merges every feature PR.
#
# A squash merge replays the branch's content onto the base as a NEW commit with
# a new sha, so the original commit is never an ancestor of the base and
# `rev-list --count` keeps reporting "1 ahead" for ever after the PR has merged.
# Without this guard the hook fires at the end of every successful session —
# demanding a PR that is already merged — which is precisely how a warning
# teaches people to ignore it.
#
# Compare trees instead: identical trees mean the work landed, whatever the shas
# say. Note this is the SECOND appearance of this bug in one session; the first
# was handoff-landed-check.sh comparing the working tree against the base tip.
# Any "has this landed?" test written against sha ancestry alone is wrong here.
git diff --quiet "$base" HEAD 2>/dev/null && exit 0

# Keyed on the UNIT OF WORK — branch plus fork point — and NOT on the HEAD sha.
#
# The sha version was the right idea measured against the wrong thing. It bounds
# repeats within one state, but a multi-agent build is a sequence of states: the
# builder commits, the reviewer's findings get committed, a CI fix lands, a
# fold-in lands. Every one is a new sha, so every one re-armed the reminder, and
# a session that was pushing correctly the whole time got told to open a PR four
# or five times before it had anything to open one for. Measured 2026-08-12: a
# single PD-104 run fired it eight times.
#
# That is the failure mode this hook's own header warns about — "anything less
# specific than 'this looks like a wrap-up' becomes noise that gets ignored" —
# arriving through the marker rather than through the conditions.
#
# Branch + merge-base is the stable identity of one branch's worth of work. It
# re-arms exactly when it should and no more often:
#   - a different branch                     -> different key
#   - the branch restarted onto a new base
#     after its PR merged (CLAUDE.md's
#     `checkout -B <branch> origin/development`) -> different fork point, new key
#   - four more commits on the same branch   -> SAME key, silence
#
# The fork point is stable while others merge into the base, because it is the
# point the branches diverged rather than either tip.
#
# The catch is not weakened: a session that pushes and stops still gets exactly
# one reminder, which is the whole requirement — `decision: block` puts it in the
# model's context, and once there it does not need repeating.
mergebase=$(git merge-base "$base" HEAD 2>/dev/null) || mergebase="$head"
key="$branch@$mergebase"
marker="$gitdir/wrapup-reminded"
[[ -f "$marker" && "$(cat "$marker" 2>/dev/null)" == "$key" ]] && exit 0

# ABOUT TO SPEAK — and only now is a network call worth its latency. A ref that
# is merely STALE says the work is unmerged long after it landed, which is the
# same false alarm by a different route, so re-read the base before accusing
# anyone. Ordering matters: this sits below the marker check so a hanging remote
# costs one fetch per wrap-up state rather than one per turn.
if refresh_base; then
  git diff --quiet "$base" HEAD 2>/dev/null && exit 0
fi

ahead=$(git rev-list --count "$base..HEAD" 2>/dev/null) || exit 0
[[ "$ahead" =~ ^[0-9]+$ ]] || exit 0
[[ "$ahead" -gt 0 ]] || exit 0
printf '%s' "$key" >"$marker" 2>/dev/null

jq -cn --arg b "$branch" --arg base "${base#origin/}" --arg n "$ahead" '
{
  decision: "block",
  reason: ("Wrap-up check — \($b) is pushed, clean, and \($n) commit(s) ahead of \($base).\n\nTwo standing instructions from the product owner apply before this session ends:\n\n1. Open a PR against `\($base)` (NOT main) and drive it to merged. Committed and pushed is not shipped. If it genuinely cannot merge, say so plainly as the last thing in the session, with the reason.\n2. Send the push notification `Done ; ) <name of the session>` — the name being what the session was about, so it identifies itself when read on a phone hours later. One at the end, not per milestone.\n\nIf both are already done, or this is not the wrap-up, say which in one line and stop. This fires once per pushed commit, so it will not ask again for this one."),
  systemMessage: ("Wrap-up check on \($b): \($n) commit(s) ahead of \($base), pushed and clean. Reminding the session to open the PR and send the done notification.")
}'
