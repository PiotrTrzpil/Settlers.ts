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
| `query_graph` | Relationship patterns, edge properties, joins | 200-row cap, Cypher-like syntax |
| `trace_call_path` | Who calls X / what does X call (BFS traversal) | Use `search_graph` first to get exact name |
| `get_code_snippet` | Read source + metadata (complexity, callers/callees) | `include_neighbors=true` for caller/callee names |
| `detect_changes` | Map git diff to affected symbols + blast radius | Risk labels: CRITICAL/HIGH/MEDIUM/LOW by hop |
| `get_architecture` | Orientation: hotspots, boundaries, clusters, layers | Call with specific aspects to save tokens |
| `search_code` | Text search (string literals, TODOs, config values) | Like grep — for content not in the graph |

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
Functions with zero inbound CALLS that aren't entry points = dead code candidates.

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
| `CALLS` | Direct function/method invocation | `trace_call_path` or `MATCH (a)-[:CALLS]->(b)` |
| `USAGE` | Read reference (callback, variable, parameter) | `MATCH (a)-[:USAGE]->(b) WHERE b.name = 'X'` |
| `IMPLEMENTS` | Class implements interface | `MATCH (c:Class)-[:IMPLEMENTS]->(i:Interface)` |
| `OVERRIDE` | Method overrides interface method | `MATCH (m)-[:OVERRIDE]->(i) WHERE m.file CONTAINS 'X'` |
| `USES_TYPE` | Function uses type in signature/body | `MATCH (f)-[:USES_TYPE]->(t) WHERE f.name = 'X'` |
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
