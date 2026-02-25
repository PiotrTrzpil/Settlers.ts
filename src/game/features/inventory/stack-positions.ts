/**
 * Stack positions — per-BuildingType, per-Race, per-Material layout for inventory piles.
 *
 * Loaded from `data/stack-positions.yaml`. Each building type + race defines
 * dx/dy offsets (from its anchor tile) keyed by material name.
 * Buildings not listed fall back to auto-calculated adjacent-tile positions.
 *
 * YAML format:
 *   BuildingName:
 *     RaceName:
 *       output:
 *         MATERIAL: { dx, dy }
 *       input:
 *         MATERIAL: { dx, dy }
 *
 * In dev mode the debug "Adjust Stacks" tool saves changes directly to the YAML file
 * via a Vite dev server endpoint.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { BuildingType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { Race } from '../../race';
import type { TileCoord } from '../../coordinates';
import stackPositionsYaml from './data/stack-positions.yaml?raw';

/** Relative offset from building anchor position */
export interface StackOffset {
    dx: number;
    dy: number;
}

/** Stack layout for a single building type + race, keyed by material name */
interface BuildingStackLayout {
    input?: Record<string, StackOffset>;
    output?: Record<string, StackOffset>;
}

/** YAML structure: BuildingName → RaceName → { input, output } */
type RawYaml = Record<string, Record<string, BuildingStackLayout>>;

/** Composite key for (BuildingType, Race) */
function layoutKey(bt: BuildingType, race: Race): string {
    return `${bt}:${race}`;
}

/** Race name → Race enum (matches construction-costs.yaml) */
const RACE_NAME_TO_ENUM: Record<string, Race> = {
    Roman: Race.Roman,
    Viking: Race.Viking,
    Mayan: Race.Mayan,
    DarkTribe: Race.DarkTribe,
    Trojan: Race.Trojan,
};

/** Race enum → name for YAML export */
const RACE_ENUM_TO_NAME: Record<number, string> = {};
for (const [name, value] of Object.entries(RACE_NAME_TO_ENUM)) {
    RACE_ENUM_TO_NAME[value] = name;
}

/** Reverse lookup: BuildingType enum name → numeric value */
const BUILDING_NAME_TO_TYPE: Record<string, BuildingType> = {};
for (const [name, value] of Object.entries(BuildingType)) {
    if (typeof value === 'number') {
        BUILDING_NAME_TO_TYPE[name] = value;
    }
}

/** Forward lookup: numeric BuildingType → enum name */
const BUILDING_TYPE_TO_NAME: Record<number, string> = {};
for (const [name, value] of Object.entries(BuildingType)) {
    if (typeof value === 'number') {
        BUILDING_TYPE_TO_NAME[value] = name;
    }
}

/** EMaterialType name → numeric value */
const MATERIAL_NAME_TO_TYPE: Record<string, EMaterialType> = {};
for (const [name, value] of Object.entries(EMaterialType)) {
    if (typeof value === 'number') {
        MATERIAL_NAME_TO_TYPE[name] = value;
    }
}

/**
 * Manages stack position layouts, loaded from YAML.
 * Keyed by (BuildingType, Race), with individual material positions.
 *
 * In dev mode, edits are saved directly to the YAML source file via the
 * Vite dev server `/__api/write-file` endpoint.
 */
export class StackPositions {
    /** Layouts keyed by "buildingType:race" composite string */
    private layouts = new Map<string, BuildingStackLayout>();

    constructor() {
        this.loadFromYaml();
    }

    /**
     * Get the configured position for a specific material at a building type + race.
     * Returns null if no position is defined (caller should fall back to auto-calculation).
     */
    getPosition(
        buildingType: BuildingType,
        race: Race,
        material: EMaterialType,
        buildingX: number,
        buildingY: number
    ): TileCoord | null {
        const layout = this.layouts.get(layoutKey(buildingType, race));
        if (!layout) return null;

        const materialName = EMaterialType[material];
        const offset = layout.output?.[materialName] ?? layout.input?.[materialName];
        if (!offset) return null;

        return { x: buildingX + offset.dx, y: buildingY + offset.dy };
    }

    /**
     * Get the configured position for a material on a specific side (input/output).
     * Returns null if no position is defined.
     */
    getPositionForSlot(
        buildingType: BuildingType,
        race: Race,
        slotType: 'input' | 'output',
        material: EMaterialType,
        buildingX: number,
        buildingY: number
    ): TileCoord | null {
        const layout = this.layouts.get(layoutKey(buildingType, race));
        if (!layout) return null;

        const side = slotType === 'output' ? layout.output : layout.input;
        if (!side) return null;

        const offset = side[EMaterialType[material]];
        if (!offset) return null;

        return { x: buildingX + offset.dx, y: buildingY + offset.dy };
    }

    /** Check if any layout exists for a building type + race. */
    hasLayout(buildingType: BuildingType, race: Race): boolean {
        return this.layouts.has(layoutKey(buildingType, race));
    }

