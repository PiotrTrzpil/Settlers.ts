---
name: commit
description: Stage changes and create a git commit. Options: "all" (stage everything), "push" (push after commit), or both. Example: /commit, /commit all, /commit push, /commit all push
argument-hint: [all] [push]
---

Create a git commit for the current changes.

## Parse Options from $ARGUMENTS

- **`all`** present → stage ALL outstanding changes (not just files you worked on). Use `git add -A`.
- **`push`** present → push to remote after a successful commit.
- No arguments → only stage files related to current work session (smart staging).

## Steps

1. Run `git status` (without -uall), `git diff --staged`, `git diff`, and `git log --oneline -5` in parallel (or in some way in one command but preserving output of all) to understand:
   - What files are changed (staged and unstaged)
   - The nature of the changes
   - Recent commit message style

2. Stage files:
   - **If `all` option**: `git add -A` (but warn if .env or credential files would be included)
   - **Otherwise**: Stage only files related to the current work. If there are already staged changes, respect that staging. Prefer staging specific files by name.
   - NEVER stage files that likely contain secrets (.env, credentials.json, etc.) — warn the user instead.

3. Draft the commit message:
   - Analyze the staged diff to write an appropriate message
   - Use conventional commit format: `type(scope): description`
   - Types: feat, fix, refactor, test, chore, docs, style, perf
   - Keep the first line under 72 characters
   - Add a body for non-trivial changes (blank line after subject)
   - Focus on "why" not "what"

4. Create the commit using a HEREDOC for the message:
   ```
   git commit -m "$(cat <<'EOF'
   type(scope): description

   Optional body explaining why.

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```

5. Run `git status` after commit to verify success.

6. **If `push` option**: Run `git push`. If no upstream is set, use `git push -u origin HEAD`.

## Rules

- NEVER amend existing commits unless explicitly asked
- NEVER push unless the `push` option is present in $ARGUMENTS
- NEVER use --no-verify or skip hooks
- NEVER update git config
- If pre-commit hook fails, fix the issue and create a NEW commit
- If there are no changes to commit, say so and stop
