# jobInfo.xml Choreography System

Replace the YAML-driven task system with jobInfo.xml-native choreography,
faithfully replicating the original Settlers 4 engine's job execution.

## Context

jobInfo.xml defines 128 jobs per race with:
- `CEntityTask` node sequences (31 unique task types)
- `jobPart` sprite references (e.g. `WC_CUT_TREE`, `BA_PICKUP_WATER`)
- Building-relative positioning (`x`, `y`, `useWork`)
- Direction constraints (`dir`: -1=any, 0-7=fixed)
- Animation control (`forward`: playback direction, `visible`: sprite visibility)
- Material references (`entity`: `GOOD_WATER`, `GOOD_FLOUR`, etc.)
- Building triggers (`trigger`: `TRIGGER_BAKER_WORK`, `TRIGGER_START_SLOT6`)

SettlerValues.xml links settlers to their jobs via `animLists`:
e.g. `SETTLER_WOODCUTTER` → `[JOB_WOODCUTTER_CHECKIN, JOB_WOODCUTTER_WORK]`

Both files are already parsed by `GameDataLoader` (`job-info-parser.ts`, `settler-values-parser.ts`).

## Architecture Overview

```
SettlerValues.xml                jobInfo.xml
    │                               │
    ▼                               ▼
settler-data-access.ts      JobchoreographyStore
(UnitType → job IDs)        (raceId + jobId → ChoreoNode[])
    │                               │
    └──────────┬────────────────────┘
               ▼
        SettlerTaskSystem
        (job selection + state machine)
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
ChoreoTask  JobPart     Trigger
Executors   Resolver    System
    │          │          │
    ▼          ▼          ▼
Movement   Animation   Building
System     Service     Overlays
```

## Subsystems

### 1. ChoreoNode — Extended Task Node

Replace `TaskNode` from YAML with a richer node directly mapped from jobInfo.xml.

**File**: `src/game/features/settler-tasks/choreo-types.ts`

```typescript
/** CEntityTask types from jobInfo.xml, mapped 1:1. */
export enum ChoreoTaskType {
    // Movement
    GO_TO_TARGET,
    GO_TO_TARGET_ROUGHLY,
    GO_TO_POS,
    GO_TO_POS_ROUGHLY,
    GO_TO_SOURCE_PILE,
    GO_TO_DESTINATION_PILE,
    GO_HOME,
    GO_VIRTUAL,           // interior building movement (invisible)
    SEARCH,

    // Work
    WORK,
    WORK_ON_ENTITY,
    WORK_VIRTUAL,         // interior work (invisible)
    WORK_ON_ENTITY_VIRTUAL,
    PRODUCE_VIRTUAL,
    PLANT,

    // Wait
    WAIT,
    WAIT_VIRTUAL,

    // Inventory
    GET_GOOD,
    GET_GOOD_VIRTUAL,
    PUT_GOOD,
    PUT_GOOD_VIRTUAL,
    RESOURCE_GATHERING,
    RESOURCE_GATHERING_VIRTUAL,
    LOAD_GOOD,

    // Control
    CHECKIN,
    CHANGE_JOB,
    CHANGE_JOB_COME_TO_WORK,

    // Military
    CHANGE_TYPE_AT_BARRACKS,
    HEAL_ENTITY,
    ATTACK_REACTION,
}

/** Single choreography node — direct mapping from jobInfo.xml <node>. */
export interface ChoreoNode {
    task: ChoreoTaskType;
    jobPart: string;       // sprite animation reference (WC_CUT_TREE)
    x: number;             // building-relative offset
    y: number;
    duration: number;      // frames (-1 = until complete)
    dir: number;           // direction constraint (-1 = any, 0-7 = fixed)
    forward: boolean;      // animation playback direction
    visible: boolean;      // settler sprite visible during this node
    useWork: boolean;      // use building's work position
    entity: string;        // material ref (GOOD_WATER) or empty
    trigger: string;       // building trigger ID or empty
}

/** A complete job definition. */
export interface ChoreoJob {
    id: string;            // JOB_WOODCUTTER_WORK
    nodes: ChoreoNode[];
}
```

### 2. JobChoreographyStore — Job Lookup

Thin wrapper over `GameDataLoader.getJob()` that converts parsed XML
into `ChoreoJob` with typed enums.

**File**: `src/game/features/settler-tasks/job-choreography-store.ts`

Responsibilities:
- Convert `JobNode` (from parser) → `ChoreoNode` (typed enum + booleans)
- Map `CEntityTask::GO_TO_TARGET` string → `ChoreoTaskType.GO_TO_TARGET` enum
- Cache converted jobs per (raceId, jobId)
- Expose: `getJob(raceId: RaceId, jobId: string): ChoreoJob | undefined`
- Expose: `getJobsForSettler(raceId: RaceId, unitType: UnitType): ChoreoJob[]`
  (uses animLists from SettlerValues.xml to find which jobs a settler can perform)

