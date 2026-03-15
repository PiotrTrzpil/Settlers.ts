---
name: design-doc
description: Write a high-level design doc for a game feature, refactoring, or architectural change — subsystem boundaries, APIs between components, and implementation approach. Outputs a markdown doc ready for /parallel.
user-invokable: true
argument-hint: "[feature description or requirements]"
---

# design-doc

Write a high-level design document for a feature, refactoring, or architectural change. The output is a concise markdown file that `/parallel` agents can implement. Optimized for fast iteration — keep the doc lean and trust implementation agents to handle details.

Do not use plan mode.

## What a Good Design Doc IS

- **Architecture**: how the system decomposes into subsystems/modules
- **Boundaries**: what each subsystem owns and where it ends
- **Contracts as code**: type definitions, model schemas, function signatures — the shared language between subsystems
- **Key decisions**: choices that affect multiple subsystems or have non-obvious rationale
- **File map**: which files to create or modify, organized by subsystem

## What a Good Design Doc is NOT

- Not implementation details. Don't specify behavior that any competent developer would figure out. Trust the implementation agents.
- Not a tutorial. Don't explain how frameworks or libraries work.
- Not a requirements doc. Requirements are the input. The design doc is the solution.
- Not exhaustive. If a detail only affects one subsystem and has an obvious answer, omit it.

## Workflow

### Step 1: Understand the Request

Read `$ARGUMENTS`. This is either:
- A feature description ("add a bookmarks module with tagging and search")
- A refactoring/replacement ("replace the event system with a pub/sub approach")
- An architectural change ("decouple module X from module Y", "change how services communicate")
- A path to a requirements file
- An issue or problem statement

If anything is ambiguous, ask the user ONE round of clarifying questions (use AskUserQuestion). Prefer making reasonable decisions over asking too many questions.

### Step 2: Graph-Assisted Scouting

**MUST use codebase-memory-mcp graph tools first** (see `docs/CODEBASE_MEMORY.md` for full reference). The graph gives you structural answers in seconds — use it before spawning scout agents. **Run all graph queries in parallel using multiple agents** — every query below is independent, so batch them into 2-3 parallel agents alongside the scout agents. The entire scouting phase (graph + agents) should complete in one parallel wave.

#### Graph queries to run first:
- `get_architecture(aspects=['hotspots', 'boundaries', 'clusters'])` — understand current structure, cross-module call volumes, and natural functional groupings. Use `boundary_path_prefix` + `boundary_depth` for scoped analysis when the feature area is known (e.g., `boundary_path_prefix='src/game/features', boundary_depth=1`)
- `search_graph(name_pattern='.*{keyword}.*', label='Class')` — find existing code related to the feature
- `query_graph('MATCH (c:Class)-[:IMPLEMENTS]->(i:Interface) WHERE i.name = "{relevant interface}" RETURN c.name, c.file LIMIT 20')` — find all implementors to use as templates
- `trace_call_path(function_name='{registration_point}', direction='outbound', depth=1)` — find where features get wired in (high fan-out functions are registration points)
- `query_graph('MATCH (a)-[r:FILE_CHANGES_WITH]->(b) WHERE a.name CONTAINS "{keyword}" RETURN a.name, b.name, r.coupling_score, r.co_change_count LIMIT 15')` — files that change together reveal hidden coupling

For **event-driven features**, also query the existing event landscape:
- `query_graph('MATCH (f)-[r:CALLS]->(g:Method) WHERE g.name = "emit" AND g.file_path ENDS WITH "event-bus.ts" RETURN DISTINCT r.first_arg LIMIT 80')` — list all events currently emitted (avoid collisions, understand existing patterns)
- `query_graph('MATCH (f)-[r:CALLS]->(g:Method) WHERE g.name = "subscribe" AND r.first_arg CONTAINS "{related_event}" RETURN f.name, f.file_path LIMIT 20')` — find subscribers to related events

For **refactorings**, also run:
- `detect_changes(scope='branch', base_branch='master', depth=3)` — if there's existing WIP, see its blast radius
- `search_graph(label='Function', relationship='CALLS', direction='inbound', max_degree=0, exclude_entry_points=true)` — find dead code in the area you're redesigning

#### Then spawn 3 fast scout agents in parallel

Use the Agent tool (`subagent_type: "Explore"`). These gather pointers the graph can't provide (conventions from docs, code snippets, config files). Tell each agent to use `"quick"` thoroughness.

**Agent 1 — Conventions Scout**: Read CLAUDE.md and referenced guidelines. Return key naming/file conventions, error handling philosophy, type strictness, and constraining rules. Under 20 lines.

