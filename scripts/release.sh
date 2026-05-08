#!/usr/bin/env bash
set -e

VERSION="$1"

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 v<major>.<minor>.<patch>  (e.g. v1.2.0)"
  exit 1
fi

BARE="${VERSION#v}"

# Ensure working tree is clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree has uncommitted changes. Commit or stash them first."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Update package.json + package-lock.json atomically via npm
npm version "$BARE" --no-git-tag-version

echo "Updated package.json and package-lock.json to $BARE"

# Commit and tag
git add package.json package-lock.json
git commit -m "chore: release $VERSION"
git tag "$VERSION"

echo "Created commit and tag $VERSION"

# Push
git push origin HEAD
git push origin "$VERSION"

echo "Pushed. GitHub Actions will build and publish the release."
