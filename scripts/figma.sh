#!/usr/bin/env bash
#
# Authenticated access to the Figma REST API.
#
# The token lives in .env.local (gitignored) or the FIGMA_ACCESS_TOKEN environment
# variable, which takes precedence. Every subcommand is a thin wrapper over `get`;
# reach for `get` directly whenever you need an endpoint that isn't covered here.
#
#   scripts/figma.sh me
#   scripts/figma.sh get "/v1/files/$FIGMA_FILE_KEY?depth=2"
#   scripts/figma.sh nodes "1:23,4:56"
#   scripts/figma.sh images "1:23,4:56" svg
#   scripts/figma.sh components
#
# Output is raw JSON on stdout — pipe it to jq. Diagnostics go to stderr, so
# `scripts/figma.sh nodes 1:23 | jq .` stays clean.
#
# See docs/figma-api.md for endpoints, scopes and rate limits.

set -euo pipefail

API="https://api.figma.com"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Environment wins over .env.local so CI and one-off overrides work without edits.
if [[ -f "$ROOT/.env.local" ]]; then
  while IFS='=' read -r key value; do
    [[ $key =~ ^FIGMA_[A-Z_]+$ ]] || continue
    [[ -n ${!key:-} ]] || printf -v "$key" '%s' "$value"
    export "${key?}"
  done < <(grep -E '^FIGMA_[A-Z_]+=' "$ROOT/.env.local" || true)
fi

: "${FIGMA_FILE_KEY:=gDoteM1ow1AZpSEGSNhpc7}"

if [[ -z ${FIGMA_ACCESS_TOKEN:-} ]]; then
  echo "figma.sh: no FIGMA_ACCESS_TOKEN. Set it in .env.local (see .env.local.example)." >&2
  exit 1
fi

# Curl once, then map Figma's failure modes onto messages that say what to do next.
# A bare "403" is ambiguous here: it means missing scope, wrong plan, or no file
# access, and each has a different fix.
request() {
  local path="$1" body status
  body="$(mktemp)"
  trap 'rm -f "$body"' RETURN

  status="$(curl -sS -o "$body" -w '%{http_code}' \
    -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
    "$API$path")"

  case "$status" in
    200) cat "$body"; return 0 ;;
    403)
      echo "figma.sh: 403 on $path" >&2
      echo "  Token lacks the scope for this endpoint, the plan does not include it" >&2
      echo "  (Variables REST is Enterprise-only), or the token cannot see this file." >&2
      ;;
    404) echo "figma.sh: 404 on $path — check the file key and node ids." >&2 ;;
    429)
      echo "figma.sh: 429 rate limited on $path. Back off before retrying;" >&2
      echo "  /v1/images is the most expensive endpoint. Batch ids instead of looping." >&2
      ;;
    *) echo "figma.sh: HTTP $status on $path" >&2 ;;
  esac

  cat "$body" >&2
  return 1
}

# Figma takes node ids as 1:23 but URLs them as 1%3A23 in some contexts; the query
# form below accepts the colon directly, so ids pass through unchanged.
cmd="${1:-help}"
shift || true

case "$cmd" in
  me)
    request "/v1/me"
    ;;
  get)
    [[ $# -ge 1 ]] || { echo "usage: figma.sh get <path>" >&2; exit 1; }
    request "$1"
    ;;
  file)
    request "/v1/files/$FIGMA_FILE_KEY?depth=${1:-2}"
    ;;
  nodes)
    [[ $# -ge 1 ]] || { echo "usage: figma.sh nodes <id[,id...]> [depth]" >&2; exit 1; }
    request "/v1/files/$FIGMA_FILE_KEY/nodes?ids=$1${2:+&depth=$2}"
    ;;
  images)
    [[ $# -ge 1 ]] || { echo "usage: figma.sh images <id[,id...]> [format] [scale]" >&2; exit 1; }
    request "/v1/images/$FIGMA_FILE_KEY?ids=$1&format=${2:-svg}&scale=${3:-1}"
    ;;
  components)
    request "/v1/files/$FIGMA_FILE_KEY/components"
    ;;
  component-sets)
    request "/v1/files/$FIGMA_FILE_KEY/component_sets"
    ;;
  styles)
    request "/v1/files/$FIGMA_FILE_KEY/styles"
    ;;
  variables)
    request "/v1/files/$FIGMA_FILE_KEY/variables/local"
    ;;
  help|--help|-h)
    awk 'NR>2 && /^#/ { sub(/^# ?/, ""); print; next } NR>2 { exit }' "${BASH_SOURCE[0]}"
    ;;
  *)
    echo "figma.sh: unknown command '$cmd'. Try 'figma.sh help'." >&2
    exit 1
    ;;
esac
