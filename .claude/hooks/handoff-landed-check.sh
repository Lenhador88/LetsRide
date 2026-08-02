#!/usr/bin/env bash
# Stop hook — warn when docs/HANDOFF.md on this branch has not reached main.
#
# Why this exists: a session rewrote the handoff, opened a PR, said it would
# merge once CI went green, and then wrapped up without merging. Everything was
# committed and pushed, so the existing git-check hook was satisfied — but
# `main` kept telling the next session that a shipped epic was half-finished.
#
# The handoff is the one file whose staleness actively misleads, and it is
# almost always edited at wrap-up. So "you changed the handoff and it is not on
# main" is a precise signal for this failure with very little noise: it stays
# silent through normal feature work that does not touch the file.
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
case "$branch" in ''|main|master|HEAD) exit 0 ;; esac

# origin/main as last fetched. Deliberately no network call: a Stop hook must
# not hang the session, and a stale ref only costs a false negative.
git rev-parse --verify -q origin/main >/dev/null 2>&1 || exit 0

# Working tree vs origin/main, not origin/main..HEAD: the latter only sees
# commits, so an edited-but-uncommitted handoff would slip through.
git diff --quiet origin/main -- docs/HANDOFF.md 2>/dev/null && exit 0

jq -cn --arg b "$branch" '{
  systemMessage: ("docs/HANDOFF.md differs from origin/main on branch \($b).\nIf you rewrote the handoff, it is not shipped until it is merged — committed and pushed is not enough. Merge it, or say why it is being left. An unmerged handoff is how main once told a new session that a finished epic was half-done.")
}'
