# Codebase Memory MCP — Workflow Guide

This project is indexed by `codebase-memory-mcp`, which builds a code knowledge graph (functions, classes, interfaces, modules, and their relationships). This document covers **focused workflows** for everyday development: refactors, new features, bug investigation, and architectural changes.

## Graph overview

The graph contains ~13k nodes and ~32k edges:

| Node labels | Key edge types |
|---|---|
| Function, Method, Class, Interface, Type, Enum, Variable | CALLS, USAGE, IMPLEMENTS, OVERRIDE |
| Module, File, Folder, Package | IMPORTS, DEFINES, DEFINES_METHOD, CONTAINS_FILE |
| Community (auto-detected clusters) | FILE_CHANGES_WITH, TESTS_FILE, USES_TYPE |

## Tool quick reference

| Tool | Best for | Key insight |
|---|---|---|
| `search_graph` | Finding symbols by name, degree filtering, dead code | No row cap, case-insensitive regex |
| `query_graph` | Relationship patterns, edge properties, joins | 200-row cap, Cypher-like syntax; JSON array-aware matching on edge props |
| `trace_call_path` | Who calls X / what does X call (BFS traversal) | `summary_only=true` for quick overview; edges include `confidence_band` |
| `get_code_snippet` | Read source + metadata (complexity, callers/callees) | `include_neighbors=true` for caller/callee names |
| `detect_changes` | Map git diff to affected symbols + blast radius | `summary_only=true` for quick triage; `max_impact` caps results |
| `get_architecture` | Orientation: hotspots, boundaries, clusters, layers | `boundary_path_prefix` + `boundary_depth` for sub-directory analysis |
| `search_code` | Text search (string literals, TODOs, config values) | `context_lines` (0-5) controls surrounding context |
| `set_output_format` | Switch output between YAML and JSON | Default is YAML (~40% more compact) |

---

## Workflow 1: Refactoring a function or class

**Goal:** Understand all callers, usages, and downstream effects before changing a symbol.

### Step 1 — Find the symbol
```
search_graph(name_pattern='.*BuildingConstruction.*', label='Class')
```
Use regex alternatives for fuzzy matching: `'construct|building|place'`. The `label` filter narrows to classes, functions, interfaces, etc.

### Step 2 — Trace callers and callees
```
trace_call_path(function_name='executeGarrisonUnitsCommand', direction='both', depth=2)
```
- `direction='inbound'` — who calls this? (impact analysis)
- `direction='outbound'` — what does this call? (dependency analysis)
- `direction='both'` — full picture
- Start with `depth=1`, increase only if needed

### Step 3 — Read the source with context
```
get_code_snippet(qualified_name='TickSystem', include_neighbors=true)
```
Returns source code, signature, complexity, and caller/callee names — enough to understand the contract without opening the file.

### Step 4 — Check who references the type (not just calls it)
```cypher
# USAGE = read references (callbacks, variable assignments, parameter passing)
MATCH (a)-[r:USAGE]->(b) WHERE b.name = 'Entity' RETURN a.name, a.file LIMIT 20
```
USAGE edges capture references that aren't direct CALLS — e.g., passing an interface as a callback, storing it in a variable, or using it as a parameter type.

### Step 5 — Validate your changes
```
detect_changes(scope='unstaged', depth=2)
```
After editing, run this to see which symbols you touched and their blast radius. Risk classification:
- **CRITICAL** (hop 1) — direct callers, likely need review
- **HIGH** (hop 2) — indirect callers, check for contract assumptions
- **MEDIUM/LOW** (hop 3+) — unlikely to break, but good to know

---

## Workflow 2: Adding a new feature

**Goal:** Understand where to plug in, what interfaces to implement, and what patterns to follow.

### Step 1 — Check existing implementations of the interface you'll use
```cypher
# Find all classes implementing TickSystem
MATCH (c:Class)-[:IMPLEMENTS]->(i:Interface) WHERE i.name = 'TickSystem'
RETURN c.name, c.file LIMIT 30
```
This reveals every system that implements the interface — use one as a template.