**Agent 2 — Pattern Scout**: Find 1-2 existing modules most similar to the feature. Return file structure, one condensed code snippet (~20 lines), and reusable utilities. Under 30 lines.

**Agent 3 — Integration Scout**: Find wiring points. Return where to register new modules/handlers, config files to update, and existing types to extend. Under 15 lines.

#### After scouts complete

Read all 3 outputs. Then do your own **targeted exploration** — read specific files the scouts identified as important. You now have the context to be surgical: read the exact files that matter for your design decisions, skip everything else. This is faster than having agents do deep exploration upfront.

### Step 3: Write the Design Doc

Create the doc at `docs/designs/{feature-name}.md`. Use the structure below.

**Key principle: keep it lean.** The doc should capture decisions that prevent integration failures and ambiguity that would cause parallel agents to diverge. Everything else is noise that slows down iteration on the doc itself.

---

## Design Doc Structure

The doc has two zones:

1. **Shared context** (Overview through Shared Contracts) — every `/parallel` agent reads these
2. **Per-subsystem sections** — each agent reads only their assigned section

Keep subsystem sections **short**: files, responsibility, key decisions only. Don't describe obvious behavior — implementation agents are intelligent and can read the codebase.

```markdown
# {Feature Name} — Design

## Overview
{2-3 sentences: what this does and why}

## Current State (for refactorings — omit for greenfield)
- **What exists**: current approach being changed
- **What stays vs changes**: preserved behaviors vs intentional changes
- **What gets deleted**: files/patterns to remove

## Summary for Review

{Plain language for the developer to verify understanding. No code, no file paths.}

- **Interpretation**: what you understood the request to mean
- **Key decisions**: major structural choices and their rationale
- **Assumptions**: decisions you made that weren't explicitly stated
- **Scope**: what's included, what's deferred

{Keep this 10-15 lines. Developer should quickly say "yes" or "no, change X".}

## Conventions

{Critical: read the project's CLAUDE.md, referenced guidelines, and lint configs. Distill the rules that affect this feature into a compact list. Implementation agents will follow these — don't assume they'll find the guidelines themselves.}

{Keep it brief — bullet points, not paragraphs. Only include what's relevant to this feature.}

- {e.g., "All services use constructor DI"}
- {e.g., "Optimistic error handling — validate only at system boundaries"}
- {pattern snippet if the codebase pattern is non-obvious, otherwise omit}

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | ... | ... | — | ... |
| 2 | ... | ... | 1 | ... |

{Target 3-8 subsystems based on actual complexity. Don't artificially split small features.}

## Shared Contracts

{Type definitions, model schemas, enums, key function signatures — as real code. This is the most important section: it prevents integration failures between parallel agents.}

```{language}
# Only include types/signatures that cross subsystem boundaries
```

## Subsystem Details

### {Subsystem 1}
**Files**: `path/to/files`
**Key decisions**:
- {decisions where a reasonable developer might choose differently}
**Behavior** (only if ambiguous):
- {specify only when multiple reasonable interpretations exist — e.g., ordering, conflict resolution, sync vs async}
- {omit this section entirely for straightforward CRUD/wiring}

### {Subsystem 2}
**Files**: `path/to/files`
**Depends on**: Subsystem 1
**Key decisions**:
- {non-obvious decisions only}

{Continue for all subsystems. Keep each section 3-8 lines.}

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| ... | ... | ... |

### Modified Files
| File | Change |
|------|--------|
| ... | ... |

## Verification
- {2-4 concrete scenarios to verify end-to-end}
```

---

## Writing Guidelines

1. **Contracts are the most important part.** Write them as real code. This eliminates integration failures between parallel agents.

2. **Decisions over descriptions.** Don't describe what's obvious. Only document decisions where a reasonable developer might choose differently, or where parallel agents need to agree.

3. **Be specific about files.** Every subsystem lists exact file paths — this is what `/parallel` uses to assign work.

4. **Trust implementation agents.** They can read existing code, understand frameworks, and handle edge cases. Only specify behavior that is genuinely ambiguous or non-obvious.

5. **Size subsystems to actual complexity.** Don't force 5-8 if the feature only needs 3. Don't merge if you genuinely have 10 independent pieces.

6. **No backward compatibility.** Designs describe the final state, not a migration path.

7. **Optimize for iteration speed.** If editing the design doc feels as slow as writing the code, the doc is too detailed. You should be able to restructure a subsystem boundary in a few line edits.

## After Writing

1. Save the doc to `docs/designs/{feature-name}.md`
2. Tell the user the doc is ready and suggest: "Run `/parallel docs/designs/{feature-name}.md` to implement this."
3. Highlight any non-obvious decisions so the user can review before implementation.