### 3. ChoreoTaskExecutors — Node Execution

Strategy map `Record<ChoreoTaskType, ChoreoExecutorFn>` executing individual nodes.
Replaces current `task-executors.ts`.

**File**: `src/game/features/settler-tasks/choreo-executors.ts`

Each executor receives:
```typescript
type ChoreoExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ChoreoContext,
) => TaskResult;
```

`ChoreoContext` bundles:
- `movementController` — pathfinding + movement
- `inventoryManager` — building inventory ops
- `workHandlers` — domain system hooks (tree, stone, crop, etc.)
- `buildingPositionResolver` — convert (buildingId, x, y, useWork) → world position
- `triggerSystem` — fire building overlay animations
- `jobPartResolver` — jobPart → animation sequence key
- `visualService` — animation playback

#### Executor groups (parallelizable implementation):

**Movement executors** (GO_TO_TARGET, GO_TO_TARGET_ROUGHLY, GO_TO_POS, GO_HOME,
GO_TO_SOURCE_PILE, GO_TO_DESTINATION_PILE):
- Resolve target position (entity pos, building pile pos, home building door)
- Delegate to `movementController.moveTo()`
- DONE when arrived (hex distance ≤ 1), CONTINUE while moving
- GO_TO_TARGET_ROUGHLY: larger arrival threshold

**Virtual movement** (GO_VIRTUAL):
- Invisible interior movement within building footprint
- Resolve position from building anchor + (x, y) offset
- Settler not rendered (`visible: false` in node)
- Instant or short duration — no pathfinding, just position set + wait

**Work executors** (WORK, WORK_ON_ENTITY, PLANT):
- Delegate to registered work handler (same handler interface as today)
- Duration from node (convert frames → seconds at 25fps)
- Direction from node.dir if not -1
- Fire node.trigger on start (building overlay animation)

**Virtual work** (WORK_VIRTUAL, WORK_ON_ENTITY_VIRTUAL, PRODUCE_VIRTUAL):
- Same as work but settler invisible
- Building overlay may be visible (triggered)
- Duration-based progress, no entity interaction

**Inventory executors** (GET_GOOD, GET_GOOD_VIRTUAL, PUT_GOOD, PUT_GOOD_VIRTUAL,
RESOURCE_GATHERING, RESOURCE_GATHERING_VIRTUAL, LOAD_GOOD):
- Parse node.entity → EMaterialType
- GET_GOOD: withdraw from building input inventory
- PUT_GOOD: deposit to building output inventory
- RESOURCE_GATHERING: pick up from ground/entity (post-work collection)
- VIRTUAL variants: same logic, settler invisible

**Wait executors** (WAIT, WAIT_VIRTUAL):
- Timer based on node.duration (frames → seconds)
- VIRTUAL: settler invisible

**Control executors** (CHECKIN, SEARCH, CHANGE_JOB):
- CHECKIN: return settler to idle state, mark invisible at building
- SEARCH: find target entity via work handler, store in job state
- CHANGE_JOB: switch to different job ID mid-execution

### 4. JobPartResolver — Sprite Animation Mapping

Maps `jobPart` strings to registered animation sequence keys.

**File**: `src/game/features/settler-tasks/job-part-resolver.ts`

#### Approach: prefix-based mapping table

jobPart names follow the pattern `{PREFIX}_{ACTION}`:
- `WC_WALK`, `WC_CUT_TREE`, `WC_CUT_LOG`, `WC_CARRY_LOG`
- `BA_WALK`, `BA_PICKUP_WATER`, `BA_WORK_DOUGH`, `BA_SHOVEL_UP`
- `FG_WALK`, `FG_WALK_SEED`, `FG_SEED_PLANTS`, `FG_CUT_GRAIN`
- `SML01_WALK`, `SML01_FIGHT` (swordsman L1)

Build a two-level map:
1. **Prefix → settler key**: `WC → woodcutter`, `BA → baker`, `FG → farmer`, etc.
2. **Full jobPart → SETTLER_JOB_INDICES field**: `WC_CUT_TREE → work_chop`, `WC_CUT_LOG → work_cut`

Then resolve to animation sequence key:
- `work_*` fields → `workSequenceKey(index)` based on field position in SETTLER_JOB_INDICES
- `carry_*` fields → `carrySequenceKey(materialType)` or generic carry
- `walk` → walk sequence
- `idle_*` → idle sequence

```typescript
export interface JobPartResolution {
    sequenceKey: string;   // 'work.0', 'walk', 'carry_22', etc.
    loop: boolean;
    stopped: boolean;      // idle = stopped on frame 0
}

resolve(jobPart: string, settler: Entity): JobPartResolution
```

