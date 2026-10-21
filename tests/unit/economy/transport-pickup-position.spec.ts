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
import { TransportJobKind } from '@/game/features/logistics/transport-job-kind';
import { TransportJobStore } from '@/game/features/logistics/transport-job-store';
import { TransportPhase, type TransportJobRecord } from '@/game/features/logistics/transport-job-record';
import type { GameState } from '@/game/game-state';
import type { EventBus } from '@/game/event-bus';
import type { BuildingInventoryManager } from '@/game/features/inventory/building-inventory';
import type { TransportJobDeps } from '@/game/features/logistics/transport-job-service';
import { ChoreoTaskType } from '@/game/systems/choreo';
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

describe('Transport job pickup walk target', () => {
    it('walks to the output pile, not the input pile or door', () => {
        const entities = new Map<number, Entity>([
            [SOURCE, building(SOURCE, BuildingType.WoodcutterHut, { x: 10, y: 10 })],
            [DEST, building(DEST, BuildingType.Sawmill, { x: 20, y: 10 })],
        ]);

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

        const jobStore = new TransportJobStore();
        jobStore.add(record);
        const handler = new TransportJobKind({
            gameState: {
                getEntityOrThrow: (id: number) => entities.get(id)!,
            } as unknown as GameState,
            eventBus: {} as EventBus,
            inventoryManager: {
                findPileSlot: (_id: number, _m: EMaterialType, side: PileSide) =>
                    side === SlotKind.Output ? { position: OUTPUT_PILE } : { position: INPUT_PILE },
                findSlot: () => ({ position: { x: 21, y: 10 } }),
            } as unknown as BuildingInventoryManager,
            jobStore,
            transportJobDeps: {} as TransportJobDeps,
            jobs: { assign: () => true },
        });

        const job = handler.build(record.carrierId, { recordId: record.id });
        const sourceWalk = job.nodes.find(n => n.task === ChoreoTaskType.TRANSPORT_GO_TO_SOURCE)!;

        expect(sourceWalk.goal).toEqual(OUTPUT_PILE);
        expect(job.targetPos).toEqual(OUTPUT_PILE);
    });
});
