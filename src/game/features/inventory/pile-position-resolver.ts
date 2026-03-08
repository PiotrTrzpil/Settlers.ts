/**
 * Pile Position Resolver
 *
 * Dispatches pile position resolution to the correct strategy based on slotKind:
 * - 'output' / 'input'  → BuildingPileRegistry (XML-defined, always present)
 * - 'construction'      → getConstructionPilePosition (door-adjacent staging)
 * - 'storage'           → BuildingPileRegistry.getStoragePileWorldPositions (first free slot)
 */

import type { TileCoord } from '../../core/coordinates';
import { tileKey } from '../../core/coordinates';
import type { Entity } from '../../entity';
import { EntityType, BuildingType } from '../../entity';
import type { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import { LogHandler } from '@/utilities/log-handler';
import type { BuildingPileRegistry } from './building-pile-registry';
import type { LinkedSlotKind } from '../../core/pile-kind';
import { SlotKind } from '../../core/pile-kind';
import { getConstructionCandidates, getConstructionPilePosition } from './construction-pile-positions';

export class PilePositionResolver {
    private readonly log = new LogHandler('PilePositionResolver');
    private readonly gameState: GameState;
    private readonly pileRegistry: BuildingPileRegistry;

    constructor(gameState: GameState, buildingPileRegistry: BuildingPileRegistry) {
        this.gameState = gameState;
        this.pileRegistry = buildingPileRegistry;
    }

    /**
     * Resolve the tile coordinate where a pile for the given material and slotKind should be placed.
     *
     * - 'output' / 'input': XML must define a position; throws if absent.
     * - 'construction': returns door-adjacent tile, or null when all are occupied.
     * - 'storage': picks first XML-defined storage slot not in use; throws if all occupied
     *   (inventory constraint guarantees a free slot exists).
     */
    resolvePosition(params: {
        buildingId: number;
        building: Entity;
        material: EMaterialType;
        slotKind: LinkedSlotKind;
        usedPositions: ReadonlySet<string>;
    }): TileCoord | null {
        const { building, material, slotKind, usedPositions } = params;
        const bt = building.subType as BuildingType;

        switch (slotKind) {
        case SlotKind.Output: {
            const pos = this.pileRegistry.getPilePositionForSlot(
                bt,
                building.race,
                SlotKind.Output,
                material,
                building.x,
                building.y
            );
            if (!pos) {
                throw new Error(
                    `PilePositionResolver: no XML output pile position for material ${material} ` +
                            `on building ${building.id} (${BuildingType[bt]})`
                );
            }
            return pos;
        }

        case SlotKind.Input: {
            const pos = this.pileRegistry.getPilePositionForSlot(
                bt,
                building.race,
                SlotKind.Input,
                material,
                building.x,
                building.y
            );
            if (!pos) {
                throw new Error(
                    `PilePositionResolver: no XML input pile position for material ${material} ` +
                            `on building ${building.id} (${BuildingType[bt]})`
                );
            }
            return pos;
        }

        case SlotKind.Construction: {
            return getConstructionPilePosition(building, material, usedPositions, this.gameState);
        }

        case SlotKind.Storage: {
            const positions = this.pileRegistry.getStoragePileWorldPositions(
                bt,
                building.race,
                building.x,
                building.y
            );
            for (const pos of positions) {
                const key = tileKey(pos.x, pos.y);
                if (usedPositions.has(key)) continue;
                const occupant = this.gameState.getEntityAt(pos.x, pos.y);
                if (occupant?.type === EntityType.StackedPile) continue;
                return pos;
            }
            throw new Error(
                `PilePositionResolver: no free storage pile position for building ${building.id} ` +
                        `(${BuildingType[bt]}); inventory constraint violated`
            );
        }
        }
    }

    /**
     * Returns the ordered list of candidate staging tiles for construction piles.
     * Exposed primarily for tests.
     */
    getConstructionCandidates(building: Entity): TileCoord[] {
        return getConstructionCandidates(building);
    }
}