The mapping table is static and can be generated once at startup by cross-referencing
jobPart prefixes extracted from jobInfo.xml with SETTLER_JOB_INDICES keys.

### 5. BuildingPositionResolver — Coordinate System

Converts building-relative (x, y) offsets from jobInfo.xml to world hex positions.

**File**: `src/game/features/settler-tasks/building-position-resolver.ts`

Responsibilities:
- Given `(buildingId, nodeX, nodeY, useWork)` → world `(hexX, hexY)`
- Buildings have anchor position + footprint + work position + door position
- `useWork: true` → use building's designated work position
- `useWork: false` → apply (x, y) as offset from building anchor
- Handle pile positions: source pile (input stack), destination pile (output stack)

Depends on:
- Building entity position and type
- Building footprint data (from buildingInfo.xml, already parsed)
- Work area positions (from work-area-store)

### 6. TriggerSystem — Building Overlay Coordination

Fires building overlay animations synchronized with settler work.

**File**: `src/game/systems/building-overlays/trigger-system.ts`

When a ChoreoNode has a non-empty `trigger` field:
- Parse trigger ID: `TRIGGER_BAKER_WORK`, `TRIGGER_START_SLOT6`, etc.
- Map to building overlay animation slot (from `BUILDING_OVERLAY_JIL_INDICES`)
- Start/stop the overlay animation on the building entity

This connects to the existing `building-overlay-manager.ts` which already
manages overlay animations per building — just needs a trigger API.

### 7. Settler Data Access — Job Selection

**Existing infrastructure**: `settler-data-access.ts` already parses `SettlerValues.xml`
via `GameDataLoader` and derives `SettlerConfig` per `UnitType`. It uses:
- `role` field → searchType (CARRIER_ROLE → GOOD, BUILDER_ROLE → CONSTRUCTION, etc.)
- `searchTypes` field → searchType for free workers (SEARCH_TREE → TREE, etc.)
- `tool` field → **not used yet** (could enforce tool requirements in future)
- `animLists` field → **not used yet** — this is what we need

Currently `animLists` is ignored and jobs are derived as generic strings
(`['work']`, `['plant', 'harvest']`). The change: pass through `animLists`
as actual jobInfo.xml job IDs instead.

```typescript
// Before (current — generic job names derived from role/searchType)
Woodcutter → { searchType: TREE, jobs: ['work'] }
//   → looked up as 'woodcutter.work' in jobs.yaml

// After (animLists from SettlerValues.xml)
Woodcutter → { searchType: TREE, jobs: ['JOB_WOODCUTTER_WORK'] }
//   → looked up in JobChoreographyStore from jobInfo.xml
//   animLists: ['JOB_WOODCUTTER_CHECKIN', 'JOB_WOODCUTTER_WORK']
//   (CHECKIN is idle/return behavior, WORK is the actual production job)
```

Job selection logic in `WorkerTaskExecutor`:
- Filter animLists to actual work jobs (exclude CHECKIN, IDLE variants)
- For settlers with multiple jobs (farmer: PLANT + HARVEST), select based on
  what work handler says is available

### 8. Remove YAML System

Delete:
- `src/game/features/settler-tasks/data/jobs.yaml`
- `src/game/features/settler-tasks/loader.ts` (YAML loader)
- Old `TaskType` enum and `TaskNode` interface (replaced by ChoreoTaskType + ChoreoNode)
- Old `task-executors.ts` (replaced by choreo-executors.ts)

Keep:
- `unit-state-machine.ts` — state machine structure is sound, just drives ChoreoNodes instead
- `worker-task-executor.ts` — job sequencing logic stays, operates on ChoreoNode[] instead
- `carrier-task-executor.ts` — carriers use jobInfo.xml carrier jobs
- Work handler interfaces — domain systems (tree, stone, crop) keep their handlers
- `idle-animation-controller.ts` — idle behavior uses CHECKIN/IDLE jobs from XML

## Implementation Units (parallelizable)

Each unit is a self-contained piece of work that can be implemented independently.
Units within the same phase have no dependencies on each other.

### Phase 1 — Data Layer (no behavior changes)

**Unit 1A: ChoreoNode types and ChoreoTaskType enum**
- New file: `choreo-types.ts`
- Define all types, enums, interfaces listed in subsystem 1
- No imports from existing task system

**Unit 1B: JobChoreographyStore**
- New file: `job-choreography-store.ts`
- Convert `GameDataLoader.getJob()` → `ChoreoJob`
- String→enum mapping for CEntityTask types
- Unit test: parse a few known jobs, verify node counts and types

