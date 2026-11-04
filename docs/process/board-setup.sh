#!/usr/bin/env bash
# Create the LifeOS Scrum board (GitHub Projects v2) and add the Sprint 1 issues.
# Needs the `project` token scope, which needs an interactive browser login once:
#   gh auth refresh -s project
# Idempotent enough for a first run; re-running creates a second board, so check `gh project list` first.
set -euo pipefail

OWNER="${OWNER:-jackaI1}"
REPO="${REPO:-jackaI1/lifeos-open}"
TITLE="${TITLE:-LifeOS Scrum board}"

url=$(gh project create --owner "$OWNER" --title "$TITLE" --format json --jq '.url')
number=$(gh project list --owner "$OWNER" --format json --jq ".projects[] | select(.title==\"$TITLE\") | .number" | head -n1)
echo "Created $url (project $number)"

gh project field-create "$number" --owner "$OWNER" --name "Stage" \
  --data-type SINGLE_SELECT --single-select-options "Backlog,Sprint,In progress,Review,Done"
gh project field-create "$number" --owner "$OWNER" --name "Points" --data-type NUMBER
gh project link "$number" --owner "$OWNER" --repo "$REPO"

# Add every open Sprint 1 issue (set its Stage to "Sprint" in the board view).
for n in $(gh issue list -R "$REPO" --milestone "Sprint 1" --state open --json number --jq '.[].number'); do
  gh project item-add "$number" --owner "$OWNER" --url "https://github.com/$REPO/issues/$n"
done

cat <<MSG
Remaining manual steps in the board settings (Workflows):
  - Auto-add items from $REPO
  - Item closed -> set Stage to Done; Pull request merged -> set Stage to Done
  - Group the board by Stage, filter by milestone:"Sprint 1"
MSG
