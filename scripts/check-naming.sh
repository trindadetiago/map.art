#!/usr/bin/env bash
# Enforces snake_case for component/UI files under apps/web/.
# Next.js routing conventions (page.tsx, layout.tsx, route.ts, ...) and Next
# auto-generated files (next.config.ts, next-env.d.ts) are exempt.
#
# Invoked via lint-staged in package.json; staged file paths come in as $@.
set -euo pipefail

EXEMPT='^(page|layout|route|loading|error|not-found|template|default|global-error)\.tsx?$|^next\.config\.ts$|^next-env\.d\.ts$'
SNAKE='^[a-z][a-z0-9]*(_[a-z0-9]+)*\.tsx?$'

failures=()
for f in "$@"; do
  base=$(basename "$f")
  if [[ "$base" =~ $EXEMPT ]]; then
    continue
  fi
  if [[ ! "$base" =~ $SNAKE ]]; then
    failures+=("$f")
  fi
done

if (( ${#failures[@]} > 0 )); then
  printf 'error: component/UI files must be snake_case (e.g. project_workspace.tsx, tile_grid_3x3.tsx):\n' >&2
  for f in "${failures[@]}"; do
    printf '  %s\n' "$f" >&2
  done
  printf '\nRename with `git mv` so history is preserved, then re-stage.\n' >&2
  exit 1
fi
