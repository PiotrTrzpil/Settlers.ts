import type { GameState } from '../../game-state';
import { EntityType } from '../../entity';
import type { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import { distSq } from '../../core/distance';
import { createLogger } from '@/utilities/logger';

const log = createLogger('ToolSourceResolver');

export interface ToolSource {
    pileEntityId: number;
    x: number;
    y: number;
}

export class ToolSourceResolver {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly reservedPiles = new Set<number>();

    constructor(gameState: GameState, inventoryManager: BuildingInventoryManager) {
        this.gameState = gameState;
        this.inventoryManager = inventoryManager;
    }

    findNearestToolPile(material: EMaterialType, nearX: number, nearY: number, player: number): ToolSource | null {
        let bestSource: ToolSource | null = null;
        let bestDistSq = Infinity;

        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.StackedPile) {
                continue;
            }
            if (entity.subType !== material) {
                continue;
            }
            if (entity.player !== player) {
                continue;
            }
            if (this.reservedPiles.has(entity.id)) {
                continue;
            }

            const slot = this.inventoryManager.getSlotByEntityId(entity.id);
            if (!slot) {
                log.warn(
                    `Orphan pile entity ${entity.id} (${entity.subType}) at (${entity.x},${entity.y}) — no inventory slot`
                );
                continue;
            }
            if (slot.kind !== SlotKind.Free) {
                continue;
            }

            const d = distSq(entity, { x: nearX, y: nearY });

            if (d < bestDistSq) {
                bestDistSq = d;
                bestSource = { pileEntityId: entity.id, x: entity.x, y: entity.y };
            }
        }

        return bestSource;
    }

    reserve(pileEntityId: number): void {
        this.reservedPiles.add(pileEntityId);
    }

    release(pileEntityId: number): void {
        this.reservedPiles.delete(pileEntityId);
    }
}
