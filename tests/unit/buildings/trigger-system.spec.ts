/**
 * Unit tests for TriggerSystemImpl.
 *
 * Tests cover:
 * - fireTrigger: activates Working overlays and tracks active triggers
 * - stopTrigger: deactivates Working overlays when last trigger stops
 * - Multi-trigger ref-counting: building stays Working while any trigger is active
 * - Idempotent fireTrigger: firing the same trigger twice does not double-activate
 * - Unknown trigger: logs warning, does not activate overlays
 * - Missing entity: logs warning, safe no-op
 * - Non-building entity: logs warning, safe no-op
 * - stopTrigger on unknown trigger: safe no-op
 * - clearBuilding: removes all triggers and deactivates overlays
 * - reset: clears all state
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriggerSystemImpl, type TriggerSystemConfig } from '@/game/features/building-overlays/trigger-system';
import type { BuildingOverlayManager } from '@/game/features/building-overlays/building-overlay-manager';
import type { GameState } from '@/game/game-state';
import type { GameDataLoader } from '@/resources/game-data/game-data-loader';
import type { BuildingTrigger } from '@/resources/game-data/types';
import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import { Race } from '@/game/race';

// ============================================================================
// Test helpers
// ============================================================================

function makeBuildingEntity(id: number, race: Race = Race.Roman): Entity {
    return {
        id,
        type: EntityType.Building,
        subType: 0,
        x: 0,
        y: 0,
        player: 0,
        race,
    };
}

function makeUnitEntity(id: number): Entity {
    return {
        id,
        type: EntityType.Unit,
        subType: 0,
        x: 0,
        y: 0,
        player: 0,
        race: Race.Roman,
    };
}

function makeTriggerDef(id: string): BuildingTrigger {
    return { id, effects: [], patches: [] };
}

// ============================================================================
// Mock factories
// ============================================================================

function makeOverlayManagerMock(): BuildingOverlayManager {
    return {
        setWorking: vi.fn(),
        getOverlays: vi.fn(),
        addBuilding: vi.fn(),
        removeBuilding: vi.fn(),
        tick: vi.fn(),
        setFrameCount: vi.fn(),
        setFrameCountForDef: vi.fn(),
        registerEvents: vi.fn(),
        unregisterEvents: vi.fn(),
        rebuildFromExistingEntities: vi.fn(),
        destroy: vi.fn(),
    } as unknown as BuildingOverlayManager;
}

function makeGameStateMock(entities: Map<number, Entity> = new Map()): GameState {
    return {
        getEntity: vi.fn((id: number) => entities.get(id)),
        getEntityOrThrow: vi.fn((id: number, ctx?: string) => {
            const e = entities.get(id);
            if (!e) throw new Error(`Entity ${id}${ctx ? ` (${ctx})` : ''} not found`);
            return e;
        }),
    } as unknown as GameState;
}

function makeDataLoaderMock(triggers: Map<string, BuildingTrigger> = new Map()): GameDataLoader {
    return {
        getBuildingTrigger: vi.fn((_raceId: string, triggerId: string) => triggers.get(triggerId)),
    } as unknown as GameDataLoader;
}

// ============================================================================
// Setup
// ============================================================================

describe('TriggerSystemImpl', () => {
    let overlayManager: ReturnType<typeof makeOverlayManagerMock>;
    let entities: Map<number, Entity>;
    let triggers: Map<string, BuildingTrigger>;
    let gameState: ReturnType<typeof makeGameStateMock>;
    let dataLoader: ReturnType<typeof makeDataLoaderMock>;
    let system: TriggerSystemImpl;

    const BUILDING_ID = 42;
    const TRIGGER_ID = 'TRIGGER_BAKER_WORK';
    const TRIGGER_ID_2 = 'TRIGGER_BAKER_SMOKE';

    beforeEach(() => {
        entities = new Map();
        triggers = new Map();
        overlayManager = makeOverlayManagerMock();
        gameState = makeGameStateMock(entities);
        dataLoader = makeDataLoaderMock(triggers);

        const config: TriggerSystemConfig = {
            overlayManager: overlayManager as unknown as BuildingOverlayManager,
            gameState: gameState as unknown as GameState,
            dataLoader: dataLoader as unknown as GameDataLoader,
        };
        system = new TriggerSystemImpl(config);
    });

    // ========================================================================
    // fireTrigger
    // ========================================================================

    describe('fireTrigger', () => {
        it('activates Working overlay when trigger fires on a known building', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);

            expect(overlayManager.setWorking).toHaveBeenCalledOnce();
            expect(overlayManager.setWorking).toHaveBeenCalledWith(BUILDING_ID, true);
        });

        it('records the trigger as active', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);

            expect(system.hasActiveTrigger(BUILDING_ID)).toBe(true);
            expect(system.getActiveTriggers(BUILDING_ID).has(TRIGGER_ID)).toBe(true);
        });

        it('is idempotent: firing the same trigger twice does not double-activate', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);
            system.fireTrigger(BUILDING_ID, TRIGGER_ID);

            // setWorking should only be called once (on the first fire)
            expect(overlayManager.setWorking).toHaveBeenCalledOnce();
        });

        it('does not activate overlays for unknown trigger IDs', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            // Do NOT add the trigger to the triggers map

            system.fireTrigger(BUILDING_ID, 'TRIGGER_UNKNOWN');

            expect(overlayManager.setWorking).not.toHaveBeenCalled();
            expect(system.hasActiveTrigger(BUILDING_ID)).toBe(false);
        });

        it('is a safe no-op when building entity does not exist', () => {
            // Entity not in map — should not throw

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);

            expect(overlayManager.setWorking).not.toHaveBeenCalled();
        });

        it('is a safe no-op when entity is not a building', () => {
            entities.set(BUILDING_ID, makeUnitEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);

            expect(overlayManager.setWorking).not.toHaveBeenCalled();
        });

        it('is a no-op for empty trigger IDs', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));

            system.fireTrigger(BUILDING_ID, '');

            expect(overlayManager.setWorking).not.toHaveBeenCalled();
        });

        it('looks up the trigger using the building entity race', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID, Race.Viking));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);

            // dataLoader.getBuildingTrigger should be called with the Viking race ID
            expect(dataLoader.getBuildingTrigger).toHaveBeenCalledWith('RACE_VIKING', TRIGGER_ID);
        });
    });

    // ========================================================================
    // stopTrigger
    // ========================================================================

    describe('stopTrigger', () => {
        it('deactivates Working overlay when the last trigger stops', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);
            system.stopTrigger(BUILDING_ID, TRIGGER_ID);

            expect(overlayManager.setWorking).toHaveBeenCalledWith(BUILDING_ID, false);
        });

        it('removes the trigger from the active set', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);
            system.stopTrigger(BUILDING_ID, TRIGGER_ID);

            expect(system.hasActiveTrigger(BUILDING_ID)).toBe(false);
        });

        it('keeps Working overlay active when another trigger is still running', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));
            triggers.set(TRIGGER_ID_2, makeTriggerDef(TRIGGER_ID_2));

            // Fire two triggers
            system.fireTrigger(BUILDING_ID, TRIGGER_ID);
            system.fireTrigger(BUILDING_ID, TRIGGER_ID_2);

            // Stop one — overlay should NOT be deactivated yet
            system.stopTrigger(BUILDING_ID, TRIGGER_ID);

            const setWorkingCalls = vi.mocked(overlayManager.setWorking).mock.calls;
            // setWorking(true) called twice (once per trigger), setWorking(false) never
            const deactivateCalls = setWorkingCalls.filter(([, working]) => !working);
            expect(deactivateCalls).toHaveLength(0);
            expect(system.hasActiveTrigger(BUILDING_ID)).toBe(true);
        });

        it('deactivates Working overlay only after all triggers have stopped', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));
            triggers.set(TRIGGER_ID_2, makeTriggerDef(TRIGGER_ID_2));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);
            system.fireTrigger(BUILDING_ID, TRIGGER_ID_2);
            system.stopTrigger(BUILDING_ID, TRIGGER_ID);
            system.stopTrigger(BUILDING_ID, TRIGGER_ID_2);

            expect(overlayManager.setWorking).toHaveBeenLastCalledWith(BUILDING_ID, false);
            expect(system.hasActiveTrigger(BUILDING_ID)).toBe(false);
        });

        it('is a safe no-op when the trigger was never fired', () => {
            // No entity, no trigger fired — should not throw

            system.stopTrigger(BUILDING_ID, TRIGGER_ID);

            expect(overlayManager.setWorking).not.toHaveBeenCalled();
        });

        it('is a safe no-op for empty trigger IDs', () => {
            system.stopTrigger(BUILDING_ID, '');

            expect(overlayManager.setWorking).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // clearBuilding
    // ========================================================================

    describe('clearBuilding', () => {
        it('deactivates overlays and removes all triggers for a building', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);
            system.clearBuilding(BUILDING_ID);

            expect(overlayManager.setWorking).toHaveBeenLastCalledWith(BUILDING_ID, false);
            expect(system.hasActiveTrigger(BUILDING_ID)).toBe(false);
        });

        it('is a safe no-op when the building has no active triggers', () => {
            system.clearBuilding(BUILDING_ID);

            expect(overlayManager.setWorking).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // reset
    // ========================================================================

    describe('reset', () => {
        it('clears all active triggers across all buildings', () => {
            const BUILDING_B = 99;
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            entities.set(BUILDING_B, makeBuildingEntity(BUILDING_B));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);
            system.fireTrigger(BUILDING_B, TRIGGER_ID);

            system.reset();

            expect(system.hasActiveTrigger(BUILDING_ID)).toBe(false);
            expect(system.hasActiveTrigger(BUILDING_B)).toBe(false);
        });
    });

    // ========================================================================
    // getActiveTriggers
    // ========================================================================

    describe('getActiveTriggers', () => {
        it('returns an empty set when no triggers are active', () => {
            const set = system.getActiveTriggers(BUILDING_ID);
            expect(set.size).toBe(0);
        });

        it('returns all active trigger IDs for a building', () => {
            entities.set(BUILDING_ID, makeBuildingEntity(BUILDING_ID));
            triggers.set(TRIGGER_ID, makeTriggerDef(TRIGGER_ID));
            triggers.set(TRIGGER_ID_2, makeTriggerDef(TRIGGER_ID_2));

            system.fireTrigger(BUILDING_ID, TRIGGER_ID);
            system.fireTrigger(BUILDING_ID, TRIGGER_ID_2);

            const active = system.getActiveTriggers(BUILDING_ID);
            expect(active.has(TRIGGER_ID)).toBe(true);
            expect(active.has(TRIGGER_ID_2)).toBe(true);
            expect(active.size).toBe(2);
        });
    });
});