**Unit 1C: JobPartResolver**
- New file: `job-part-resolver.ts`
- Build prefix→settler mapping from jobInfo.xml jobPart names
- Build jobPart→animation sequence resolution
- Cross-reference with `SETTLER_JOB_INDICES` field names
- Unit test: resolve known jobParts (WC_CUT_TREE → work.0, BA_WALK → walk)

**Unit 1D: BuildingPositionResolver**
- New file: `building-position-resolver.ts`
- Convert (buildingId, x, y, useWork) → world hex coords
- Use building anchor, footprint, work position, pile positions
- Unit test: resolve positions for known building types

### Phase 2 — Executors (parallel, no integration yet)

**Unit 2A: Movement executors**
- GO_TO_TARGET, GO_TO_TARGET_ROUGHLY, GO_TO_POS, GO_TO_POS_ROUGHLY
- GO_HOME, GO_TO_SOURCE_PILE, GO_TO_DESTINATION_PILE
- Uses existing movementController, adds rough-arrival threshold
- Applies node.dir direction constraint on arrival

**Unit 2B: Virtual movement + visibility**
- GO_VIRTUAL executor
- Visibility control: hide/show settler sprite per node.visible
- Position set without pathfinding (interior movement)

**Unit 2C: Work executors**
- WORK, WORK_ON_ENTITY, PLANT
- Duration conversion: frames → seconds (÷ 25)
- Direction constraint from node.dir
- Delegate to work handlers (existing interface)
- Fire trigger on work start

**Unit 2D: Virtual work executors**
- WORK_VIRTUAL, WORK_ON_ENTITY_VIRTUAL, PRODUCE_VIRTUAL
- Same as 2C but settler invisible, trigger-driven building animations

**Unit 2E: Inventory executors**
- GET_GOOD, GET_GOOD_VIRTUAL, PUT_GOOD, PUT_GOOD_VIRTUAL
- RESOURCE_GATHERING, RESOURCE_GATHERING_VIRTUAL, LOAD_GOOD
- Parse node.entity → EMaterialType
- Interact with inventoryManager (withdraw/deposit)

**Unit 2F: Wait + control executors**
- WAIT, WAIT_VIRTUAL (frame-based timer)
- CHECKIN (return to idle, hide at building)
- SEARCH (find target via handler)
- CHANGE_JOB (switch active job ID)

**Unit 2G: TriggerSystem**
- Parse trigger IDs from nodes
- Map to building overlay slots
- Start/stop overlay animations via building-overlay-manager
- Unit test: trigger known overlay animations

### Phase 3 — Integration (sequential)

**Unit 3A: Wire ChoreoJobState into state machine**
- Modify `unit-state-machine.ts` to use ChoreoNode[] instead of TaskNode[]
- Modify `worker-task-executor.ts` to sequence ChoreoNodes
- Job state tracks: current node index, progress, visibility, active trigger

**Unit 3B: Wire settler-data-access to provide XML job IDs**
- Modify `settler-data-access.ts`: derive job IDs from animLists
- Filter CHECKIN/IDLE jobs from work job list
- Job selection in WorkerTaskExecutor uses ChoreoJob from store

**Unit 3C: Wire carrier jobs**
- Carrier IDLE/STRIKE jobs from jobInfo.xml
- Transport job sequence uses GO_TO_SOURCE_PILE / GO_TO_DESTINATION_PILE nodes
- Carrier-specific executors updated

**Unit 3D: Delete YAML system**
- Remove jobs.yaml, loader.ts
- Remove old TaskType, TaskNode, AnimationType
- Remove old task-executors.ts
- Update all imports

### Phase 4 — Polish

**Unit 4A: Race-specific job parameters**
- JobChoreographyStore returns race-specific coordinates/directions
- Settler's race (from player) selects correct job variant

**Unit 4B: CHANGE_JOB / multi-job settlers**
- Settlers with multiple animLists jobs (farmer: plant + harvest)
- CHANGE_JOB node switches active job mid-execution
- Job selection based on handler availability (crops ready → harvest, else → plant)

**Unit 4C: Military job choreography**
- CHANGE_TYPE_AT_BARRACKS (upgrade at barracks)
- HEAL_ENTITY (healer work)
- ATTACK_REACTION (combat response)
- Wire to existing combat system

## Dependencies Between Phases

```
Phase 1A ──┐
Phase 1B ──┤
Phase 1C ──┼── all independent, can run in parallel
Phase 1D ──┘
            │
            ▼
Phase 2A ──┐
Phase 2B ──┤
Phase 2C ──┤
Phase 2D ──┼── all independent, depend only on Phase 1
Phase 2E ──┤
Phase 2F ──┤
Phase 2G ──┘
            │
            ▼
Phase 3A ──► Phase 3B ──► Phase 3D
Phase 3C ──┘              (sequential within phase 3)
            │
            ▼
Phase 4A ──┐
Phase 4B ──┼── independent polish
Phase 4C ──┘
```
