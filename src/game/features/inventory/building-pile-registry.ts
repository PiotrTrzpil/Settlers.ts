/**
 * Building Pile Registry
 *
 * Read-only service exposing pile (inventory stack) positions from buildingInfo.xml.
 * Converts raw XML pile data into hotspot-adjusted tile offsets keyed by
 * (BuildingType, Race, Material).
 *
 * Constructed at startup from GameData. Replaces the hand-maintained stack-positions.yaml.
 */

import type { TileCoord } from '../../coordinates';
import { EMaterialType } from '../../economy/material-type';
import { Race } from '../../race';
import { BuildingType } from '../../buildings/building-type';
import type { GameData, BuildingInfo } from '@/resources/game-data';
import { PileSlotType } from '@/resources/game-data';
import { getBuildingTypesByXmlId, raceIdToRace, xmlGoodToMaterialType } from '../../game-data-access';

/** A single pile slot with hotspot-adjusted offsets */
export interface PileSlot {
    material: EMaterialType;
    slotType: 'input' | 'output';
    /** Tile offset from building anchor (already hotspot-adjusted) */
    dx: number;
    dy: number;
}

/** Composite key for (BuildingType, Race) */
function registryKey(buildingType: BuildingType, race: Race): string {
    return `${buildingType}:${race}`;
}

export class BuildingPileRegistry {
    /** Pile slots keyed by "buildingType:race" */
    private slots = new Map<string, PileSlot[]>();

    constructor(gameData: GameData) {
        this.buildFromGameData(gameData);
    }

    /** Get all pile slots for a building type + race */
    getPileSlots(buildingType: BuildingType, race: Race): readonly PileSlot[] {
        return this.slots.get(registryKey(buildingType, race)) ?? [];
    }

    /** Get pile slots filtered to inputs only */
    getInputSlots(buildingType: BuildingType, race: Race): readonly PileSlot[] {
        return this.getPileSlots(buildingType, race).filter(s => s.slotType === 'input');
    }

    /** Get pile slots filtered to outputs only */
    getOutputSlots(buildingType: BuildingType, race: Race): readonly PileSlot[] {
        return this.getPileSlots(buildingType, race).filter(s => s.slotType === 'output');
    }

    /** Get the tile position for a specific material at a building */
    getPilePosition(
        buildingType: BuildingType,
        race: Race,
        material: EMaterialType,
        buildingX: number,
        buildingY: number
    ): TileCoord | null {
        const slots = this.getPileSlots(buildingType, race);
        const slot = slots.find(s => s.material === material);
        if (!slot) return null;
        return { x: buildingX + slot.dx, y: buildingY + slot.dy };
    }

    /** Get the tile position for a specific material on a specific side (input/output) */
    getPilePositionForSlot(
        buildingType: BuildingType,
        race: Race,
        slotType: 'input' | 'output',
        material: EMaterialType,
        buildingX: number,
        buildingY: number
    ): TileCoord | null {
        const slots = this.getPileSlots(buildingType, race);
        const slot = slots.find(s => s.material === material && s.slotType === slotType);
        if (!slot) return null;
        return { x: buildingX + slot.dx, y: buildingY + slot.dy };
    }

    // --- Private ---

    private buildFromGameData(gameData: GameData): void {
        for (const [raceId, raceBuildingData] of gameData.buildings) {
            const race = raceIdToRace(raceId);
            for (const [xmlId, buildingInfo] of raceBuildingData.buildings) {
                const buildingTypes = getBuildingTypesByXmlId(xmlId);
                if (!buildingTypes) continue;

                const pileSlots = this.convertPiles(buildingInfo);
                if (pileSlots.length === 0) continue;

                for (const bt of buildingTypes) {
                    this.slots.set(registryKey(bt, race), pileSlots);
                }
            }
        }
    }

    private convertPiles(info: BuildingInfo): PileSlot[] {
        const result: PileSlot[] = [];

        for (const pile of info.piles) {
            // Skip storage entries (type=4)
            if (pile.type === PileSlotType.Storage) continue;

            const slotType = pile.type === PileSlotType.Output ? 'output' : 'input';

            const material = xmlGoodToMaterialType(pile.good);
            if (material === undefined) continue;

            // Pile xOffset/yOffset are already anchor-relative (like door offsets),
            // NOT in bitmask coordinates — no hotspot subtraction needed.
            const dx = pile.xOffset;
            const dy = pile.yOffset;

            result.push({ material, slotType, dx, dy });
        }

        return result;
    }
}
