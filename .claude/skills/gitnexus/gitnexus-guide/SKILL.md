---
name: gitnexus-guide
description: "Use when the user asks about GitNexus itself — available tools, how to query the knowledge graph, MCP resources, graph schema, or workflow reference. Examples: \"What GitNexus tools are available?\", \"How do I use GitNexus?\""
---

# GitNexus Guide

Quick reference for all GitNexus MCP tools, resources, and the knowledge graph schema.

## Always Start Here

For any task involving code understanding, debugging, impact analysis, or refactoring:

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx gitnexus analyze` in the terminal first.

## Skills

| Task                                         | Skill to read       |
| -------------------------------------------- | ------------------- |
| Understand architecture / "How does X work?" | `gitnexus-exploring`         |
| Blast radius / "What breaks if I change X?"  | `gitnexus-impact-analysis`   |
| Trace bugs / "Why is X failing?"             | `gitnexus-debugging`         |
| Rename / extract / split / refactor          | `gitnexus-refactoring`       |
| Tools, resources, schema reference           | `gitnexus-guide` (this file) |
| Index, status, clean, wiki CLI commands      | `gitnexus-cli`               |

## Tools Reference

| Tool             | What it gives you                                                        |
| ---------------- | ------------------------------------------------------------------------ |
| `query`          | Process-grouped code intelligence — execution flows related to a concept |
| `context`        | 360-degree symbol view — categorized refs, processes it participates in  |
| `impact`         | Symbol blast radius — what breaks at depth 1/2/3 with confidence         |
| `detect_changes` | Git-diff impact — what do your current changes affect                    |
| `rename`         | Multi-file coordinated rename with confidence-tagged edits               |
| `cypher`         | Raw graph queries (read `gitnexus://repo/{name}/schema` first)           |
| `list_repos`     | Discover indexed repos                                                   |

## Resources Reference

Lightweight reads (~100-500 tokens) for navigation:

| Resource                                       | Content                                   |
| ---------------------------------------------- | ----------------------------------------- |
| `gitnexus://repo/{name}/context`               | Stats, staleness check                    |
| `gitnexus://repo/{name}/clusters`              | All functional areas with cohesion scores |
| `gitnexus://repo/{name}/cluster/{clusterName}` | Area members                              |
| `gitnexus://repo/{name}/processes`             | All execution flows                       |
| `gitnexus://repo/{name}/process/{processName}` | Step-by-step trace                        |
| `gitnexus://repo/{name}/schema`                | Graph schema for Cypher                   |

## Graph Schema

**Nodes:** File, Function, Class, Interface, Method, Constructor, Property, Community, Process, BasicBlock
**Edges (via CodeRelation.type):** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, HAS_METHOD, MEMBER_OF, STEP_IN_PROCESS, CFG_CONTAINS, CFG_EDGE

Method, Constructor, and Property nodes have a `className` property for easy class-scoped queries.

```cypher
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath
```

## KuzuDB Cypher Differences

GitNexus uses KuzuDB, not Neo4j. Key differences that affect query writing:

### Single relationship table

All edges go through `CodeRelation` with a `type` property. You **cannot** use the type as a relationship label:

```cypher
-- WRONG: "Table CALLS does not exist"
MATCH (a)-[:CALLS]->(b) RETURN a

-- CORRECT:
MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b) RETURN a
```

### Finding symbols across label types

Functions, methods, and constructors are separate node labels. To find a symbol by name without knowing its type:

```cypher
-- Search across all callable types:
MATCH (f) WHERE f.name = 'handleIdle'
  AND f.filePath STARTS WITH 'src/'
RETURN label(f) AS type, f.name, f.className, f.filePath
```

Use `f.className` on Method/Constructor/Property nodes to scope by class:

```cypher
MATCH (m:Method) WHERE m.className = 'GameState'
RETURN m.name, m.id
```

### Reserved words

`end`, `start`, `type`, `key` are reserved. Use backticks or different aliases:

```cypher
-- WRONG: RETURN f.endLine AS end
-- CORRECT:
RETURN f.endLine AS endLine
```

### No `toFloat()` — use `CAST`

```cypher
-- WRONG: toFloat(x) / toFloat(y)
-- CORRECT:
CAST(x AS DOUBLE) / CAST(y AS DOUBLE)
-- Or multiply first for integer ratios:
x * 100 / y AS percentage
```

