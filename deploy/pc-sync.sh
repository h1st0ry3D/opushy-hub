#!/bin/bash
# Move sessions between the desktop tracker and the hub.
#
#   pc-sync.sh                both directions
#   pc-sync.sh --upload       desktop to hub
#   pc-sync.sh --download     hub to desktop
#   pc-sync.sh --dry-run      what each side holds, writes nothing
#   pc-sync.sh --wait 60      how long to wait for the hub to answer (default 300)
#
# Configuration lives in ~/.config/opushy/sync.env, or in the environment:
#
#   OPSHUB_URL=http://192.168.0.9:8080
#   OPSHUB_TOKEN=<the contents of /volume1/docker/opushy-hub/data/token>
set -euo pipefail

HELPER="${OPSHUB_HELPER:-$HOME/github/opushy/state/opushy-state.py}"
PY="${OPSHUB_PYTHON:-/usr/bin/python3}"
CONFIG="${OPSHUB_CONFIG:-$HOME/.config/opushy/sync.env}"

# The file is read key by key so that an environment variable already set wins
# over it. Sourcing it instead would let the empty OPSHUB_TOKEN= placeholder
# overwrite a real one, which is the wrong precedence for a script that also
# needs to be testable.
load_config() {
  local line key value
  [ -f "$CONFIG" ] || return 0
  while IFS='=' read -r key value; do
    case "$key" in
      OPSHUB_URL | OPSHUB_TOKEN | OPSHUB_HELPER | OPSHUB_PYTHON) ;;
      *) continue ;;
    esac
    value="${value%%#*}"
    value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -n "$value" ] || continue
    eval "local current=\"\${$key:-}\""
    [ -n "$current" ] && continue
    export "$key=$value"
  done <"$CONFIG"
}

load_config
HUB="${OPSHUB_URL:-http://192.168.0.9:8080}"
TOKEN="${OPSHUB_TOKEN:-}"

mode=both
dry=0
wait_seconds="${OPSHUB_WAIT:-300}"
for arg in "$@"; do
  case "$arg" in
    --upload) mode=upload ;;
    --download) mode=download ;;
    --dry-run) dry=1 ;;
    --wait)
      shift || true
      wait_seconds="${1:-300}"
      ;;
    -h | --help)
      # the comment block under the shebang, however long it grows
      awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
      exit 0
      ;;
    [0-9]*) wait_seconds="$arg" ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

say() { printf '%s\n' "$*"; }

# Two cases are not errors: an unconfigured token and a hub that is not up yet.
# This runs at login, when the NAS may still be booting, and a failed unit every
# boot for something this small is worse than one line in the journal.
skip() {
  say "$*"
  exit 0
}

[ -x "$PY" ] || skip "no python at $PY"
[ -f "$HELPER" ] || skip "no helper at $HELPER, is the plugin checked out?"
[ -n "$TOKEN" ] || skip "no token. Put OPSHUB_TOKEN in $CONFIG"

helper() { "$PY" -I -S -B "$HELPER" "$@"; }

# A tracker document in, a merge request out. The hub's export and the local
# document both carry `history`, so one filter serves both directions.
batch() {
  "$PY" -c '
import json, sys

doc = json.load(sys.stdin)
entries = doc.get("history") or []
print(json.dumps({
    "device": "pc",
    "sessions": [{"time": e["time"], "reps": e["reps"]} for e in entries],
}))
'
}

# A document in, one line out.
describe() {
  "$PY" -c '
import json, sys

doc = json.load(sys.stdin)
print("%d sessions, %d days, record %d" % (
    len(doc.get("history") or []),
    doc.get("trainingDays") or 0,
    doc.get("maxPushups") or 0,
))
'
}

reachable() {
  curl -fsS --connect-timeout 5 --max-time 10 "$HUB/api/health" >/dev/null 2>&1
}

api() {
  # A 401 is not going to fix itself, so only connection failures and the
  # transient status codes are retried. --retry-all-errors would retry a bad
  # token four times and bury the message.
  curl -fsS --retry 3 --retry-delay 2 --retry-connrefused \
    --connect-timeout 5 --max-time 60 \
    -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' "$@"
}

fail() {
  say "$*" >&2
  exit 1
}

# A POST reply in, one line out. Kept apart from the request so a refused call
# reports the status code rather than a JSON traceback on an empty body.
uploaded() {
  "$PY" -c '
import json, sys

reply = json.load(sys.stdin)
print("%d new on the hub, %d already there" % (reply["added"], reply["skipped"]))
'
}

upload() {
  local document request reply
  document="$(helper state read || true)"
  [ -n "$document" ] || document='{"history":[]}'
  request="$(printf '%s' "$document" | batch)"
  if ! reply="$(api -X POST --data "$request" "$HUB/api/sessions")"; then
    fail "the hub refused the upload. Check OPSHUB_TOKEN in $CONFIG"
  fi
  say "upload   $(printf '%s' "$reply" | uploaded)"
}

download() {
  local exported request merged
  if ! exported="$(api "$HUB/api/export")"; then
    fail "the hub refused the download. Check OPSHUB_TOKEN in $CONFIG"
  fi
  request="$(printf '%s' "$exported" | batch)"
  # The helper takes the lock and only writes when something was missing, so
  # running this against a hub that is behind is the same as running it twice.
  merged="$(printf '%s' "$request" | helper state merge)"
  say "download $(printf '%s' "$merged" | describe)"
}

# At login the NAS may still be booting and the link may not be up, so one probe
# is not enough. The unit runs this with --wait 300, which covers a NAS that
# takes a couple of minutes without leaving a failed unit when it never appears.
wait_for_hub() {
  local deadline=$((SECONDS + wait_seconds))
  reachable && return 0
  [ "$wait_seconds" -gt 0 ] || return 1
  say "hub not up yet at $HUB, waiting up to ${wait_seconds}s"
  while [ "$SECONDS" -lt "$deadline" ]; do
    sleep 5
    if reachable; then
      say "hub answered after ${SECONDS}s"
      return 0
    fi
  done
  return 1
}

if ! wait_for_hub; then
  skip "hub still not reachable at $HUB after ${wait_seconds}s, nothing synced"
fi

if [ "$dry" = 1 ]; then
  say "hub      $(api "$HUB/api/export" | describe)"
  local_document="$(helper state read || true)"
  [ -n "$local_document" ] || local_document='{"history":[]}'
  say "desktop  $(printf '%s' "$local_document" | describe)"
  case "$mode" in
    both) say "would run: upload, then download" ;;
    upload) say "would run: upload" ;;
    download) say "would run: download" ;;
  esac
  exit 0
fi

case "$mode" in
  both)
    upload
    download
    ;;
  upload) upload ;;
  download) download ;;
esac