    /**
     * Set the position for a specific material and save to file.
     */
    setPosition(
        buildingType: BuildingType,
        race: Race,
        slotType: 'input' | 'output',
        material: EMaterialType,
        buildingX: number,
        buildingY: number,
        targetX: number,
        targetY: number
    ): void {
        const key = layoutKey(buildingType, race);
        let layout = this.layouts.get(key);
        if (!layout) {
            layout = {};
            this.layouts.set(key, layout);
        }

        const side = slotType === 'output' ? 'output' : 'input';
        if (!layout[side]) layout[side] = {};
        layout[side][EMaterialType[material]] = { dx: targetX - buildingX, dy: targetY - buildingY };
        this.saveToFile();
    }

    /**
     * Store positions for multiple materials at once (used by generateDefaultPositions).
     * Materials and positions are paired by index.
     */
    setMaterialPositions(
        buildingType: BuildingType,
        race: Race,
        slotType: 'input' | 'output',
        materials: EMaterialType[],
        buildingX: number,
        buildingY: number,
        positions: TileCoord[]
    ): void {
        const key = layoutKey(buildingType, race);
        let layout = this.layouts.get(key);
        if (!layout) {
            layout = {};
            this.layouts.set(key, layout);
        }

        const side = slotType === 'output' ? 'output' : 'input';
        if (!layout[side]) layout[side] = {};
        const record = layout[side];

        for (let i = 0; i < materials.length && i < positions.length; i++) {
            record[EMaterialType[materials[i]!]] = {
                dx: positions[i]!.x - buildingX,
                dy: positions[i]!.y - buildingY,
            };
        }
    }

    /**
     * Save the current positions directly to the YAML file via the Vite dev server.
     */
    saveToFile(): void {
        const yaml = this.exportYaml();
        const filePath = 'src/game/features/inventory/data/stack-positions.yaml';

        fetch('/__api/write-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content: yaml }),
        }).then(
            res => {
                if (res.ok) console.log('Stack positions saved to', filePath);
                else console.warn('Failed to save stack positions:', res.statusText);
            },
            () => {
                console.warn('Dev server endpoint unavailable. YAML output:\n' + yaml);
            }
        );
    }

    // --- Private ---

    private exportYaml(): string {
        const obj = this.buildExportObject();
        if (Object.keys(obj).length === 0) return '';
        return stringifyYaml(this.sortByBuildingType(obj), { indent: 2 });
    }

    private buildExportObject(): RawYaml {
        const obj: RawYaml = {};
        for (const [key, layout] of this.layouts) {
            const [btStr, raceStr] = key.split(':');
            const buildingName = BUILDING_TYPE_TO_NAME[Number(btStr)];
            const raceName = RACE_ENUM_TO_NAME[Number(raceStr)];
            if (!buildingName || !raceName) continue;

            const entry: BuildingStackLayout = {};
            if (layout.output && Object.keys(layout.output).length > 0) entry.output = layout.output;
            if (layout.input && Object.keys(layout.input).length > 0) entry.input = layout.input;
            if (!entry.output && !entry.input) continue;

            const raceMap = obj[buildingName] ?? (obj[buildingName] = {});
            raceMap[raceName] = entry;
        }
        return obj;
    }

    private sortByBuildingType(obj: RawYaml): RawYaml {
        const sorted: RawYaml = {};
        const sortedKeys = Object.keys(obj).sort((a, b) => {
            return (BUILDING_NAME_TO_TYPE[a] ?? 999) - (BUILDING_NAME_TO_TYPE[b] ?? 999);
        });
        for (const k of sortedKeys) {
            sorted[k] = obj[k]!;
        }
        return sorted;
    }

    private loadFromYaml(): void {
        try {
            const raw = parseYaml(stackPositionsYaml) as RawYaml | null;
            if (!raw || typeof raw !== 'object') return;
            this.applyRawYaml(raw);
        } catch (e) {
            console.warn('Failed to parse stack-positions.yaml:', e);
        }
    }

    private applyRawYaml(raw: RawYaml): void {
        for (const [buildingName, racesObj] of Object.entries(raw)) {
            const buildingType = BUILDING_NAME_TO_TYPE[buildingName];
            if (buildingType === undefined) {
                console.warn(`stack-positions.yaml: unknown building type "${buildingName}"`);
                continue;
            }
            this.applyRaceEntries(buildingType, buildingName, racesObj);
        }
    }

    private applyRaceEntries(
        buildingType: BuildingType,
        buildingName: string,
        racesObj: Record<string, BuildingStackLayout>
    ): void {
        for (const [raceName, layout] of Object.entries(racesObj)) {
            const race = RACE_NAME_TO_ENUM[raceName];
            if (race === undefined) {
                console.warn(`stack-positions.yaml: unknown race "${raceName}" for ${buildingName}`);
                continue;
            }
            const entry: BuildingStackLayout = {};
            if (layout.output && typeof layout.output === 'object') entry.output = layout.output;
            if (layout.input && typeof layout.input === 'object') entry.input = layout.input;
            this.layouts.set(layoutKey(buildingType, race), entry);
        }
    }
}
