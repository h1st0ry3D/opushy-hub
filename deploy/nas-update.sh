#!/bin/bash
# Update the hub on the NAS from a commit on GitHub.
#
#   ./update.sh              newest commit on main
#   ./update.sh <sha>        one specific commit, full or short
#   ./update.sh --dry-run    download and unpack, then stop before the swap
#
# Run it as your DSM user from the project folder. Docker calls go through sudo,
# so you will be asked for the password once.
set -euo pipefail

REPO="h1st0ry3D/opushy-hub"
BRANCH="main"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHA_FILE="$ROOT/deployed-sha"
DOCKER="${DOCKER:-sudo docker}"

dry_run=0
target=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) target="$arg" ;;
  esac
done

cd "$ROOT"
if [ ! -d data ] || [ ! -f docker-compose.yaml ]; then
  echo "run this from the project folder, next to docker-compose.yaml and data/" >&2
  exit 1
fi

# Read the first line of a stream without `| head`, which closes the pipe early
# and, with pipefail, takes the script down on the producer's SIGPIPE.
first_line() {
  local line
  while IFS= read -r line; do
    printf '%s' "$line"
    return 0
  done
  return 1
}

newest_commit() {
  local line
  while IFS= read -r line; do
    case "$line" in
      *Grit::Commit/*)
        line="${line#*Grit::Commit/}"
        printf '%s' "${line%%<*}"
        return 0
        ;;
    esac
  done < <(curl -fsSL "https://github.com/${REPO}/commits/${BRANCH}.atom")
  return 1
}

# ---- which commit ----
if [ -n "$target" ]; then
  sha="$target"
  echo "commit  $sha (from the argument)"
else
  echo "commit  resolving the newest on $BRANCH"
  # The commit feed needs no API token and no rate limit. Its first entry is the
  # newest commit.
  if ! sha="$(newest_commit)" || [ -z "$sha" ]; then
    echo "could not resolve a commit, pass the sha instead" >&2
    exit 1
  fi
  echo "commit  $sha (newest on $BRANCH)"
fi

case "$sha" in
  "" | *[!0-9a-f]*) echo "not a commit sha: $sha" >&2; exit 1 ;;
esac

if [ -f "$SHA_FILE" ] && [ "$(cat "$SHA_FILE")" = "$sha" ]; then
  echo "already running $sha, nothing to do"
  echo "delete deployed-sha to rebuild it anyway"
  exit 0
fi

# ---- fetch and unpack ----
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "fetch   $REPO at ${sha:0:12}"
curl -fsSL -o "$work/src.tar.gz" "https://github.com/${REPO}/archive/${sha}.tar.gz"

top="$(first_line < <(tar -tzf "$work/src.tar.gz"))"
case "$top" in
  */) ;;
  *) echo "unexpected archive layout, top entry is $top" >&2; exit 1 ;;
esac

rm -rf "$ROOT/src.new"
mkdir -p "$ROOT/src.new"
# One level of the archive is the commit folder. Stripping it is what makes the
# tree land in src/ itself instead of src/opushy-hub-<sha>/.
tar -xzf "$work/src.tar.gz" -C "$ROOT/src.new" --strip-components=1

# A truncated download or a commit without the pieces the image copies fails
# here, in a second, instead of during a two minute build.
for marker in Dockerfile tsconfig.json src/server.ts web/index.html; do
  if [ ! -e "$ROOT/src.new/$marker" ]; then
    echo "archive is missing $marker, not deploying" >&2
    rm -rf "$ROOT/src.new"
    exit 1
  fi
done
if ! grep -q 'bun build web/index.html' "$ROOT/src.new/Dockerfile"; then
  echo "Dockerfile has no client build step, not deploying" >&2
  rm -rf "$ROOT/src.new"
  exit 1
fi
echo "unpack  src.new looks complete"

if [ "$dry_run" = 1 ]; then
  echo "dry run, src untouched. remove src.new when you are done looking"
  exit 0
fi

# ---- swap ----
rm -rf "$ROOT/src.old"
if [ -d "$ROOT/src" ]; then
  mv "$ROOT/src" "$ROOT/src.old"
fi
mv "$ROOT/src.new" "$ROOT/src"

# ---- build and start ----
echo "build   docker compose up -d --build"
$DOCKER compose up -d --build

echo -n "wait    health"
status=""
for _ in $(seq 1 30); do
  status="$($DOCKER inspect --format '{{.State.Health.Status}}' opushy-hub 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then break; fi
  echo -n "."
  sleep 2
done
echo

page="$(curl -s -o /dev/null -w '%{http_code} %{size_download}' http://127.0.0.1:8080/ || true)"
[ -n "$page" ] || page="000 0"
echo "check   health=$status page=$page"

if [ "$status" != "healthy" ] || [ "${page##* }" -lt 100 ]; then
  echo
  echo "that does not look right. The log, then the way back:" >&2
  echo "  $DOCKER compose logs --tail 40" >&2
  echo "  rm -rf src && mv src.old src && $DOCKER compose up -d --build" >&2
  exit 1
fi

echo "$sha" > "$SHA_FILE"
echo
echo "deployed ${sha:0:12}, recorded in deployed-sha"
echo "drop the old tree when you are happy: rm -rf src.old"
