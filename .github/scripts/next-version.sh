#!/bin/sh
# Prints "version=X.Y.Z" for the next release, from the Conventional Commits since the last v* tag.
# Prints nothing when only docs, chores, CI or tests changed.
set -eu

last="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
subjects="$(git log --format=%s "${last:+$last..}HEAD")"
bodies="$(git log --format=%b "${last:+$last..}HEAD")"
[ -n "$subjects" ] || exit 0

current="${last#v}"
current="${current:-0.0.0}"
major="${current%%.*}"
rest="${current#*.}"
minor="${rest%%.*}"
patch="${rest#*.}"

has() { printf '%s\n' "$subjects" | grep -Eq "^($1)(\([^)]*\))?:"; }
if printf '%s\n' "$subjects" | grep -Eq '^[a-z]+(\([^)]*\))?!:' || printf '%s\n' "$bodies" | grep -q '^BREAKING CHANGE'; then
  bump=major
elif has feat; then
  bump=minor
elif has 'fix|perf|refactor|build|revert'; then
  bump=patch
else
  exit 0
fi
# Semver lets 0.x break in a minor release, so stay below 1.0 until that's a deliberate step.
[ "$bump" = major ] && [ "$major" = 0 ] && bump=minor

case "$bump" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
esac
echo "version=$major.$minor.$patch"
