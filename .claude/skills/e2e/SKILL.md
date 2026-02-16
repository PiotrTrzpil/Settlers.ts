---
name: e2e
description: Lint and run Playwright e2e tests. Smoke tests run first; full suite only if smoke passes. Failures are investigated immediately while remaining tests continue.
argument-hint: [smoke|full|project-name]
---

Run end-to-end Playwright tests with smart sequencing.

## Parse Options from $ARGUMENTS

- **No arguments** or **`full`** → run smoke first, then remaining projects (default + slow) if smoke passes.
- **`smoke`** → run only smoke tests.
- **Any other value** → pass as `--project=<value>` (e.g., `assets`, `visual`, `slow`).

## Steps

### 1. Lint first

Run `pnpm lint` and wait for it to complete. If lint fails, report about it, then fix if the issues are relatively small, and continue.

### 2. Run smoke tests in background

```sh
npx playwright test --project=smoke --reporter=list 2>&1 | tee /tmp/e2e-smoke.log &
```

Poll `/tmp/e2e-smoke.log` every 10 seconds using `tail -20` until you see "passed" or "failed" in the output.

### 3. If smoke fails → investigate immediately

- Read the full log to find which test(s) failed
- Read the failing test file and the relevant source code
- Start investigating the root cause right away
- Do NOT proceed to the full suite

### 4. If smoke passes and full suite was requested → run remaining tests in background

```sh
npx playwright test --project=default --project=slow --reporter=list 2>&1 | tee /tmp/e2e-full.log &
```

Poll `/tmp/e2e-full.log` every 10 seconds. **As soon as any test failure appears** in the output (look for `✘` or `FAILED` or `Error` lines), start investigating it immediately — read the test, read the source, identify the issue — while the remaining tests continue running in background.

### 5. Report results

Once all tests complete, summarize:
- Total passed / failed / skipped
- For any failures: root cause analysis and suggested fix
- Note the WaitProfiler output if present (slowest waits)

## Rules

- ALWAYS lint before running tests (`pnpm lint`)
- NEVER use `--reporter=line` (suppresses stdout) — use `--reporter=list`
- NEVER use `waitForTimeout()` in test code — use `waitForFrames()`, `waitForReady()`, etc.
- Run tests in BACKGROUND and poll — never block waiting for completion
- Poll every 10 seconds with `tail -20 /tmp/e2e-*.log`
- Investigate failures IMMEDIATELY when spotted — don't wait for the full suite to finish
- Save any MCP screenshots to `.playwright-mcp/` (gitignored)
