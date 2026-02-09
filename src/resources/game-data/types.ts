/**
 * TypeScript interfaces for parsed game data from XML files.
 */

/** Race identifiers used in game data */
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
    case 'RACE_ROMAN': return RaceIndex.Roman;
    case 'RACE_VIKING': return RaceIndex.Viking;
    case 'RACE_MAYA': return RaceIndex.Maya;
    case 'RACE_DARK': return RaceIndex.Dark;
    case 'RACE_TROJAN': return RaceIndex.Trojan;
    }
}

// ============ Building Info Types ============

export interface BuildingPileInfo {
    xPixelOffset: number;
    yPixelOffset: number;
    xOffset: number;
    yOffset: number;
    good: string;
    type: number;
    patch: number;
    appearance: number;
}

export interface BuilderInfo {
    xOffset: number;
    yOffset: number;
    dir: number;
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
    /** Working position offset (pixel coords) */
    workingPos: PositionOffset;
    /** Mini flag position offset (pixel coords) */
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
    /** Animation lists for this building */
    animLists: string[];
    /** Resource pile definitions */
    piles: BuildingPileInfo[];
    /** Builder position information */
    builderInfos: BuilderInfo[];
}

// ============ Job Info Types ============

export interface JobNode {
    task: string;
    jobPart: string;
    x: number;
    y: number;
    duration: number;
    dir: number;
    forward: number;
    visible: number;
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
}
