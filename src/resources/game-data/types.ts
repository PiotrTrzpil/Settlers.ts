/**
 * TypeScript interfaces for parsed game data from XML files.
 *
 * This module is a pure data layer — it only knows about XML string identifiers.
 * For domain-typed access (Race, BuildingType enums), use game-data-access.ts in the game layer.
 */

/** Race identifiers used in game data XML files */
export type RaceId = 'RACE_ROMAN' | 'RACE_VIKING' | 'RACE_MAYA' | 'RACE_DARK' | 'RACE_TROJAN';

/** Numeric race index (0-4) */
export enum RaceIndex {
    Roman = 0,
    Viking = 1,
    Maya = 2,
    Dark = 3,
    Trojan = 4,
}

/** Map race ID string to numeric index */
export function raceIdToIndex(raceId: RaceId): RaceIndex {
    switch (raceId) {
        case 'RACE_ROMAN':
            return RaceIndex.Roman;
        case 'RACE_VIKING':
            return RaceIndex.Viking;
        case 'RACE_MAYA':
            return RaceIndex.Maya;
        case 'RACE_DARK':
            return RaceIndex.Dark;
        case 'RACE_TROJAN':
            return RaceIndex.Trojan;
    }
}

// ============ Building Info Types ============

/** Pile type from buildingInfo.xml <pile><type> field */
export enum PileSlotType {
    Output = 0,
    Input = 1,
    Storage = 4,
}

export interface BuildingPileInfo {
    xPixelOffset: number;
    yPixelOffset: number;
    xOffset: number;
    yOffset: number;
    good: string;
    type: PileSlotType;
    patch: number;
    appearance: number;
}

export interface BuilderInfo {
    xOffset: number;
    yOffset: number;
    dir: number;
}

/** Sound effect attached to a building animation patch */
export interface PatchSound {
    /** Sound definition ID (e.g., SOUND_ANIMAL_SHEEP) */
    def: string;
    /** Animation frame that triggers the sound */
    frame: number;
    /** Random chance (0-100) of playing */
    random: number;
}

/** Animation patch on a building (smoke, fire, animals, tower guards, signs) */
export interface BuildingPatch {
    /** Animation slot index */
    slot: number;
    /** Timing: -1 = event-driven, 0 = permanent, >0 = interval in ticks */
    ticks: number;
    /** Animation job name (e.g., BUILDING_BAKERY_FIRE) */
    job: string;
    /** Trigger type: EVENT, TIMED, or PERMANENT */
    type: string;
    /** Optional sound effect */
    sound: PatchSound | null;
}

/** Garrison settler position on military buildings (castles, guard towers) */
export interface BuildingSettlerPos {
    /** Pixel X offset from building anchor */
    xOffset: number;
    /** Pixel Y offset from building anchor */
    yOffset: number;
    /** Direction the settler faces — sprite direction index (0-5) */
    direction: number;
    /** Whether the settler renders on top of the building sprite */
    top: boolean;
}

export interface PositionOffset {
    xOffset: number;
    yOffset: number;
}

export interface BoundingRect {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface BuildingInfo {
    id: string;
    /** Hotspot X position (tile offset) */
    hotSpotX: number;
    /** Hotspot Y position (tile offset) */
    hotSpotY: number;
    /** Stone required for construction */
    stone: number;
    /** Boards required for construction */
    boards: number;
    /** Gold required for construction */
    gold: number;
    /** Number of lines for building footprint bitmask */
    lines: number;
    /** Building position bitmask lines */
    buildingPosLines: number[];
    /** Dig position bitmask lines */
    digPosLines: number[];
    /** Repealing position bitmask lines */
    repealingPosLines: number[];
    /** Block position bitmask lines */
    blockPosLines: number[];
    /** Water position bitmask lines */
    waterPosLines: number[];
    /** Bounding rectangle */
    boundingRect: BoundingRect;
    /** Number of builders required */
    builderNumber: number;
    /** Flag position offset */
    flag: PositionOffset;
    /** Door position offset */
    door: PositionOffset;
    /** Working position offset (tile coords, same as door) */
    workingPos: PositionOffset;
    /** Mini flag position offset */
    miniFlag: PositionOffset;
    /** Number of resource piles */
    pileNumber: number;
    /** Building kind (e.g., HOUSE_KIND_WORKUP) */
    kind: string;
    /** Inhabitant settler type */
    inhabitant: string;
    /** Required tool good type */
    tool: string;
    /** Production delay in ticks */
    productionDelay: number;
    /** Territory influence radius */
    influenceRadius: number;
    /** Explorer/vision radius */
    explorerRadius: number;
    /** Working area radius */
    workingAreaRadius: number;
    /** Whether production should be calculated */
    calcProd: boolean;
    /** Number of settlers this building houses (garrison capacity) */
    settlerNumber: number;
    /** Hit points for military buildings (castles, towers) */
    hitpoints: number;
    /** Armor value for military buildings */
    armor: number;
    /** Settler slot used by animation patches (shipyards) */
    patchSettlerSlot: number;
    /** Water-free position bitmask lines */
    waterFreePosLines: number[];
    /** Water-block position bitmask lines */
    waterBlockPosLines: number[];
    /** Animation patches (smoke, fire, animals, signs, tower guards) */
    patches: BuildingPatch[];
    /** Garrison settler positions for military buildings */
    settlers: BuildingSettlerPos[];
    /** Animation lists for this building */
    animLists: string[];
    /** Resource pile definitions */
    piles: BuildingPileInfo[];
    /** Builder position information */
    builderInfos: BuilderInfo[];

