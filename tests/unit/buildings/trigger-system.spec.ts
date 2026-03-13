/**
 * Unit tests for TriggerSystemImpl.
 *
 * Tests the ref-counting state machine: multiple triggers keep a building
 * in Working state until all are stopped.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriggerSystemImpl, type TriggerSystemConfig } from '@/game/features/building-overlays/trigger-system';
import type { BuildingTrigger } from '@/resources/game-data/types';
import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import { Race } from '@/game/core/race';

function makeBuildingEntity(id: number, race: Race = Race.Roman): Entity {
    return { id, type: EntityType.Building, subType: 0, x: 0, y: 0, player: 0, race, operational: true };
}

function makeTriggerDef(id: string): BuildingTrigger {
    return { id, effects: [], patches: [] };
}

describe('TriggerSystemImpl', () => {
    let setWorkingOverlay: ReturnType<typeof vi.fn>;
    let entities: Map<number, Entity>;
    let triggers: Map<string, BuildingTrigger>;
    let system: TriggerSystemImpl;

    const BUILDING_ID = 42;
    const TRIGGER_A = 'TRIGGER_BAKER_WORK';
    const TRIGGER_B = 'TRIGGER_BAKER_SMOKE';

    beforeEach(() => {
        entities = new Map();
        triggers = new Map();
        setWorkingOverlay = vi.fn();

        const config: TriggerSystemConfig = {
            setWorkingOverlay: setWorkingOverlay as (buildingId: number, working: boolean) => void,
            gameState: { getEntity: (id: number) => entities.get(id) },
            dataLoader: { getBuildingTrigger: (_raceId: string, triggerId: string) => triggers.get(triggerId) },
        };
        system = new TriggerSystemImpl(config);
    });

    it('should activate Working overlay on fire and deactivate on stop', () => {
        entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
        triggers.set(TRIGGER_A, makeTriggerDef(TRIGGER_A));

        system.fireTrigger(BUILDING_ID, TRIGGER_A);
        expect(setWorkingOverlay).toHaveBeenCalledWith(BUILDING_ID, true);
        expect(system.hasActiveTrigger(BUILDING_ID)).toBe(true);

        system.stopTrigger(BUILDING_ID, TRIGGER_A);
        expect(setWorkingOverlay).toHaveBeenCalledWith(BUILDING_ID, false);
        expect(system.hasActiveTrigger(BUILDING_ID)).toBe(false);
    });

    it('should be idempotent: firing the same trigger twice does not double-activate', () => {
        entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
        triggers.set(TRIGGER_A, makeTriggerDef(TRIGGER_A));

        system.fireTrigger(BUILDING_ID, TRIGGER_A);
        system.fireTrigger(BUILDING_ID, TRIGGER_A);

        expect(setWorkingOverlay).toHaveBeenCalledOnce();
    });

    it('should ref-count: keep Working active until ALL triggers stop', () => {
        entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
        triggers.set(TRIGGER_A, makeTriggerDef(TRIGGER_A));
        triggers.set(TRIGGER_B, makeTriggerDef(TRIGGER_B));

        system.fireTrigger(BUILDING_ID, TRIGGER_A);
        system.fireTrigger(BUILDING_ID, TRIGGER_B);

        // Stop one — overlay should NOT be deactivated
        system.stopTrigger(BUILDING_ID, TRIGGER_A);
        expect(setWorkingOverlay).not.toHaveBeenCalledWith(BUILDING_ID, false);
        expect(system.hasActiveTrigger(BUILDING_ID)).toBe(true);

        // Stop last — overlay deactivated
        system.stopTrigger(BUILDING_ID, TRIGGER_B);
        expect(setWorkingOverlay).toHaveBeenLastCalledWith(BUILDING_ID, false);
        expect(system.hasActiveTrigger(BUILDING_ID)).toBe(false);
    });

    it('should not activate overlays for unknown triggers, missing entities, or non-buildings', () => {
        // Unknown trigger
        entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
        system.fireTrigger(BUILDING_ID, 'TRIGGER_UNKNOWN');
        expect(setWorkingOverlay).not.toHaveBeenCalled();

        // Missing entity
        system.fireTrigger(999, TRIGGER_A);
        expect(setWorkingOverlay).not.toHaveBeenCalled();

        // Non-building entity
        entities.set(77, {
            id: 77,
            type: EntityType.Unit,
            subType: 0,
            x: 0,
            y: 0,
            player: 0,
            race: Race.Roman,
            operational: true,
        });
        triggers.set(TRIGGER_A, makeTriggerDef(TRIGGER_A));
        system.fireTrigger(77, TRIGGER_A);
        expect(setWorkingOverlay).not.toHaveBeenCalled();
    });

    it('should look up trigger using the building entity race', () => {
        entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID, Race.Viking));
        triggers.set(TRIGGER_A, makeTriggerDef(TRIGGER_A));

        system.fireTrigger(BUILDING_ID, TRIGGER_A);

        expect(setWorkingOverlay).toHaveBeenCalled();
    });

    it('should clear all triggers for a building and reset all state', () => {
        entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
        entities.set(99, makeBuildingEntity(99));
        triggers.set(TRIGGER_A, makeTriggerDef(TRIGGER_A));

        system.fireTrigger(BUILDING_ID, TRIGGER_A);
        system.fireTrigger(99, TRIGGER_A);

        system.clearBuilding(BUILDING_ID);
        expect(system.hasActiveTrigger(BUILDING_ID)).toBe(false);
        expect(system.hasActiveTrigger(99)).toBe(true);

        system.reset();
        expect(system.hasActiveTrigger(99)).toBe(false);
    });
});
