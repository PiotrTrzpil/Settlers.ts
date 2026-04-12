---
name: gitnexus-refactoring
description: "Use when the user wants to rename, extract, split, move, or restructure code safely. Examples: \"Rename this function\", \"Move this file\", \"Rename this directory\", \"Extract this into a module\", \"Refactor this class\""
---

# Refactoring with GitNexus

## When to Use

- "Rename this function/class/method safely"
- "Move this file to a new location" (imports get rewired)
- "Rename this directory" (all files + imports get rewired)
- "Extract this into a module"
- "Split this service"
- Any task involving renaming, moving, extracting, or restructuring code

## gitnexus_rename — three modes

The `rename` tool has one parameter that picks the mode: `type`.

| `type`        | What it does                                                                     | `symbol_name` / `new_name`        |
| ------------- | -------------------------------------------------------------------------------- | --------------------------------- |
| `"symbol"` *(default)* | Rename a function/class/method/variable across the codebase             | symbol identifiers (`oldName` → `newName`) |
| `"file"`      | Move a single file to a new path and rewire all imports                          | file paths (`src/a/x.ts` → `src/b/x.ts`) |
| `"directory"` | Move every file under a directory to a new path and rewire all imports          | directory paths (`src/canvas` → `src/view`) |

`dry_run: true` is the default — always preview first, then re-run with `dry_run: false`.

### Engine selection (symbol renames only)

The `engine` parameter controls how aggressively the tool searches for references:

| Engine            | Behavior                                                      | When to use                           |
| ----------------- | ------------------------------------------------------------- | ------------------------------------- |
| `auto` *(default)* | ts_morph/rope → graph-only fallback (NO text_search)        | Safe default, avoids over-matching    |
| `semantic_only`   | ts_morph/rope only, fail if not resolved                     | Strictest — use for well-indexed code |
| `graph_only`      | Skip ts_morph/rope, use graph edges only                     | Fast, for large renames               |
| `with_text_search`| ts_morph/rope → graph + text_search                          | Aggressive — **may over-match!**      |

**Important:** `text_search` is **disabled by default**. It does blind regex matching without type awareness and can rename unrelated symbols with the same name. Only use `engine: "with_text_search"` when you understand the risk and will review every edit.

### Confidence labels on each edit

Each returned edit is tagged with how it was found:

| Label          | Source                                   | Trust                                           |
| -------------- | ---------------------------------------- | ----------------------------------------------- |
| `ts_morph`     | TypeScript language service (TS/JS)      | Highest — scope-aware, handles imports / re-exports / destructuring |
| `rope`         | Python rope refactoring library          | Highest — scope-aware, handles imports and class hierarchies |
| `graph`        | GitNexus knowledge graph relationships   | High — safe to accept                           |
| `text_search`  | Regex fallback via ripgrep               | Lower — **only with `engine: "with_text_search"`, review carefully** |

Symbol renames try ts-morph (TS/JS) or rope (Python) first, then fall back to graph-only (no text_search) for other languages or unresolvable symbols. File and directory moves use ts-morph's `SourceFile.move()` API for TS/JS; non-TS files are moved on the filesystem without import rewriting.

## Workflow

```
1. gitnexus_impact({target: "X", direction: "upstream"})  → Map all dependents
2. gitnexus_context({name: "X"})                           → See callers, callees, processes
3. gitnexus_rename({..., dry_run: true})                   → Preview edits
4. Review text_search edits (lower confidence)
5. gitnexus_rename({..., dry_run: false})                  → Apply
6. gitnexus_detect_changes({scope: "all"})                 → Verify scope
7. Run tests for affected processes
```

> If "Index is stale" → run `gitnexus analyze` in terminal.

## Checklists

### Rename Symbol

```
- [ ] gitnexus_impact({target: "oldName", direction: "upstream"}) — report blast radius
- [ ] gitnexus_rename({symbol_name: "oldName", new_name: "newName", dry_run: true})
      (add file_path or symbol_uid to disambiguate common names)
- [ ] Accept ts_morph / rope / graph edits; review every text_search edit
- [ ] gitnexus_rename({..., dry_run: false}) — apply
- [ ] gitnexus_detect_changes({scope: "all"}) — verify only expected files changed
- [ ] Run tests for affected processes
```

### Move a Single File

```
- [ ] gitnexus_rename({symbol_name: "src/utils/helpers.ts",
                       new_name: "src/lib/helpers.ts",
                       type: "file", dry_run: true})
- [ ] Review import rewiring across the codebase
- [ ] gitnexus_rename({..., dry_run: false}) — apply
- [ ] gitnexus_detect_changes({scope: "all"}) — verify scope
- [ ] Run tests for affected processes
```

### Rename/Move a Directory

