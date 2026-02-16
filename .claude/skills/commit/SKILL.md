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
   - See if there are some files that perhaps should be gitignored and do it first in that case.

2. Stage files:
   - **If `all` option**: try briefly to decide if the work should be commited in 1 or 2 or 3 commits (if very big) - try to distinguish changes semantically, but best-effort.
   - **Otherwise**: Stage only files related to the current work. If there are already staged changes, respect that staging. Prefer staging specific files by name.

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
- If lint found warnings not related to your changes, also fix them if they are minor.
- If there are no changes to commit, say so and stop
