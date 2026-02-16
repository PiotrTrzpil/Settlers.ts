---
name: fix-bug
description: Investigate and fix a bug with deep root cause analysis. Identifies systemic improvements to prevent similar bugs across the codebase.
argument-hint: <bug description or symptoms>
---

You are fixing a bug with a focus on understanding root causes and preventing similar issues in the future.

ultrathink

**IMPORTANT: Do NOT use plan mode. Investigate and fix the bug directly.**

## Bug Description

$ARGUMENTS

## Investigation Process

### 1. Reproduce & Understand

- Read any stack traces, error messages, or symptoms described
- Locate the failing code path
- Understand what the code *should* do vs what it actually does
- Identify the exact point where behavior diverges from expectations

### 2. Root Cause Analysis

Go deeper than the immediate fix. Ask yourself:

- **Why did this bug exist in the first place?**
  - Was there a missing invariant or contract?
  - Was the API confusing or easy to misuse?
  - Was there insufficient type safety?
  - Was there a missing test that would have caught this?

- **What made this bug hard to notice?**
  - Silent failures (swallowed errors, fallback values)
  - Missing validation at boundaries
  - Insufficient logging or observability
  - Test gaps

- **Could this same class of bug exist elsewhere?**
  - Search for similar patterns in the codebase
  - Look for copy-pasted code that might have the same issue
  - Check if other callers of the same API might have the same misunderstanding

### 3. Systemic Improvements

Before writing the fix, identify preventive measures:

- **Type-level prevention**: Can we make this bug impossible with better types? (branded types, discriminated unions, non-optional fields)
- **API design**: Should the function signature be changed to prevent misuse?
- **Validation**: Should we add runtime checks that fail loudly?
- **Abstraction**: Would a helper function or pattern make the correct usage obvious?
- **Documentation**: If the gotcha is unavoidable, should it be documented?

### 4. Fix the Bug

Apply the minimal correct fix:
- Fix the immediate issue
- Add a regression test that would have caught this
- Apply any systemic improvements identified above (if scoped and safe)

### 5. Sweep for Similar Issues

Search the codebase for the same pattern:
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
