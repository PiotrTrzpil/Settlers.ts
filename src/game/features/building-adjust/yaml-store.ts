/**
 * YAML-backed store for building property offsets.
 *
 * Shared persistence layer used by entrance and sprite-layer handlers.
 * Loads from a YAML string at construction, provides get/set by composite key
 * (BuildingType + Race + itemKey), and saves via the Vite dev server endpoint.
 *
 * YAML format:
 *   BuildingName:
 *     RaceName:
 *       itemKey: { ...offset fields }
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { BuildingType } from '../../entity';
import { Race } from '../../race';
import { writeDevFile } from '@/utilities/dev-file-writer';

// ============================================================================
// Lookup tables (shared with stack-positions.ts)
// ============================================================================

const RACE_NAME_TO_ENUM: Record<string, Race> = {
    Roman: Race.Roman,
    Viking: Race.Viking,
    Mayan: Race.Mayan,
    DarkTribe: Race.DarkTribe,
    Trojan: Race.Trojan,
};

const RACE_ENUM_TO_NAME: Record<number, string> = {};
for (const [name, value] of Object.entries(RACE_NAME_TO_ENUM)) {
    RACE_ENUM_TO_NAME[value] = name;
}

const BUILDING_NAME_TO_TYPE: Record<string, BuildingType> = {};
const BUILDING_TYPE_TO_NAME: Record<number, string> = {};
for (const [name, value] of Object.entries(BuildingType)) {
    if (typeof value === 'number') {
        BUILDING_NAME_TO_TYPE[name] = value;
        BUILDING_TYPE_TO_NAME[value] = name;
    }
}

/** Composite key for (BuildingType, Race) */
function layoutKey(bt: BuildingType, race: Race): string {
    return `${bt}:${race}`;
}

// ============================================================================
// Generic offset record type
// ============================================================================

/** Any plain-object offset (dx/dy for tiles, px/py for pixels). */
export type OffsetRecord = Record<string, number>;

/** YAML structure: BuildingName → RaceName → itemKey → offset */
type RawYaml = Record<string, Record<string, Record<string, OffsetRecord>>>;

// ============================================================================
// YamlStore
// ============================================================================

export class YamlStore {
    private readonly data = new Map<string, Map<string, OffsetRecord>>();
    private readonly filePath: string;

    constructor(yamlContent: string, filePath: string) {
        this.filePath = filePath;
        this.loadFromYaml(yamlContent);
    }

    /** Get the offset for a specific item. */
    get(buildingType: BuildingType, race: Race, itemKey: string): OffsetRecord | null {
        const items = this.data.get(layoutKey(buildingType, race));
        if (!items) return null;
        return items.get(itemKey) ?? null;
    }

    /** Set the offset for a specific item. */
    set(buildingType: BuildingType, race: Race, itemKey: string, offset: OffsetRecord): void {
        const key = layoutKey(buildingType, race);
        let items = this.data.get(key);
        if (!items) {
            items = new Map();
            this.data.set(key, items);
        }
        items.set(itemKey, offset);
    }

    /** Save to disk via the Vite dev server (HMR-safe). */
    save(): void {
        writeDevFile(this.filePath, this.exportYaml());
    }

    // --- Private ---

    private exportYaml(): string {
        const obj: RawYaml = {};
        for (const [compositeKey, items] of this.data) {
            const [btStr, raceStr] = compositeKey.split(':');
            const buildingName = BUILDING_TYPE_TO_NAME[Number(btStr)];
            const raceName = RACE_ENUM_TO_NAME[Number(raceStr)];
            if (!buildingName || !raceName) continue;
            if (items.size === 0) continue;

            const raceMap = obj[buildingName] ?? (obj[buildingName] = {});
            const itemObj: Record<string, OffsetRecord> = {};
            for (const [itemKey, offset] of items) {
                itemObj[itemKey] = offset;
            }
            raceMap[raceName] = itemObj;
        }

        if (Object.keys(obj).length === 0) return '';

        // Sort by building type enum value for stable output
        const sorted: RawYaml = {};
        const sortedKeys = Object.keys(obj).sort(
            (a, b) => (BUILDING_NAME_TO_TYPE[a] ?? 999) - (BUILDING_NAME_TO_TYPE[b] ?? 999)
        );
        for (const k of sortedKeys) sorted[k] = obj[k]!;

        return stringifyYaml(sorted, { indent: 2 });
    }

    private loadFromYaml(content: string): void {
        try {
            const raw = parseYaml(content) as RawYaml | null;
            if (!raw || typeof raw !== 'object') return;

            for (const [buildingName, racesObj] of Object.entries(raw)) {
                this.loadBuildingEntry(buildingName, racesObj);
            }
        } catch (e) {
            console.warn(`Failed to parse ${this.filePath}:`, e);
        }
    }

    private loadBuildingEntry(buildingName: string, racesObj: Record<string, Record<string, OffsetRecord>>): void {
        const buildingType = BUILDING_NAME_TO_TYPE[buildingName];
        if (buildingType === undefined) {
            console.warn(`${this.filePath}: unknown building "${buildingName}"`);
            return;
        }
        for (const [raceName, itemsObj] of Object.entries(racesObj)) {
            this.loadRaceEntry(buildingType, buildingName, raceName, itemsObj);
        }
    }

    private loadRaceEntry(
        buildingType: BuildingType,
        buildingName: string,
        raceName: string,
        itemsObj: Record<string, OffsetRecord>
    ): void {
        const race = RACE_NAME_TO_ENUM[raceName];
        if (race === undefined) {
            console.warn(`${this.filePath}: unknown race "${raceName}" for ${buildingName}`);
            return;
        }
        const key = layoutKey(buildingType, race);
        const items = new Map<string, OffsetRecord>();
        for (const [itemKey, offset] of Object.entries(itemsObj)) {
            if (typeof offset === 'object') {
                items.set(itemKey, offset);
            }
        }
        if (items.size > 0) this.data.set(key, items);
    }
}