    // ===== Editor metadata (from s4objed.exe) =====
    /** Editor dummy value (always 0) */
    dummyValue: number;
    /** Whether the footprint grid was changed for export */
    gridChangedForExport: number;
    /** Grid format version */
    gridVersion: number;
    /** Editor helper file reference */
    helperFile: string;
    /** Helper sprite X offset */
    helperX: number;
    /** Helper sprite Y offset */
    helperY: number;
}

// ============ Job Info Types ============

export interface JobNode {
    /** Task type (e.g., WORK, GO_TO_POS) — CEntityTask:: prefix stripped at parse time */
    task: string;
    /** Animation/sprite part reference (e.g., BA_WALK, BML01_SHOOT) */
    jobPart: string;
    /** Map X offset */
    x: number;
    /** Map Y offset */
    y: number;
    /** Duration in frames (-1 = infinite, 0 = instant) */
    duration: number;
    /** Direction (-1 = any, 0-5 = specific 6-direction) */
    dir: number;
    /** Animation direction (0 = reverse, 1 = forward) */
    forward: number;
    /** Sprite visibility (0 = invisible, 1 = visible) */
    visible: number;
    /** Whether this node uses the building's work position */
    useWork: boolean;
    /** Good or trigger reference (e.g., GOOD_WATER, TRIGGER_START_SLOT3) */
    entity: string;
    /** Sound/animation trigger ID (e.g., TRIGGER_BAKER_WORK) */
    trigger: string;
}

export interface JobInfo {
    id: string;
    nodes: JobNode[];
}

// ============ Object Info Types ============

export interface ObjectInfo {
    id: string;
    /** 0 = non-blocking, 1+ = blocking level */
    blocking: number;
    /** Is this a building? 0/1 */
    building: number;
    /** Repellent value (prevents building nearby) */
    repellent: number;
    /** Animation type */
    animType: number;
    /** Render layer */
    layer: number;
    /** Object version/variant count */
    version: number;
    /** Ping-pong animation flag */
    pingPong: number;
}

// ============ Building Trigger Types ============

/** Sound effect in a building trigger */
export interface TriggerSound {
    /** Sound definition ID (e.g., SOUND_WORK_LOOKOUTTOWER) */
    def: string;
}

/** Visual effect triggered by a building action (smoke, impact, etc.) */
export interface TriggerEffect {
    /** Effect definition ID (e.g., EFFECT_SMOKE02) */
    def: string;
    /** Duration in frames */
    duration: number;
    /** Start frame */
    frame: number;
    /** Pixel X offset */
    x: number;
    /** Pixel Y offset */
    y: number;
    /** Whether this is a smoke effect */
    smoke: boolean;
    /** Optional sound effect */
    sound: TriggerSound | null;
}

/** Animation patch triggered by a building action (lookout bell, etc.) */
export interface TriggerPatch {
    /** Patch definition ID (e.g., BUILDING_LOOKOUTTOWER_MOVEBELL) */
    def: string;
    /** Animation slot index */
    slot: number;
    /** Duration (0 = play once) */
    duration: number;
    /** Optional sound effect */
    sound: TriggerSound | null;
}

/** A building trigger with its effects and patches */
export interface BuildingTrigger {
    /** Trigger ID (e.g., TRIGGER_BAKER_WORK) */
    id: string;
    /** Visual effects */
    effects: TriggerEffect[];
    /** Animation patches */
    patches: TriggerPatch[];
}

export interface RaceBuildingTriggerData {
    triggers: Map<string, BuildingTrigger>;
}

// ============ Settler Value Types ============

export interface SettlerValueInfo {
    id: string;
    role: string;
    searchTypes: string[];
    tool: string;
    animLists: string[];
}

export interface RaceSettlerValueData {
    settlers: Map<string, SettlerValueInfo>;
}

// ============ Aggregated Game Data ============

export interface RaceBuildingData {
    buildings: Map<string, BuildingInfo>;
}

export interface RaceJobData {
    jobs: Map<string, JobInfo>;
}

export interface GameData {
    /** Building info per race */
    buildings: Map<RaceId, RaceBuildingData>;
    /** Job info per race */
    jobs: Map<RaceId, RaceJobData>;
    /** Object info (not race-specific) */
    objects: Map<string, ObjectInfo>;
    /** Building triggers per race */
    buildingTriggers: Map<RaceId, RaceBuildingTriggerData>;
    /** Settler values per race */
    settlers: Map<RaceId, RaceSettlerValueData>;
}
