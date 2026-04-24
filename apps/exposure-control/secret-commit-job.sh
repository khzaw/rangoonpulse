#!/bin/sh
set -eu

operation="${OPERATION:-upsert}"
branch="${GITHUB_BRANCH:-master}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
token="${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
secret_file="${SECRET_FILE_PATH:?SECRET_FILE_PATH is required}"
kustomization_file="${KUSTOMIZATION_FILE_PATH:-}"
commit_message="${COMMIT_MESSAGE:-secrets: update managed secret}"
author_name="${GIT_AUTHOR_NAME:-rangoonpulse controlpanel}"
author_email="${GIT_AUTHOR_EMAIL:-controlpanel@khzaw.dev}"
recipient="${SOPS_AGE_RECIPIENT:-}"

apk add --no-cache git sops >/dev/null

workdir="/tmp/secret-editor"
rm -rf "$workdir"
git clone --depth 1 --branch "$branch" "https://x-access-token:${token}@github.com/${repo}.git" "$workdir" >/dev/null 2>&1

cd "$workdir"
git config user.name "$author_name"
git config user.email "$author_email"

if [ "$operation" = "delete" ]; then
  git rm -f --ignore-unmatch "$secret_file" >/dev/null
else
  if [ -z "$recipient" ]; then
    echo "SOPS_AGE_RECIPIENT is required for upsert operations" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$secret_file")"
  sops --encrypt --age "$recipient" --encrypted-regex '^(data|stringData)$' /payload/secret.yaml > "$secret_file"
fi

if [ -n "$kustomization_file" ] && [ -f /payload/kustomization.yaml ]; then
  mkdir -p "$(dirname "$kustomization_file")"
  cp /payload/kustomization.yaml "$kustomization_file"
fi

if [ "$operation" != "delete" ]; then
  git add "$secret_file"
fi
if [ -n "$kustomization_file" ]; then
  git add "$kustomization_file"
fi

if git diff --cached --quiet; then
  echo "No secret changes to commit."
  exit 0
fi

git commit -m "$commit_message" >/dev/null
git push origin "$branch" >/dev/null 2>&1
echo "Committed and pushed secret change to ${repo}@${branch}."
