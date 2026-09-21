#!/bin/sh
#
# Xcode Cloud's post-clone script: turns a bare clone of `main` into a project
# that can be archived, and refuses to hand xcodebuild a bundle that must not
# ship. docs/reference/native-shell.md §Xcode Cloud has the owner checklist and
# the environment variables; scripts/native/__tests__/xcode-cloud.test.mjs pins
# the order below.
#
# Apple runs this after cloning and before `xcodebuild`, for every action, from
# this directory — which is why it cd's to the repository first. The name and
# the location (beside App.xcodeproj) are Apple's, not ours.
#
# A bare clone cannot archive: App/App/public, App/App/capacitor.config.json and
# App/App/config.xml are Copy Bundle Resources inputs and all three are
# gitignored, and CapApp-SPM/Package.swift resolves the plugins out of
# node_modules. So every step is load-bearing, and any failure fails the build:
# a red build costs a rebuild, a quietly wrong one costs a store binary.

set -eu

fail() {
  printf 'error: ci_post_clone.sh: %s\n' "$*" >&2
  exit 1
}

step() {
  printf '\n==> %s\n' "$*"
}

# release:check reads what a bundle points at, not which branch built it — this
# is the only place that can. A manual build of any other branch would reach
# TestFlight carrying PROD's backend and unreleased code.
if [ "${CI_BRANCH:-}" != main ]; then
  fail "CI_BRANCH is '${CI_BRANCH:-<unset>}', not 'main'. This workflow bakes PROD's backend into a TestFlight build, so it archives main and nothing else — set the workflow's start condition to Branch Changes on main."
fi

[ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ] ||
  fail 'CI_PRIMARY_REPOSITORY_PATH is unset — Xcode Cloud always sets it, so this is not an Xcode Cloud build.'

# printenv rather than ${!name}: POSIX sh has no indirection, and printenv
# reads only EXPORTED variables, which is exactly what `next build` inherits.
for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_CANONICAL_ORIGIN; do
  [ -n "$(printenv "$name" || true)" ] ||
    fail "$name is not set. Add it to the workflow's Environment section — native-shell.md §Xcode Cloud lists each variable and where its PROD value lives."
done

cd "$CI_PRIMARY_REPOSITORY_PATH"

# The major comes from .nvmrc so this is not a fourth hand-kept copy of it
# (docs/ENVIRONMENTS.md names the three). node@<major> is keg-only in Homebrew,
# so it goes on PATH by hand — and is then checked rather than trusted, because
# the image may carry some other Node ahead of it.
node_major=$(cat .nvmrc)
case "$node_major" in
  '' | *[!0-9]*) fail ".nvmrc holds '$node_major'; this script needs a bare major such as 22." ;;
esac

step "brew install node@$node_major"
brew install "node@$node_major"
PATH="$(brew --prefix "node@$node_major")/bin:$PATH"
export PATH
node_version=$(node --version)
case "$node_version" in
  "v$node_major".*) ;;
  *) fail "node on PATH is $node_version after installing node@$node_major." ;;
esac

step 'npm ci'
npm ci

step 'npm run build:native'
npm run build:native

# --no: CI is TRUE on Xcode Cloud, and in CI npx installs a missing package
# without asking. If @capacitor/cli were absent (it is a devDependency), bare
# `npx cap` would fetch and run whatever the registry calls `cap`.
step 'npx --no cap sync ios'
npx --no cap sync ios

# `cap sync` rewrites CapApp-SPM/Package.swift. A rewrite HERE means the plugin
# graph being archived is not the one the repo records — and Xcode Cloud
# resolves packages from the committed Package.resolved with automatic
# resolution off, so the build either dies later on a SwiftPM error that names
# neither cause, or ships a plugin set nobody committed. A warning in an
# unattended log is read by nobody; the fix is one local command and a commit.
step 'checking that cap sync left ios/ as committed'
drift=$(git status --porcelain --untracked-files=all -- ios) ||
  fail 'git status failed, so whether cap sync rewrote a committed file is unknown.'
if [ -n "$drift" ]; then
  printf '%s\n' "$drift" >&2
  fail 'cap sync changed the files above. Run "npx cap sync ios" locally, commit the result, and merge it to main.'
fi

# After the sync, never before: it compares the copy the archive will contain
# (ios/App/App/public) against out/, byte for byte.
step 'npm run release:check'
npm run release:check
