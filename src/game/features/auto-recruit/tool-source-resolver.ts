import type { GameState } from '../../game-state';
import { EntityType } from '../../entity';
import type { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../inventory/pile-kind';

export interface ToolSource {
    pileEntityId: number;
    x: number;
    y: number;
}

export class ToolSourceResolver {
    private readonly gameState: GameState;
    private readonly reservedPiles = new Set<number>();

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    findNearestToolPile(material: EMaterialType, nearX: number, nearY: number, player: number): ToolSource | null {
        let bestSource: ToolSource | null = null;
        let bestDistSq = Infinity;

        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.StackedPile) continue;
            if (entity.subType !== (material as number)) continue;
            if (entity.player !== player) continue;
            if (this.reservedPiles.has(entity.id)) continue;

            const kind = this.gameState.piles.getKind(entity.id);
            if (kind.kind !== SlotKind.Free) continue;

            const dx = entity.x - nearX;
            const dy = entity.y - nearY;
            const distSq = dx * dx + dy * dy;

            if (distSq < bestDistSq) {
                bestDistSq = distSq;
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