### Step 2 — Find similar features by name pattern
```
search_graph(name_pattern='.*garrison|tower.*', label='Function', limit=15)
```
Or scope to a directory:
```
search_graph(qn_pattern='.*features\\.combat\\..*', label='Function')
```

### Step 3 — Understand the registration/wiring point
```
trace_call_path(function_name='registerAllHandlers', direction='outbound', depth=1)
```
High fan-out functions are registration points — they show where new features get wired in.

### Step 4 — Check which files change together (coupling)
```cypher
MATCH (a)-[r:FILE_CHANGES_WITH]->(b)
WHERE a.name CONTAINS 'garrison'
RETURN a.name, b.name, r.coupling_score, r.co_change_count
LIMIT 15
```
Files with high coupling scores are likely co-dependent — if you're adding a feature similar to an existing one, these reveal the full set of files you'll need to touch.

### Step 5 — Check method overrides for interface contracts
```cypher
# See which methods are overridden from an interface
MATCH (s)-[r:OVERRIDE]->(i)
WHERE s.file CONTAINS 'combat'
RETURN s.name, i.name, s.file LIMIT 20
```
OVERRIDE edges connect concrete method implementations to their interface method definitions — useful for understanding which methods you must implement.

---

## Workflow 3: Investigating a bug

**Goal:** Trace control flow from symptom to root cause.

### Step 1 — Find the function where the symptom appears
```
search_graph(name_pattern='.*serialize|persist.*', label='Function')
```
Or search for error messages / string literals:
```
search_code(pattern='snapshot version mismatch', regex=false)
```

### Step 2 — Trace inbound callers to find the trigger
```
trace_call_path(function_name='saveGameState', direction='inbound', depth=3, risk_labels=true)
```
With `risk_labels=true`, each caller gets a risk classification based on hop distance — focus on CRITICAL (direct callers) first.

### Step 3 — Check type dependencies
```cypher
# What types does this function depend on?
MATCH (f:Function)-[r:USES_TYPE]->(t)
WHERE f.name = 'topologicalSort'
RETURN t.name, t.label, t.file LIMIT 20
```
USES_TYPE edges reveal which interfaces/types a function depends on — useful when a bug might be caused by a type mismatch or missing field.

### Step 4 — Find the test file
```cypher
MATCH (m:Module)-[r:TESTS_FILE]->(t:Module)
WHERE t.name CONTAINS 'persistence'
RETURN m.name, t.name LIMIT 10
```
TESTS_FILE edges link test modules to the source they test.

### Step 5 — Assess blast radius of your fix
```
detect_changes(scope='staged', depth=3)
```

---

## Workflow 4: Architectural analysis

**Goal:** Understand system structure, find hotspots, detect dead code.

### Hotspots (most-called functions)
```
get_architecture(aspects=['hotspots'])
```
Returns the top functions by fan-in. High fan-in = high-impact changes.

### Cross-module boundaries
```
get_architecture(aspects=['boundaries'])
```
Shows call volumes between top-level packages (e.g., `tests→src: 373 calls`). Unexpected boundaries signal architectural violations.

For sub-directory analysis, use `boundary_path_prefix` and `boundary_depth`:
```
get_architecture(aspects=['boundaries'], boundary_path_prefix='src/game/features', boundary_depth=1)
```
This scopes boundaries to a specific subtree — useful for analyzing feature-to-feature coupling.

### Community detection (hidden modules)
```
get_architecture(aspects=['clusters'])
```
Louvain algorithm detects functional clusters across CALLS edges — reveals which functions naturally group together, even across file boundaries.

### Dead code detection
```
search_graph(
    label='Function',
    relationship='CALLS',
    direction='inbound',
    max_degree=0,
    exclude_entry_points=true
)
```
Functions with zero inbound CALLS that aren't entry points = dead code candidates. The detection also excludes nodes with inbound USAGE edges (callback references, event registrations) and treats `is_exported` nodes as entry points to reduce false positives.

