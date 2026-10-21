/**
 * Pile Position Resolver — decides pile tiles at slot creation time.
 *
 * This is the ONLY place pile tiles are computed. The result is stored on
 * PileSlot.position (persisted with the slot) and read back at runtime through
 * BuildingInventoryManager.findPileSlot / getPilePosition (see pile-lookup.ts).
 *
 * Two layouts, one per slot-creation phase:
 * - operational  — completed buildings, from buildingInfo.xml (BuildingPileRegistry):
 *     'input' / 'output' → XML pile offset for (type, race, side, material);
 *                          no XML entry → warn, slot skipped
 *     'storage'          → next XML storage pile offset not taken by another slot of this
 *                          building nor by an existing pile entity on the ground
 * - construction — construction sites, door-adjacent staging tiles
 *     (assignConstructionPilePositions): one tile per pile of ≤ SLOT_CAPACITY items,
 *     piles of one material take consecutive tiles; out of tiles → slot skipped
 */

import type { Tile } from '../../core/coordinates';
import { tileKey } from '../../core/coordinates';
import type { Entity } from '../../entity';
import { EntityType, BuildingType } from '../../entity';
import type { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import { LogHandler } from '@/utilities/log-handler';
import type { BuildingPileRegistry } from './building-pile-registry';
import { SlotKind } from '../../core/pile-kind';
import { assignConstructionPilePositions } from './construction-pile-positions';
import type { SlotPositionResolver } from './building-inventory';

type SlotRequest = { materialType: EMaterialType; kind: SlotKind };

export class PilePositionResolver {
    private readonly log = new LogHandler('PilePositionResolver');
    private readonly gameState: GameState;
    private readonly pileRegistry: BuildingPileRegistry;

    constructor(gameState: GameState, buildingPileRegistry: BuildingPileRegistry) {
        this.gameState = gameState;
        this.pileRegistry = buildingPileRegistry;
    }

    /** Slot positions for a completed building's operational inventory (XML pile layout). */
    readonly operational: SlotPositionResolver = (_buildingId, building, configs) => {
        const usedPositions = new Set<string>();
        return configs.map(cfg => {
            const position = this.resolveOperational(building, cfg, usedPositions);
            if (position) {
                usedPositions.add(tileKey(position));
            }
            return position;
        });
    };

    /** Slot positions for a construction site's material piles (door-adjacent layout). */
    readonly construction: SlotPositionResolver = (_buildingId, building, configs) => {
        const layout = assignConstructionPilePositions(
            building.subType as BuildingType,
            building.race,
            building.x,
            building.y
        );
        const nextPileIndex = new Map<EMaterialType, number>();
        return configs.map(cfg => {
            if (cfg.kind !== SlotKind.Input) {
                throw new Error(`Construction slot for building ${building.id} must be input, got ${cfg.kind}`);
            }
            // eslint-disable-next-line no-restricted-syntax -- first pile of a material has no entry yet; index 0 is the correct start
            const pileIndex = nextPileIndex.get(cfg.materialType) ?? 0;
            nextPileIndex.set(cfg.materialType, pileIndex + 1);
            // Out of staging tiles (already warned by assignConstructionPilePositions) → slot skipped.
            // eslint-disable-next-line no-restricted-syntax -- layout may legitimately lack a tile for this pile; null = skip slot
            return layout.get(cfg.materialType)?.[pileIndex] ?? null;
        });
    };

    private resolveOperational(building: Entity, cfg: SlotRequest, usedPositions: ReadonlySet<string>): Tile | null {
        const bt = building.subType as BuildingType;
        switch (cfg.kind) {
            case SlotKind.Output:
            case SlotKind.Input: {
                const pos = this.pileRegistry.getPilePositionForSlot(
                    bt,
                    building.race,
                    cfg.kind,
                    cfg.materialType,
                    building.x,
                    building.y
                );
                if (!pos) {
                    this.log.warn(
                        `No XML ${cfg.kind} pile position for material ${cfg.materialType} ` +
                            `on building ${building.id} (${bt}); slot skipped`
                    );
                }
                return pos;
            }
            case SlotKind.Storage:
                return this.nextFreeStoragePosition(building, usedPositions);
            case SlotKind.Free:
                throw new Error(`Free pile slots are not created from building configs (building ${building.id})`);
        }
    }

    private nextFreeStoragePosition(building: Entity, usedPositions: ReadonlySet<string>): Tile {
        const bt = building.subType as BuildingType;
        const positions = this.pileRegistry.getStoragePileWorldPositions(bt, building.race, building.x, building.y);
        for (const pos of positions) {
            if (usedPositions.has(tileKey(pos))) {
                continue;
            }
            const occupant = this.gameState.getGroundEntityAt(pos);
            if (occupant?.type === EntityType.StackedPile) {
                continue;
            }
            return pos;
        }
        throw new Error(
            `PilePositionResolver: no free storage pile position for building ${building.id} ` +
                `(${bt}); inventory constraint violated`
        );
    }
}
