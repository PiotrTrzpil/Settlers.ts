/**
 * Pile Position Resolver
 *
 * Dispatches pile position resolution to the correct strategy based on slotKind:
 * - 'input' (construction) → ConstructionSiteManager.getConstructionPilePosition (when hasSite)
 * - 'output' / 'input'     → BuildingPileRegistry (XML-defined, always present)
 * - 'storage'              → BuildingPileRegistry.getStoragePileWorldPositions (first free slot)
 */

import type { TileCoord } from '../../core/coordinates';
import { tileKey } from '../../core/coordinates';
import type { Entity } from '../../entity';
import { EntityType, BuildingType } from '../../entity';
import type { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import { LogHandler } from '@/utilities/log-handler';
import type { BuildingPileRegistry } from '../../systems/inventory/building-pile-registry';
import type { LinkedSlotKind } from '../../core/pile-kind';
import { SlotKind } from '../../core/pile-kind';
import { getConstructionCandidates } from '../../systems/inventory/construction-pile-positions';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';

export class PilePositionResolver {
    private readonly log = new LogHandler('PilePositionResolver');
    private readonly gameState: GameState;
    private readonly pileRegistry: BuildingPileRegistry;
    private readonly constructionSiteManager: ConstructionSiteManager;

    constructor(gameState: GameState, buildingPileRegistry: BuildingPileRegistry, csm: ConstructionSiteManager) {
        this.gameState = gameState;
        this.pileRegistry = buildingPileRegistry;
        this.constructionSiteManager = csm;
    }

    /**
     * Resolve the tile coordinate where a pile for the given material and slotKind should be placed.
     *
     * - 'input' on a construction site: returns door-adjacent tile, or null when all occupied.
     * - 'output' / 'input': XML must define a position; warns and returns null if absent.
     * - 'storage': picks first XML-defined storage slot not in use; throws if all occupied
     *   (inventory constraint guarantees a free slot exists).
     */
    resolvePosition(params: {
        buildingId: number;
        building: Entity;
        material: EMaterialType;
        slotKind: LinkedSlotKind;
        usedPositions: ReadonlySet<string>;
        /** For construction piles: which pile index (when a material has multiple piles). Default 0. */
        pileIndex?: number;
    }): TileCoord | null {
        const { building, material, slotKind, usedPositions } = params;
        const bt = building.subType as BuildingType;

        switch (slotKind) {
            case SlotKind.Output:
            case SlotKind.Input: {
                // Construction sites: use door-adjacent positions instead of XML
                if (slotKind === SlotKind.Input && this.constructionSiteManager.hasSite(params.buildingId)) {
                    return (
                        this.constructionSiteManager.getConstructionPilePosition(
                            params.buildingId,
                            material,
                            params.pileIndex ?? 0
                        ) ?? null
                    );
                }
                const pos = this.pileRegistry.getPilePositionForSlot(
                    bt,
                    building.race,
                    slotKind,
                    material,
                    building.x,
                    building.y
                );
                if (!pos) {
                    this.log.warn(
                        `No XML ${slotKind} pile position for material ${material} ` +
                            `on building ${building.id} (${BuildingType[bt]}); slot skipped`
                    );
                }
                return pos ?? null;
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
                    if (usedPositions.has(key)) {
                        continue;
                    }
                    const occupant = this.gameState.getGroundEntityAt(pos.x, pos.y);
                    if (occupant?.type === EntityType.StackedPile) {
                        continue;
                    }
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
        return getConstructionCandidates(building.subType as BuildingType, building.race, building.x, building.y);
    }
}