### High fan-out (God functions)
```
search_graph(
    label='Function',
    relationship='CALLS',
    direction='outbound',
    min_degree=15,
    sort_by='degree'
)
```

### Layer classification
```
get_architecture(aspects=['layers'])
```
Heuristic layer assignment: core (high fan-in), leaf (only inbound), entry (has main/init), internal.

---

## Workflow 5: Pre-change impact assessment

**Goal:** Before starting a refactor, understand the full blast radius.

### From uncommitted changes
```
detect_changes(scope='all', depth=3)
```
Returns:
- `changed_symbols` — functions/classes modified in the diff
- `impacted_symbols` — callers of changed symbols, classified by risk
- `summary` — counts by risk level

### From a branch
```
detect_changes(scope='branch', base_branch='master', depth=3)
```
Compares current branch to master — shows the full impact of all commits on the branch.

### Targeted: "What breaks if I change this interface?"
```
# Step 1: Find all implementors
MATCH (c:Class)-[:IMPLEMENTS]->(i:Interface) WHERE i.name = 'Persistable'
RETURN c.name, c.file LIMIT 30

# Step 2: Find all type references
MATCH (f)-[r:USES_TYPE]->(i:Interface) WHERE i.name = 'Persistable'
RETURN f.name, f.file LIMIT 30

# Step 3: Find all read references
MATCH (f)-[r:USAGE]->(i:Interface) WHERE i.name = 'Persistable'
RETURN f.name, f.file LIMIT 30
```
Combine IMPLEMENTS + USES_TYPE + USAGE for complete interface impact.

---

## Key edge types explained

| Edge | Meaning | Example query |
|---|---|---|
| `CALLS` | Direct function/method invocation; `first_arg` property holds string literal args as JSON array | `trace_call_path` or `MATCH (a)-[:CALLS]->(b)` |
| `USAGE` | Read reference (callback, variable, parameter) | `MATCH (a)-[:USAGE]->(b) WHERE b.name = 'X'` |
| `IMPLEMENTS` | Class implements interface | `MATCH (c:Class)-[:IMPLEMENTS]->(i:Interface)` |
| `OVERRIDE` | Method overrides interface method | `MATCH (m)-[:OVERRIDE]->(i) WHERE m.file CONTAINS 'X'` |
| `USES_TYPE` | Function uses type in signature/body (includes param_types and return_type annotations) | `MATCH (f)-[:USES_TYPE]->(t) WHERE f.name = 'X'` |
| `IMPORTS` | Module imports module | `MATCH (a:Module)-[:IMPORTS]->(b:Module)` |
| `DEFINES` | Module defines symbol | `MATCH (m:Module)-[:DEFINES]->(f:Function)` |
| `DEFINES_METHOD` | Class defines method | `MATCH (c:Class)-[:DEFINES_METHOD]->(m:Method)` |
| `FILE_CHANGES_WITH` | Git co-change coupling | `r.coupling_score`, `r.co_change_count` |
| `TESTS_FILE` | Test module tests source module | `MATCH (t)-[:TESTS_FILE]->(s)` |
| `WRITES` | Function writes to a variable/field | `MATCH (f)-[:WRITES]->(v)` |

---

## Tips and gotchas

### Prefer `search_graph` over `query_graph` for counting
`query_graph` has a 200-row cap that applies BEFORE aggregation — `COUNT(*)` silently undercounts. Use `search_graph` with `min_degree`/`max_degree` for accurate fan-in/out analysis.

### Use regex alternatives for broad matching
```
search_graph(name_pattern='auth|authenticate|authorization|login')
```
One broad regex replaces multiple narrow searches. Include word forms, abbreviations, and synonyms.

### Chain tools for complete answers
The recommended pattern:
1. `search_graph` — find the exact symbol name
2. `trace_call_path` — understand control flow
3. `get_code_snippet` — read the source

### `detect_changes` is your pre-commit check
Run it after editing to catch unexpected blast radius before you lint or test. It maps your git diff directly to the graph.

