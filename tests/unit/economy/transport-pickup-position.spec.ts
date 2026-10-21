/**
 * Carrier pickup walk target must be the source building's OUTPUT pile.
 *
 * The INPUT-side pile is where workers take their inputs. Using it for carrier
 * pickup sent carriers to the door (or the wrong pile), crowding door occupancy.
 */

import { describe, it, expect } from 'vitest';
import { EntityType, BuildingType, type Entity, type Tile } from '@/game/entity';
import { Race } from '@/game/core/race';
import { EMaterialType } from '@/game/economy';
import { TransportJobBuilder } from '@/game/features/logistics/transport-job-builder';
import { TransportPhase, type TransportJobRecord } from '@/game/features/logistics/transport-job-record';
import type { GameState } from '@/game/game-state';
import type { BuildingInventoryManager } from '@/game/features/inventory/building-inventory';
import type { TransportJobDeps } from '@/game/features/logistics/transport-job-service';
import { SlotKind } from '@/game/core/pile-kind';
import type { PileSide } from '@/game/features/inventory';

const SOURCE = 10;
const DEST = 20;
const OUTPUT_PILE: Tile = { x: 12, y: 8 };
const INPUT_PILE: Tile = { x: 8, y: 12 };

function building(id: number, type: BuildingType, tile: Tile): Entity {
    return {
        id,
        type: EntityType.Building,
        subType: type,
        x: tile.x,
        y: tile.y,
        player: 0,
        race: Race.Roman,
    } as Entity;
}

describe('TransportJobBuilder pickup walk target', () => {
    it('walks to the output pile, not the input pile or door', () => {
        const entities = new Map<number, Entity>([
            [SOURCE, building(SOURCE, BuildingType.WoodcutterHut, { x: 10, y: 10 })],
            [DEST, building(DEST, BuildingType.Sawmill, { x: 20, y: 10 })],
        ]);

        const builder = new TransportJobBuilder({
            gameState: {
                getEntityOrThrow: (id: number) => entities.get(id)!,
            } as unknown as GameState,
            inventoryManager: {
                findPileSlot: (_id: number, _m: EMaterialType, side: PileSide) =>
                    side === SlotKind.Output ? { position: OUTPUT_PILE } : { position: INPUT_PILE },
                findSlot: () => ({ position: { x: 21, y: 10 } }),
            } as unknown as BuildingInventoryManager,
            transportJobDeps: {
                jobStore: { get: () => undefined },
            } as unknown as TransportJobDeps,
        });

        const record: TransportJobRecord = {
            id: 1,
            sourceBuilding: SOURCE,
            destBuilding: DEST,
            material: EMaterialType.LOG,
            amount: 1,
            carrierId: 5,
            phase: TransportPhase.Reserved,
            createdAt: 0,
        };

        const job = builder.build(record);

        expect(job.transportData!.sourcePos).toEqual(OUTPUT_PILE);
        expect(job.targetPos).toEqual(OUTPUT_PILE);
    });
});
