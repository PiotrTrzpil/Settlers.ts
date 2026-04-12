<!-- gitnexus:start -->
# GitNexus — Code Intelligence

Indexed as **Settlers.ts** (36293 symbols, 75052 relationships, 300 execution flows). Prefer GitNexus MCP tools over grep/glob for structural questions. If a tool warns the index is stale, run `gitnexus analyze`.

## Always

- MUST run `gitnexus_impact({target, direction: "upstream"})` before editing any function/class/method and report the blast radius.
- MUST run `gitnexus_detect_changes()` before committing to verify scope.
- MUST warn the user on HIGH/CRITICAL impact risk.
- Use `gitnexus_query` / `gitnexus_context` to explore unfamiliar code — not grep.

## Never

- NEVER edit a symbol without running `gitnexus_impact` first.
- NEVER ignore HIGH/CRITICAL risk warnings.
- NEVER rename with find-and-replace — use `gitnexus_rename` (read the refactoring skill first).
- NEVER commit without running `gitnexus_detect_changes`.

## Renaming

**MUST read `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` before any rename operation.**
The rename tool has an `engine` parameter that controls matching strictness. Default is safe (no text_search). Use `engine: "with_text_search"` only with caution — it does blind regex matching.

## Tools

| Tool | Use for |
|------|---------|
| `query` | Natural-language code search, ranked by execution flow |
| `context` | Callers, callees, process participation for a symbol |
| `impact` | Blast radius before editing (depth d=1 WILL BREAK) |
| `detect_changes` | Map a diff to affected symbols and flows |
| `rename` | Safe multi-file rename — **read refactoring skill first** |
| `cypher` | Custom graph queries |

## Skills

| Task | Read |
|------|------|
| Architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Debugging / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools and schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| CLI (analyze, embeddings, wiki) | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
<!-- gitnexus:end -->