### `labels()` returns a string, not a list

```cypher
-- Neo4j: WHERE 'Method' IN labels(n)
-- KuzuDB:
WHERE label(n) = 'Method'
```

### `WITH` scoping

Variables from before `WITH` are only available if explicitly carried through:

```cypher
MATCH (f)-[:CodeRelation]->(b:BasicBlock)
WITH f, count(b) AS blocks       -- only f and blocks survive
WHERE blocks > 50                -- OK: blocks is in scope
RETURN f.name, blocks
```

Multi-step queries that need data from different `MATCH` clauses should carry everything through `WITH`:

```cypher
MATCH (f)-[c:CodeRelation {type: 'CFG_CONTAINS'}]->(b:BasicBlock)
WITH f, count(b) AS blocks
MATCH (f)-[:CodeRelation {type: 'CFG_CONTAINS'}]->(b1:BasicBlock)
      -[e:CodeRelation {type: 'CFG_EDGE', cfgEdgeType: 'Backedge'}]->(b2:BasicBlock)
WITH f, blocks, count(e) AS loops
RETURN f.name, blocks, loops ORDER BY blocks DESC LIMIT 10
```

## Control Flow Graph (CFG)

BasicBlock nodes represent basic blocks within functions/methods. Two CFG-specific relation types connect them:

- **CFG_CONTAINS** — Function/Method/Constructor → BasicBlock (ownership)
- **CFG_EDGE** — BasicBlock → BasicBlock (control flow)

### BasicBlock Properties

| Property           | Type   | Description                                  |
| ------------------ | ------ | -------------------------------------------- |
| `blockIndex`       | INT64  | Block number within the function (0 = entry) |
| `instructionCount` | INT64  | Number of instructions in the block          |
| `isUnreachable`    | BOOL   | True if dead code (never executed)           |
| `cfgInstructions`  | STRING | Serialized instruction list                  |

### CFG_EDGE Properties

| Property        | Type   | Description                                                                            |
| --------------- | ------ | -------------------------------------------------------------------------------------- |
| `cfgEdgeType`   | STRING | Edge type: Normal, Jump, Backedge, ErrorExplicit, Unreachable, Finalize |
| `conditionText` | STRING | Branch condition text (if conditional)                                                 |

### CFG Query Examples

Get basic blocks for a function:

```cypher
MATCH (f:Function {name: "myFunc"})-[:CodeRelation {type: 'CFG_CONTAINS'}]->(b:BasicBlock)
RETURN b.blockIndex, b.instructionCount, b.isUnreachable
ORDER BY b.blockIndex
```

Trace control flow edges within a function:

```cypher
MATCH (f:Function {name: "myFunc"})-[:CodeRelation {type: 'CFG_CONTAINS'}]->(b1:BasicBlock)
      -[e:CodeRelation {type: 'CFG_EDGE'}]->(b2:BasicBlock)
RETURN b1.blockIndex AS from, e.cfgEdgeType AS type, e.conditionText AS condition, b2.blockIndex AS to
ORDER BY b1.blockIndex
```

Find functions with unreachable (dead) code:

```cypher
MATCH (f:Function)-[:CodeRelation {type: 'CFG_CONTAINS'}]->(b:BasicBlock)
WHERE b.isUnreachable = true
RETURN f.name, f.filePath, count(b) AS unreachableBlocks
ORDER BY unreachableBlocks DESC LIMIT 10
```

Find functions with high branching complexity (many CFG edges):

```cypher
MATCH (f:Function)-[:CodeRelation {type: 'CFG_CONTAINS'}]->(b:BasicBlock)
WITH f, count(b) AS blockCount
WHERE blockCount > 50
RETURN f.name, f.filePath, blockCount
ORDER BY blockCount DESC
```

Find loop back-edges:

```cypher
MATCH (f:Function)-[:CodeRelation {type: 'CFG_CONTAINS'}]->(b1:BasicBlock)
      -[e:CodeRelation {type: 'CFG_EDGE', cfgEdgeType: 'Backedge'}]->(b2:BasicBlock)
RETURN f.name, b1.blockIndex AS loopEnd, b2.blockIndex AS loopHead
```
