---
name: fix-bug
description: Investigate and fix a bug with deep root cause analysis. Identifies systemic improvements to prevent similar bugs across the codebase.
argument-hint: <bug description or symptoms>
---

You are fixing a bug with a focus on understanding root causes and preventing similar issues in the future.

ultrathink

**IMPORTANT: Do NOT use plan mode. Investigate and fix the bug directly.**
Also, you may be working concurrently with other workers or the user. do not stash anything, do not revert anything.

## Bug Description

$ARGUMENTS

## Process: Test First, Then Fix

### 1. Speed Explore (MINIMAL — under 1 minute, minimize context usage)

**Goal: Get just enough context to write a failing test. Do NOT fully understand the bug yet.**

- Read the bug description / stack trace / symptoms
- 1-2 targeted lookups max (`find_definition`, `search_graph`, or a single file read of the relevant lines)
- Form a rough hypothesis — it's OK to be wrong, the test will tell you
- **Do NOT read entire files. Do NOT deep-dive. Stop as soon as you can write a test.**

### 2. Write a Failing Test IMMEDIATELY

**Write a failing test before doing any more investigation.** This is non-negotiable.

1. Create an integration test in `tests/unit/integration/` that reproduces the bug (or as close as you can get)
2. Run it — confirm it fails
3. If it fails for the wrong reason or doesn't reproduce the bug, use the **timeline DB** to understand what happened:
   ```sh
   pnpm timeline -- --db <path> --entity <id>
   pnpm timeline -- --db <path> --cat <category> --test <id>
   pnpm timeline -- --db <path> --sql "SELECT ..."
   ```
4. Adjust the test and re-run. Iterate until you have a test that fails for the right reason.

**It's OK if the first test isn't perfect** — you can refine it after understanding more. What matters is having a concrete, runnable reproduction as early as possible. A wrong test that runs is more valuable than 20 minutes of exploration.

### 3. Deep Investigation (now with a test harness)

Now that you have a failing test, investigate properly:

- Use the timeline DB to trace exactly what happened during the test
- Use `trace_call_path`, `find_references`, `query_graph` to understand the code flow (see `docs/CODEBASE_MEMORY.md` for full graph workflow reference)
- Read targeted code sections as needed

**codebase-memory-mcp graph tools for investigation** (see `docs/CODEBASE_MEMORY.md`). **Run all applicable queries in parallel using multiple agents** — investigation speed matters, and these queries are independent. Batch them into 2-3 parallel agents to get results in seconds:
- `search_graph(name_pattern='.*symptom.*', label='Function')` — find the function where the symptom appears
- `trace_call_path(function_name='X', direction='inbound', depth=3, risk_labels=true)` — trace inbound callers with risk classification (CRITICAL/HIGH/MEDIUM/LOW by hop distance)
- `query_graph('MATCH (f)-[:USES_TYPE]->(t) WHERE f.name = "X" RETURN t.name, t.file LIMIT 20')` — check type dependencies (useful when bug may be type mismatch or missing field)
- `query_graph('MATCH (m:Module)-[:TESTS_FILE]->(t:Module) WHERE t.name CONTAINS "X" RETURN m.name LIMIT 10')` — find existing test files for the affected module
- `search_code(pattern='error message text')` — find string literals and error messages not in the graph

Ask yourself:
- **Why does this bug exist?** Missing invariant? Confusing API? Insufficient types? Copy-paste error?
- **Could this same class of bug exist elsewhere?** Search for similar patterns.
- **Can we prevent this class of bug?** Better types, API redesign, runtime validation?

### 4. Fix the Bug

1. Implement the minimal correct fix
2. Run the failing test — confirm it passes
3. Apply any scoped systemic improvements (better types, validation, API clarification)
4. Run `pnpm lint` to validate

### 5. Assess Blast Radius and Sweep for Similar Issues

After editing, use the graph to validate your fix doesn't have unexpected impact:
- `detect_changes(scope='unstaged', depth=2)` — maps your git diff to affected symbols + callers classified by risk
- Use Grep to find similar code structures
- Check if other modules have the same vulnerability
- Fix any duplicates found

## Output

After fixing the bug, summarize:

1. **Root Cause**: One paragraph explaining why the bug existed
2. **Fix Applied**: What you changed and why
3. **Regression Test**: What test you added
4. **Systemic Improvements**: Any broader changes made to prevent recurrence
5. **Remaining Risk**: Any similar patterns you found but didn't fix (document them)
