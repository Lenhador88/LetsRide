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
#   - it has not already fired for this exact HEAD sha
#
# The last one is what bounds it. The marker lives in .git/ (per-clone, never
# committed) and holds the sha it last fired on, so a wrap-up state is announced
# once rather than on every turn that follows it. A new commit is a new sha and
# legitimately re-arms it.
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

# `development` is the base a feature PR targets — CLAUDE.md §Branching & CI.
# Fall back to main only when this clone has never fetched development, in which
# case a stale ref costs a false negative and never a wrong instruction.
base=origin/development
git rev-parse --verify -q "$base" >/dev/null 2>&1 || base=origin/main
git rev-parse --verify -q "$base" >/dev/null 2>&1 || exit 0

ahead=$(git rev-list --count "$base..HEAD" 2>/dev/null) || exit 0
[[ "$ahead" =~ ^[0-9]+$ ]] || exit 0
[[ "$ahead" -gt 0 ]] || exit 0

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

marker="$(git rev-parse --git-dir 2>/dev/null)/wrapup-reminded" || exit 0
[[ -f "$marker" && "$(cat "$marker" 2>/dev/null)" == "$head" ]] && exit 0
printf '%s' "$head" >"$marker" 2>/dev/null

jq -cn --arg b "$branch" --arg base "${base#origin/}" --arg n "$ahead" '
{
  decision: "block",
  reason: ("Wrap-up check — \($b) is pushed, clean, and \($n) commit(s) ahead of \($base).\n\nTwo standing instructions from the product owner apply before this session ends:\n\n1. Open a PR against `\($base)` (NOT main) and drive it to merged. Committed and pushed is not shipped. If it genuinely cannot merge, say so plainly as the last thing in the session, with the reason.\n2. Send the push notification `Done ; ) <name of the session>` — the name being what the session was about, so it identifies itself when read on a phone hours later. One at the end, not per milestone.\n\nIf both are already done, or this is not the wrap-up, say which in one line and stop. This fires once per pushed commit, so it will not ask again for this one."),
  systemMessage: ("Wrap-up check on \($b): \($n) commit(s) ahead of \($base), pushed and clean. Reminding the session to open the PR and send the done notification.")
}'