```
- [ ] gitnexus_rename({symbol_name: "src/canvas",
                       new_name: "src/view",
                       type: "directory", dry_run: true})
- [ ] Review file moves + import rewiring
- [ ] gitnexus_rename({..., dry_run: false}) — apply
- [ ] gitnexus_detect_changes({scope: "all"}) — verify scope
- [ ] Run tests for affected processes
```

### Extract Module

```
- [ ] gitnexus_context({name: target}) — see incoming/outgoing refs
- [ ] gitnexus_impact({target, direction: "upstream"}) — find all external callers
- [ ] Define new module interface
- [ ] Extract code, update imports (or use rename type: "file" for single-file moves)
- [ ] gitnexus_detect_changes({scope: "all"}) — verify scope
- [ ] Run tests for affected processes
```

### Split Function/Service

```
- [ ] gitnexus_context({name: target}) — understand all callees
- [ ] Group callees by responsibility
- [ ] gitnexus_impact({target, direction: "upstream"}) — map callers to update
- [ ] Create new functions/services
- [ ] Update callers (use gitnexus_rename for each one)
- [ ] gitnexus_detect_changes({scope: "all"}) — verify scope
- [ ] Run tests for affected processes
```

## Tools

**gitnexus_rename** — symbol rename, file move, or directory rename:

```
gitnexus_rename({
  symbol_name: "validateUser",        // or old file/dir path
  new_name: "authenticateUser",       // or new file/dir path
  type: "symbol",                      // "symbol" | "file" | "directory"
  file_path: "src/auth/validator.ts", // optional — disambiguate common names
  symbol_uid: "...",                   // optional — zero-ambiguity from prior tool output
  engine: "auto",                      // "auto" | "semantic_only" | "graph_only" | "with_text_search"
  dry_run: true,
})
→ edits: [{file_path, edits: [{line, old_text, new_text, confidence}]}]
→ confidence ∈ {ts_morph, rope, graph, text_search}
→ text_search only appears when engine="with_text_search"
```

**gitnexus_impact** — map dependents before you touch anything:

```
gitnexus_impact({target: "validateUser", direction: "upstream"})
→ d=1: loginHandler, apiMiddleware, testUtils
→ Affected processes: LoginFlow, TokenRefresh
```

**gitnexus_detect_changes** — verify scope after refactoring:

```
gitnexus_detect_changes({scope: "all"})
→ Changed: 8 files, 12 symbols
→ Affected processes: LoginFlow, TokenRefresh
→ Risk: MEDIUM
```

**gitnexus_cypher** — custom reference queries:

```cypher
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "validateUser"})
RETURN caller.name, caller.filePath ORDER BY caller.filePath
```

## Risk Rules

| Risk Factor         | Mitigation                                             |
| ------------------- | ------------------------------------------------------ |
| Many callers (>5)   | Use gitnexus_rename for automated, scope-aware updates |
| Cross-area refs     | Use detect_changes after to verify scope               |
| Dynamic/string refs | Use `engine: "with_text_search"` but **review every edit** |
| External/public API | Version and deprecate properly                         |
| Common symbol name  | Pass `file_path` or `symbol_uid` to disambiguate       |
| Over-matching       | **Never** use `engine: "with_text_search"` without reviewing edits |

## Example: Rename `validateUser` to `authenticateUser`

```
1. gitnexus_impact({target: "validateUser", direction: "upstream"})
   → d=1: loginHandler, apiMiddleware; processes: LoginFlow, TokenRefresh

2. gitnexus_rename({symbol_name: "validateUser", new_name: "authenticateUser", dry_run: true})
   → 12 edits across 8 files
   → 10 ts_morph edits (scope-aware, safe)
   →  1 graph edit   (safe)
   →  1 text_search edit in config.json (dynamic reference — review!)

3. Review text_search edit — confirm config.json really should be updated.

4. gitnexus_rename({symbol_name: "validateUser", new_name: "authenticateUser", dry_run: false})
   → Applied 12 edits across 8 files

5. gitnexus_detect_changes({scope: "all"})
   → Affected: LoginFlow, TokenRefresh
   → Risk: MEDIUM — run tests for these flows
```

## Example: Move a file

```
1. gitnexus_rename({symbol_name: "src/utils/helpers.ts",
                    new_name:    "src/lib/helpers.ts",
                    type: "file", dry_run: true})
   → Moves helpers.ts and rewrites 14 import statements across 11 files

2. gitnexus_rename({..., dry_run: false}) — apply

3. gitnexus_detect_changes({scope: "all"}) — verify scope
```

## Example: Rename a directory

```
1. gitnexus_rename({symbol_name: "src/canvas",
                    new_name:    "src/view",
                    type: "directory", dry_run: true})
   → Moves 8 files from src/canvas/ to src/view/ and rewires imports

2. gitnexus_rename({..., dry_run: false}) — apply

3. gitnexus_detect_changes({scope: "all"}) — verify scope
```