### `get_architecture` aspects are independent
Request only what you need: `['hotspots']` is much cheaper than `['all']`. Combine aspects in one call: `['hotspots', 'boundaries']`.

### Ambiguous names in `get_code_snippet`
If a name matches multiple symbols, the tool returns suggestions. Use `auto_resolve=true` to let it pick the best match, or pass the full `qualified_name` for precision.

### Qualified name format
Qualified names follow the pattern:
```
project.path.to.file.ClassName.methodName
```
Use `qn_pattern` in `search_graph` to scope searches to directories:
```
search_graph(qn_pattern='.*features\\.logistics\\..*')
```

### Use `first_arg` on CALLS edges to find specific call sites
CALLS edges store the first string literal argument as a JSON array (`first_arg`). Cypher operators (`=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`) are JSON array-aware on edge properties:
```cypher
# Find all calls that pass 'buildingDestroyed' as the first argument (e.g., event emissions)
MATCH (a)-[r:CALLS]->(b) WHERE r.first_arg CONTAINS 'buildingDestroyed' RETURN a.name, b.name LIMIT 20
```

### Searching publish/subscribe patterns (EventBus)

This project uses `EventBus` with `.emit()`, `.on()`, and `.subscribe()` for pub/sub. The graph indexes these as CALLS edges to Method nodes (`emit`, `on`, `subscribe`) with the event name(s) stored in the `first_arg` edge property as a JSON array (e.g. `["building:placed","building:completed"]`). One edge per calling function — if a function emits/subscribes to multiple events, they're all in the same array.

**Find all emitters of an event:**
```cypher
MATCH (f)-[r:CALLS]->(g:Method)
WHERE g.name = 'emit' AND g.file_path ENDS WITH 'event-bus.ts'
  AND r.first_arg CONTAINS 'building:placed'
RETURN f.name, f.file_path LIMIT 20
```

**Find all subscribers to an event:**
```cypher
MATCH (f)-[r:CALLS]->(g:Method)
WHERE g.name = 'subscribe' AND r.first_arg CONTAINS 'entity:removed'
RETURN f.name, f.file_path LIMIT 20
```

**Find all `.on()` listeners for an event:**
```cypher
MATCH (f)-[r:CALLS]->(g:Method)
WHERE g.name = 'on' AND g.file_path ENDS WITH 'event-bus.ts'
  AND r.first_arg CONTAINS 'entity:created'
RETURN f.name, f.file_path LIMIT 20
```

**List all distinct events emitted across the codebase:**
```cypher
MATCH (f)-[r:CALLS]->(g:Method)
WHERE g.name = 'emit' AND g.file_path ENDS WITH 'event-bus.ts'
RETURN DISTINCT r.first_arg ORDER BY r.first_arg LIMIT 80
```
Each row is a JSON array — flatten and deduplicate to get the full event list.

**Caveats:**
- **CONTAINS is substring-based.** `r.first_arg CONTAINS 'movement:bump'` also matches `movement:bumpAttempt` and `movement:bumpFailed`. For precision, include the JSON quotes: `r.first_arg CONTAINS '"movement:bump"'`.
- **Exact match (`=`) always fails** on `first_arg` because the value is a JSON array string, not a bare string. Always use CONTAINS.
- **`search_graph` cannot find event names** — it searches node names/properties only, not edge properties. `query_graph` + CONTAINS is the only path.
- **One edge per function.** If `registerEvents` calls `.subscribe()` five times with different events, all five appear in one `first_arg` array on one edge. This is not a bug — it reflects the function-level granularity of the graph.

### Use `summary_only` for quick triage
Both `detect_changes` and `trace_call_path` support `summary_only=true` — returns counts and risk levels without full symbol details. Use this for a quick "how big is this change?" check before diving deeper.

### Output format
Default output is YAML (~40% more compact than JSON). Use `set_output_format(format='json')` to switch back if needed. Responses use compact field names (`qn`, `file`, `lines`, `in`, `out`) with project prefix stripped from qualified names.
