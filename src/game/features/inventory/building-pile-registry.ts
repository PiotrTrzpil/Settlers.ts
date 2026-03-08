/**
 * Building Pile Registry
 *
 * Read-only service exposing pile (inventory stack) positions from buildingInfo.xml.
 * Converts raw XML pile data into hotspot-adjusted tile offsets keyed by
 * (BuildingType, Race, Material).
 *
 * Constructed at startup from GameData. Replaces the hand-maintained stack-positions.yaml.
 */

import type { TileCoord } from '../../core/coordinates';
import { EMaterialType } from '../../economy/material-type';
import { Race } from '../../core/race';
import { BuildingType } from '../../buildings/building-type';
import type { GameData, BuildingInfo } from '@/resources/game-data';
import { PileSlotType } from '@/resources/game-data';
import { getBuildingTypesByXmlId, raceIdToRace, xmlGoodToMaterialType } from '../../data/game-data-access';
import { SlotKind } from '../../core/pile-kind';

/** A single pile slot with hotspot-adjusted offsets */
export interface PileSlot {
    material: EMaterialType;
    slotType: SlotKind.Input | SlotKind.Output;
    /** Tile offset from building anchor (already hotspot-adjusted) */
    dx: number;
    dy: number;
}

/** A storage pile position — material-agnostic, bidirectional (input + output) */
export interface StoragePilePosition {
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
    /** Storage pile positions keyed by "buildingType:race" — bidirectional, material-agnostic */
    private storagePositions = new Map<string, StoragePilePosition[]>();

    constructor(gameData: GameData) {
        this.buildFromGameData(gameData);
    }

    /** Get all pile slots for a building type + race */
    getPileSlots(buildingType: BuildingType, race: Race): readonly PileSlot[] {
        return this.slots.get(registryKey(buildingType, race)) ?? [];
    }

    /** Get pile slots filtered to inputs only */
    getInputSlots(buildingType: BuildingType, race: Race): readonly PileSlot[] {
        return this.getPileSlots(buildingType, race).filter(s => s.slotType === SlotKind.Input);
    }

    /** Get pile slots filtered to outputs only */
    getOutputSlots(buildingType: BuildingType, race: Race): readonly PileSlot[] {
        return this.getPileSlots(buildingType, race).filter(s => s.slotType === SlotKind.Output);
    }

    /** Whether this building type has storage piles (bidirectional, material-agnostic) */
    hasStoragePiles(buildingType: BuildingType, race: Race): boolean {
        return this.storagePositions.has(registryKey(buildingType, race));
    }

    /** Get storage pile offsets (anchor-relative) for a building type + race */
    getStoragePilePositions(buildingType: BuildingType, race: Race): readonly StoragePilePosition[] {
        return this.storagePositions.get(registryKey(buildingType, race)) ?? [];
    }

    /** Get storage pile positions as world coordinates */
    getStoragePileWorldPositions(
        buildingType: BuildingType,
        race: Race,
        buildingX: number,
        buildingY: number
    ): TileCoord[] {
        const offsets = this.getStoragePilePositions(buildingType, race);
        return offsets.map(p => ({ x: buildingX + p.dx, y: buildingY + p.dy }));
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
        slotType: SlotKind.Input | SlotKind.Output,
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
                this.registerBuildingPiles(race, xmlId, buildingInfo);
            }
        }
    }

    private registerBuildingPiles(race: Race, xmlId: string, buildingInfo: BuildingInfo): void {
        const buildingTypes = getBuildingTypesByXmlId(xmlId);
        if (!buildingTypes) return;

        const { pileSlots, storageSlots } = this.convertPiles(buildingInfo);

        for (const bt of buildingTypes) {
            const key = registryKey(bt, race);
            if (pileSlots.length > 0) this.slots.set(key, pileSlots);
            if (storageSlots.length > 0) this.storagePositions.set(key, storageSlots);
        }
    }

    private convertPiles(info: BuildingInfo): { pileSlots: PileSlot[]; storageSlots: StoragePilePosition[] } {
        const pileSlots: PileSlot[] = [];
        const storageSlots: StoragePilePosition[] = [];

        for (const pile of info.piles) {
            // Pile xOffset/yOffset are already anchor-relative (like door offsets),
            // NOT in bitmask coordinates — no hotspot subtraction needed.
            const dx = pile.xOffset;
            const dy = pile.yOffset;

            if (pile.type === PileSlotType.Storage) {
                storageSlots.push({ dx, dy });
                continue;
            }

            const slotType = pile.type === PileSlotType.Output ? SlotKind.Output : SlotKind.Input;

            const material = xmlGoodToMaterialType(pile.good);
            if (material === undefined) continue;

            pileSlots.push({ material, slotType, dx, dy });
        }

        return { pileSlots, storageSlots };
    }
}
